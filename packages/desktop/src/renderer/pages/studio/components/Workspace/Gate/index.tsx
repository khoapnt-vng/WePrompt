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
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';
import {
  initialSpendGateState,
  formatMinorUnits,
  isProjectReferenceSpendGateDraft,
  selectedSpendGateQuote,
  spendGateBoardPromotion,
  spendGateContinuityChange,
  spendGateProjectReferenceIds,
  spendGateReducer,
  spendGateRouteIssue,
  summarizeQuote,
  type SpendGateDraft,
  type SpendGateBoardPromotion,
  type SpendGateBoardPromotionImpact,
  type SpendGateGenerationDisclosure,
  type SpendGateSelectedOption,
  type SpendGateState,
  type SpendGateRouteIssue,
} from '../spendGate';
import { generationBlockMessage } from './generationBlockers';
import styles from './SpendGateModal.module.css';

// The spend gate can open from inside the Beat panel modal. Arco gives sibling modals the same
// default layer, so a retained Beat panel can otherwise intercept the gate at compact viewports.
const SPEND_GATE_MASK_Z_INDEX = 1100;
const SPEND_GATE_WRAPPER_Z_INDEX = SPEND_GATE_MASK_Z_INDEX + 1;

export type UseSpendGateInput = {
  onConfirmed: (result: StudioConfirmSubmissionResultV2) => void | Promise<void>;
  onPromoteOnly?: (input: {
    projectId: string;
    expectedRevision: number;
    promotion: SpendGateBoardPromotion;
  }) => boolean | Promise<boolean>;
};

export type UseSpendGateResult = {
  state: SpendGateState;
  open: (
    draft: SpendGateDraft,
    boardPromotionImpact?: SpendGateBoardPromotionImpact,
    generationDisclosure?: SpendGateGenerationDisclosure
  ) => void;
  updateGenerationDisclosure: (generationDisclosure?: SpendGateGenerationDisclosure) => void;
  close: () => void;
  promoteOnly: () => Promise<void>;
  prepare: () => Promise<void>;
  selectOption: (option: SpendGateSelectedOption) => void;
  confirm: () => Promise<void>;
};

/** Owns one reviewed submission attempt. Opening estimates; only explicit confirmation can spend. */
export const useSpendGate = ({ onConfirmed, onPromoteOnly }: UseSpendGateInput): UseSpendGateResult => {
  const [state, dispatch] = useReducer(spendGateReducer, undefined, initialSpendGateState);
  const stateRef = useRef(state);
  const gateGenerationRef = useRef(0);
  const prepareOperationRef = useRef(0);
  const confirmOperationRef = useRef(0);
  const preparingRef = useRef(false);
  const promotingRef = useRef(false);
  const confirmingRef = useRef(false);
  const terminalSuccessRef = useRef(false);
  stateRef.current = state;

  const open = useCallback(
    (
      draft: SpendGateDraft,
      boardPromotionImpact?: SpendGateBoardPromotionImpact,
      generationDisclosure?: SpendGateGenerationDisclosure
    ) => {
      if (
        promotingRef.current ||
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
      dispatch({
        type: 'open',
        draft,
        ...(boardPromotionImpact === undefined ? {} : { boardPromotionImpact }),
        ...(generationDisclosure === undefined ? {} : { generationDisclosure }),
      });
    },
    []
  );
  const close = useCallback(() => {
    if (promotingRef.current || confirmingRef.current || stateRef.current.phase === 'quote_in_use') {
      return;
    }
    gateGenerationRef.current += 1;
    preparingRef.current = false;
    terminalSuccessRef.current = false;
    dispatch({ type: 'close' });
  }, []);
  const updateGenerationDisclosure = useCallback((generationDisclosure?: SpendGateGenerationDisclosure): void => {
    dispatch({
      type: 'generation_disclosure_changed',
      ...(generationDisclosure === undefined ? {} : { generationDisclosure }),
    });
  }, []);

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
      current.generationDisclosure?.blocksPrepare === true ||
      promotingRef.current ||
      preparingRef.current ||
      confirmingRef.current ||
      terminalSuccessRef.current ||
      (promotion !== null &&
        (current.boardPromotionImpact === null ||
          current.boardPromotionImpact.paidRouteReady === false ||
          current.boardPromotionImpact.paidCurrentTakeShotIds.length === 0 ||
          current.boardPromotionImpact.paidCurrentTakeShotIds.length > STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST))
    ) {
      return;
    }
    preparingRef.current = true;
    const generation = gateGenerationRef.current;
    const operation = ++prepareOperationRef.current;
    const draft = current.draft;
    dispatch({ type: 'prepare_started' });
    const fail = (error: { code: string; reason?: unknown; details?: unknown }): void => {
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

  useEffect(() => {
    // `open` enters `preparing` for every ordinary paid intent. The only `choices` phase left is a
    // real product choice (Board promotion) or an exact capability refusal. Manual paid promotion
    // preparation also enters this phase with `preparingRef` already held, so this cannot duplicate it.
    if (state.phase !== 'preparing' || state.draft === null || preparingRef.current) return;
    void prepare();
  }, [prepare, state.draft, state.phase]);

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
    let refreshExpiredQuote = false;
    try {
      const result = await ipcBridge.creativeStudio.confirmSubmission.invoke({
        projectId: quote.projectId,
        quoteId: quote.id,
        expectedRevision: quote.projectRevision,
      });
      if (gateGenerationRef.current !== generation || confirmOperationRef.current !== operation) return;
      if (result.ok === false) {
        dispatch({ type: 'confirm_failed', error: result.error });
        refreshExpiredQuote = result.error.code === 'quote_not_found';
      } else {
        terminalSuccessRef.current = true;
        dispatch({ type: 'confirmed' });
        confirmed = result.data;
      }
    } catch {
      if (gateGenerationRef.current === generation && confirmOperationRef.current === operation) {
        dispatch({ type: 'confirm_failed', error: { code: 'storage_error' } });
      }
    } finally {
      if (confirmOperationRef.current === operation) confirmingRef.current = false;
    }
    if (
      refreshExpiredQuote &&
      gateGenerationRef.current === generation &&
      confirmOperationRef.current === operation &&
      !terminalSuccessRef.current
    ) {
      await prepare();
      return;
    }
    if (confirmed !== null) {
      try {
        await onConfirmed(confirmed);
      } catch {
        // The paid commit is already terminal. A refresh failure must never reopen confirmation.
      }
    }
  }, [onConfirmed, prepare]);

  return { state, open, updateGenerationDisclosure, close, promoteOnly, prepare, selectOption, confirm };
};

export type SpendGateModalProps = Pick<
  UseSpendGateResult,
  'state' | 'close' | 'promoteOnly' | 'prepare' | 'selectOption' | 'confirm'
> & {
  onEditRoutes: (issue: SpendGateRouteIssue) => void;
  onReviewShotBinding: (shotId: string) => void;
  projectReferences?: readonly Pick<StudioProjectReferenceV2, 'id' | 'kind' | 'label'>[];
  shotLocations?: readonly {
    id: string;
    beatPosition: number;
    shotPosition: number;
    beatTitle: string;
  }[];
};

const pricingRefusalMessageKeys: Record<StudioPricingRefusalReasonV2, string> = {
  invalid_quote: 'conversation.creativeStudio.workspace.gate.errors.pricing.invalidQuote',
  inactive_shot: 'conversation.creativeStudio.workspace.gate.errors.pricing.inactiveShot',
  in_flight: 'conversation.creativeStudio.workspace.gate.errors.pricing.inFlight',
  duplicate_shot_purpose: 'conversation.creativeStudio.workspace.gate.errors.pricing.duplicateShotPurpose',
  invalid_dependency: 'conversation.creativeStudio.workspace.gate.errors.pricing.invalidDependency',
  invalid_prepare_request: 'conversation.creativeStudio.workspace.gate.errors.pricing.invalidPrepareRequest',
  invalid_reference: 'conversation.creativeStudio.workspace.gate.errors.pricing.invalidReference',
  reference_capacity_unavailable:
    'conversation.creativeStudio.workspace.gate.errors.pricing.referenceCapacityUnavailable',
  missing_shooting_script: 'conversation.creativeStudio.workspace.gate.errors.pricing.missingShootingScript',
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
  prepare,
  selectOption,
  confirm,
  onEditRoutes,
  onReviewShotBinding,
  projectReferences = [],
  shotLocations = [],
}) => {
  const { t, i18n } = useTranslation();
  // The headline and the Confirm label already carry the count and the total. The per-generation
  // breakdown is a long list on a real film, so it starts closed and stays one click away.
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const [boardPromotionChoice, setBoardPromotionChoice] = useState<BoardPromotionChoice>('promote_only');
  const breakdownId = useId();
  const quote = selectedSpendGateQuote(state);
  const summary = useMemo(() => (quote === null ? null : summarizeQuote(quote)), [quote]);
  const predecessorVideoRows =
    summary?.rows.filter(
      (row) =>
        row.purpose === 'video_take' &&
        row.generationCount === 2 &&
        typeof row.conditioningAssetId === 'string' &&
        row.composition.inputs.source.kind === 'shot'
    ) ?? [];
  const visible = state.phase !== 'closed';
  const breakdownOpen = visible && quote !== null && expandedQuoteId === quote.id;
  const closeGate = useCallback(() => {
    setExpandedQuoteId(null);
    close();
  }, [close]);
  const continuityChange = spendGateContinuityChange(state.draft);
  const continuityIntent = continuityChange === null ? null : continuityChange.hardCut ? 'sever' : 'rejoin';
  const boardPromotion = spendGateBoardPromotion(state.draft);
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
  const shotLocationById = useMemo(() => new Map(shotLocations.map((shot) => [shot.id, shot])), [shotLocations]);
  const promotionShotLabel = useCallback(
    (shotId: string): string => {
      const location = shotLocationById.get(shotId);
      return location === undefined
        ? t('conversation.creativeStudio.workspace.gate.promotion.shotFallback')
        : t('conversation.creativeStudio.workspace.gate.promotion.shotLocation', {
            beatPosition: location.beatPosition,
            beatTitle: location.beatTitle,
            shotPosition: location.shotPosition,
          });
    },
    [shotLocationById, t]
  );
  const boardPromotionAffectedCount = boardPromotionImpact?.currentTakeShotIds.length ?? 0;
  const boardPromotionPaidCount = boardPromotionImpact?.paidCurrentTakeShotIds.length ?? 0;
  const boardPromotionPaidAvailable =
    boardPromotionPaidCount > 0 &&
    boardPromotionPaidCount <= STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST &&
    boardPromotionImpact?.paidRouteReady !== false;
  const generationPrepareBlocked = state.generationDisclosure?.blocksPrepare === true;
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
  const messageKey = errorMessageKey(state);
  const canClose = state.phase !== 'promoting' && state.phase !== 'confirming' && state.phase !== 'quote_in_use';
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
    !generationPrepareBlocked &&
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
      maskStyle={{ zIndex: SPEND_GATE_MASK_Z_INDEX }}
      maskClosable={false}
      closable={canClose}
      unmountOnExit={false}
      title={t(titleKey)}
      wrapStyle={{ zIndex: SPEND_GATE_WRAPPER_Z_INDEX }}
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
                    shot: promotionShotLabel(boardPromotion.shotId),
                  })}
                </p>
                {boardPromotionAffectedCount === 0 ? (
                  <p>{t('conversation.creativeStudio.workspace.gate.promotion.impactNone')}</p>
                ) : (
                  <div className={styles.promotionImpact}>
                    <p>
                      {t('conversation.creativeStudio.workspace.gate.promotion.impactIntro', {
                        count: boardPromotionAffectedCount,
                      })}
                    </p>
                    <ol>
                      {boardPromotionImpact.currentTakeShotIds.map((shotId) => (
                        <li key={shotId} data-promotion-stale-shot-id={shotId}>
                          {t('conversation.creativeStudio.workspace.gate.promotion.impactItem', {
                            shot: promotionShotLabel(shotId),
                          })}
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
                    [...state.draft.baseChoices, ...state.draft.cascadeChoices].flatMap((choice) =>
                      choice.target.kind === 'shot' ? [choice.target.shotId] : []
                    )
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

        {state.generationDisclosure === null ? null : (
          <div data-generation-capability-disclosure>
            {state.generationDisclosure.groups.map((group, index) => {
              const message = generationBlockMessage(group.block);
              const reason = t(message.key, message.values);
              const shotIds = [
                ...new Set(group.items.flatMap((item) => (item.target.kind === 'shot' ? [item.target.shotId] : []))),
              ];
              const referenceIds = [
                ...new Set(
                  group.items.flatMap((item) => (item.target.kind === 'reference' ? [item.target.referenceId] : []))
                ),
              ];
              return (
                <div data-generation-block-code={group.block.code} key={`${JSON.stringify(group.block)}:${index}`}>
                  <Alert
                    type='warning'
                    content={
                      <div>
                        {shotIds.length === 0 ? null : (
                          <p
                            data-generation-block-scope={
                              state.generationDisclosure?.blocksPrepare ? 'exact' : 'excluded'
                            }
                          >
                            {state.generationDisclosure?.blocksPrepare ? (
                              <>
                                {reason}: <bdi dir='auto'>{shotIds.join(' · ')}</bdi>
                              </>
                            ) : (
                              t('conversation.creativeStudio.phase.produce.batchExcluded', {
                                count: shotIds.length,
                                reason,
                              })
                            )}
                          </p>
                        )}
                        {referenceIds.length === 0 ? null : (
                          <p>
                            {t('conversation.creativeStudio.workspace.referenceWorkflow.generationScope')} — {reason}:{' '}
                            <bdi dir='auto'>
                              {referenceIds
                                .map((referenceId) => projectReferenceById.get(referenceId)?.label ?? referenceId)
                                .join(' · ')}
                            </bdi>
                          </p>
                        )}
                      </div>
                    }
                  />
                </div>
              );
            })}
          </div>
        )}

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
            <p className={styles.freeEstimateNote} data-free-estimate-note>
              {t('conversation.creativeStudio.workspace.gate.reviewBeforeSpend')}
            </p>
            {predecessorVideoRows.length === 0 ? null : (
              <div className={styles.predecessorReviews} data-predecessor-video-reviews>
                <p>
                  {t('conversation.creativeStudio.workspace.gate.predecessorVideoRetry', {
                    lower: formatMoney(summary.lowerMinorUnits, summary.currency),
                    upper: formatMoney(summary.upperMinorUnits, summary.currency),
                  })}
                </p>
                {predecessorVideoRows.map((row) => {
                  if (
                    row.target.kind !== 'shot' ||
                    typeof row.conditioningAssetId !== 'string' ||
                    row.composition.inputs.source.kind !== 'shot'
                  ) {
                    return null;
                  }
                  return (
                    <div
                      className={styles.predecessorReview}
                      data-predecessor-video-review={row.target.shotId}
                      key={`${row.target.shotId}:${row.conditioningAssetId}`}
                    >
                      <img
                        alt={t('conversation.creativeStudio.workspace.gate.conditioningFrameAlt', {
                          shot: row.target.shotId,
                        })}
                        className={styles.predecessorFrame}
                        data-conditioning-asset-id={row.conditioningAssetId}
                        src={createManagedStudioAssetUrl(summary.projectId, row.conditioningAssetId)}
                      />
                      <div className={styles.predecessorScript}>
                        <strong>
                          {t('conversation.creativeStudio.workspace.gate.readout.shootingScript')} ·{' '}
                          <bdi dir='auto'>{row.target.shotId}</bdi>
                        </strong>
                        <pre dir='auto'>{row.composition.inputs.source.shootingScript}</pre>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {projectReferenceIds === null ? null : (
              <>
                <p data-project-reference-scope>
                  {t('conversation.creativeStudio.workspace.referenceWorkflow.generationScope')}:{' '}
                  <bdi dir='auto'>{projectReferenceScope.join(' · ')}</bdi>
                </p>
                {summary.exactPrice ? null : (
                  <p data-reference-grid-contingency>
                    {t('conversation.creativeStudio.workspace.gate.referenceGridRetry', {
                      lower: formatMoney(summary.lowerMinorUnits, summary.currency),
                      upper: formatMoney(summary.upperMinorUnits, summary.currency),
                    })}
                  </p>
                )}
              </>
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
                    const rowIdentity =
                      row.referenceTarget !== null
                        ? `${t(
                            row.referenceTarget.kind === 'character'
                              ? 'conversation.creativeStudio.workspace.referenceWorkflow.characters.title'
                              : 'conversation.creativeStudio.workspace.referenceWorkflow.backgrounds.title'
                          )} — ${row.referenceTarget.label}`
                        : row.target.kind === 'shot'
                          ? row.target.shotId
                          : t('conversation.creativeStudio.workspace.views.references');
                    const targetId = row.target.kind === 'shot' ? row.target.shotId : row.target.referenceId;
                    return (
                      <li
                        data-generation-purpose={row.purpose}
                        data-project-reference-id={row.target.kind === 'reference' ? row.target.referenceId : undefined}
                        data-quote-group={requiredChange ? 'required' : row.group}
                        data-shot-id={row.target.kind === 'shot' ? row.target.shotId : undefined}
                        key={`${row.group}:${row.target.kind}:${targetId}:${row.purpose}:${index}`}
                      >
                        <div className={styles.rowSummary}>
                          {typeof row.conditioningAssetId !== 'string' ? null : (
                            <img
                              alt={t('conversation.creativeStudio.workspace.gate.conditioningFrameAlt', {
                                shot: rowIdentity,
                              })}
                              className={styles.conditioningFrame}
                              data-conditioning-asset-id={row.conditioningAssetId}
                              src={createManagedStudioAssetUrl(summary.projectId, row.conditioningAssetId)}
                            />
                          )}
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
                        </div>
                        {sharedRoute === null ? (
                          <bdi dir='auto'>
                            {t('conversation.creativeStudio.workspace.gate.route', {
                              provider: row.route.providerId,
                              model: row.route.model,
                              choice: row.route.choiceId,
                            })}
                          </bdi>
                        ) : null}
                        <dl className={styles.technicalReadout}>
                          <dt>{t('conversation.creativeStudio.workspace.gate.readout.prompt')}</dt>
                          <dd>
                            <pre dir='auto'>{row.composition.prompt}</pre>
                          </dd>
                          <dt>{t('conversation.creativeStudio.workspace.gate.readout.rendersAs')}</dt>
                          <dd>
                            <bdi dir='auto'>
                              {row.composition.inputs.route.providerId} · {row.composition.inputs.route.adapterId} ·{' '}
                              {row.composition.inputs.route.model} · {row.composition.inputs.instructionProfile}
                            </bdi>
                          </dd>
                          <dt>{t('conversation.creativeStudio.workspace.gate.readout.sourceRevision')}</dt>
                          <dd>{row.composition.inputs.projectRevision}</dd>
                          <dt>{t('conversation.creativeStudio.workspace.gate.readout.source')}</dt>
                          <dd>
                            <bdi dir='auto'>
                              {row.composition.inputs.source.kind === 'shot'
                                ? `${row.composition.inputs.source.beatId} · ${row.composition.inputs.source.shotId}`
                                : `${row.composition.inputs.source.referenceKind} · ${row.composition.inputs.source.referenceId}`}
                            </bdi>
                          </dd>
                          {row.composition.inputs.source.kind === 'shot' ? (
                            <>
                              <dt>{t('conversation.creativeStudio.workspace.gate.readout.story')}</dt>
                              <dd>
                                <bdi dir='auto'>{row.composition.inputs.source.story}</bdi>
                              </dd>
                              <dt>{t('conversation.creativeStudio.workspace.gate.readout.shootingScript')}</dt>
                              <dd>
                                <bdi dir='auto'>{row.composition.inputs.source.shootingScript}</bdi>
                              </dd>
                            </>
                          ) : (
                            <>
                              <dt>{t('conversation.creativeStudio.workspace.gate.readout.referencePrompt')}</dt>
                              <dd>
                                <bdi dir='auto'>{row.composition.inputs.source.prompt}</bdi>
                              </dd>
                            </>
                          )}
                          <dt>{t('conversation.creativeStudio.workspace.gate.readout.references')}</dt>
                          <dd>
                            {row.composition.inputs.referenceInputs.length === 0 ? (
                              t('conversation.creativeStudio.workspace.gate.readout.noReferences')
                            ) : (
                              <ol>
                                {row.composition.inputs.referenceInputs.map((reference) => (
                                  <li key={`${reference.referenceId}:${reference.assetId}`}>
                                    <bdi dir='auto'>
                                      {reference.label}
                                      {' · '}
                                      {t('conversation.creativeStudio.workspace.gate.readout.referenceFact', {
                                        kind: reference.kind,
                                        referenceId: reference.referenceId,
                                        assetId: reference.assetId,
                                      })}
                                    </bdi>
                                  </li>
                                ))}
                              </ol>
                            )}
                          </dd>
                        </dl>
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
          {state.phase === 'error' && state.pricingRefusalDetails !== null ? (
            <Button
              type='primary'
              onClick={() => {
                const { shotId } = state.pricingRefusalDetails!;
                closeGate();
                onReviewShotBinding(shotId);
              }}
            >
              {t('conversation.creativeStudio.workspace.gate.reviewShotBinding')}
            </Button>
          ) : null}
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
          {boardPromotion === null && state.phase === 'quote_cache_full' ? (
            <Button
              type='primary'
              disabled={generationPrepareBlocked}
              onClick={() => {
                setExpandedQuoteId(null);
                void prepare();
              }}
            >
              {t('conversation.creativeStudio.workspace.gate.prepareAgain')}
            </Button>
          ) : null}
          {(state.phase === 'review' || state.phase === 'confirming' || state.phase === 'quote_in_use') &&
          summary !== null ? (
            <Button
              autoFocus={false}
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
