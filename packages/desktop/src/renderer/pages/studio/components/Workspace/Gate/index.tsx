/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Modal, Radio, Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ipcBridge } from '@/common';
import type {
  StudioConfirmSubmissionResultV2,
  StudioPricingRefusalReasonV2,
  StudioProjectReferenceV2,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST } from '@/common/types/project/creativeStudioTypes';
import {
  initialSpendGateState,
  formatMinorUnits,
  isProjectReferenceSpendGateDraft,
  selectedSpendGateQuote,
  spendGateBoardPromotion,
  spendGateContinuityChange,
  spendGateDraftIdentity,
  spendGateProjectReferenceIds,
  spendGateReducer,
  spendGateRouteIssue,
  summarizeQuote,
  validSpendGateBackgroundChoices,
  type SpendGateBackgroundChoice,
  type SpendGateBackgroundChoicePlan,
  type SpendGateDraft,
  type SpendGateBoardPromotion,
  type SpendGateBoardPromotionImpact,
  type SpendGateSelectedOption,
  type SpendGateState,
  type SpendGateRouteIssue,
} from '../spendGate';
import styles from './SpendGateModal.module.css';

export type UseSpendGateInput = {
  onConfirmed: (result: StudioConfirmSubmissionResultV2) => void | Promise<void>;
  deriveBackgroundChoicePlan?: (draft: SpendGateDraft) => SpendGateBackgroundChoicePlan | null;
  onAssignBackgroundChoices?: (input: {
    draft: SpendGateDraft;
    plan: SpendGateBackgroundChoicePlan;
    choices: readonly SpendGateBackgroundChoice[];
  }) => Promise<SpendGateDraft | null>;
  onPromoteOnly?: (input: {
    projectId: string;
    expectedRevision: number;
    promotion: SpendGateBoardPromotion;
  }) => boolean | Promise<boolean>;
};

export type UseSpendGateResult = {
  state: SpendGateState;
  open: (draft: SpendGateDraft, boardPromotionImpact?: SpendGateBoardPromotionImpact) => void;
  close: () => void;
  promoteOnly: () => Promise<void>;
  assignBackgroundChoices: (choices: readonly SpendGateBackgroundChoice[]) => Promise<void>;
  prepare: () => Promise<void>;
  selectOption: (option: SpendGateSelectedOption) => void;
  confirm: () => Promise<void>;
};

/** Owns one reviewed submission attempt. Opening and closing never call native paid seams. */
export const useSpendGate = ({
  onConfirmed,
  deriveBackgroundChoicePlan,
  onAssignBackgroundChoices,
  onPromoteOnly,
}: UseSpendGateInput): UseSpendGateResult => {
  const [state, dispatch] = useReducer(spendGateReducer, undefined, initialSpendGateState);
  const stateRef = useRef(state);
  const gateGenerationRef = useRef(0);
  const prepareOperationRef = useRef(0);
  const confirmOperationRef = useRef(0);
  const preparingRef = useRef(false);
  const assigningBackgroundsRef = useRef(false);
  const backgroundAssignmentOperationRef = useRef(0);
  const promotingRef = useRef(false);
  const confirmingRef = useRef(false);
  const terminalSuccessRef = useRef(false);
  stateRef.current = state;

  const open = useCallback(
    (draft: SpendGateDraft, boardPromotionImpact?: SpendGateBoardPromotionImpact) => {
      if (
        promotingRef.current ||
        assigningBackgroundsRef.current ||
        confirmingRef.current ||
        terminalSuccessRef.current ||
        stateRef.current.phase === 'quote_in_use'
      ) {
        return;
      }
      gateGenerationRef.current += 1;
      preparingRef.current = false;
      confirmingRef.current = false;
      terminalSuccessRef.current = false;
      let backgroundChoicePlan: SpendGateBackgroundChoicePlan | null = null;
      try {
        backgroundChoicePlan = deriveBackgroundChoicePlan?.(draft) ?? null;
      } catch {
        backgroundChoicePlan = {
          status: 'invalid',
          identity: JSON.stringify(['invalid', spendGateDraftIdentity(draft)]),
          projectId: draft.projectId,
          expectedRevision: draft.expectedRevision,
          shotIds: [],
          approvedBackgrounds: [],
        };
      }
      dispatch({
        type: 'open',
        draft,
        ...(boardPromotionImpact === undefined ? {} : { boardPromotionImpact }),
        backgroundChoicePlan,
      });
    },
    [deriveBackgroundChoicePlan]
  );
  const close = useCallback(() => {
    if (
      promotingRef.current ||
      assigningBackgroundsRef.current ||
      confirmingRef.current ||
      stateRef.current.phase === 'quote_in_use'
    ) {
      return;
    }
    gateGenerationRef.current += 1;
    preparingRef.current = false;
    terminalSuccessRef.current = false;
    dispatch({ type: 'close' });
  }, []);

  const assignBackgroundChoices = useCallback(
    async (choices: readonly SpendGateBackgroundChoice[]): Promise<void> => {
      const current = stateRef.current;
      const plan = current.backgroundChoicePlan;
      const draft = current.draft;
      if (
        current.phase !== 'choices' ||
        draft === null ||
        plan === null ||
        onAssignBackgroundChoices === undefined ||
        assigningBackgroundsRef.current ||
        promotingRef.current ||
        preparingRef.current ||
        confirmingRef.current ||
        !validSpendGateBackgroundChoices(plan, choices)
      ) {
        return;
      }
      assigningBackgroundsRef.current = true;
      const generation = gateGenerationRef.current;
      const operation = ++backgroundAssignmentOperationRef.current;
      const originalIdentity = spendGateDraftIdentity(draft);
      dispatch({ type: 'background_assignment_started' });
      try {
        const updatedDraft = await onAssignBackgroundChoices({ draft, plan, choices });
        if (
          gateGenerationRef.current !== generation ||
          backgroundAssignmentOperationRef.current !== operation ||
          updatedDraft === null ||
          updatedDraft.projectId !== draft.projectId ||
          updatedDraft.expectedRevision !== draft.expectedRevision + 1 ||
          spendGateDraftIdentity({ ...updatedDraft, expectedRevision: draft.expectedRevision }) !== originalIdentity
        ) {
          dispatch({ type: 'background_assignment_failed' });
          return;
        }
        let nextPlan: SpendGateBackgroundChoicePlan | null;
        try {
          nextPlan = deriveBackgroundChoicePlan?.(updatedDraft) ?? null;
        } catch {
          nextPlan = plan;
        }
        if (nextPlan !== null) {
          dispatch({ type: 'background_assignment_failed' });
          return;
        }
        dispatch({ type: 'background_assignment_succeeded', draft: updatedDraft, backgroundChoicePlan: null });
      } catch {
        if (gateGenerationRef.current === generation && backgroundAssignmentOperationRef.current === operation) {
          dispatch({ type: 'background_assignment_failed' });
        }
      } finally {
        if (backgroundAssignmentOperationRef.current === operation) assigningBackgroundsRef.current = false;
      }
    },
    [deriveBackgroundChoicePlan, onAssignBackgroundChoices]
  );
  const selectOption = useCallback((option: SpendGateSelectedOption) => {
    if (stateRef.current.phase === 'review') dispatch({ type: 'select_option', option });
  }, []);

  const promoteOnly = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    const promotion = spendGateBoardPromotion(current.draft);
    if (
      promotion === null ||
      current.boardPromotionImpact === null ||
      onPromoteOnly === undefined ||
      promotingRef.current ||
      preparingRef.current ||
      confirmingRef.current ||
      current.phase === 'quote_in_use' ||
      current.phase === 'promoted' ||
      current.phase === 'confirmed'
    ) {
      return;
    }
    promotingRef.current = true;
    const generation = gateGenerationRef.current;
    dispatch({ type: 'promote_started' });
    try {
      const promoted = await onPromoteOnly({
        projectId: current.draft!.projectId,
        expectedRevision: current.draft!.expectedRevision,
        promotion,
      });
      if (gateGenerationRef.current !== generation) return;
      if (!promoted) {
        dispatch({ type: 'promote_failed', error: { code: 'storage_error' } });
        return;
      }
      terminalSuccessRef.current = true;
      dispatch({ type: 'promote_succeeded' });
    } catch {
      if (gateGenerationRef.current === generation) {
        dispatch({ type: 'promote_failed', error: { code: 'storage_error' } });
      }
    } finally {
      promotingRef.current = false;
    }
  }, [onPromoteOnly]);

  const prepare = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    const promotion = spendGateBoardPromotion(current.draft);
    if (
      current.draft === null ||
      current.backgroundChoicePlan !== null ||
      promotingRef.current ||
      preparingRef.current ||
      confirmingRef.current ||
      terminalSuccessRef.current ||
      (promotion !== null &&
        (current.boardPromotionImpact === null ||
          current.boardPromotionImpact.paidRouteReady === false ||
          current.boardPromotionImpact.currentTakeShotIds.length === 0 ||
          current.boardPromotionImpact.currentTakeShotIds.length > STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST))
    ) {
      return;
    }
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
      const result = isProjectReferenceSpendGateDraft(draft)
        ? await ipcBridge.creativeStudio.prepareProjectReferences.invoke({
            projectId: draft.projectId,
            expectedRevision: draft.expectedRevision,
            referenceIds: [...draft.referenceIds],
          })
        : await ipcBridge.creativeStudio.prepareSubmission.invoke(draft);
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
      promotingRef.current ||
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

  return { state, open, close, promoteOnly, assignBackgroundChoices, prepare, selectOption, confirm };
};

export type SpendGateModalProps = Pick<
  UseSpendGateResult,
  'state' | 'close' | 'promoteOnly' | 'assignBackgroundChoices' | 'prepare' | 'selectOption' | 'confirm'
> & {
  onEditRoutes: (issue: SpendGateRouteIssue) => void;
  onReviewBackgroundReferences?: () => void;
  projectReferences?: readonly Pick<StudioProjectReferenceV2, 'id' | 'kind' | 'label'>[];
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

type BoardPromotionChoice = 'promote_only' | 'promote_and_rerender';

export const SpendGateModal: React.FC<SpendGateModalProps> = ({
  state,
  close,
  promoteOnly,
  assignBackgroundChoices,
  prepare,
  selectOption,
  confirm,
  onEditRoutes,
  onReviewBackgroundReferences,
  projectReferences = [],
}) => {
  const { t, i18n } = useTranslation();
  // The headline and the Confirm label already carry the count and the total. The per-generation
  // breakdown is a long list on a real film, so it starts closed and stays one click away.
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const [boardPromotionChoice, setBoardPromotionChoice] = useState<BoardPromotionChoice>('promote_only');
  const [backgroundSelections, setBackgroundSelections] = useState<Record<string, string>>({});
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
  const boardPromotion = spendGateBoardPromotion(state.draft);
  const backgroundChoicePlan = state.backgroundChoicePlan;
  const backgroundChoiceIdentity = backgroundChoicePlan?.identity ?? null;
  useEffect(() => setBackgroundSelections({}), [backgroundChoiceIdentity]);
  const backgroundChoices = useMemo(
    () =>
      backgroundChoicePlan?.status === 'choices'
        ? backgroundChoicePlan.shotIds.flatMap((shotId) => {
            const referenceId = backgroundSelections[shotId];
            return referenceId === undefined ? [] : [{ shotId, referenceId }];
          })
        : [],
    [backgroundChoicePlan, backgroundSelections]
  );
  const backgroundChoicesComplete =
    backgroundChoicePlan?.status === 'choices' && backgroundChoices.length === backgroundChoicePlan.shotIds.length;
  const projectReferenceIds = spendGateProjectReferenceIds(state.draft);
  const projectReferenceById = useMemo(
    () => new Map(projectReferences.map((reference) => [reference.id, reference])),
    [projectReferences]
  );
  const projectReferenceScope = useMemo(
    () =>
      projectReferenceIds?.map((referenceId) => {
        const reference = projectReferenceById.get(referenceId);
        if (reference === undefined) return t('conversation.creativeStudio.workspace.views.references');
        return `${t(
          reference.kind === 'character'
            ? 'conversation.creativeStudio.workspace.referenceWorkflow.characters.title'
            : 'conversation.creativeStudio.workspace.referenceWorkflow.backgrounds.title'
        )} — ${reference.label}`;
      }) ?? [],
    [projectReferenceById, projectReferenceIds, t]
  );
  const boardPromotionImpact = boardPromotion === null ? null : state.boardPromotionImpact;
  const boardPromotionPaidCount = boardPromotionImpact?.currentTakeShotIds.length ?? 0;
  const boardPromotionPaidAvailable =
    boardPromotionPaidCount > 0 &&
    boardPromotionPaidCount <= STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST &&
    boardPromotionImpact?.paidRouteReady !== false;
  const boardPromotionIdentity =
    boardPromotion === null
      ? null
      : `${state.draft?.projectId ?? ''}\0${String(state.draft?.expectedRevision ?? '')}\0${boardPromotion.shotId}\0${boardPromotion.boardAssetId}`;
  useEffect(() => setBoardPromotionChoice('promote_only'), [boardPromotionIdentity]);
  const requiredChange = continuityIntent !== null || boardPromotion !== null;
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
      // A state change forces every row to read "Required", so the label never varies there.
      mixedGroups: !requiredChange && new Set(rows.map((row) => row.group)).size > 1,
      mixedPurposes: new Set(rows.map((row) => row.purpose)).size > 1,
      sharedRoute,
    };
  }, [quote, requiredChange]);
  const { mixedGroups, mixedPurposes, sharedRoute } = rowFacts;
  const formatMoney = useCallback(
    (minorUnits: number, currency: string): string =>
      formatMinorUnits(minorUnits, currency, i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage]
  );
  const messageKey =
    state.phase === 'choices' && state.errorCode === 'background_assignment_failed'
      ? 'conversation.creativeStudio.workspace.gate.backgroundChoice.failed'
      : errorMessageKey(state);
  const canClose =
    state.phase !== 'promoting' &&
    state.phase !== 'assigning_backgrounds' &&
    state.phase !== 'confirming' &&
    state.phase !== 'quote_in_use';
  const titleKey =
    projectReferenceIds !== null
      ? 'conversation.creativeStudio.workspace.views.references'
      : boardPromotion !== null
        ? 'conversation.creativeStudio.workspace.gate.promotion.title'
        : continuityIntent === 'sever'
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
  const freePromotionAvailable =
    boardPromotion !== null &&
    (state.phase === 'choices' ||
      state.phase === 'review' ||
      state.phase === 'error' ||
      state.phase === 'refresh_required' ||
      state.phase === 'quote_cache_full' ||
      state.phase === 'quote_too_large');
  const paidPromotionPrepareAvailable =
    boardPromotion !== null &&
    boardPromotionPaidAvailable &&
    state.routeIssue === null &&
    ((state.phase === 'choices' && boardPromotionChoice === 'promote_and_rerender') ||
      state.phase === 'error' ||
      state.phase === 'refresh_required' ||
      state.phase === 'quote_cache_full' ||
      state.phase === 'quote_too_large');

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
        data-gate-kind={
          projectReferenceIds !== null
            ? 'project_references'
            : boardPromotion !== null
              ? 'board_promotion'
              : continuityIntent === null
                ? 'generation'
                : 'continuity_change'
        }
        data-testid='studio-spend-gate'
      >
        {state.phase === 'choices' ? (
          <>
            {boardPromotion !== null && boardPromotionImpact !== null ? (
              <>
                <p data-board-promotion-summary>
                  {t('conversation.creativeStudio.workspace.gate.promotion.summary', {
                    shotId: boardPromotion.shotId,
                  })}
                </p>
                {boardPromotionPaidCount === 0 ? (
                  <p>{t('conversation.creativeStudio.workspace.gate.promotion.impactNone')}</p>
                ) : (
                  <div className={styles.promotionImpact}>
                    <p>
                      {t('conversation.creativeStudio.workspace.gate.promotion.impactIntro', {
                        count: boardPromotionPaidCount,
                      })}
                    </p>
                    <ol>
                      {boardPromotionImpact.currentTakeShotIds.map((shotId) => (
                        <li key={shotId} data-promotion-stale-shot-id={shotId}>
                          {t('conversation.creativeStudio.workspace.gate.promotion.impactItem', { shotId })}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <Radio.Group
                  aria-label={t('conversation.creativeStudio.workspace.gate.promotion.optionsLabel')}
                  className={styles.promotionChoices}
                  onChange={(value) => {
                    if (value === 'promote_only' || (value === 'promote_and_rerender' && boardPromotionPaidAvailable)) {
                      setBoardPromotionChoice(value);
                    }
                  }}
                  value={boardPromotionChoice}
                >
                  <Radio value='promote_only'>
                    <span>{t('conversation.creativeStudio.workspace.gate.promotion.promoteOnly')}</span>
                    <bdi>{t('conversation.creativeStudio.workspace.gate.promotion.freePrice')}</bdi>
                  </Radio>
                  {boardPromotionPaidAvailable ? (
                    <Radio value='promote_and_rerender'>
                      <span>{t('conversation.creativeStudio.workspace.gate.promotion.promoteAndRerender')}</span>
                      <bdi>{t('conversation.creativeStudio.workspace.gate.promotion.priceAfterReview')}</bdi>
                    </Radio>
                  ) : null}
                </Radio.Group>
                {boardPromotionPaidCount > STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST ? (
                  <p>{t('conversation.creativeStudio.workspace.gate.promotion.paidUnavailable')}</p>
                ) : null}
              </>
            ) : backgroundChoicePlan === null ? (
              <p>{t('conversation.creativeStudio.workspace.gate.reviewBeforeSpend')}</p>
            ) : null}
            {backgroundChoicePlan?.status === 'choices' ? (
              <section className={styles.backgroundChoices} data-background-choice-plan={backgroundChoicePlan.identity}>
                <header>
                  <h3>{t('conversation.creativeStudio.workspace.gate.backgroundChoice.title')}</h3>
                  <p>{t('conversation.creativeStudio.workspace.gate.backgroundChoice.description')}</p>
                </header>
                {backgroundChoicePlan.shotIds.map((shotId) => (
                  <fieldset className={styles.backgroundChoice} data-background-choice-shot-id={shotId} key={shotId}>
                    <legend>
                      {t('conversation.creativeStudio.workspace.gate.backgroundChoice.shotLabel', { shotId })}
                    </legend>
                    <Radio.Group
                      aria-label={t('conversation.creativeStudio.workspace.gate.backgroundChoice.shotLabel', {
                        shotId,
                      })}
                      className={styles.backgroundOptions}
                      onChange={(referenceId) => {
                        if (
                          state.phase === 'choices' &&
                          backgroundChoicePlan.approvedBackgrounds.some(
                            (background) => background.referenceId === referenceId
                          )
                        ) {
                          setBackgroundSelections((current) => ({ ...current, [shotId]: referenceId }));
                        }
                      }}
                      value={backgroundSelections[shotId]}
                    >
                      {backgroundChoicePlan.approvedBackgrounds.map((background) => (
                        <Radio key={background.referenceId} value={background.referenceId}>
                          <bdi dir='auto'>{background.label}</bdi>
                        </Radio>
                      ))}
                    </Radio.Group>
                  </fieldset>
                ))}
                {backgroundChoicesComplete ? null : (
                  <p role='status'>{t('conversation.creativeStudio.workspace.gate.backgroundChoice.incomplete')}</p>
                )}
              </section>
            ) : backgroundChoicePlan?.status === 'no_approved_backgrounds' ? (
              <section className={styles.backgroundChoices} data-background-choice-empty>
                <h3>{t('conversation.creativeStudio.workspace.gate.backgroundChoice.noneTitle')}</h3>
                <p>{t('conversation.creativeStudio.workspace.gate.backgroundChoice.noneBody')}</p>
              </section>
            ) : backgroundChoicePlan?.status === 'invalid' ? (
              <Alert
                type='warning'
                content={t('conversation.creativeStudio.workspace.gate.backgroundChoice.invalid')}
              />
            ) : null}
            {projectReferenceIds !== null ? (
              <p data-project-reference-scope>
                {t('conversation.creativeStudio.workspace.referenceWorkflow.generationScope')}:{' '}
                <bdi dir='auto'>{projectReferenceScope.join(' · ')}</bdi>
              </p>
            ) : boardPromotion === null &&
              continuityIntent === null &&
              state.draft !== null &&
              !isProjectReferenceSpendGateDraft(state.draft) ? (
              <p>
                {t('conversation.creativeStudio.workspace.gate.requestedShots', {
                  count: new Set(
                    [...state.draft.baseChoices, ...state.draft.cascadeChoices].map((choice) => choice.shotId)
                  ).size,
                })}
              </p>
            ) : boardPromotion === null ? (
              <p data-chain-change-summary data-testid='studio-chain-change-summary'>
                {t(
                  continuityIntent === 'sever'
                    ? 'conversation.creativeStudio.workspace.gate.continuity.severSummary'
                    : 'conversation.creativeStudio.workspace.gate.continuity.rejoinSummary'
                )}
              </p>
            ) : null}
          </>
        ) : null}

        {state.phase === 'promoting' ? (
          <div className={styles.loading}>
            <Spin />
            <span>{t('conversation.creativeStudio.workspace.gate.promotion.promoting')}</span>
          </div>
        ) : null}

        {state.phase === 'preparing' ? (
          <div className={styles.loading}>
            <Spin />
            <span>{t('conversation.creativeStudio.workspace.gate.preparing')}</span>
          </div>
        ) : null}

        {state.phase === 'assigning_backgrounds' ? (
          <div className={styles.loading} data-background-choice-assigning>
            <Spin />
            <span>{t('conversation.creativeStudio.workspace.gate.backgroundChoice.assigning')}</span>
          </div>
        ) : null}

        {state.options !== null && quote !== null && summary !== null ? (
          <>
            {!requiredChange && state.options.withCascade !== null ? (
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
                boardPromotion !== null
                  ? 'conversation.creativeStudio.workspace.gate.promotion.headline'
                  : continuityIntent === 'sever'
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
            {projectReferenceIds === null ? null : (
              <p data-project-reference-scope>
                {t('conversation.creativeStudio.workspace.referenceWorkflow.generationScope')}:{' '}
                <bdi dir='auto'>{projectReferenceScope.join(' · ')}</bdi>
              </p>
            )}
            {requiredChange ? (
              <p
                data-chain-change-required={continuityIntent === null ? undefined : true}
                data-promotion-required={boardPromotion === null ? undefined : true}
              >
                {t(
                  boardPromotion === null
                    ? 'conversation.creativeStudio.workspace.gate.continuity.requiredWork'
                    : 'conversation.creativeStudio.workspace.gate.promotion.requiredWork'
                )}
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
                  {summary.rows.map((row, index) => {
                    const projectReference =
                      row.projectReferenceId === undefined
                        ? undefined
                        : projectReferenceById.get(row.projectReferenceId);
                    const rowIdentity =
                      projectReference !== undefined
                        ? `${t(
                            projectReference.kind === 'character'
                              ? 'conversation.creativeStudio.workspace.referenceWorkflow.characters.title'
                              : 'conversation.creativeStudio.workspace.referenceWorkflow.backgrounds.title'
                          )} — ${projectReference.label}`
                        : projectReferenceIds === null
                          ? row.shotId
                          : t('conversation.creativeStudio.workspace.views.references');
                    return (
                      <li
                        data-generation-purpose={row.purpose}
                        data-project-reference-id={row.projectReferenceId}
                        data-quote-group={requiredChange ? 'required' : row.group}
                        data-shot-id={row.shotId}
                        key={`${row.group}:${row.shotId}:${row.purpose}:${index}`}
                      >
                        <span>
                          {mixedGroups
                            ? `${t(
                                `conversation.creativeStudio.workspace.gate.group.${requiredChange ? 'required' : row.group}`
                              )} · `
                            : null}
                          {mixedPurposes
                            ? `${t(`conversation.creativeStudio.workspace.gate.purpose.${row.purpose}`)} · `
                            : null}
                          <bdi dir='auto'>{rowIdentity}</bdi> ·{' '}
                          {row.durationSeconds === null
                            ? t('conversation.creativeStudio.workspace.gate.durationNotApplicable')
                            : t('conversation.creativeStudio.workspace.gate.duration', {
                                seconds: row.durationSeconds,
                              })}
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
                    );
                  })}
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
        {state.phase === 'promoted' ? (
          <Alert type='success' content={t('conversation.creativeStudio.workspace.gate.promotion.promoted')} />
        ) : null}
        {state.phase === 'confirmed' ? (
          <Alert
            type='success'
            content={t(
              boardPromotion !== null
                ? 'conversation.creativeStudio.workspace.gate.promotion.confirmed'
                : continuityIntent === 'sever'
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
          {freePromotionAvailable && (state.phase !== 'choices' || boardPromotionChoice === 'promote_only') ? (
            <Button type={state.phase === 'choices' ? 'primary' : 'default'} onClick={() => void promoteOnly()}>
              {t('conversation.creativeStudio.workspace.gate.promotion.promoteOnlyAction')}
            </Button>
          ) : null}
          {paidPromotionPrepareAvailable ? (
            <Button
              type='primary'
              onClick={() => {
                setExpandedQuoteId(null);
                void prepare();
              }}
            >
              {t('conversation.creativeStudio.workspace.gate.promotion.reviewPaidAction')}
            </Button>
          ) : null}
          {state.phase === 'choices' && backgroundChoicePlan?.status === 'choices' ? (
            <Button
              type='primary'
              disabled={!backgroundChoicesComplete}
              onClick={() => void assignBackgroundChoices(backgroundChoices)}
            >
              {t('conversation.creativeStudio.workspace.gate.backgroundChoice.assign')}
            </Button>
          ) : null}
          {state.phase === 'choices' &&
          backgroundChoicePlan !== null &&
          backgroundChoicePlan.status !== 'choices' &&
          onReviewBackgroundReferences !== undefined ? (
            <Button
              type='primary'
              onClick={() => {
                closeGate();
                onReviewBackgroundReferences();
              }}
            >
              {t('conversation.creativeStudio.workspace.gate.backgroundChoice.reviewReferences')}
            </Button>
          ) : null}
          {boardPromotion === null &&
          backgroundChoicePlan === null &&
          (state.phase === 'choices' || state.phase === 'refresh_required' || state.phase === 'quote_cache_full') ? (
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
              data-board-promotion-confirm={boardPromotion === null ? undefined : true}
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
                boardPromotion !== null
                  ? 'conversation.creativeStudio.workspace.gate.promotion.confirm'
                  : continuityIntent === 'sever'
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
                ? boardPromotion === null
                  ? 'conversation.creativeStudio.workspace.gate.close'
                  : 'conversation.creativeStudio.workspace.gate.promotion.close'
                : 'conversation.creativeStudio.workspace.gate.continuity.close'
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
