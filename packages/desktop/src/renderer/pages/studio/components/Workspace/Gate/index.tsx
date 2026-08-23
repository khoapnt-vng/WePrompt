/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Modal, Radio, Spin } from '@arco-design/web-react';
import React, { useCallback, useId, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ipcBridge } from '@/common';
import type {
  StudioConfirmSubmissionResultV2,
  StudioPricingRefusalReasonV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  initialSpendGateState,
  formatMinorUnits,
  selectedSpendGateQuote,
  spendGateContinuityChange,
  spendGateReducer,
  spendGateRouteIssue,
  summarizeQuote,
  type SpendGateDraft,
  type SpendGateSelectedOption,
  type SpendGateState,
  type SpendGateRouteIssue,
} from '../spendGate';
import styles from './SpendGateModal.module.css';

export type UseSpendGateInput = {
  onConfirmed: (result: StudioConfirmSubmissionResultV2) => void | Promise<void>;
};

export type UseSpendGateResult = {
  state: SpendGateState;
  open: (draft: SpendGateDraft) => void;
  close: () => void;
  prepare: () => Promise<void>;
  selectOption: (option: SpendGateSelectedOption) => void;
  confirm: () => Promise<void>;
};

/** Owns one reviewed submission attempt. Opening and closing never call native paid seams. */
export const useSpendGate = ({ onConfirmed }: UseSpendGateInput): UseSpendGateResult => {
  const [state, dispatch] = useReducer(spendGateReducer, undefined, initialSpendGateState);
  const stateRef = useRef(state);
  const gateGenerationRef = useRef(0);
  const prepareOperationRef = useRef(0);
  const confirmOperationRef = useRef(0);
  const preparingRef = useRef(false);
  const confirmingRef = useRef(false);
  const terminalSuccessRef = useRef(false);
  stateRef.current = state;

  const open = useCallback((draft: SpendGateDraft) => {
    if (confirmingRef.current || terminalSuccessRef.current || stateRef.current.phase === 'quote_in_use') return;
    gateGenerationRef.current += 1;
    preparingRef.current = false;
    confirmingRef.current = false;
    terminalSuccessRef.current = false;
    dispatch({ type: 'open', draft });
  }, []);
  const close = useCallback(() => {
    if (confirmingRef.current || stateRef.current.phase === 'quote_in_use') return;
    gateGenerationRef.current += 1;
    preparingRef.current = false;
    terminalSuccessRef.current = false;
    dispatch({ type: 'close' });
  }, []);
  const selectOption = useCallback((option: SpendGateSelectedOption) => {
    if (stateRef.current.phase === 'review') dispatch({ type: 'select_option', option });
  }, []);

  const prepare = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (current.draft === null || preparingRef.current || confirmingRef.current) return;
    preparingRef.current = true;
    const generation = gateGenerationRef.current;
    const operation = ++prepareOperationRef.current;
    const draft = current.draft;
    dispatch({ type: 'prepare_started' });
    const fail = (error: { code: string; reason?: unknown }): void => {
      dispatch({ type: 'prepare_failed', error });
      void (async (): Promise<void> => {
        try {
          const routes = await ipcBridge.creativeStudio.listRoutes.invoke({ projectId: draft.projectId });
          if (gateGenerationRef.current !== generation || prepareOperationRef.current !== operation || !routes.ok) {
            return;
          }
          const routeIssue = spendGateRouteIssue(routes.data, draft);
          if (routeIssue !== null) dispatch({ type: 'prepare_failed', error: { ...error, routeIssue } });
        } catch {
          // Route diagnosis is read-only assistance. Preserve the original estimate failure if it is unavailable.
        }
      })();
    };
    try {
      const result = await ipcBridge.creativeStudio.prepareSubmission.invoke(draft);
      if (gateGenerationRef.current !== generation || prepareOperationRef.current !== operation) return;
      if (result.ok === false) {
        fail(result.error);
        return;
      }
      dispatch({ type: 'prepare_succeeded', options: result.data });
    } catch {
      if (gateGenerationRef.current === generation && prepareOperationRef.current === operation) {
        fail({ code: 'storage_error' });
      }
    } finally {
      if (prepareOperationRef.current === operation) preparingRef.current = false;
    }
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    const quote = selectedSpendGateQuote(current);
    if (
      quote === null ||
      current.phase !== 'review' ||
      confirmingRef.current ||
      preparingRef.current ||
      terminalSuccessRef.current
    ) {
      return;
    }
    confirmingRef.current = true;
    const generation = gateGenerationRef.current;
    const operation = ++confirmOperationRef.current;
    dispatch({ type: 'confirm_started' });
    let confirmed: StudioConfirmSubmissionResultV2 | null = null;
    try {
      const result = await ipcBridge.creativeStudio.confirmSubmission.invoke({
        projectId: quote.projectId,
        quoteId: quote.id,
        expectedRevision: quote.projectRevision,
      });
      if (gateGenerationRef.current !== generation || confirmOperationRef.current !== operation) return;
      if (result.ok === false) {
        dispatch({ type: 'confirm_failed', error: result.error });
        return;
      }
      terminalSuccessRef.current = true;
      dispatch({ type: 'confirmed' });
      confirmed = result.data;
    } catch {
      if (gateGenerationRef.current === generation && confirmOperationRef.current === operation) {
        dispatch({ type: 'confirm_failed', error: { code: 'storage_error' } });
      }
    } finally {
      if (confirmOperationRef.current === operation) confirmingRef.current = false;
    }
    if (confirmed !== null) {
      try {
        await onConfirmed(confirmed);
      } catch {
        // The paid commit is already terminal. A refresh failure must never reopen confirmation.
      }
    }
  }, [onConfirmed]);

  return { state, open, close, prepare, selectOption, confirm };
};

export type SpendGateModalProps = Pick<
  UseSpendGateResult,
  'state' | 'close' | 'prepare' | 'selectOption' | 'confirm'
> & {
  onEditRoutes: (issue: SpendGateRouteIssue) => void;
};

const pricingRefusalMessageKeys: Record<StudioPricingRefusalReasonV2, string> = {
  invalid_quote: 'conversation.creativeStudio.workspace.gate.errors.pricing.invalidQuote',
  inactive_shot: 'conversation.creativeStudio.workspace.gate.errors.pricing.inactiveShot',
  in_flight: 'conversation.creativeStudio.workspace.gate.errors.pricing.inFlight',
  duplicate_shot_purpose: 'conversation.creativeStudio.workspace.gate.errors.pricing.duplicateShotPurpose',
  invalid_dependency: 'conversation.creativeStudio.workspace.gate.errors.pricing.invalidDependency',
  invalid_prepare_request: 'conversation.creativeStudio.workspace.gate.errors.pricing.invalidPrepareRequest',
  invalid_reference: 'conversation.creativeStudio.workspace.gate.errors.pricing.invalidReference',
  missing_conditioning: 'conversation.creativeStudio.workspace.gate.errors.pricing.missingConditioning',
  unsafe_total: 'conversation.creativeStudio.workspace.gate.errors.pricing.unsafeTotal',
};

const errorMessageKey = (state: SpendGateState): string | null => {
  if (state.phase === 'refresh_required') return 'conversation.creativeStudio.errors.quoteNotFound';
  if (state.phase === 'quote_in_use') return 'conversation.creativeStudio.errors.quoteInUse';
  if (state.phase === 'quote_cache_full') return 'conversation.creativeStudio.errors.quoteCacheFull';
  if (state.phase === 'quote_too_large') return 'conversation.creativeStudio.errors.quoteTooLarge';
  if (state.phase === 'error' && state.pricingRefusalReason !== null) {
    return pricingRefusalMessageKeys[state.pricingRefusalReason];
  }
  if (state.phase === 'error' && state.routeIssue === 'image') {
    return 'conversation.creativeStudio.workspace.controls.imageRouteBlocked';
  }
  if (state.phase === 'error' && state.routeIssue === 'video') {
    return 'conversation.creativeStudio.workspace.controls.videoRouteBlocked';
  }
  if (state.phase === 'error' && state.routeIssue === 'image_and_video') {
    return 'conversation.creativeStudio.workspace.gate.errors.routesUnavailable';
  }
  if (state.phase === 'error') return 'conversation.creativeStudio.workspace.gate.errors.generic';
  return null;
};

export const SpendGateModal: React.FC<SpendGateModalProps> = ({
  state,
  close,
  prepare,
  selectOption,
  confirm,
  onEditRoutes,
}) => {
  const { t, i18n } = useTranslation();
  // The headline and the Confirm label already carry the count and the total. The per-generation
  // breakdown is a long list on a real film, so it starts closed and stays one click away.
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const breakdownId = useId();
  const quote = selectedSpendGateQuote(state);
  const summary = useMemo(() => (quote === null ? null : summarizeQuote(quote)), [quote]);
  const visible = state.phase !== 'closed';
  const breakdownOpen = visible && quote !== null && expandedQuoteId === quote.id;
  const closeGate = useCallback(() => {
    setExpandedQuoteId(null);
    close();
  }, [close]);
  const continuityChange = spendGateContinuityChange(state.draft);
  const continuityIntent = continuityChange === null ? null : continuityChange.hardCut ? 'sever' : 'rejoin';
  // A column that reads the same on every row is noise. Show group, purpose and route per row only
  // when they actually differ; otherwise the route is stated once and the row is shot, length, price.
  const rowFacts = useMemo(() => {
    const rows = quote === null ? [] : summarizeQuote(quote).rows;
    const firstRoute = rows[0]?.route;
    const sharedRoute =
      firstRoute !== undefined &&
      rows.every(
        (row) =>
          row.route.providerId === firstRoute.providerId &&
          row.route.model === firstRoute.model &&
          row.route.choiceId === firstRoute.choiceId
      )
        ? firstRoute
        : null;
    return {
      // A continuity change forces every row to read "Required", so the label never varies there.
      mixedGroups: continuityIntent === null && new Set(rows.map((row) => row.group)).size > 1,
      mixedPurposes: new Set(rows.map((row) => row.purpose)).size > 1,
      sharedRoute,
    };
  }, [continuityIntent, quote]);
  const { mixedGroups, mixedPurposes, sharedRoute } = rowFacts;
  const formatMoney = useCallback(
    (minorUnits: number, currency: string): string =>
      formatMinorUnits(minorUnits, currency, i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage]
  );
  const messageKey = errorMessageKey(state);
  const canClose = state.phase !== 'confirming' && state.phase !== 'quote_in_use';
  const titleKey =
    continuityIntent === 'sever'
      ? 'conversation.creativeStudio.workspace.gate.continuity.severTitle'
      : continuityIntent === 'rejoin'
        ? 'conversation.creativeStudio.workspace.gate.continuity.rejoinTitle'
        : 'conversation.creativeStudio.workspace.gate.title';
  const displayedCost =
    summary === null
      ? ''
      : summary.exactPrice
        ? formatMoney(summary.lowerMinorUnits, summary.currency)
        : `${formatMoney(summary.lowerMinorUnits, summary.currency)}–${formatMoney(
            summary.upperMinorUnits,
            summary.currency
          )}`;
  const confirmCost =
    summary === null
      ? ''
      : formatMoney(summary.exactPrice ? summary.lowerMinorUnits : summary.upperMinorUnits, summary.currency);

  return (
    <Modal
      visible={visible}
      footer={null}
      maskClosable={false}
      closable={canClose}
      unmountOnExit={false}
      title={t(titleKey)}
      onCancel={canClose ? closeGate : undefined}
    >
      <div
        className={styles.body}
        data-chain-change-intent={continuityIntent ?? undefined}
        data-gate-kind={continuityIntent === null ? 'generation' : 'continuity_change'}
        data-testid='studio-spend-gate'
      >
        {state.phase === 'choices' ? (
          <>
            <p>{t('conversation.creativeStudio.workspace.gate.reviewBeforeSpend')}</p>
            {continuityIntent === null ? (
              <p>
                {t('conversation.creativeStudio.workspace.gate.requestedShots', {
                  count: new Set(
                    [...(state.draft?.baseChoices ?? []), ...(state.draft?.cascadeChoices ?? [])].map(
                      (choice) => choice.shotId
                    )
                  ).size,
                })}
              </p>
            ) : (
              <p data-chain-change-summary data-testid='studio-chain-change-summary'>
                {t(
                  continuityIntent === 'sever'
                    ? 'conversation.creativeStudio.workspace.gate.continuity.severSummary'
                    : 'conversation.creativeStudio.workspace.gate.continuity.rejoinSummary'
                )}
              </p>
            )}
          </>
        ) : null}

        {state.phase === 'preparing' ? (
          <div className={styles.loading}>
            <Spin />
            <span>{t('conversation.creativeStudio.workspace.gate.preparing')}</span>
          </div>
        ) : null}

        {state.options !== null && quote !== null && summary !== null ? (
          <>
            {continuityIntent === null && state.options.withCascade !== null ? (
              <Radio.Group
                aria-label={t('conversation.creativeStudio.workspace.gate.optionsLabel')}
                value={state.selectedOption}
                disabled={state.phase !== 'review'}
                onChange={(value) => {
                  setExpandedQuoteId(null);
                  selectOption(value as SpendGateSelectedOption);
                }}
              >
                <Radio value='baseOnly'>{t('conversation.creativeStudio.workspace.gate.baseOnly')}</Radio>
                <Radio value='withCascade'>{t('conversation.creativeStudio.workspace.gate.withCascade')}</Radio>
              </Radio.Group>
            ) : null}
            <h3>
              {t(
                continuityIntent === 'sever'
                  ? 'conversation.creativeStudio.workspace.gate.continuity.severHeadline'
                  : continuityIntent === 'rejoin'
                    ? 'conversation.creativeStudio.workspace.gate.continuity.rejoinHeadline'
                    : 'conversation.creativeStudio.workspace.gate.headline',
                {
                  count: summary.choiceCount,
                  cost: displayedCost,
                }
              )}
            </h3>
            {continuityIntent !== null ? (
              <p data-chain-change-required>
                {t('conversation.creativeStudio.workspace.gate.continuity.requiredWork')}
              </p>
            ) : null}
            {summary.budget.kind === 'no_policy' ? null : (
              <p>
                {t(`conversation.creativeStudio.workspace.gate.budget.${summary.budget.kind}`)}
                {'policyCurrency' in summary.budget
                  ? ` · ${t('conversation.creativeStudio.workspace.gate.budgetPolicy', {
                      currency: summary.budget.policyCurrency,
                      cap: formatMoney(summary.budget.maxPerBatchMinorUnits, summary.budget.policyCurrency),
                    })}`
                  : null}
              </p>
            )}
            <Button
              aria-controls={breakdownId}
              aria-expanded={breakdownOpen}
              className={styles.breakdownToggle}
              onClick={() => setExpandedQuoteId((current) => (current === quote.id ? null : quote.id))}
              type='text'
            >
              {t(
                breakdownOpen
                  ? 'conversation.creativeStudio.workspace.gate.hideBreakdown'
                  : 'conversation.creativeStudio.workspace.gate.showBreakdown'
              )}
            </Button>
            {breakdownOpen ? (
              <div className={styles.breakdown} id={breakdownId}>
                {summary.budget.kind === 'no_policy' ? (
                  <p>{t('conversation.creativeStudio.workspace.gate.budget.no_policy')}</p>
                ) : null}
                <p>{t('conversation.creativeStudio.workspace.gate.rateCardSource')}</p>
                {sharedRoute === null ? null : (
                  <p>
                    <bdi dir='auto'>
                      {t('conversation.creativeStudio.workspace.gate.routeShared', {
                        model: sharedRoute.model,
                      })}
                    </bdi>
                  </p>
                )}
                <ol className={styles.rows}>
                  {summary.rows.map((row, index) => (
                    <li
                      data-generation-purpose={row.purpose}
                      data-quote-group={continuityIntent === null ? row.group : 'required'}
                      data-shot-id={row.shotId}
                      key={`${row.group}:${row.shotId}:${row.purpose}:${index}`}
                    >
                      <span>
                        {mixedGroups
                          ? `${t(
                              `conversation.creativeStudio.workspace.gate.group.${continuityIntent === null ? row.group : 'required'}`
                            )} · `
                          : null}
                        {mixedPurposes
                          ? `${t(`conversation.creativeStudio.workspace.gate.purpose.${row.purpose}`)} · `
                          : null}
                        {row.shotId} ·{' '}
                        {row.durationSeconds === null
                          ? t('conversation.creativeStudio.workspace.gate.durationNotApplicable')
                          : t('conversation.creativeStudio.workspace.gate.duration', { seconds: row.durationSeconds })}
                        {' · '}
                        {formatMoney(row.requestedTotalMinorUnits, summary.currency)}
                      </span>
                      {sharedRoute === null ? (
                        <bdi dir='auto'>
                          {t('conversation.creativeStudio.workspace.gate.route', {
                            provider: row.route.providerId,
                            model: row.route.model,
                            choice: row.route.choiceId,
                          })}
                        </bdi>
                      ) : null}
                    </li>
                  ))}
                </ol>
                <p>
                  {t('conversation.creativeStudio.workspace.gate.revision', { revision: summary.projectRevision })} ·{' '}
                  {t('conversation.creativeStudio.workspace.gate.expires', { expiresAt: summary.expiresAt })}
                </p>
              </div>
            ) : null}
          </>
        ) : null}

        {messageKey !== null ? <Alert type='warning' content={t(messageKey)} /> : null}
        {state.phase === 'confirmed' ? (
          <Alert
            type='success'
            content={t(
              continuityIntent === 'sever'
                ? 'conversation.creativeStudio.workspace.gate.continuity.severConfirmed'
                : continuityIntent === 'rejoin'
                  ? 'conversation.creativeStudio.workspace.gate.continuity.rejoinConfirmed'
                  : 'conversation.creativeStudio.workspace.gate.confirmed'
            )}
          />
        ) : null}

        <div className={styles.actions}>
          {state.phase === 'error' && state.routeIssue !== null ? (
            <Button
              type='primary'
              onClick={() => {
                const issue = state.routeIssue;
                closeGate();
                onEditRoutes(issue);
              }}
            >
              {t('conversation.creativeStudio.workspace.controls.briefAndRulesTitle')}
            </Button>
          ) : null}
          {state.phase === 'choices' || state.phase === 'refresh_required' || state.phase === 'quote_cache_full' ? (
            <Button
              type='primary'
              onClick={() => {
                setExpandedQuoteId(null);
                void prepare();
              }}
            >
              {t(
                state.phase === 'choices'
                  ? 'conversation.creativeStudio.workspace.gate.prepare'
                  : 'conversation.creativeStudio.workspace.gate.prepareAgain'
              )}
            </Button>
          ) : null}
          {(state.phase === 'review' || state.phase === 'confirming' || state.phase === 'quote_in_use') &&
          summary !== null ? (
            <Button
              data-chain-change-confirm={continuityIntent === null ? undefined : true}
              type='primary'
              loading={state.phase === 'confirming' || state.phase === 'quote_in_use'}
              disabled={
                state.phase !== 'review' ||
                summary.budget.kind === 'over_cap' ||
                summary.budget.kind === 'currency_mismatch'
              }
              onClick={() => void confirm()}
            >
              {t(
                continuityIntent === 'sever'
                  ? 'conversation.creativeStudio.workspace.gate.continuity.confirmSever'
                  : continuityIntent === 'rejoin'
                    ? 'conversation.creativeStudio.workspace.gate.continuity.confirmRejoin'
                    : 'conversation.creativeStudio.workspace.gate.confirm',
                {
                  count: summary.choiceCount,
                  cost: confirmCost,
                }
              )}
            </Button>
          ) : null}
          <Button disabled={!canClose} onClick={closeGate}>
            {t(
              continuityIntent === null
                ? 'conversation.creativeStudio.workspace.gate.close'
                : 'conversation.creativeStudio.workspace.gate.continuity.close'
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
