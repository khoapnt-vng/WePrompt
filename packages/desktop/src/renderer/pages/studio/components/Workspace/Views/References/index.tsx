/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Popconfirm, Tag } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioRendererJobV2 } from '@/common/types/project/creativeStudioTypes';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';
import styles from './References.module.css';

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

export type ReferencesViewActions = {
  approve: (referenceId: string, candidateAssetId: string) => Promise<boolean>;
  regenerate: (referenceId: string) => void;
  retryJob: (referenceId: string, jobId: string, acknowledgePossibleDuplicateCharge: boolean) => Promise<boolean>;
  retryDownload: (referenceId: string, jobId: string) => Promise<boolean>;
  cancelJob: (referenceId: string, jobId: string) => Promise<boolean>;
  continueToTable: () => void;
};

export type ReferencesViewProps = {
  projectId: string;
  references: readonly ReferenceWorkspaceItem[];
  readyForTable: boolean;
  pendingReferenceId: string | null;
  gateLocked: boolean;
  errorMessageKey: string | null;
  focusedReferenceIds?: readonly string[];
  focusedAssetIds?: readonly string[];
  actions: ReferencesViewActions;
};

const ROOT = 'conversation.creativeStudio.workspace.referenceWorkflow';
const JOB_ROOT = 'conversation.creativeStudio.jobs';
const REFERENCE_HIGHLIGHT_MS = 1_600;

const referenceStatus = (item: ReferenceWorkspaceItem): string => {
  if (item.generationStatus === 'queued' || item.generationStatus === 'running' || item.generationStatus === 'failed') {
    return item.generationStatus;
  }
  if (item.candidateAssetId !== null && item.candidateAssetId !== item.approvedAssetId) return 'candidate';
  if (item.approvedAssetId !== null) return 'approved';
  if (item.candidateAssetId !== null) return 'candidate';
  return item.generationStatus;
};

/** Project-level identity and location references, approved before any Shot candidates are made. */
export const ReferencesView: React.FC<ReferencesViewProps> = ({
  projectId,
  references,
  readyForTable,
  pendingReferenceId,
  gateLocked,
  errorMessageKey,
  focusedReferenceIds = [],
  focusedAssetIds = [],
  actions,
}) => {
  const { t } = useTranslation();
  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  const handledFocusSignatureRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeFocusSignature, setActiveFocusSignature] = useState<string | null>(null);
  const characters = useMemo(() => references.filter((item) => item.kind === 'character'), [references]);
  const backgrounds = useMemo(() => references.filter((item) => item.kind === 'background'), [references]);
  const charactersApproved = characters.every((item) => item.approvedAssetId !== null);
  const focusIds = useMemo(() => new Set(focusedReferenceIds), [focusedReferenceIds]);
  const focusAssets = useMemo(() => new Set(focusedAssetIds), [focusedAssetIds]);
  const focusSignature = useMemo(
    () =>
      focusedReferenceIds.length === 0 && focusedAssetIds.length === 0
        ? null
        : JSON.stringify([projectId, focusedReferenceIds, focusedAssetIds]),
    [focusedAssetIds, focusedReferenceIds, projectId]
  );

  useEffect(() => {
    if (focusSignature === null) {
      handledFocusSignatureRef.current = null;
      setActiveFocusSignature(null);
      if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
      return;
    }
    if (handledFocusSignatureRef.current === focusSignature) return;
    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = null;
    setActiveFocusSignature(null);
    const focused = references.find(
      (item) =>
        cardRefs.current.has(item.id) &&
        (focusIds.has(item.id) ||
          (item.candidateAssetId !== null && focusAssets.has(item.candidateAssetId)) ||
          (item.approvedAssetId !== null && focusAssets.has(item.approvedAssetId)))
    );
    if (focused === undefined) return;
    handledFocusSignatureRef.current = focusSignature;
    setActiveFocusSignature(focusSignature);
    cardRefs.current.get(focused.id)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    highlightTimerRef.current = setTimeout(() => {
      setActiveFocusSignature((current) => (current === focusSignature ? null : current));
      highlightTimerRef.current = null;
    }, REFERENCE_HIGHLIGHT_MS);
  }, [focusAssets, focusIds, focusSignature, references]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    },
    []
  );

  const renderCard = (item: ReferenceWorkspaceItem): React.ReactNode => {
    const previewAssetId = item.candidateAssetId ?? item.approvedAssetId;
    const status = referenceStatus(item);
    const highlighted =
      activeFocusSignature === focusSignature &&
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
        <div className={styles.preview}>
          {previewAssetId === null ? (
            <span className={styles.previewPlaceholder}>{t(`${ROOT}.previewPending`)}</span>
          ) : (
            <img
              alt={t(`${ROOT}.previewAlt`, { label: item.label })}
              src={createManagedStudioAssetUrl(projectId, previewAssetId)}
            />
          )}
          <Tag className={styles.status} color={status === 'approved' ? 'green' : undefined}>
            {t(`${ROOT}.status.${status}`)}
          </Tag>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.cardTitle}>
            <h4>
              <bdi dir='auto'>{item.label}</bdi>
            </h4>
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
      </header>
      {errorMessageKey === null ? null : <Alert type='error' content={t(errorMessageKey)} />}
      <section className={styles.section} aria-labelledby='studio-reference-characters'>
        <header className={styles.sectionHeader}>
          <h3 id='studio-reference-characters'>{t(`${ROOT}.characters.title`)}</h3>
          <p>{t(`${ROOT}.characters.description`)}</p>
        </header>
        {characters.length === 0 ? (
          <p className={styles.empty}>{t(`${ROOT}.characters.empty`)}</p>
        ) : (
          <ul className={styles.grid}>{characters.map(renderCard)}</ul>
        )}
      </section>
      <section className={styles.section} aria-labelledby='studio-reference-backgrounds'>
        <header className={styles.sectionHeader}>
          <h3 id='studio-reference-backgrounds'>{t(`${ROOT}.backgrounds.title`)}</h3>
          <p>{t(charactersApproved ? `${ROOT}.backgrounds.description` : `${ROOT}.backgrounds.charactersRequired`)}</p>
        </header>
        {!charactersApproved ? null : backgrounds.length === 0 ? (
          <p className={styles.empty}>{t(`${ROOT}.backgrounds.empty`)}</p>
        ) : (
          <ul className={styles.grid}>{backgrounds.map(renderCard)}</ul>
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
