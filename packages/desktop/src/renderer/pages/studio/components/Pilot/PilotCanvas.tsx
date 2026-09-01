/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
  type StudioJobStatus,
  type StudioApplyMutationBatchRequestV3,
  type StudioApplyMutationBatchResultV3,
  type StudioCancelPieceJobRequestV3,
  type StudioCancelPieceJobResultV3,
  type StudioConfirmPreparedPhotoRequestV3,
  type StudioConfirmPreparedPhotoResultV3,
  type StudioDiscardPreparedPhotoRequestV3,
  type StudioDiscardPreparedPhotoResultV3,
  type StudioExportPieceRequestV3,
  type StudioExportPieceResultV3,
  type StudioImportPhotoRequestV3,
  type StudioImportPhotoResultV3,
  type StudioPiecePhotoSettingsV3,
  type StudioPieceJobErrorCodeV3,
  type StudioPieceJobRetryReasonV3,
  type StudioPreparePhotoIntentV3,
  type StudioPreparePhotoResultV3,
  type StudioProjectLoadResultV3,
  type StudioRendererPieceActivityJobV3,
  type StudioRendererPieceAssetV3,
  type StudioRendererPieceExportCatalogV3,
  type StudioRendererPieceV3,
  type StudioRendererPreparedPhotoQuoteV3,
  type StudioResumePieceJobRequestV3,
  type StudioResumePieceJobResultV3,
  type StudioRetryPieceDownloadRequestV3,
  type StudioRetryPieceDownloadResultV3,
} from '@/common/types/project/creativeStudioTypes';
import { Button, Checkbox, Dropdown, Input, Menu, Select } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PilotSpendingLimitDialog } from './PilotSpendingLimitDialog';
import styles from './PilotCanvas.module.css';

const ASPECT_RATIOS: StudioPiecePhotoSettingsV3['aspectRatio'][] = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const RESOLUTIONS: StudioPiecePhotoSettingsV3['resolution'][] = ['720p', '1080p'];

export type StudioPilotClientV3 = {
  loadProjectV3(projectId: string): Promise<StudioProjectLoadResultV3>;
  preparePhotoV3(input: StudioPreparePhotoIntentV3): Promise<StudioPreparePhotoResultV3>;
  confirmPreparedPhotoV3(input: StudioConfirmPreparedPhotoRequestV3): Promise<StudioConfirmPreparedPhotoResultV3>;
  discardPreparedPhotoV3(input: StudioDiscardPreparedPhotoRequestV3): Promise<StudioDiscardPreparedPhotoResultV3>;
  importPhotoV3(input: StudioImportPhotoRequestV3): Promise<StudioImportPhotoResultV3>;
  applyMutationBatchV3(input: StudioApplyMutationBatchRequestV3): Promise<StudioApplyMutationBatchResultV3>;
  cancelJobV3(input: StudioCancelPieceJobRequestV3): Promise<StudioCancelPieceJobResultV3>;
  resumeJobV3(input: StudioResumePieceJobRequestV3): Promise<StudioResumePieceJobResultV3>;
  retryDownloadV3(input: StudioRetryPieceDownloadRequestV3): Promise<StudioRetryPieceDownloadResultV3>;
  listPieceExportsV3(projectId: string): Promise<StudioRendererPieceExportCatalogV3>;
  exportPieceV3(input: StudioExportPieceRequestV3): Promise<StudioExportPieceResultV3>;
  watchProjectUpdatesV3(listener: (update: StudioPilotRendererUpdateV3) => void): () => void;
};

export type StudioPilotRendererUpdateV3 =
  | { source: 'prepared'; projectId: string }
  | { source: 'durable'; facts: { projectId: string } };

export type PilotCanvasProps = {
  projectId: string;
  client: StudioPilotClientV3;
  assetUrlFor?: (projectId: string, asset: StudioRendererPieceAssetV3) => string | null;
  onEditSpendPolicy?: () => void;
  onExported?: (pieceId: string, result: StudioExportPieceResultV3) => void;
};

type SupportedProject = Extract<StudioProjectLoadResultV3, { status: 'supported' }>;

const quoteKey = (quote: StudioRendererPreparedPhotoQuoteV3): string =>
  `${quote.reservationId}:${quote.quoteId}:${quote.quoteRevision}`;

const PILOT_I18N_ROOT = 'conversation.creativeStudio.pilot';

const PIECE_STATUS_KEYS = {
  queued: `${PILOT_I18N_ROOT}.canvas.pieceStatus.queued`,
  running: `${PILOT_I18N_ROOT}.canvas.pieceStatus.running`,
  needs_attention: `${PILOT_I18N_ROOT}.canvas.pieceStatus.needsAttention`,
  failed: `${PILOT_I18N_ROOT}.canvas.pieceStatus.failed`,
  cancelled: `${PILOT_I18N_ROOT}.canvas.pieceStatus.cancelled`,
  current: `${PILOT_I18N_ROOT}.canvas.pieceStatus.current`,
} as const;

const JOB_STATUS_KEYS: Readonly<Record<StudioJobStatus, string>> = {
  queued_local: `${PILOT_I18N_ROOT}.canvas.jobStatus.queuedLocal`,
  submitting: `${PILOT_I18N_ROOT}.canvas.jobStatus.submitting`,
  queued_remote: `${PILOT_I18N_ROOT}.canvas.jobStatus.queuedRemote`,
  running: `${PILOT_I18N_ROOT}.canvas.jobStatus.running`,
  needs_attention: `${PILOT_I18N_ROOT}.canvas.jobStatus.needsAttention`,
  succeeded: `${PILOT_I18N_ROOT}.canvas.jobStatus.succeeded`,
  failed: `${PILOT_I18N_ROOT}.canvas.jobStatus.failed`,
  cancelled: `${PILOT_I18N_ROOT}.canvas.jobStatus.cancelled`,
};

const JOB_ERROR_KEYS: Readonly<Record<StudioPieceJobErrorCodeV3, string>> = {
  invalid_request: `${PILOT_I18N_ROOT}.canvas.jobErrors.invalidRequest`,
  content_rejected: `${PILOT_I18N_ROOT}.canvas.jobErrors.contentRejected`,
  auth: `${PILOT_I18N_ROOT}.canvas.jobErrors.auth`,
  quota: `${PILOT_I18N_ROOT}.canvas.jobErrors.quota`,
  rate_limited: `${PILOT_I18N_ROOT}.canvas.jobErrors.rateLimited`,
  provider_unavailable: `${PILOT_I18N_ROOT}.canvas.jobErrors.providerUnavailable`,
  timeout: `${PILOT_I18N_ROOT}.canvas.jobErrors.timeout`,
  poll_deadline: `${PILOT_I18N_ROOT}.canvas.jobErrors.pollDeadline`,
  no_output: `${PILOT_I18N_ROOT}.canvas.jobErrors.noOutput`,
  variation_grid: `${PILOT_I18N_ROOT}.canvas.jobErrors.variationGrid`,
  submission_unknown: `${PILOT_I18N_ROOT}.canvas.jobErrors.submissionUnknown`,
  download_failed: `${PILOT_I18N_ROOT}.canvas.jobErrors.downloadFailed`,
  unsupported: `${PILOT_I18N_ROOT}.canvas.jobErrors.unsupported`,
  unknown: `${PILOT_I18N_ROOT}.canvas.jobErrors.unknown`,
};

const RETRY_REASON_KEYS: Readonly<Record<StudioPieceJobRetryReasonV3, string>> = {
  provider_failure: `${PILOT_I18N_ROOT}.canvas.retryReasons.providerFailure`,
  submission_unknown: `${PILOT_I18N_ROOT}.canvas.retryReasons.submissionUnknown`,
  variation_grid: `${PILOT_I18N_ROOT}.canvas.retryReasons.variationGrid`,
  cancelled: `${PILOT_I18N_ROOT}.canvas.retryReasons.cancelled`,
};

const FRESH_QUOTE_ERROR_CODES = new Set([
  'quote_not_found',
  'quote_expired',
  'stale_quote',
  'confirmation_required',
  'stale_authoring',
]);

const errorCopy = (error: unknown, t: TFunction): string => {
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && typeof error.code === 'string') {
      switch (error.code) {
        case 'route_catalog_unavailable':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.routeCatalogUnavailable`);
        case 'route_incompatible':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.routeIncompatible`);
        case 'project_piece_capacity_reached':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.capacity`);
        case 'quote_not_found':
        case 'quote_expired':
        case 'stale_quote':
        case 'confirmation_required':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.freshQuoteRequired`);
        case 'duplicate_charge_acknowledgement_required':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.duplicateAcknowledgementRequired`);
        case 'invalid_handle':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.invalidHandle`);
        case 'handle_collision':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.handleCollision`);
        case 'alias_limit':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.aliasLimit`);
        case 'no_change':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.noChange`);
        case 'undo_conflict':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.undoConflict`);
        case 'stale_authoring':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.staleAuthoring`);
        case 'variation_grid':
          return t(`${PILOT_I18N_ROOT}.canvas.errors.variationGrid`);
      }
    }
  }
  return t(`${PILOT_I18N_ROOT}.common.actionFailed`);
};

const errorCode = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null;

const formatMinorUnits = (minorUnits: number, currency: string, locale: string): string => {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) return '';
  const whole = Math.trunc(minorUnits / 100);
  const fraction = String(minorUnits % 100).padStart(2, '0');
  const groupedWhole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(whole);
  try {
    let wroteInteger = false;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .formatToParts(0)
      .flatMap((part) => {
        if (part.type === 'integer') {
          if (wroteInteger) return [];
          wroteInteger = true;
          return [groupedWhole];
        }
        if (part.type === 'fraction') return [fraction];
        if (part.type === 'group') return [];
        return [part.value];
      })
      .join('');
  } catch {
    return `${currency} ${groupedWhole}.${fraction}`;
  }
};

const formatTimestamp = (timestamp: string, locale: string): string => {
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf())
    ? timestamp
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const QuoteCard: React.FC<{
  quote: StudioRendererPreparedPhotoQuoteV3;
  busy: boolean;
  onConfirm: (
    quote: StudioRendererPreparedPhotoQuoteV3,
    duplicateChargeAcknowledged: boolean,
    explicitHumanConfirmation: boolean
  ) => Promise<void>;
  onDiscard: (quote: StudioRendererPreparedPhotoQuoteV3) => Promise<void>;
}> = ({ quote, busy, onConfirm, onDiscard }) => {
  const { t, i18n } = useTranslation();
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const automatic =
    quote.spendPolicyClassification === 'within_cap' &&
    !quote.requiresExplicitHumanAction &&
    !quote.duplicateChargeAcknowledgementRequired;
  const autoStarted = useRef(false);

  useEffect(() => {
    autoStarted.current = false;
  }, [quote.reservationId, quote.quoteId, quote.quoteRevision]);

  useEffect(() => {
    if (!automatic || busy || autoStarted.current) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        autoStarted.current = true;
        void onConfirm(quote, false, false);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== 0) window.cancelAnimationFrame(secondFrame);
    };
  }, [automatic, busy, onConfirm, quote]);

  return (
    <article
      className={styles.quote}
      aria-label={t(`${PILOT_I18N_ROOT}.canvas.quote.accessibleName`)}
      data-quote-key={quoteKey(quote)}
      data-pilot-focus-kind='quote'
      data-pilot-focus-id={quote.targetPieceId}
      tabIndex={-1}
    >
      <header className={styles.quoteHeader}>
        <div>
          <span className={styles.eyebrow}>{t(`${PILOT_I18N_ROOT}.canvas.quote.eyebrow`)}</span>
          <h2 className={styles.quoteTitle}>
            {quote.mode === 'create' ? (
              <span className={styles.handle} dir='auto'>
                #{quote.proposedHandle}
              </span>
            ) : (
              t(`${PILOT_I18N_ROOT}.canvas.quote.retryTitle`)
            )}
          </h2>
        </div>
        <strong>{formatMinorUnits(quote.upperMinorUnits, quote.currency, i18n.language)}</strong>
      </header>

      <p className={styles.quoteWords} dir='auto'>
        {quote.words}
      </p>
      <dl className={styles.facts}>
        <dt>{t(`${PILOT_I18N_ROOT}.canvas.quote.amount`)}</dt>
        <dd>
          {formatMinorUnits(quote.upperMinorUnits, quote.currency, i18n.language)} ({quote.currency})
        </dd>
        <dt>{t(`${PILOT_I18N_ROOT}.canvas.quote.scope`)}</dt>
        <dd>
          {t(`${PILOT_I18N_ROOT}.canvas.quote.scopeValue`, {
            aspectRatio: quote.settings.aspectRatio,
            resolution: quote.settings.resolution,
          })}
        </dd>
        <dt>{t(`${PILOT_I18N_ROOT}.canvas.quote.expires`)}</dt>
        <dd>
          <time dateTime={quote.expiresAt}>{formatTimestamp(quote.expiresAt, i18n.language)}</time>
        </dd>
      </dl>

      {automatic ? (
        <p role='status'>{t(`${PILOT_I18N_ROOT}.canvas.quote.automatic`)}</p>
      ) : (
        <p role='status'>{t(`${PILOT_I18N_ROOT}.canvas.quote.reviewRequired`)}</p>
      )}

      {quote.duplicateChargeAcknowledgementRequired && (
        <Checkbox checked={duplicateAcknowledged} onChange={setDuplicateAcknowledged}>
          {t(`${PILOT_I18N_ROOT}.canvas.quote.duplicateAcknowledgement`)}
        </Checkbox>
      )}

      <div className={styles.quoteActions}>
        {!automatic && (
          <Button
            type='primary'
            loading={busy}
            disabled={quote.duplicateChargeAcknowledgementRequired && !duplicateAcknowledged}
            onClick={() => void onConfirm(quote, duplicateAcknowledged, true)}
          >
            {t(
              quote.mode === 'create'
                ? `${PILOT_I18N_ROOT}.canvas.quote.confirmCreate`
                : `${PILOT_I18N_ROOT}.canvas.quote.confirmRetry`
            )}
          </Button>
        )}
        <Button disabled={busy} onClick={() => void onDiscard(quote)}>
          {t(`${PILOT_I18N_ROOT}.canvas.quote.discard`)}
        </Button>
      </div>
    </article>
  );
};

const PieceCard: React.FC<{
  piece: StudioRendererPieceV3;
  jobs: StudioRendererPieceActivityJobV3[];
  quotes: StudioRendererPreparedPhotoQuoteV3[];
  project: SupportedProject;
  client: StudioPilotClientV3;
  assetUrlFor?: PilotCanvasProps['assetUrlFor'];
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onError: (error: unknown) => void;
  onRefresh: () => Promise<void>;
  onSavedRefreshUnavailable: () => void;
  onPrepared: (quote: StudioRendererPreparedPhotoQuoteV3) => void;
  onConfirm: (
    quote: StudioRendererPreparedPhotoQuoteV3,
    duplicateChargeAcknowledged: boolean,
    explicitHumanConfirmation: boolean
  ) => Promise<void>;
  onDiscard: (quote: StudioRendererPreparedPhotoQuoteV3) => Promise<void>;
  onImportPhoto: () => Promise<void>;
}> = ({
  piece,
  jobs,
  quotes,
  project,
  client,
  assetUrlFor,
  busy,
  onBusy,
  onError,
  onRefresh,
  onSavedRefreshUnavailable,
  onPrepared,
  onConfirm,
  onDiscard,
  onImportPhoto,
}) => {
  const { t, i18n } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [handle, setHandle] = useState(piece.handle);
  const pieceRef = useRef<HTMLElement | null>(null);
  const restoreRenameFocus = useRef(false);
  const currentUrl =
    piece.currentAsset === null ? null : (assetUrlFor?.(project.summary.id, piece.currentAsset) ?? null);

  const openRename = (): void => {
    restoreRenameFocus.current = false;
    setRenaming(true);
  };

  const closeRename = (): void => {
    restoreRenameFocus.current = true;
    setRenaming(false);
  };

  useEffect(() => {
    if (!renaming) setHandle(piece.handle);
  }, [piece.handle, renaming]);

  useEffect(() => {
    const card = pieceRef.current;
    if (card === null) return;
    if (renaming) {
      if (busy) return;
      const input = card.ownerDocument.getElementById(`pilot-rename-${piece.id}`);
      if (input !== null && card.contains(input)) input.focus();
      return;
    }
    if (!restoreRenameFocus.current || busy) return;
    const trigger = card.querySelector<HTMLButtonElement>('[data-pilot-rename-trigger]');
    if (trigger === null) return;
    trigger.focus();
    restoreRenameFocus.current = false;
  }, [busy, piece.id, renaming]);

  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<void> => {
      onBusy(true);
      try {
        await action();
        try {
          await onRefresh();
        } catch {
          onSavedRefreshUnavailable();
        }
      } catch (error) {
        onError(error);
      } finally {
        onBusy(false);
      }
    },
    [onBusy, onError, onRefresh, onSavedRefreshUnavailable]
  );

  const saveRename = (): void => {
    restoreRenameFocus.current = true;
    void run(async () => {
      await client.applyMutationBatchV3({
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
        projectId: project.summary.id,
        expectedAuthoringRevision: project.canvas.authoringRevision,
        operations: [{ kind: 'rename_piece', pieceId: piece.id, handle }],
      });
      setRenaming(false);
    });
  };

  return (
    <article
      ref={pieceRef}
      className={styles.piece}
      aria-labelledby={`pilot-piece-${piece.id}`}
      data-pilot-focus-kind='piece'
      data-pilot-focus-id={piece.id}
      tabIndex={-1}
    >
      <header className={styles.pieceHeader}>
        <div>
          <span className={styles.eyebrow}>{t(`${PILOT_I18N_ROOT}.canvas.piece.eyebrow`)}</span>
          <h2 id={`pilot-piece-${piece.id}`} className={styles.pieceTitle}>
            <bdi className={styles.handle} dir='auto'>
              #{piece.handle}
            </bdi>
          </h2>
        </div>
        <span className={styles.status}>{t(PIECE_STATUS_KEYS[piece.state])}</span>
      </header>

      {quotes.map((quote) => (
        <QuoteCard key={quoteKey(quote)} quote={quote} busy={busy} onConfirm={onConfirm} onDiscard={onDiscard} />
      ))}

      {piece.currentAsset === null ? (
        <div className={styles.pending} role='status'>
          {piece.state === 'running' || piece.state === 'queued'
            ? t(`${PILOT_I18N_ROOT}.canvas.piece.generationInProgress`)
            : t(`${PILOT_I18N_ROOT}.canvas.piece.noCurrentImage`)}
        </div>
      ) : currentUrl === null ? (
        <div className={styles.pending} role='status'>
          {t(`${PILOT_I18N_ROOT}.canvas.piece.imageUnavailable`)}
        </div>
      ) : (
        <div
          className={styles.mediaFrame}
          style={{ aspectRatio: `${piece.currentAsset.width} / ${piece.currentAsset.height}` }}
        >
          <img
            src={currentUrl}
            alt={t(`${PILOT_I18N_ROOT}.canvas.piece.currentImageAccessible`, { handle: `#${piece.handle}` })}
          />
        </div>
      )}

      {renaming ? (
        <div className={styles.rename}>
          <label className={styles.fieldLabel} htmlFor={`pilot-rename-${piece.id}`}>
            {t(`${PILOT_I18N_ROOT}.canvas.piece.rename`)}
          </label>
          <div className={styles.renameField}>
            <span className={styles.renamePrefix} aria-hidden='true'>
              #
            </span>
            <Input
              id={`pilot-rename-${piece.id}`}
              value={handle}
              dir='auto'
              disabled={busy}
              aria-label={t(`${PILOT_I18N_ROOT}.canvas.piece.renameAccessible`, { handle: `#${piece.handle}` })}
              onChange={setHandle}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && handle.length > 0) saveRename();
                if (event.key === 'Escape') closeRename();
              }}
            />
          </div>
          <div className={styles.renameActions}>
            <Button type='primary' disabled={busy || handle.length === 0} onClick={saveRename}>
              {t(`${PILOT_I18N_ROOT}.canvas.piece.saveName`)}
            </Button>
            <Button disabled={busy} onClick={closeRename}>
              {t(`${PILOT_I18N_ROOT}.canvas.piece.cancelRename`)}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.pieceActions}>
          <Button data-pilot-rename-trigger disabled={busy} onClick={openRename}>
            {t(`${PILOT_I18N_ROOT}.canvas.piece.rename`)}
          </Button>
        </div>
      )}

      {piece.currentAsset !== null && (
        <section aria-label={t(`${PILOT_I18N_ROOT}.canvas.provenance.accessible`, { handle: `#${piece.handle}` })}>
          <h3 className={styles.historyTitle}>{t(`${PILOT_I18N_ROOT}.canvas.provenance.title`)}</h3>
          <dl className={styles.facts}>
            <dt>{t(`${PILOT_I18N_ROOT}.canvas.provenance.origin`)}</dt>
            <dd>
              {t(
                piece.currentAsset.provenance.origin === 'imported'
                  ? `${PILOT_I18N_ROOT}.canvas.provenance.imported`
                  : `${PILOT_I18N_ROOT}.canvas.provenance.generated`
              )}
            </dd>
            <dt>{t(`${PILOT_I18N_ROOT}.canvas.provenance.created`)}</dt>
            <dd>{formatTimestamp(piece.currentAsset.provenance.createdAt, i18n.language)}</dd>
            {piece.currentAsset.provenance.origin === 'generated' && (
              <>
                <dt>{t(`${PILOT_I18N_ROOT}.canvas.provenance.model`)}</dt>
                <dd>{piece.currentAsset.provenance.model}</dd>
                <dt>{t(`${PILOT_I18N_ROOT}.canvas.provenance.instructionProfile`)}</dt>
                <dd>{piece.currentAsset.provenance.instructionProfile}</dd>
                <dt>{t(`${PILOT_I18N_ROOT}.canvas.provenance.recordedSpend`)}</dt>
                <dd>
                  {formatMinorUnits(
                    piece.currentAsset.provenance.recordedSpend.totalMinorUnits,
                    piece.currentAsset.provenance.recordedSpend.currency,
                    i18n.language
                  )}{' '}
                  ({piece.currentAsset.provenance.recordedSpend.currency})
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      {jobs.length > 0 && (
        <section
          className={styles.history}
          aria-label={t(`${PILOT_I18N_ROOT}.canvas.history.accessible`, { handle: `#${piece.handle}` })}
        >
          <h3 className={styles.historyTitle}>{t(`${PILOT_I18N_ROOT}.canvas.history.title`)}</h3>
          <ol className={styles.historyList}>
            {jobs.map((job) => (
              <li key={job.jobId} className={styles.historyItem}>
                <div className={styles.historyLine}>
                  <span className={styles.status}>{t(JOB_STATUS_KEYS[job.status])}</span>
                  {job.progress !== null && <span>{Math.round(job.progress)}%</span>}
                </div>
                {job.error !== null && <p className={styles.alert}>{t(JOB_ERROR_KEYS[job.error.code])}</p>}
                {job.error?.code === 'variation_grid' && (
                  <div className={styles.recovery} role='note'>
                    {job.recordedSpend !== null && <p>{t(`${PILOT_I18N_ROOT}.canvas.variationGrid.paidRejected`)}</p>}
                    <p>
                      {t(
                        job.canRetry
                          ? `${PILOT_I18N_ROOT}.canvas.variationGrid.retryAvailable`
                          : `${PILOT_I18N_ROOT}.canvas.variationGrid.retryExhausted`
                      )}
                    </p>
                    <p>{t(`${PILOT_I18N_ROOT}.canvas.variationGrid.importEscape`)}</p>
                    <Button size='small' disabled={busy} onClick={() => void onImportPhoto()}>
                      {t(`${PILOT_I18N_ROOT}.canvas.actions.importPhoto`)}
                    </Button>
                  </div>
                )}
                {job.retryReason !== null && (
                  <span className={styles.muted}>
                    {t(`${PILOT_I18N_ROOT}.canvas.history.retryReason`, {
                      reason: t(RETRY_REASON_KEYS[job.retryReason]),
                    })}
                  </span>
                )}
                <dl className={styles.facts}>
                  <dt>{t(`${PILOT_I18N_ROOT}.canvas.history.created`)}</dt>
                  <dd>
                    <time dateTime={job.createdAt}>{formatTimestamp(job.createdAt, i18n.language)}</time>
                  </dd>
                  <dt>{t(`${PILOT_I18N_ROOT}.canvas.history.authorized`)}</dt>
                  <dd>
                    <time dateTime={job.authorization.confirmedAt}>
                      {formatTimestamp(job.authorization.confirmedAt, i18n.language)}
                    </time>
                  </dd>
                  {job.retryOfJobId !== null && (
                    <>
                      <dt>{t(`${PILOT_I18N_ROOT}.canvas.history.retryOf`)}</dt>
                      <dd dir='ltr'>{job.retryOfJobId}</dd>
                    </>
                  )}
                  <dt>{t(`${PILOT_I18N_ROOT}.canvas.history.duplicateCharge`)}</dt>
                  <dd>
                    {t(
                      job.duplicateChargeAcknowledged
                        ? `${PILOT_I18N_ROOT}.canvas.history.acknowledged`
                        : `${PILOT_I18N_ROOT}.canvas.history.notRequired`
                    )}
                  </dd>
                </dl>
                {job.recordedSpend !== null && (
                  <span className={styles.muted}>
                    {t(`${PILOT_I18N_ROOT}.canvas.history.recordedSpend`, {
                      amount: formatMinorUnits(
                        job.recordedSpend.totalMinorUnits,
                        job.recordedSpend.currency,
                        i18n.language
                      ),
                      currency: job.recordedSpend.currency,
                    })}
                  </span>
                )}
                <div className={styles.jobActions}>
                  {job.canCancel && (
                    <Button
                      size='small'
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          client.cancelJobV3({ projectId: project.summary.id, pieceId: piece.id, jobId: job.jobId })
                        )
                      }
                    >
                      {t(`${PILOT_I18N_ROOT}.canvas.actions.cancelGeneration`)}
                    </Button>
                  )}
                  {job.canRetry && (
                    <Button
                      size='small'
                      disabled={busy}
                      onClick={() => {
                        onBusy(true);
                        void client
                          .preparePhotoV3({
                            mode: 'retry',
                            projectId: project.summary.id,
                            expectedAuthoringRevision: project.canvas.authoringRevision,
                            pieceId: piece.id,
                            sourceJobId: job.jobId,
                          })
                          .then((result) => onPrepared(result.quote))
                          .catch(onError)
                          .finally(() => onBusy(false));
                      }}
                    >
                      {t(`${PILOT_I18N_ROOT}.canvas.actions.retryGeneration`)}
                    </Button>
                  )}
                  {job.canRetryDownload && (
                    <Button
                      size='small'
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          client.retryDownloadV3({
                            projectId: project.summary.id,
                            pieceId: piece.id,
                            jobId: job.jobId,
                            expectedRevision: project.canvas.revision,
                          })
                        )
                      }
                    >
                      {t(`${PILOT_I18N_ROOT}.canvas.actions.retryDownload`)}
                    </Button>
                  )}
                  {job.canResume && (
                    <Button
                      size='small'
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          client.resumeJobV3({
                            projectId: project.summary.id,
                            pieceId: piece.id,
                            jobId: job.jobId,
                            expectedRevision: project.canvas.revision,
                          })
                        )
                      }
                    >
                      {t(`${PILOT_I18N_ROOT}.canvas.actions.checkProvider`)}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
};

export const PilotCanvas: React.FC<PilotCanvasProps> = ({
  projectId,
  client,
  assetUrlFor,
  onEditSpendPolicy,
  onExported,
}) => {
  const { t } = useTranslation();
  const [project, setProject] = useState<SupportedProject | null>(null);
  const [loadState, setLoadState] = useState<'uninitialised' | 'refreshing' | 'ready' | 'unavailable'>('uninitialised');
  const [composerOpen, setComposerOpen] = useState(false);
  const [words, setWords] = useState('');
  const [settings, setSettings] = useState<StudioPiecePhotoSettingsV3>({ aspectRatio: '16:9', resolution: '720p' });
  const [localQuotes, setLocalQuotes] = useState<StudioRendererPreparedPhotoQuoteV3[]>([]);
  const [suppressedQuoteKeys, setSuppressedQuoteKeys] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeErrorCode, setActiveErrorCode] = useState<string | null>(null);
  const [errorRole, setErrorRole] = useState<'alert' | 'status'>('alert');
  const [announcement, setAnnouncement] = useState('');
  const [spendingLimitOpen, setSpendingLimitOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ kind: 'quote' | 'piece'; id: string } | null>(null);
  const lastSupportedProject = useRef<SupportedProject | null>(null);
  const previousJobStatuses = useRef<Map<string, StudioJobStatus>>(new Map());
  const canvasRef = useRef<HTMLElement | null>(null);
  const restoreCreateFocus = useRef(false);
  const viewGeneration = useRef(0);

  const openComposer = (): void => {
    restoreCreateFocus.current = false;
    setComposerOpen(true);
  };

  const closeComposer = (): void => {
    restoreCreateFocus.current = true;
    setComposerOpen(false);
  };

  const refresh = useCallback(async (): Promise<void> => {
    const generation = viewGeneration.current;
    const result = await client.loadProjectV3(projectId);
    if (viewGeneration.current !== generation) return;
    if (result.status === 'supported') {
      lastSupportedProject.current = result;
      setProject(result);
      setLoadState('ready');
      setError(null);
      setActiveErrorCode(null);
      setErrorRole('alert');
      // A successful load is the authoritative cache projection. Local quotes bridge only the
      // prepare response to the next projection; retaining an absent quote here would resurrect an
      // intent invalidated by another authored change or spending-policy update.
      setLocalQuotes([]);
      setSuppressedQuoteKeys((current) => {
        if (current.size === 0) return current;
        const projected = new Set(result.activity.preparedPhotoQuotes.map(quoteKey));
        const retained = new Set([...current].filter((key) => projected.has(key)));
        return retained.size === current.size ? current : retained;
      });
      return;
    }
    if (lastSupportedProject.current === null) {
      setProject(null);
      setLoadState('unavailable');
      return;
    }
    throw new Error('last_known_project_state');
  }, [client, projectId]);

  useEffect(() => {
    const generation = viewGeneration.current + 1;
    viewGeneration.current = generation;
    let active = true;
    let refreshRunning = false;
    let refreshAgain = false;
    let updateScheduled = false;
    lastSupportedProject.current = null;
    setProject(null);
    setLocalQuotes([]);
    setSuppressedQuoteKeys(new Set());
    setLoadState('uninitialised');
    setError(null);
    setActiveErrorCode(null);
    setErrorRole('alert');
    previousJobStatuses.current = new Map();

    const synchronize = async (): Promise<void> => {
      if (refreshRunning) {
        refreshAgain = true;
        return;
      }
      refreshRunning = true;
      if (lastSupportedProject.current !== null) setLoadState('refreshing');
      try {
        refreshAgain = false;
        await refresh();
      } catch (caught) {
        if (!active || viewGeneration.current !== generation) return;
        setError(errorCopy(caught, t));
        setActiveErrorCode(errorCode(caught));
        setErrorRole(lastSupportedProject.current === null ? 'alert' : 'status');
        setLoadState(lastSupportedProject.current === null ? 'unavailable' : 'ready');
      } finally {
        refreshRunning = false;
        if (active && refreshAgain) {
          refreshAgain = false;
          void synchronize();
        }
      }
    };

    const unsubscribe = client.watchProjectUpdatesV3((update) => {
      const updatedProjectId = update.source === 'prepared' ? update.projectId : update.facts.projectId;
      if (updatedProjectId !== projectId || updateScheduled) return;
      updateScheduled = true;
      window.queueMicrotask(() => {
        updateScheduled = false;
        if (active) void synchronize();
      });
    });
    void synchronize();

    return () => {
      active = false;
      if (viewGeneration.current === generation) viewGeneration.current += 1;
      unsubscribe();
    };
  }, [client, projectId, refresh, t]);

  const quotes = useMemo(() => {
    const persisted = (project?.activity.preparedPhotoQuotes ?? []).filter(
      (quote) => !suppressedQuoteKeys.has(quoteKey(quote))
    );
    const keys = new Set(persisted.map(quoteKey));
    return [
      ...persisted,
      ...localQuotes.filter((quote) => !suppressedQuoteKeys.has(quoteKey(quote)) && !keys.has(quoteKey(quote))),
    ];
  }, [localQuotes, project?.activity.preparedPhotoQuotes, suppressedQuoteKeys]);

  const createQuotes = useMemo(
    () => quotes.filter((quote): quote is Extract<typeof quote, { mode: 'create' }> => quote.mode === 'create'),
    [quotes]
  );
  const retryQuotes = useMemo(
    () => quotes.filter((quote): quote is Extract<typeof quote, { mode: 'retry' }> => quote.mode === 'retry'),
    [quotes]
  );
  const boardItems = useMemo(() => {
    const pieces = (project?.canvas.pieces ?? []).map((piece, orderIndex) => ({
      kind: 'piece' as const,
      orderIndex,
      key: `piece:${piece.id}`,
      piece,
    }));
    const prepared = createQuotes.map((quote) => ({
      kind: 'quote' as const,
      orderIndex: quote.orderIndex,
      key: `quote:${quoteKey(quote)}`,
      quote,
    }));
    return [...pieces, ...prepared].toSorted((left, right) => {
      const byPosition = left.orderIndex - right.orderIndex;
      if (byPosition !== 0) return byPosition;
      if (left.kind !== right.kind) return left.kind === 'quote' ? -1 : 1;
      return left.key.localeCompare(right.key);
    });
  }, [createQuotes, project?.canvas.pieces]);

  useEffect(() => {
    if (focusTarget === null || canvasRef.current === null) return;
    const target = [...canvasRef.current.querySelectorAll<HTMLElement>('[data-pilot-focus-kind]')].find(
      (candidate) =>
        candidate.dataset.pilotFocusKind === focusTarget.kind && candidate.dataset.pilotFocusId === focusTarget.id
    );
    if (target === undefined) return;
    target.focus();
    setFocusTarget(null);
  }, [boardItems, focusTarget]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    if (composerOpen) {
      if (busy) return;
      canvas.ownerDocument.getElementById('pilot-photo-words')?.focus();
      return;
    }
    if (!restoreCreateFocus.current || busy) return;
    const trigger = canvas.querySelector<HTMLButtonElement>('[data-pilot-create-trigger]');
    if (trigger === null) return;
    trigger.focus();
    restoreCreateFocus.current = false;
  }, [busy, composerOpen]);

  useEffect(() => {
    if (project === null) return;
    const next = new Map(project.activity.jobs.map((job) => [job.jobId, job.status]));
    const changed = project.activity.jobs.findLast(
      (job) => previousJobStatuses.current.has(job.jobId) && previousJobStatuses.current.get(job.jobId) !== job.status
    );
    previousJobStatuses.current = next;
    if (changed === undefined) return;
    const handle = project.canvas.pieces.find((piece) => piece.id === changed.pieceId)?.handle;
    if (handle === undefined) return;
    setAnnouncement(
      t(`${PILOT_I18N_ROOT}.canvas.announcements.jobTransition`, {
        handle: `#${handle}`,
        status: t(JOB_STATUS_KEYS[changed.status]),
      })
    );
  }, [project, t]);

  const handleError = useCallback(
    (caught: unknown): void => {
      setError(errorCopy(caught, t));
      setActiveErrorCode(errorCode(caught));
      setErrorRole('alert');
    },
    [t]
  );

  const savedRefreshUnavailable = useCallback((): void => {
    setError(null);
    setActiveErrorCode(null);
    setErrorRole('status');
    setAnnouncement(t(`${PILOT_I18N_ROOT}.canvas.announcements.savedRefreshUnavailable`));
  }, [t]);

  const refreshAfterSavedAction = useCallback(async (): Promise<void> => {
    try {
      await refresh();
    } catch {
      savedRefreshUnavailable();
    }
  }, [refresh, savedRefreshUnavailable]);

  const suppressQuote = useCallback((quote: StudioRendererPreparedPhotoQuoteV3): void => {
    const key = quoteKey(quote);
    setLocalQuotes((current) => current.filter((candidate) => quoteKey(candidate) !== key));
    setSuppressedQuoteKeys((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);

  const prepare = async (): Promise<void> => {
    if (project === null || words.trim().length === 0) return;
    setBusy(true);
    setError(null);
    setActiveErrorCode(null);
    try {
      const result = await client.preparePhotoV3({
        mode: 'create',
        projectId,
        expectedAuthoringRevision: project.canvas.authoringRevision,
        words: words.trim(),
        settings,
        suggestedHandle: null,
      });
      setSuppressedQuoteKeys((current) => {
        const key = quoteKey(result.quote);
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setLocalQuotes((current) => [
        ...current.filter((quote) => quoteKey(quote) !== quoteKey(result.quote)),
        result.quote,
      ]);
      setFocusTarget({ kind: 'quote', id: result.quote.targetPieceId });
      setComposerOpen(false);
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  };

  const confirm = useCallback(
    async (
      quote: StudioRendererPreparedPhotoQuoteV3,
      duplicateChargeAcknowledged: boolean,
      explicitHumanConfirmation: boolean
    ): Promise<void> => {
      setBusy(true);
      setError(null);
      setActiveErrorCode(null);
      try {
        await client.confirmPreparedPhotoV3({
          reservationId: quote.reservationId,
          quoteId: quote.quoteId,
          quoteRevision: quote.quoteRevision,
          explicitHumanConfirmation,
          duplicateChargeAcknowledged,
        });
        suppressQuote(quote);
        setFocusTarget({ kind: 'piece', id: quote.targetPieceId });
        setAnnouncement(t(`${PILOT_I18N_ROOT}.canvas.announcements.paidWorkStarted`));
        await refreshAfterSavedAction();
      } catch (caught) {
        const code = errorCode(caught);
        if (code !== null && FRESH_QUOTE_ERROR_CODES.has(code)) {
          await client
            .discardPreparedPhotoV3({
              reservationId: quote.reservationId,
              quoteId: quote.quoteId,
              quoteRevision: quote.quoteRevision,
            })
            .catch((): undefined => undefined);
          suppressQuote(quote);
          if (quote.mode === 'create') {
            setWords(quote.words);
            setSettings({ ...quote.settings });
            setComposerOpen(true);
          }
          await refresh().catch((): undefined => undefined);
          setAnnouncement(t(`${PILOT_I18N_ROOT}.canvas.announcements.freshQuoteRequired`));
        }
        handleError(caught);
      } finally {
        setBusy(false);
      }
    },
    [client, handleError, refresh, refreshAfterSavedAction, suppressQuote, t]
  );

  const discard = useCallback(
    async (quote: StudioRendererPreparedPhotoQuoteV3): Promise<void> => {
      setBusy(true);
      setError(null);
      setActiveErrorCode(null);
      try {
        await client.discardPreparedPhotoV3({
          reservationId: quote.reservationId,
          quoteId: quote.quoteId,
          quoteRevision: quote.quoteRevision,
        });
        suppressQuote(quote);
        setAnnouncement(t(`${PILOT_I18N_ROOT}.canvas.announcements.quoteDiscarded`));
        await refreshAfterSavedAction();
      } catch (caught) {
        handleError(caught);
      } finally {
        setBusy(false);
      }
    },
    [client, handleError, refreshAfterSavedAction, suppressQuote, t]
  );

  const importPhoto = async (): Promise<void> => {
    if (project === null) return;
    setBusy(true);
    setError(null);
    setActiveErrorCode(null);
    try {
      const result = await client.importPhotoV3({
        projectId,
        expectedAuthoringRevision: project.canvas.authoringRevision,
      });
      if (result.status === 'imported') {
        setFocusTarget({ kind: 'piece', id: result.pieceId });
        setAnnouncement(t(`${PILOT_I18N_ROOT}.canvas.announcements.photoImported`));
        await refreshAfterSavedAction();
      }
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  };

  const undo = async (): Promise<void> => {
    if (project?.lastUndo === null || project === null) return;
    setBusy(true);
    try {
      await client.applyMutationBatchV3({
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
        projectId,
        expectedAuthoringRevision: project.canvas.authoringRevision,
        operations: [{ kind: 'undo_last', entryId: project.lastUndo.entryId }],
      });
      setAnnouncement(t(`${PILOT_I18N_ROOT}.canvas.announcements.renameUndone`));
      await refreshAfterSavedAction();
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  };

  const currentPieces = project?.canvas.pieces.filter((piece) => piece.currentAsset !== null) ?? [];
  const projectMenu = (
    <Menu>
      <Menu.Item key='spending-limit' onClick={() => setSpendingLimitOpen(true)}>
        {t(`${PILOT_I18N_ROOT}.canvas.projectMenu.spendingLimit`)}
      </Menu.Item>
      {currentPieces.map((piece) => (
        <Menu.Item
          key={piece.id}
          onClick={() => {
            if (project === null) return;
            setBusy(true);
            void client
              .listPieceExportsV3(projectId)
              .then((catalog) =>
                client.exportPieceV3({
                  projectId,
                  pieceId: piece.id,
                  expectedRevision: project.canvas.revision,
                  expectedCatalogRevision: catalog.revision,
                })
              )
              .then((result) => {
                setAnnouncement(t(`${PILOT_I18N_ROOT}.canvas.announcements.exported`, { handle: `#${piece.handle}` }));
                onExported?.(piece.id, result);
              })
              .catch(handleError)
              .finally(() => setBusy(false));
          }}
        >
          {t(`${PILOT_I18N_ROOT}.canvas.projectMenu.export`)} <bdi dir='auto'>#{piece.handle}</bdi>
        </Menu.Item>
      ))}
    </Menu>
  );

  return (
    <main
      ref={canvasRef}
      className={styles.canvas}
      aria-busy={loadState === 'uninitialised' || loadState === 'refreshing' || busy}
    >
      <header className={styles.header}>
        <h1 className={styles.title} dir='auto'>
          {project?.summary.name ?? t(`${PILOT_I18N_ROOT}.common.productName`)}
        </h1>
        {project !== null && (
          <div className={styles.menuActions} aria-label={t(`${PILOT_I18N_ROOT}.canvas.projectActions`)}>
            {project.lastUndo !== null && (
              <Button disabled={busy} onClick={() => void undo()}>
                {t(`${PILOT_I18N_ROOT}.canvas.actions.undoRename`)}
              </Button>
            )}
            <Dropdown droplist={projectMenu} trigger='click' position='br'>
              <Button disabled={busy}>{t(`${PILOT_I18N_ROOT}.canvas.projectMenu.label`)}</Button>
            </Dropdown>
          </div>
        )}
      </header>

      <div className={styles.announcement} role='status' aria-live='polite' aria-atomic='true'>
        {announcement}
      </div>
      {error !== null && (
        <div className={styles.alert} role={errorRole}>
          <p>{error}</p>
          {activeErrorCode === 'route_catalog_unavailable' && composerOpen && (
            <Button disabled={busy} onClick={() => void prepare()}>
              {t(`${PILOT_I18N_ROOT}.canvas.actions.retryRouteCheck`)}
            </Button>
          )}
        </div>
      )}

      {loadState === 'uninitialised' && <p role='status'>{t(`${PILOT_I18N_ROOT}.canvas.loading`)}</p>}
      {loadState === 'refreshing' && <p role='status'>{t(`${PILOT_I18N_ROOT}.canvas.refreshing`)}</p>}
      {loadState === 'unavailable' && <p role='alert'>{t(`${PILOT_I18N_ROOT}.canvas.unavailable`)}</p>}

      {project !== null && (project.canvas.pieces.length > 0 || quotes.length > 0) && !composerOpen && (
        <section className={styles.creationToolbar} aria-label={t(`${PILOT_I18N_ROOT}.canvas.startCreating`)}>
          <Button data-pilot-create-trigger type='primary' disabled={busy} onClick={openComposer}>
            {t(`${PILOT_I18N_ROOT}.canvas.actions.createPhoto`)}
          </Button>
          <Button disabled={busy} onClick={() => void importPhoto()}>
            {t(`${PILOT_I18N_ROOT}.canvas.actions.importPhoto`)}
          </Button>
        </section>
      )}

      {project !== null && project.canvas.pieces.length === 0 && quotes.length === 0 && !composerOpen && (
        <section className={styles.empty} aria-label={t(`${PILOT_I18N_ROOT}.canvas.startCreating`)}>
          <div className={styles.emptyActions}>
            <Button data-pilot-create-trigger type='primary' disabled={busy} onClick={openComposer}>
              {t(`${PILOT_I18N_ROOT}.canvas.actions.createPhoto`)}
            </Button>
            <Button disabled={busy} onClick={() => void importPhoto()}>
              {t(`${PILOT_I18N_ROOT}.canvas.actions.importPhoto`)}
            </Button>
          </div>
        </section>
      )}

      {project !== null && composerOpen && (
        <section className={styles.composer} aria-labelledby='pilot-create-photo-title'>
          <h2 id='pilot-create-photo-title' className={styles.quoteTitle}>
            {t(`${PILOT_I18N_ROOT}.canvas.actions.createPhoto`)}
          </h2>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor='pilot-photo-words'>
              {t(`${PILOT_I18N_ROOT}.canvas.composer.description`)}
            </label>
            <Input.TextArea
              id='pilot-photo-words'
              value={words}
              dir='auto'
              rows={4}
              autoSize={{ minRows: 3, maxRows: 8 }}
              disabled={busy}
              onChange={setWords}
            />
          </div>
          <div className={styles.composerSettings}>
            <div className={styles.field}>
              <label id='pilot-photo-aspect-label' className={styles.fieldLabel} htmlFor='pilot-photo-aspect'>
                {t(`${PILOT_I18N_ROOT}.canvas.composer.aspectRatio`)}
              </label>
              <Select
                id='pilot-photo-aspect'
                aria-labelledby='pilot-photo-aspect-label'
                value={settings.aspectRatio}
                disabled={busy}
                onChange={(aspectRatio) => setSettings((current) => ({ ...current, aspectRatio }))}
              >
                {ASPECT_RATIOS.map((aspectRatio) => (
                  <Select.Option key={aspectRatio} value={aspectRatio}>
                    {aspectRatio}
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div className={styles.field}>
              <label id='pilot-photo-resolution-label' className={styles.fieldLabel} htmlFor='pilot-photo-resolution'>
                {t(`${PILOT_I18N_ROOT}.canvas.composer.resolution`)}
              </label>
              <Select
                id='pilot-photo-resolution'
                aria-labelledby='pilot-photo-resolution-label'
                value={settings.resolution}
                disabled={busy}
                onChange={(resolution) => setSettings((current) => ({ ...current, resolution }))}
              >
                {RESOLUTIONS.map((resolution) => (
                  <Select.Option key={resolution} value={resolution}>
                    {resolution}
                  </Select.Option>
                ))}
              </Select>
            </div>
          </div>
          <div className={styles.formActions}>
            <Button
              type='primary'
              disabled={busy || words.trim().length === 0}
              loading={busy}
              onClick={() => void prepare()}
            >
              {t(`${PILOT_I18N_ROOT}.canvas.actions.reviewCost`)}
            </Button>
            <Button disabled={busy} onClick={closeComposer}>
              {t(`${PILOT_I18N_ROOT}.common.cancel`)}
            </Button>
          </div>
        </section>
      )}

      {project !== null && (quotes.length > 0 || project.canvas.pieces.length > 0) && (
        <section className={styles.board} aria-label={t(`${PILOT_I18N_ROOT}.canvas.boardAccessible`)}>
          {boardItems.map((item) =>
            item.kind === 'quote' ? (
              <QuoteCard key={item.key} quote={item.quote} busy={busy} onConfirm={confirm} onDiscard={discard} />
            ) : (
              <PieceCard
                key={item.key}
                piece={item.piece}
                jobs={project.activity.jobs.filter((job) => job.pieceId === item.piece.id)}
                quotes={retryQuotes.filter((quote) => quote.targetPieceId === item.piece.id)}
                project={project}
                client={client}
                assetUrlFor={assetUrlFor}
                busy={busy}
                onBusy={setBusy}
                onError={handleError}
                onRefresh={refresh}
                onSavedRefreshUnavailable={savedRefreshUnavailable}
                onConfirm={confirm}
                onDiscard={discard}
                onImportPhoto={importPhoto}
                onPrepared={(quote) => {
                  setLocalQuotes((current) => [
                    ...current.filter((candidate) => quoteKey(candidate) !== quoteKey(quote)),
                    quote,
                  ]);
                  setFocusTarget({ kind: 'quote', id: quote.targetPieceId });
                }}
              />
            )
          )}
        </section>
      )}
      {project !== null && (
        <PilotSpendingLimitDialog
          open={spendingLimitOpen}
          currentPolicy={project.spendPolicy}
          projectId={projectId}
          expectedAuthoringRevision={project.canvas.authoringRevision}
          client={client}
          onClose={() => setSpendingLimitOpen(false)}
          onSaved={() => {
            setSuppressedQuoteKeys(new Set(quotes.map(quoteKey)));
            setAnnouncement(t(`${PILOT_I18N_ROOT}.canvas.announcements.spendingLimitSaved`));
            onEditSpendPolicy?.();
            void refreshAfterSavedAction();
          }}
          onError={handleError}
        />
      )}
    </main>
  );
};
