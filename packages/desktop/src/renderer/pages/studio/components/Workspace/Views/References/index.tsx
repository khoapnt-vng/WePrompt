/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Empty, Popconfirm, Progress, Select, Tag } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioRendererJobV2 } from '@/common/types/project/creativeStudioTypes';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';
import styles from './References.module.css';
import { referenceWorkspaceStatus } from './referenceStatus';

export type ReferenceCandidateJob = Pick<
  StudioRendererJobV2,
  'id' | 'status' | 'error' | 'canCancel' | 'canRetry' | 'canRetryDownload'
>;

export type ReferenceWorkspaceItem = {
  id: string;
  kind: 'character' | 'background';
  label: string;
  description: string | null;
  approvedAssetId: string | null;
  candidateAssetId: string | null;
  generationStatus: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';
  candidateJob: ReferenceCandidateJob | null;
};

export type ReferenceBindingWorkspaceItem = {
  shotId: string;
  beatId: string;
  beatTitle: string;
  shotPosition: number;
  shootingScript: string;
  status: 'unassigned' | 'ready' | 'invalid';
  characterReferenceIds: string[];
  backgroundReferenceId: string | null;
};

export type StudioReferenceFocusIntent = {
  id: string;
  projectId: string;
  referenceIds: readonly string[];
  assetIds: readonly string[];
  shotIds: readonly string[];
};

export type ReferencesViewActions = {
  approve: (referenceId: string, candidateAssetId: string) => Promise<boolean>;
  regenerate: (referenceId: string) => void;
  retryJob: (referenceId: string, jobId: string, acknowledgePossibleDuplicateCharge: boolean) => Promise<boolean>;
  retryDownload: (referenceId: string, jobId: string) => Promise<boolean>;
  cancelJob: (referenceId: string, jobId: string) => Promise<boolean>;
  saveBinding: (
    shotId: string,
    characterReferenceIds: readonly string[],
    backgroundReferenceId: string | null
  ) => Promise<boolean>;
  continueToTable: () => void;
};

export type ReferencesViewProps = {
  projectId: string;
  references: readonly ReferenceWorkspaceItem[];
  bindings: readonly ReferenceBindingWorkspaceItem[];
  maxConditioningImages: number | null;
  readyForTable: boolean;
  pendingReferenceId: string | null;
  gateLocked: boolean;
  errorMessageKey: string | null;
  focusIntent?: StudioReferenceFocusIntent | null;
  onFocusIntentConsumed?: (intentId: string) => void;
  actions: ReferencesViewActions;
};

const ROOT = 'conversation.creativeStudio.workspace.referenceWorkflow';
const JOB_ROOT = 'conversation.creativeStudio.jobs';
const REFERENCE_HIGHLIGHT_MS = 1_600;

type BindingCardProps = {
  item: ReferenceBindingWorkspaceItem;
  characters: readonly ReferenceWorkspaceItem[];
  backgrounds: readonly ReferenceWorkspaceItem[];
  maxConditioningImages: number | null;
  pending: boolean;
  gateLocked: boolean;
  highlighted: boolean;
  cardRef: (node: HTMLLIElement | null) => void;
  save: ReferencesViewActions['saveBinding'];
};

const BindingCard: React.FC<BindingCardProps> = ({
  item,
  characters,
  backgrounds,
  maxConditioningImages,
  pending,
  gateLocked,
  highlighted,
  cardRef,
  save,
}) => {
  const { t } = useTranslation();
  const [characterReferenceIds, setCharacterReferenceIds] = useState(item.characterReferenceIds);
  const [backgroundReferenceId, setBackgroundReferenceId] = useState(item.backgroundReferenceId);
  const authoritySignature = JSON.stringify([
    item.shotId,
    item.status,
    item.characterReferenceIds,
    item.backgroundReferenceId,
  ]);
  useEffect(() => {
    setCharacterReferenceIds(item.characterReferenceIds);
    setBackgroundReferenceId(item.backgroundReferenceId);
  }, [authoritySignature]);
  const selectedCount = characterReferenceIds.length + (backgroundReferenceId === null ? 0 : 1);
  const overCapacity = maxConditioningImages !== null && selectedCount > maxConditioningImages;
  const dirty =
    item.status !== 'ready' ||
    backgroundReferenceId !== item.backgroundReferenceId ||
    characterReferenceIds.length !== item.characterReferenceIds.length ||
    characterReferenceIds.some((referenceId, index) => referenceId !== item.characterReferenceIds[index]);
  const disabled = gateLocked || pending;

  return (
    <li
      ref={cardRef}
      className={`${styles.bindingCard} ${highlighted ? styles.cardHighlighted : ''}`}
      data-shot-binding-highlighted={highlighted || undefined}
      data-shot-binding-status={item.status}
      data-shot-id={item.shotId}
    >
      <header>
        <h4>
          <bdi dir='auto'>
            {item.beatTitle} · {t(`${ROOT}.bindings.shot`, { position: item.shotPosition })}
          </bdi>
        </h4>
        <p>
          <bdi dir='auto'>{item.shootingScript || item.shotId}</bdi>
        </p>
      </header>
      {item.status === 'unassigned' ? (
        <div>
          <Alert type='warning' content={t(`${ROOT}.bindings.unassigned`)} />
        </div>
      ) : item.status === 'invalid' ? (
        <div>
          <Alert type='error' content={t(`${ROOT}.bindings.invalid`)} />
        </div>
      ) : null}
      {overCapacity ? (
        <div>
          <Alert
            type='error'
            content={t(`${ROOT}.bindings.capacity`, { count: selectedCount, limit: maxConditioningImages })}
          />
        </div>
      ) : null}
      <label className={styles.bindingField}>
        <span>{t(`${ROOT}.bindings.characters`)}</span>
        <Select
          disabled={disabled}
          mode='multiple'
          onChange={(value) => setCharacterReferenceIds(Array.isArray(value) ? value.map(String) : [])}
          value={characterReferenceIds}
        >
          {characters.map((reference) => (
            <Select.Option key={reference.id} value={reference.id} disabled={reference.approvedAssetId === null}>
              <bdi dir='auto'>{reference.label}</bdi>
            </Select.Option>
          ))}
        </Select>
      </label>
      <label className={styles.bindingField}>
        <span>{t(`${ROOT}.bindings.background`)}</span>
        <Select
          allowClear
          disabled={disabled}
          onChange={(value) => setBackgroundReferenceId(typeof value === 'string' ? value : null)}
          value={backgroundReferenceId ?? undefined}
        >
          {backgrounds.map((reference) => (
            <Select.Option key={reference.id} value={reference.id} disabled={reference.approvedAssetId === null}>
              <bdi dir='auto'>{reference.label}</bdi>
            </Select.Option>
          ))}
        </Select>
      </label>
      <Button
        type='primary'
        disabled={disabled || overCapacity || !dirty}
        loading={pending}
        onClick={() => void save(item.shotId, characterReferenceIds, backgroundReferenceId)}
      >
        {t(`${ROOT}.bindings.save`)}
      </Button>
    </li>
  );
};

/** Project-level identity and location references, approved before any Shot candidates are made. */
export const ReferencesView: React.FC<ReferencesViewProps> = ({
  projectId,
  references,
  bindings,
  maxConditioningImages,
  readyForTable,
  pendingReferenceId,
  gateLocked,
  errorMessageKey,
  focusIntent = null,
  onFocusIntentConsumed,
  actions,
}) => {
  const { t } = useTranslation();
  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  const bindingCardRefs = useRef(new Map<string, HTMLLIElement>());
  const characterHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const backgroundHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const bindingHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const handledFocusIntentIdRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeFocusIntent, setActiveFocusIntent] = useState<StudioReferenceFocusIntent | null>(null);
  const characters = useMemo(() => references.filter((item) => item.kind === 'character'), [references]);
  const backgrounds = useMemo(() => references.filter((item) => item.kind === 'background'), [references]);
  const charactersApproved = characters.every((item) => item.approvedAssetId !== null);
  const approvedCount = references.filter((item) => item.approvedAssetId !== null).length;
  const approvalPercent = references.length === 0 ? 100 : Math.round((approvedCount * 100) / references.length);
  const focusIds = useMemo(() => new Set(activeFocusIntent?.referenceIds ?? []), [activeFocusIntent]);
  const focusAssets = useMemo(() => new Set(activeFocusIntent?.assetIds ?? []), [activeFocusIntent]);
  const focusShots = useMemo(() => new Set(activeFocusIntent?.shotIds ?? []), [activeFocusIntent]);

  useEffect(() => {
    handledFocusIntentIdRef.current = null;
    setActiveFocusIntent(null);
  }, [projectId]);

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
    const requestedShotIds = new Set(focusIntent.shotIds);
    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = null;
    const focused = references.find(
      (item) =>
        cardRefs.current.has(item.id) &&
        (requestedReferenceIds.has(item.id) ||
          (item.candidateAssetId !== null && requestedAssetIds.has(item.candidateAssetId)) ||
          (item.approvedAssetId !== null && requestedAssetIds.has(item.approvedAssetId)))
    );
    const focusedBinding = bindings.find(
      (item) => requestedShotIds.has(item.shotId) && bindingCardRefs.current.has(item.shotId)
    );
    if (focused === undefined && focusedBinding === undefined) return;
    handledFocusIntentIdRef.current = focusIntent.id;
    setActiveFocusIntent(focusIntent);
    if (focused !== undefined) {
      cardRefs.current.get(focused.id)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      (focused.kind === 'character' ? characterHeadingRef.current : backgroundHeadingRef.current)?.focus();
    } else {
      bindingCardRefs.current.get(focusedBinding!.shotId)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      bindingHeadingRef.current?.focus();
    }
    onFocusIntentConsumed?.(focusIntent.id);
    highlightTimerRef.current = setTimeout(() => {
      setActiveFocusIntent((current) => (current?.id === focusIntent.id ? null : current));
      highlightTimerRef.current = null;
    }, REFERENCE_HIGHLIGHT_MS);
  }, [bindings, focusIntent, onFocusIntentConsumed, projectId, references]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    },
    []
  );

  const renderCard = (item: ReferenceWorkspaceItem): React.ReactNode => {
    const status = referenceWorkspaceStatus(item);
    const previewAssets = [
      ...(item.approvedAssetId === null ? [] : [{ assetId: item.approvedAssetId, status: 'approved' as const }]),
      ...(item.candidateAssetId === null || item.candidateAssetId === item.approvedAssetId
        ? []
        : [{ assetId: item.candidateAssetId, status: 'candidate' as const }]),
    ];
    const showSeparateStatus = previewAssets.length > 0 && !previewAssets.some((preview) => preview.status === status);
    const highlighted =
      activeFocusIntent !== null &&
      (focusIds.has(item.id) ||
        (item.candidateAssetId !== null && focusAssets.has(item.candidateAssetId)) ||
        (item.approvedAssetId !== null && focusAssets.has(item.approvedAssetId)));
    const busy = pendingReferenceId === item.id;
    const generationActive = item.generationStatus === 'queued' || item.generationStatus === 'running';
    const recoveryPending = item.candidateJob?.status === 'needs_attention';
    const downloadRecoveryPending = item.candidateJob?.canRetryDownload === true;
    const mayApprove = item.candidateAssetId !== null && item.candidateAssetId !== item.approvedAssetId;
    const recoveryDescriptionId = `studio-reference-recovery-${item.id}`;
    const actionsDisabled = gateLocked || pendingReferenceId !== null;
    const retryJob = (acknowledgePossibleDuplicateCharge: boolean): void => {
      if (item.candidateJob === null) return;
      void actions.retryJob(item.id, item.candidateJob.id, acknowledgePossibleDuplicateCharge);
    };
    return (
      <li
        ref={(node) => {
          if (node === null) cardRefs.current.delete(item.id);
          else cardRefs.current.set(item.id, node);
        }}
        className={`${styles.card} ${highlighted ? styles.cardHighlighted : ''}`}
        data-reference-id={item.id}
        data-reference-kind={item.kind}
        data-reference-highlighted={highlighted || undefined}
        key={item.id}
      >
        <div className={styles.previewStack}>
          {previewAssets.length === 0 ? (
            <div className={styles.preview} data-reference-preview='pending'>
              <span className={styles.previewPlaceholder}>{t(`${ROOT}.previewPending`)}</span>
              <Tag className={styles.status}>{t(`${ROOT}.status.${status}`)}</Tag>
            </div>
          ) : (
            previewAssets.map((preview) => (
              <div className={styles.preview} data-reference-preview={preview.status} key={preview.assetId}>
                <img
                  alt={t(`${ROOT}.previewAlt`, { label: item.label })}
                  src={createManagedStudioAssetUrl(projectId, preview.assetId)}
                />
                <Tag className={styles.status} color={preview.status === 'approved' ? 'green' : undefined}>
                  {t(`${ROOT}.status.${preview.status}`)}
                </Tag>
              </div>
            ))
          )}
        </div>
        <div className={styles.cardBody}>
          <div className={styles.cardTitle}>
            <h4>
              <bdi dir='auto'>{item.label}</bdi>
            </h4>
            {showSeparateStatus ? (
              <Tag color={status === 'approved' ? 'green' : undefined} data-reference-status={status}>
                {t(`${ROOT}.status.${status}`)}
              </Tag>
            ) : null}
          </div>
          {item.description === null ? null : (
            <p className={styles.cardDescription}>
              <bdi dir='auto'>{item.description}</bdi>
            </p>
          )}
          {item.candidateJob?.error === null || item.candidateJob === null ? null : (
            <p className={styles.jobError} id={recoveryDescriptionId} role='alert'>
              {t(item.candidateJob.error.messageKey)}
            </p>
          )}
          <div className={styles.actions}>
            {mayApprove ? (
              <Button
                type='primary'
                loading={busy}
                disabled={actionsDisabled}
                onClick={() => void actions.approve(item.id, item.candidateAssetId!)}
              >
                {t(`${ROOT}.approve`)}
              </Button>
            ) : null}
            <Button
              loading={busy && !mayApprove}
              disabled={
                gateLocked ||
                generationActive ||
                recoveryPending ||
                downloadRecoveryPending ||
                pendingReferenceId !== null ||
                (!charactersApproved && item.kind === 'background')
              }
              onClick={() => actions.regenerate(item.id)}
            >
              {t(`${ROOT}.regenerate`)}
            </Button>
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
              >
                {t(`${JOB_ROOT}.retryDownload`)}
              </Button>
            ) : null}
            {item.candidateJob?.canCancel ? (
              <Button
                aria-describedby={item.candidateJob.error === null ? undefined : recoveryDescriptionId}
                disabled={actionsDisabled}
                loading={busy}
                onClick={() => void actions.cancelJob(item.id, item.candidateJob!.id)}
              >
                {t(`${JOB_ROOT}.cancel`)}
              </Button>
            ) : null}
          </div>
        </div>
      </li>
    );
  };

  return (
    <section className={styles.root} data-studio-references-view>
      <header className={styles.introduction}>
        <p>{t(`${ROOT}.description`)}</p>
        <div aria-live='polite'>
          <Progress percent={approvalPercent} showText={false} />
          <p>{t(`${ROOT}.approvalProgress`, { approved: approvedCount, total: references.length })}</p>
        </div>
      </header>
      {errorMessageKey === null ? null : <Alert type='error' content={t(errorMessageKey)} />}
      <section className={styles.section} aria-labelledby='studio-reference-characters'>
        <header className={styles.sectionHeader}>
          <h3 id='studio-reference-characters' ref={characterHeadingRef} tabIndex={-1}>
            {t(`${ROOT}.characters.title`)}
          </h3>
          <p>{t(`${ROOT}.characters.description`)}</p>
        </header>
        {characters.length === 0 ? (
          <Empty description={t(`${ROOT}.characters.empty`)} />
        ) : (
          <ul className={styles.grid}>{characters.map(renderCard)}</ul>
        )}
      </section>
      <section className={styles.section} aria-labelledby='studio-reference-backgrounds'>
        <header className={styles.sectionHeader}>
          <h3 id='studio-reference-backgrounds' ref={backgroundHeadingRef} tabIndex={-1}>
            {t(`${ROOT}.backgrounds.title`)}
          </h3>
          <p>{t(charactersApproved ? `${ROOT}.backgrounds.description` : `${ROOT}.backgrounds.charactersRequired`)}</p>
        </header>
        {backgrounds.length === 0 ? (
          <Empty description={t(`${ROOT}.backgrounds.empty`)} />
        ) : (
          <ul className={styles.grid}>{backgrounds.map(renderCard)}</ul>
        )}
      </section>
      <section className={styles.section} aria-labelledby='studio-reference-bindings'>
        <header className={styles.sectionHeader}>
          <h3 id='studio-reference-bindings' ref={bindingHeadingRef} tabIndex={-1}>
            {t(`${ROOT}.bindings.title`)}
          </h3>
          <p>{t(`${ROOT}.bindings.description`)}</p>
        </header>
        {bindings.length === 0 ? (
          <Empty description={t(`${ROOT}.bindings.empty`)} />
        ) : (
          <ul className={styles.bindingList}>
            {bindings.map((item) => (
              <BindingCard
                key={item.shotId}
                backgrounds={backgrounds}
                cardRef={(node) => {
                  if (node === null) bindingCardRefs.current.delete(item.shotId);
                  else bindingCardRefs.current.set(item.shotId, node);
                }}
                characters={characters}
                gateLocked={gateLocked}
                highlighted={activeFocusIntent !== null && focusShots.has(item.shotId)}
                item={item}
                maxConditioningImages={maxConditioningImages}
                pending={pendingReferenceId === item.shotId}
                save={actions.saveBinding}
              />
            ))}
          </ul>
        )}
      </section>
      <footer className={styles.footer}>
        <p>{t(readyForTable ? `${ROOT}.ready` : `${ROOT}.notReady`)}</p>
        <Button
          type='primary'
          disabled={!readyForTable || pendingReferenceId !== null || gateLocked}
          onClick={actions.continueToTable}
        >
          {t(`${ROOT}.continueToTable`)}
        </Button>
      </footer>
    </section>
  );
};
