/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Modal, Radio, Spin } from '@arco-design/web-react';
import React, { useCallback, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ipcBridge } from '@/common';
import type { StudioConfirmSubmissionResultV2 } from '@/common/types/project/creativeStudioTypes';
import {
  initialSpendGateState,
  formatMinorUnits,
  selectedSpendGateQuote,
  spendGateReducer,
  summarizeQuote,
  type SpendGateDraft,
  type SpendGateSelectedOption,
  type SpendGateState,
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
    try {
      const result = await ipcBridge.creativeStudio.prepareSubmission.invoke(draft);
      if (gateGenerationRef.current !== generation || prepareOperationRef.current !== operation) return;
      if (result.ok === false) {
        dispatch({ type: 'prepare_failed', code: result.error.code });
        return;
      }
      dispatch({ type: 'prepare_succeeded', options: result.data });
    } catch {
      if (gateGenerationRef.current === generation && prepareOperationRef.current === operation) {
        dispatch({ type: 'prepare_failed', code: 'storage_error' });
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
        dispatch({ type: 'confirm_failed', code: result.error.code });
        return;
      }
      terminalSuccessRef.current = true;
      dispatch({ type: 'confirmed' });
      confirmed = result.data;
    } catch {
      if (gateGenerationRef.current === generation && confirmOperationRef.current === operation) {
        dispatch({ type: 'confirm_failed', code: 'storage_error' });
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

export type SpendGateModalProps = Pick<UseSpendGateResult, 'state' | 'close' | 'prepare' | 'selectOption' | 'confirm'>;

const errorMessageKey = (state: SpendGateState): string | null => {
  if (state.phase === 'refresh_required') return 'conversation.creativeStudio.errors.quoteNotFound';
  if (state.phase === 'quote_in_use') return 'conversation.creativeStudio.errors.quoteInUse';
  if (state.phase === 'quote_cache_full') return 'conversation.creativeStudio.errors.quoteCacheFull';
  if (state.phase === 'quote_too_large') return 'conversation.creativeStudio.errors.quoteTooLarge';
  if (state.phase === 'error') return 'conversation.creativeStudio.workspace.gate.errors.generic';
  return null;
};

export const SpendGateModal: React.FC<SpendGateModalProps> = ({ state, close, prepare, selectOption, confirm }) => {
  const { t, i18n } = useTranslation();
  const quote = selectedSpendGateQuote(state);
  const summary = useMemo(() => (quote === null ? null : summarizeQuote(quote)), [quote]);
  const formatMoney = useCallback(
    (minorUnits: number, currency: string): string =>
      formatMinorUnits(minorUnits, currency, i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage]
  );
  const visible = state.phase !== 'closed';
  const messageKey = errorMessageKey(state);
  const canClose = state.phase !== 'confirming' && state.phase !== 'quote_in_use';

  return (
    <Modal
      visible={visible}
      footer={null}
      maskClosable={false}
      closable={canClose}
      unmountOnExit={false}
      title={t('conversation.creativeStudio.workspace.gate.title')}
      onCancel={canClose ? close : undefined}
    >
      <div className={styles.body} data-testid='studio-spend-gate'>
        {state.phase === 'choices' ? (
          <>
            <p>{t('conversation.creativeStudio.workspace.gate.reviewBeforeSpend')}</p>
            <p>
              {t('conversation.creativeStudio.workspace.gate.requestedShots', {
                count: new Set(
                  [...(state.draft?.baseChoices ?? []), ...(state.draft?.cascadeChoices ?? [])].map(
                    (choice) => choice.shotId
                  )
                ).size,
              })}
            </p>
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
            {state.options.withCascade !== null ? (
              <Radio.Group
                aria-label={t('conversation.creativeStudio.workspace.gate.optionsLabel')}
                value={state.selectedOption}
                disabled={state.phase !== 'review'}
                onChange={(value) => selectOption(value as SpendGateSelectedOption)}
              >
                <Radio value='baseOnly'>{t('conversation.creativeStudio.workspace.gate.baseOnly')}</Radio>
                <Radio value='withCascade'>{t('conversation.creativeStudio.workspace.gate.withCascade')}</Radio>
              </Radio.Group>
            ) : null}
            <h3>
              {t('conversation.creativeStudio.workspace.gate.headline', {
                count: summary.generationCount,
                cost: summary.exactPrice
                  ? formatMoney(summary.lowerMinorUnits, summary.currency)
                  : `${formatMoney(summary.lowerMinorUnits, summary.currency)}–${formatMoney(
                      summary.upperMinorUnits,
                      summary.currency
                    )}`,
              })}
            </h3>
            <p>{t('conversation.creativeStudio.workspace.gate.rateCardSource')}</p>
            <ol className={styles.rows}>
              {summary.rows.map((row, index) => (
                <li key={`${row.group}:${row.shotId}:${row.purpose}:${index}`}>
                  <span>
                    {t(`conversation.creativeStudio.workspace.gate.group.${row.group}`)} ·{' '}
                    {t(`conversation.creativeStudio.workspace.gate.purpose.${row.purpose}`)} · {row.shotId}
                  </span>
                  <span>
                    {t('conversation.creativeStudio.workspace.gate.route', {
                      provider: row.route.providerId,
                      model: row.route.model,
                      choice: row.route.choiceId,
                    })}
                  </span>
                  <span>
                    {row.durationSeconds === null
                      ? t('conversation.creativeStudio.workspace.gate.durationNotApplicable')
                      : t('conversation.creativeStudio.workspace.gate.duration', { seconds: row.durationSeconds })}
                  </span>
                  <span>
                    {t('conversation.creativeStudio.workspace.gate.rowCost', {
                      count: row.generationCount,
                      cost: formatMoney(row.requestedTotalMinorUnits, summary.currency),
                      each: formatMoney(row.oneGenerationMinorUnits, summary.currency),
                    })}
                  </span>
                  {row.waitsForTakeSelection ? (
                    <span>{t('conversation.creativeStudio.workspace.gate.waitsForTakeSelection')}</span>
                  ) : null}
                </li>
              ))}
            </ol>
            <p>
              {t(`conversation.creativeStudio.workspace.gate.budget.${summary.budget.kind}`)}
              {'policyCurrency' in summary.budget
                ? ` · ${t('conversation.creativeStudio.workspace.gate.budgetPolicy', {
                    currency: summary.budget.policyCurrency,
                    cap: formatMoney(summary.budget.maxPerBatchMinorUnits, summary.budget.policyCurrency),
                  })}`
                : null}
            </p>
            <p>
              {t('conversation.creativeStudio.workspace.gate.revision', { revision: summary.projectRevision })} ·{' '}
              {t('conversation.creativeStudio.workspace.gate.expires', { expiresAt: summary.expiresAt })}
            </p>
          </>
        ) : null}

        {messageKey !== null ? <Alert type='warning' content={t(messageKey)} /> : null}
        {state.phase === 'confirmed' ? (
          <Alert type='success' content={t('conversation.creativeStudio.workspace.gate.confirmed')} />
        ) : null}

        <div className={styles.actions}>
          {state.phase === 'choices' || state.phase === 'refresh_required' || state.phase === 'quote_cache_full' ? (
            <Button type='primary' onClick={() => void prepare()}>
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
              type='primary'
              loading={state.phase === 'confirming' || state.phase === 'quote_in_use'}
              disabled={
                state.phase !== 'review' ||
                summary.budget.kind === 'over_cap' ||
                summary.budget.kind === 'currency_mismatch'
              }
              onClick={() => void confirm()}
            >
              {t('conversation.creativeStudio.workspace.gate.confirm', {
                count: summary.generationCount,
                cost: summary.exactPrice
                  ? formatMoney(summary.lowerMinorUnits, summary.currency)
                  : formatMoney(summary.upperMinorUnits, summary.currency),
              })}
            </Button>
          ) : null}
          <Button disabled={!canClose} onClick={close}>
            {t('conversation.creativeStudio.workspace.gate.close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
