/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioBoardPromotionV2,
  StudioGenerationCapabilityBlockGroupV2,
  StudioPrepareProjectReferencesRequestV2,
  StudioPrepareGenerationChoiceV2,
  StudioPrepareSubmissionRequestV2,
  StudioPreparedSubmissionRequestV2,
  StudioContinuityChangeV2,
  StudioPricingRefusalDetailsV2,
  StudioPricingRefusalReasonV2,
  StudioRendererPreparedSubmissionOptionsV2,
  StudioRendererProjectV2,
  StudioRendererQuotedGenerationV2,
  StudioRendererReferenceGenerationHandoffV2,
  StudioRouteCatalogV2,
  StudioRendererSubmissionQuoteV2,
  StudioSubmissionCacheErrorCodeV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  isStudioPricingRefusalDetailsV2,
  isStudioPricingRefusalReasonV2,
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
} from '@/common/types/project/creativeStudioTypes';
import type { WorkspaceProjection } from './workspaceProjection';

export type SpendGateContinuityChange = StudioContinuityChangeV2;

export type SpendGateBoardPromotion = StudioBoardPromotionV2;

export type SpendGateBoardPromotionImpact = {
  currentTakeShotIds: string[];
  /** Renderer-only availability fact; false hides paid review without blocking the free mutation. */
  paidRouteReady?: boolean;
};

/** Renderer-only explanation of capability-scoped omissions or a blocked exact intent. */
export type SpendGateGenerationDisclosure = {
  groups: StudioGenerationCapabilityBlockGroupV2[];
  /** True when the draft represents one exact intent that must not be narrowed. */
  blocksPrepare: boolean;
};

export type BoardPromotionGatePlan = {
  draft: StudioPrepareSubmissionRequestV2;
  impact: SpendGateBoardPromotionImpact;
};

export type SpendGateDraft = StudioPreparedSubmissionRequestV2;

export type SpendGateSelectedOption = 'baseOnly' | 'withCascade';

export type SpendGateRouteIssue = 'image' | 'video' | 'image_and_video';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;

const shotGenerationChoice = (
  shotId: string,
  purpose: Extract<StudioPrepareGenerationChoiceV2['purpose'], 'seed_still' | 'board_still' | 'video_take'>
): StudioPrepareGenerationChoiceV2 => ({ target: { kind: 'shot', shotId }, purpose });

const choiceShotId = (choice: StudioPrepareGenerationChoiceV2): string | null =>
  choice.target.kind === 'shot' ? choice.target.shotId : null;

export const isProjectReferenceSpendGateDraft = (
  draft: SpendGateDraft | null
): draft is StudioPrepareProjectReferencesRequestV2 => draft !== null && 'referenceIds' in draft;

export const spendGateProjectReferenceIds = (draft: SpendGateDraft | null): readonly string[] | null =>
  isProjectReferenceSpendGateDraft(draft) ? draft.referenceIds : null;

export const spendGateContinuityChange = (draft: SpendGateDraft | null): SpendGateContinuityChange | null => {
  if (draft === null || isProjectReferenceSpendGateDraft(draft)) return null;
  const change = draft?.continuityChange;
  return draft?.boardPromotion === undefined &&
    change !== undefined &&
    SAFE_STUDIO_ID.test(change.shotId) &&
    typeof change.hardCut === 'boolean' &&
    typeof change.requiresSeedGeneration === 'boolean'
    ? {
        shotId: change.shotId,
        hardCut: change.hardCut,
        requiresSeedGeneration: change.requiresSeedGeneration,
      }
    : null;
};

export const spendGateBoardPromotion = (draft: SpendGateDraft | null): SpendGateBoardPromotion | null => {
  if (draft === null || isProjectReferenceSpendGateDraft(draft)) return null;
  const promotion = draft?.boardPromotion;
  return promotion !== undefined &&
    draft.continuityChange === undefined &&
    draft.originReferenceHandoffId === null &&
    draft.baseChoices.length === 0 &&
    draft.cascadeChoices.length === 0 &&
    SAFE_STUDIO_ID.test(promotion.shotId) &&
    SAFE_STUDIO_ID.test(promotion.boardAssetId)
    ? { shotId: promotion.shotId, boardAssetId: promotion.boardAssetId }
    : null;
};

const exactBoardPromotionImpact = (
  draft: StudioPrepareSubmissionRequestV2,
  impact: SpendGateBoardPromotionImpact | undefined
): SpendGateBoardPromotionImpact | null => {
  if (spendGateBoardPromotion(draft) === null || impact === undefined || !Array.isArray(impact.currentTakeShotIds)) {
    return null;
  }
  const seen = new Set<string>();
  const currentTakeShotIds: string[] = [];
  for (const shotId of impact.currentTakeShotIds) {
    if (!SAFE_STUDIO_ID.test(shotId) || seen.has(shotId)) return null;
    seen.add(shotId);
    currentTakeShotIds.push(shotId);
  }
  if (impact.paidRouteReady !== undefined && typeof impact.paidRouteReady !== 'boolean') return null;
  return {
    currentTakeShotIds,
    ...(impact.paidRouteReady === undefined ? {} : { paidRouteReady: impact.paidRouteReady }),
  };
};

export type SpendGatePhase =
  | 'closed'
  | 'choices'
  | 'promoting'
  | 'promoted'
  | 'preparing'
  | 'review'
  | 'confirming'
  | 'refresh_required'
  | 'quote_in_use'
  | 'quote_cache_full'
  | 'quote_too_large'
  | 'error'
  | 'confirmed';

export type SpendGateState = {
  phase: SpendGatePhase;
  draft: SpendGateDraft | null;
  boardPromotionImpact: SpendGateBoardPromotionImpact | null;
  generationDisclosure: SpendGateGenerationDisclosure | null;
  options: StudioRendererPreparedSubmissionOptionsV2 | null;
  selectedOption: SpendGateSelectedOption;
  errorCode: string | null;
  pricingRefusalReason: StudioPricingRefusalReasonV2 | null;
  pricingRefusalDetails: StudioPricingRefusalDetailsV2 | null;
  routeIssue: SpendGateRouteIssue | null;
};

type SpendGateFailure = { code: string; reason?: unknown; details?: unknown; routeIssue?: SpendGateRouteIssue };

export type SpendGateAction =
  | {
      type: 'open';
      draft: SpendGateDraft;
      boardPromotionImpact?: SpendGateBoardPromotionImpact;
      generationDisclosure?: SpendGateGenerationDisclosure;
    }
  | { type: 'generation_disclosure_changed'; generationDisclosure?: SpendGateGenerationDisclosure }
  | { type: 'close' }
  | { type: 'promote_started' }
  | { type: 'promote_succeeded' }
  | { type: 'promote_failed'; error: SpendGateFailure }
  | { type: 'prepare_started' }
  | { type: 'prepare_succeeded'; options: StudioRendererPreparedSubmissionOptionsV2 }
  | { type: 'prepare_failed'; error: SpendGateFailure }
  | { type: 'select_option'; option: SpendGateSelectedOption }
  | { type: 'confirm_started' }
  | { type: 'confirm_failed'; error: SpendGateFailure }
  | { type: 'confirmed' };

export const initialSpendGateState = (): SpendGateState => ({
  phase: 'closed',
  draft: null,
  boardPromotionImpact: null,
  generationDisclosure: null,
  options: null,
  selectedOption: 'baseOnly',
  errorCode: null,
  pricingRefusalReason: null,
  pricingRefusalDetails: null,
  routeIssue: null,
});

const cacheFailurePhase = (code: string): SpendGatePhase => {
  const cacheCode = code as StudioSubmissionCacheErrorCodeV2;
  if (cacheCode === 'quote_not_found') return 'refresh_required';
  if (cacheCode === 'quote_in_use') return 'quote_in_use';
  if (cacheCode === 'quote_cache_full') return 'quote_cache_full';
  if (cacheCode === 'quote_too_large') return 'quote_too_large';
  return 'error';
};

/** Pure gate state. No transition initiates a bridge call or retries another transition. */
export const spendGateReducer = (state: SpendGateState, action: SpendGateAction): SpendGateState => {
  if (action.type === 'open') {
    const promotion = spendGateBoardPromotion(action.draft);
    const boardPromotionImpact =
      promotion === null || isProjectReferenceSpendGateDraft(action.draft)
        ? null
        : exactBoardPromotionImpact(action.draft, action.boardPromotionImpact);
    if (promotion !== null && boardPromotionImpact === null) return state;
    const generationDisclosure =
      action.generationDisclosure === undefined || action.generationDisclosure.groups.length === 0
        ? null
        : action.generationDisclosure;
    return {
      // Ordinary generation has no free permission step: opening starts the read-only estimate.
      // Board promotion keeps its genuine $0-vs-paid choice, and exact capability blockers remain
      // visible without attempting work the renderer already knows is impossible.
      phase: promotion !== null || generationDisclosure?.blocksPrepare === true ? 'choices' : 'preparing',
      draft: action.draft,
      boardPromotionImpact,
      generationDisclosure,
      options: null,
      selectedOption: 'baseOnly',
      errorCode: null,
      pricingRefusalReason: null,
      pricingRefusalDetails: null,
      routeIssue: null,
    };
  }
  if (action.type === 'generation_disclosure_changed') {
    if (state.phase !== 'choices' || state.draft === null) return state;
    const generationDisclosure =
      action.generationDisclosure === undefined || action.generationDisclosure.groups.length === 0
        ? null
        : action.generationDisclosure;
    return {
      ...state,
      phase:
        spendGateBoardPromotion(state.draft) === null && generationDisclosure?.blocksPrepare !== true
          ? 'preparing'
          : state.phase,
      generationDisclosure,
    };
  }
  if (action.type === 'close') return initialSpendGateState();
  if (action.type === 'promote_started') {
    return spendGateBoardPromotion(state.draft) === null || state.boardPromotionImpact === null
      ? state
      : {
          ...state,
          phase: 'promoting',
          options: null,
          errorCode: null,
          pricingRefusalReason: null,
          pricingRefusalDetails: null,
          routeIssue: null,
        };
  }
  if (action.type === 'promote_succeeded') {
    return state.phase !== 'promoting'
      ? state
      : {
          ...state,
          phase: 'promoted',
          errorCode: null,
          pricingRefusalReason: null,
          pricingRefusalDetails: null,
          routeIssue: null,
        };
  }
  if (action.type === 'promote_failed') {
    return state.phase !== 'promoting'
      ? state
      : {
          ...state,
          phase: 'error',
          options: null,
          errorCode: action.error.code,
          pricingRefusalReason: null,
          pricingRefusalDetails: null,
          routeIssue: null,
        };
  }
  if (action.type === 'prepare_started') {
    return state.draft === null
      ? state
      : {
          ...state,
          phase: 'preparing',
          options: null,
          selectedOption: 'baseOnly',
          errorCode: null,
          pricingRefusalReason: null,
          pricingRefusalDetails: null,
          routeIssue: null,
        };
  }
  if (action.type === 'prepare_succeeded') {
    if (
      (isProjectReferenceSpendGateDraft(state.draft) ||
        spendGateContinuityChange(state.draft) !== null ||
        spendGateBoardPromotion(state.draft) !== null) &&
      action.options.withCascade !== null
    ) {
      return {
        ...state,
        phase: 'error',
        options: null,
        selectedOption: 'baseOnly',
        errorCode: 'storage_error',
        pricingRefusalReason: null,
        pricingRefusalDetails: null,
        routeIssue: null,
      };
    }
    return state.draft === null
      ? state
      : {
          ...state,
          phase: 'review',
          options: action.options,
          selectedOption: 'baseOnly',
          errorCode: null,
          pricingRefusalReason: null,
          pricingRefusalDetails: null,
          routeIssue: null,
        };
  }
  if (action.type === 'select_option') {
    if (state.options === null || (action.option === 'withCascade' && state.options.withCascade === null)) return state;
    return { ...state, selectedOption: action.option };
  }
  if (action.type === 'confirm_started') {
    return state.options === null
      ? state
      : {
          ...state,
          phase: 'confirming',
          errorCode: null,
          pricingRefusalReason: null,
          pricingRefusalDetails: null,
          routeIssue: null,
        };
  }
  if (action.type === 'confirmed') {
    return state.options === null
      ? state
      : {
          ...state,
          phase: 'confirmed',
          errorCode: null,
          pricingRefusalReason: null,
          pricingRefusalDetails: null,
          routeIssue: null,
        };
  }
  if (action.type === 'prepare_failed' || action.type === 'confirm_failed') {
    const pricingRefusalReason =
      action.error.code === 'pricing_refused' && isStudioPricingRefusalReasonV2(action.error.reason)
        ? action.error.reason
        : null;
    const pricingRefusalDetails =
      pricingRefusalReason !== null && isStudioPricingRefusalDetailsV2(action.error.details)
        ? action.error.details
        : null;
    const errorCode =
      action.error.code === 'pricing_refused' && pricingRefusalReason === null ? 'storage_error' : action.error.code;
    const classifiedPhase = cacheFailurePhase(errorCode);
    const phase = classifiedPhase === 'quote_in_use' && state.options === null ? 'error' : classifiedPhase;
    return {
      ...state,
      phase,
      options: phase === 'quote_in_use' ? state.options : null,
      errorCode,
      pricingRefusalReason,
      pricingRefusalDetails,
      routeIssue: action.type === 'prepare_failed' ? (action.error.routeIssue ?? null) : null,
    };
  }
  return state;
};

/** Names the exact media route required by this immutable estimate draft that is not currently ready. */
export const spendGateRouteIssue = (
  catalog: StudioRouteCatalogV2,
  draft: SpendGateDraft
): SpendGateRouteIssue | null => {
  if ('referenceIds' in draft) return catalog.image.status === 'ready' ? null : 'image';
  const choices = [...draft.baseChoices, ...draft.cascadeChoices];
  const continuityChange = spendGateContinuityChange(draft);
  const boardPromotion = spendGateBoardPromotion(draft);
  const needsImage =
    continuityChange?.requiresSeedGeneration === true ||
    choices.some((choice) => choice.purpose === 'seed_still' || choice.purpose === 'board_still');
  const needsVideo =
    continuityChange !== null || boardPromotion !== null || choices.some((choice) => choice.purpose === 'video_take');
  const imageUnavailable = needsImage && catalog.image.status !== 'ready';
  const videoUnavailable = needsVideo && catalog.video.status !== 'ready';
  if (imageUnavailable && videoUnavailable) return 'image_and_video';
  if (imageUnavailable) return 'image';
  if (videoUnavailable) return 'video';
  return null;
};

export const selectedSpendGateQuote = (state: SpendGateState): StudioRendererSubmissionQuoteV2 | null => {
  if (state.options === null) return null;
  return state.selectedOption === 'withCascade' ? state.options.withCascade : state.options.baseOnly;
};

export type SpendGateSummaryRow = StudioRendererQuotedGenerationV2 & { group: 'base' | 'cascade' };

export type SpendGateQuoteSummary = {
  quoteId: string;
  projectId: string;
  projectRevision: number;
  expiresAt: string;
  rows: SpendGateSummaryRow[];
  choiceCount: number;
  currency: string;
  lowerMinorUnits: number;
  upperMinorUnits: number;
  exactPrice: boolean;
  budget: StudioRendererSubmissionQuoteV2['budget'];
};

/** Every visible quote fact is selected from one safe quote and one ordered row list. */
export const summarizeQuote = (quote: StudioRendererSubmissionQuoteV2): SpendGateQuoteSummary => {
  const rows = [
    ...quote.baseItems.map((item) => ({ ...item, group: 'base' as const })),
    ...quote.cascadeItems.map((item) => ({ ...item, group: 'cascade' as const })),
  ];
  return {
    quoteId: quote.id,
    projectId: quote.projectId,
    projectRevision: quote.projectRevision,
    expiresAt: quote.expiresAt,
    rows,
    choiceCount: rows.length,
    currency: quote.currency,
    lowerMinorUnits: quote.lowerMinorUnits,
    upperMinorUnits: quote.upperMinorUnits,
    exactPrice: quote.lowerMinorUnits === quote.upperMinorUnits,
    budget: { ...quote.budget },
  };
};

/** Converts a human-entered two-decimal major-unit amount without floating-point arithmetic. */
export const majorUnitsToMinorUnits = (value: string): number | null => {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (match === null) return null;
  const digits = `${match[1]}${(match[2] ?? '').padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const minor = Number(digits);
  return Number.isSafeInteger(minor) ? minor : null;
};

/** Formats a safe non-negative minor-unit integer without converting the cents through a float. */
export const formatMinorUnits = (minorUnits: number, currency: string, locale: string): string => {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) return '';
  const whole = Math.trunc(minorUnits / 100);
  const fraction = String(minorUnits % 100).padStart(2, '0');
  const groupedWhole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(whole);
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
};

const choiceForShot = (
  project: StudioRendererProjectV2,
  projection: WorkspaceProjection,
  shotId: string,
  segmentHead: boolean
): StudioPrepareGenerationChoiceV2 | null => {
  const shot = Object.hasOwn(project.shots, shotId) ? project.shots[shotId] : undefined;
  if (shot?.id !== shotId) return null;
  const projectedShot = projection.activeBeats
    .flatMap((beat) => beat.shots)
    .find((candidate) => candidate.id === shotId);
  if (projectedShot === undefined) return null;
  if (segmentHead && !projectedShot.hasEffectiveSeed) {
    return projectedShot.seedGenerationInFlight ? null : shotGenerationChoice(shotId, 'seed_still');
  }
  return projectedShot.videoGenerationInFlight ? null : shotGenerationChoice(shotId, 'video_take');
};

type ActiveShotLocation = {
  beatId: string;
  shotIndex: number;
  segmentHeadIndex: number;
  filmIndex: number;
};

const activeShotLocations = (project: StudioRendererProjectV2): Map<string, ActiveShotLocation> => {
  const locations = new Map<string, ActiveShotLocation>();
  let filmIndex = 0;
  for (const beatId of project.beatOrder) {
    const beat = Object.hasOwn(project.beats, beatId) ? project.beats[beatId] : undefined;
    if (beat?.id !== beatId) continue;
    let segmentHeadIndex = 0;
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      const shotId = beat.shotOrder[shotIndex]!;
      const shot = Object.hasOwn(project.shots, shotId) ? project.shots[shotId] : undefined;
      if (shot?.id !== shotId || locations.has(shotId)) continue;
      if (shotIndex > 0 && shot.chainBreak === 'hard_cut') segmentHeadIndex = shotIndex;
      locations.set(shotId, { beatId, shotIndex, segmentHeadIndex, filmIndex });
      filmIndex += 1;
    }
  }
  return locations;
};

/** Stable identity for the paid authority captured when the review gate opened. */
export const spendGateDraftIdentity = (draft: SpendGateDraft): string => {
  try {
    return JSON.stringify(draft);
  } catch {
    return '';
  }
};

const BOARD_DRAWABLE_ACTIVITIES = new Set(['idle', 'failed', 'cancelled']);
const BOARD_EXACT_FRESHNESS = new Set(['missing', 'current', 'stale']);
const BOARD_EXACT_ACTIVITIES = new Set(['idle', 'queued', 'drawing', 'needs_attention', 'failed', 'cancelled']);

const isBoardPanelDrawable = (panel: WorkspaceProjection['boardPanels'][number]): boolean =>
  BOARD_DRAWABLE_ACTIVITIES.has(panel.activity) && panel.recovery?.canRetryDownload !== true;

const exactBoardGateProjection = (input: {
  project: StudioRendererProjectV2;
  projection: WorkspaceProjection;
}): { orderedShotIds: string[]; boardPanels: WorkspaceProjection['boardPanels'] } | null => {
  if (
    input.project.boardStyle === null ||
    input.projection.projectId !== input.project.id ||
    input.projection.projectRevision !== input.project.revision ||
    input.projection.activeBeatIds.length !== input.project.beatOrder.length ||
    input.projection.activeBeatIds.some((beatId, index) => beatId !== input.project.beatOrder[index])
  ) {
    return null;
  }

  const locations = activeShotLocations(input.project);
  const orderedShotIds = [...locations]
    .toSorted((left, right) => left[1].filmIndex - right[1].filmIndex)
    .map(([shotId]) => shotId);
  const authoredShotCount = input.project.beatOrder.reduce((count, beatId) => {
    const beat = Object.hasOwn(input.project.beats, beatId) ? input.project.beats[beatId] : undefined;
    return count + (beat?.id === beatId ? beat.shotOrder.length : 0);
  }, 0);
  if (
    authoredShotCount !== orderedShotIds.length ||
    input.projection.activeShotIds.length !== orderedShotIds.length ||
    input.projection.activeShotIds.some((shotId, index) => shotId !== orderedShotIds[index]) ||
    input.projection.boardPanels.length !== orderedShotIds.length
  ) {
    return null;
  }

  for (let index = 0; index < orderedShotIds.length; index += 1) {
    const shotId = orderedShotIds[index]!;
    const panel = input.projection.boardPanels[index];
    if (
      panel?.shotId !== shotId ||
      !BOARD_EXACT_FRESHNESS.has(panel.freshness) ||
      !BOARD_EXACT_ACTIVITIES.has(panel.activity)
    ) {
      return null;
    }
  }
  return { orderedShotIds, boardPanels: input.projection.boardPanels };
};

/** Builds one paid, Board-only request for the next exact film-order batch of missing panels. */
export const boardGateDraft = (input: {
  project: StudioRendererProjectV2;
  projection: WorkspaceProjection;
}): StudioPrepareSubmissionRequestV2 | null => {
  const exact = exactBoardGateProjection(input);
  if (exact === null) return null;
  const choices = exact.boardPanels.flatMap<StudioPrepareGenerationChoiceV2>((panel) =>
    panel.freshness === 'missing' && isBoardPanelDrawable(panel)
      ? [shotGenerationChoice(panel.shotId, 'board_still')]
      : []
  );
  if (choices.length === 0) return null;
  return {
    projectId: input.project.id,
    expectedRevision: input.project.revision,
    originReferenceHandoffId: null,
    baseChoices: choices.slice(0, STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST),
    cascadeChoices: [],
  };
};

/** Builds an exact paid redraw request for a caller-selected film-order set of Board panels. */
export const boardSelectionGateDraft = (input: {
  project: StudioRendererProjectV2;
  projection: WorkspaceProjection;
  orderedShotIds: readonly string[];
}): StudioPrepareSubmissionRequestV2 | null => {
  const exact = exactBoardGateProjection(input);
  if (
    exact === null ||
    !Array.isArray(input.orderedShotIds) ||
    input.orderedShotIds.length === 0 ||
    input.orderedShotIds.length > STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST
  ) {
    return null;
  }
  const filmIndexByShotId = new Map(exact.orderedShotIds.map((shotId, filmIndex) => [shotId, filmIndex]));
  const choices: StudioPrepareGenerationChoiceV2[] = [];
  let previousFilmIndex = -1;
  for (const shotId of input.orderedShotIds) {
    const filmIndex = filmIndexByShotId.get(shotId);
    const panel = filmIndex === undefined ? undefined : exact.boardPanels[filmIndex];
    if (
      filmIndex === undefined ||
      filmIndex <= previousFilmIndex ||
      panel?.shotId !== shotId ||
      !isBoardPanelDrawable(panel)
    ) {
      return null;
    }
    previousFilmIndex = filmIndex;
    choices.push(shotGenerationChoice(shotId, 'board_still'));
  }
  return {
    projectId: input.project.id,
    expectedRevision: input.project.revision,
    originReferenceHandoffId: null,
    baseChoices: choices,
    cascadeChoices: [],
  };
};

/**
 * Builds one exact Board-promotion review without changing continuity or silently filling coverage.
 * The paid alternative is limited to canonical current takes that the promotion will make stale.
 */
export const boardPromotionGatePlan = (input: {
  project: StudioRendererProjectV2;
  projection: WorkspaceProjection;
  shotId: string;
  boardAssetId: string;
}): BoardPromotionGatePlan | null => {
  if (!SAFE_STUDIO_ID.test(input.shotId) || !SAFE_STUDIO_ID.test(input.boardAssetId)) return null;
  const exact = exactBoardGateProjection(input);
  if (exact === null || !input.projection.workspaceStatusReady || !input.projection.chainStatusReady) return null;

  const location = activeShotLocations(input.project).get(input.shotId);
  const beat = location === undefined ? undefined : input.project.beats[location.beatId];
  const shot = Object.hasOwn(input.project.shots, input.shotId) ? input.project.shots[input.shotId] : undefined;
  const projectedBeat = input.projection.activeBeats.find((candidate) => candidate.id === location?.beatId);
  const projectedShot = projectedBeat?.shots.find((candidate) => candidate.id === input.shotId);
  const panel = location === undefined ? undefined : exact.boardPanels[location.filmIndex];
  if (
    location === undefined ||
    beat?.id !== location.beatId ||
    shot?.id !== input.shotId ||
    projectedBeat?.id !== beat.id ||
    projectedShot?.id !== shot.id ||
    (location.shotIndex !== 0 && shot.chainBreak !== 'hard_cut') ||
    !projectedShot.segmentHead ||
    projectedShot.chainBreak !== shot.chainBreak ||
    projectedShot.seedGenerationBlocked ||
    panel?.shotId !== shot.id ||
    panel.assetId !== input.boardAssetId ||
    shot.boardAssetId !== input.boardAssetId ||
    panel.freshness !== 'current' ||
    !isBoardPanelDrawable(panel) ||
    shot.seedStillId === input.boardAssetId ||
    projectedShot.explicitSeedAssetId === input.boardAssetId
  ) {
    return null;
  }

  const segmentShotIds: string[] = [];
  for (let shotIndex = location.shotIndex; shotIndex < beat.shotOrder.length; shotIndex += 1) {
    const segmentShotId = beat.shotOrder[shotIndex]!;
    const segmentShot = Object.hasOwn(input.project.shots, segmentShotId)
      ? input.project.shots[segmentShotId]
      : undefined;
    if (segmentShot?.id !== segmentShotId) return null;
    if (shotIndex > location.shotIndex && segmentShot.chainBreak === 'hard_cut') break;
    segmentShotIds.push(segmentShotId);
  }
  if (
    segmentShotIds.length === 0 ||
    projectedShot.downstreamShotIds.length !== segmentShotIds.length - 1 ||
    projectedShot.downstreamShotIds.some((shotId, index) => shotId !== segmentShotIds[index + 1])
  ) {
    return null;
  }

  const projectedByShotId = new Map(projectedBeat.shots.map((candidate) => [candidate.id, candidate]));
  const currentTakeShotIds: string[] = [];
  for (const segmentShotId of segmentShotIds) {
    const segmentShot = Object.hasOwn(input.project.shots, segmentShotId)
      ? input.project.shots[segmentShotId]
      : undefined;
    const projected = projectedByShotId.get(segmentShotId);
    if (
      segmentShot?.id !== segmentShotId ||
      projected?.id !== segmentShotId ||
      projected.chainBreak !== segmentShot.chainBreak ||
      projected.segmentState.kind === 'status_pending' ||
      projected.videoGenerationBlocked ||
      (segmentShot.videoAssetId === null) !== (projected.currentPicture === null) ||
      (segmentShot.videoAssetId !== null && projected.currentPicture?.assetId !== segmentShot.videoAssetId)
    ) {
      return null;
    }
    if (projected.currentPicture !== null) currentTakeShotIds.push(segmentShotId);
  }

  return {
    draft: {
      projectId: input.project.id,
      expectedRevision: input.project.revision,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      boardPromotion: { shotId: input.shotId, boardAssetId: input.boardAssetId },
    },
    impact: { currentTakeShotIds },
  };
};

/** Builds the free review request for one exact prospective continuity change. */
export const continuityGateDraft = (input: {
  project: StudioRendererProjectV2;
  projection: WorkspaceProjection;
  shotId: string;
  hardCut: boolean;
}): StudioPrepareSubmissionRequestV2 | null => {
  if (
    !SAFE_STUDIO_ID.test(input.shotId) ||
    input.projection.projectId !== input.project.id ||
    input.projection.projectRevision !== input.project.revision ||
    !input.projection.workspaceStatusReady ||
    !input.projection.chainStatusReady
  ) {
    return null;
  }
  const location = activeShotLocations(input.project).get(input.shotId);
  const shot = Object.hasOwn(input.project.shots, input.shotId) ? input.project.shots[input.shotId] : undefined;
  const projectedShot = input.projection.activeBeats
    .flatMap((beat) => beat.shots)
    .find((candidate) => candidate.id === input.shotId);
  if (
    location === undefined ||
    location.shotIndex === 0 ||
    shot?.id !== input.shotId ||
    projectedShot?.id !== input.shotId ||
    projectedShot.chainBreak !== shot.chainBreak ||
    (input.hardCut ? shot.chainBreak !== 'none' : shot.chainBreak !== 'hard_cut')
  ) {
    return null;
  }
  return {
    projectId: input.project.id,
    expectedRevision: input.project.revision,
    originReferenceHandoffId: null,
    baseChoices: [],
    cascadeChoices: [],
    continuityChange: {
      shotId: input.shotId,
      hardCut: input.hardCut,
      requiresSeedGeneration: input.hardCut && projectedShot.seedStills.length === 0,
    },
  };
};

const withinNativeSubmissionBounds = (
  baseChoices: readonly StudioPrepareGenerationChoiceV2[],
  cascadeChoices: readonly StudioPrepareGenerationChoiceV2[]
): boolean => {
  const choices = [...baseChoices, ...cascadeChoices];
  return (
    choices.length <= STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST &&
    choices.every((choice) => choice.target.kind === 'shot') &&
    new Set(choices.map((choice) => choiceShotId(choice))).size <= STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST
  );
};

const validGenerationChoice = (
  choice: unknown,
  locations: ReadonlyMap<string, ActiveShotLocation>
): choice is StudioPrepareGenerationChoiceV2 => {
  if (choice === null || typeof choice !== 'object' || Array.isArray(choice)) return false;
  const candidate = choice as Record<PropertyKey, unknown>;
  if (
    Reflect.ownKeys(candidate).length !== 2 ||
    !Object.hasOwn(candidate, 'target') ||
    !Object.hasOwn(candidate, 'purpose')
  ) {
    return false;
  }
  const { target, purpose } = candidate;
  return (
    typeof target === 'object' &&
    target !== null &&
    !Array.isArray(target) &&
    Reflect.ownKeys(target).length === 2 &&
    (target as { kind?: unknown }).kind === 'shot' &&
    typeof (target as { shotId?: unknown }).shotId === 'string' &&
    SAFE_STUDIO_ID.test((target as { shotId: string }).shotId) &&
    locations.has((target as { shotId: string }).shotId) &&
    (purpose === 'seed_still' || purpose === 'video_take')
  );
};

/**
 * The largest batch that can legally be submitted at once.
 *
 * Rendering everything is impossible by construction: a shot conditions on the previous shot's last
 * frame, so two shots in the same chain segment cannot be generated together — the second has
 * nothing to start from until the first exists. One shot per segment is therefore the ceiling, which
 * is what makes the Beat the unit of parallelism.
 *
 * A segment with work already in flight is skipped whole. Submitting its next shot would queue a
 * generation against a first frame that is still being produced.
 */
/**
 * Every Shot a base choice pulls into the request: itself, plus the cascade running from it to the
 * end of its Beat, stopping where the chain is severed or where work is already in flight. This
 * mirrors the cascade the draft builder derives, so a batch is bounded by what will actually be
 * quoted rather than by how many segment heads it happens to name.
 */
const cascadeCoverage = (
  project: StudioRendererProjectV2,
  projected: Map<string, { videoGenerationInFlight: boolean }>,
  location: { shotId: string; shotIndex: number; beatId: string },
  choice: StudioPrepareGenerationChoiceV2
): string[] => {
  const covered = [location.shotId];
  const beat = Object.hasOwn(project.beats, location.beatId) ? project.beats[location.beatId] : undefined;
  if (beat?.id !== location.beatId) return covered;
  const first = choice.purpose === 'seed_still' ? location.shotIndex : location.shotIndex + 1;
  for (let index = first; index < beat.shotOrder.length; index += 1) {
    const downstreamId = beat.shotOrder[index]!;
    const downstream = Object.hasOwn(project.shots, downstreamId) ? project.shots[downstreamId] : undefined;
    if (downstream?.id !== downstreamId) break;
    if (index > location.shotIndex && downstream.chainBreak === 'hard_cut') break;
    if (projected.get(downstreamId)?.videoGenerationInFlight === true) break;
    if (!covered.includes(downstreamId)) covered.push(downstreamId);
  }
  return covered;
};

export const filmRenderBatchShotIds = (input: {
  project: StudioRendererProjectV2;
  projection: WorkspaceProjection;
  maxShots?: number;
}): string[] => {
  if (input.projection.projectId !== input.project.id || input.projection.projectRevision !== input.project.revision) {
    return [];
  }
  if (!input.projection.workspaceStatusReady || !input.projection.chainStatusReady) return [];

  const locations = activeShotLocations(input.project);
  const projected = new Map(input.projection.activeBeats.flatMap((beat) => beat.shots.map((shot) => [shot.id, shot])));
  const cap = input.maxShots ?? STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST;

  const segments = new Map<
    string,
    { shotId: string; shotIndex: number; segmentHeadIndex: number; filmIndex: number; beatId: string }[]
  >();
  for (const [shotId, location] of locations) {
    const key = `${location.beatId}\0${location.segmentHeadIndex}`;
    const bucket = segments.get(key) ?? [];
    bucket.push({ shotId, ...location });
    segments.set(key, bucket);
  }

  const batch: { shotId: string; filmIndex: number; coveredShotIds: string[] }[] = [];
  for (const bucket of segments.values()) {
    const ordered = bucket.toSorted((left, right) => left.shotIndex - right.shotIndex);
    // "Render the film" means render what is missing. A segment whose every Shot already has a picture
    // needs nothing, and packing it anyway both re-charges finished work and consumes cap that the
    // unrendered Beats behind it then never get — a partly-rendered film could not be finished at all.
    if (
      ordered.every(({ shotId }) => {
        const shot = projected.get(shotId);
        return shot?.currentPicture !== null && shot?.currentPicture !== undefined;
      })
    ) {
      continue;
    }
    if (
      ordered.some(({ shotId }) => {
        const shot = projected.get(shotId);
        return shot !== undefined && (shot.videoGenerationInFlight || shot.seedGenerationInFlight);
      })
    ) {
      continue;
    }
    // Start where the work actually is. Re-rendering a Shot that already has a picture pays for it twice
    // and drags the rest of its chain along behind it, so the first Shot still missing a picture is the
    // one to begin from — its upstream frame already exists.
    const needsWork = ({ shotId }: { shotId: string }): boolean => {
      const shot = projected.get(shotId);
      return shot?.currentPicture == null;
    };
    let nextChoice: StudioPrepareGenerationChoiceV2 | null = null;
    const admissible = ({
      shotId,
      shotIndex,
      segmentHeadIndex,
    }: {
      shotId: string;
      shotIndex: number;
      segmentHeadIndex: number;
    }): boolean => {
      const choice = choiceForShot(input.project, input.projection, shotId, shotIndex === segmentHeadIndex);
      if (choice === null || (choice.purpose === 'seed_still' && shotIndex !== segmentHeadIndex)) return false;
      nextChoice = choice;
      return true;
    };
    const next = ordered.find((entry) => needsWork(entry) && admissible(entry)) ?? ordered.find(admissible);
    if (next !== undefined && nextChoice !== null) {
      // The cap counts distinct Shot ids across the whole selection, and choosing a head drags its
      // whole cascade in with it. Counting heads alone lets a large film exceed the cap, and the
      // draft is then refused as unpayable — which is what a 30-Shot film hit in practice.
      batch.push({
        shotId: next.shotId,
        filmIndex: next.filmIndex,
        coveredShotIds: cascadeCoverage(input.project, projected, next, nextChoice),
      });
    }
  }

  const selected: string[] = [];
  let covered = new Set<string>();
  for (const entry of batch.toSorted((left, right) => left.filmIndex - right.filmIndex)) {
    const widened = new Set(covered);
    for (const shotId of entry.coveredShotIds) widened.add(shotId);
    if (widened.size > cap) break;
    selected.push(entry.shotId);
    covered = widened;
  }
  return selected;
};

export const selectionGateDraft = (input: {
  project: StudioRendererProjectV2;
  projection: WorkspaceProjection;
  orderedShotIds: readonly string[];
  baseChoices?: readonly StudioPrepareGenerationChoiceV2[];
  cascadeChoices?: readonly StudioPrepareGenerationChoiceV2[];
}): StudioPrepareSubmissionRequestV2 | null => {
  const locations = activeShotLocations(input.project);
  if (input.projection.projectId !== input.project.id || input.projection.projectRevision !== input.project.revision) {
    return null;
  }
  if (!input.projection.workspaceStatusReady || !input.projection.chainStatusReady) return null;
  const projectedShots = new Map(
    input.projection.activeBeats.flatMap((beat) => beat.shots.map((shot) => [shot.id, shot] as const))
  );
  const requested = [...new Set(input.orderedShotIds)]
    .flatMap((shotId) => {
      const location = locations.get(shotId);
      return location === undefined ? [] : [{ shotId, location }];
    })
    .toSorted((left, right) => left.location.filmIndex - right.location.filmIndex);
  const segmentKeys = new Set<string>();
  const derivedBaseChoices: StudioPrepareGenerationChoiceV2[] = [];
  let selectionIsExact = true;
  for (const { shotId, location } of requested) {
    const segmentKey = `${location.beatId}\0${location.segmentHeadIndex}`;
    if (segmentKeys.has(segmentKey)) {
      selectionIsExact = false;
      break;
    }
    const choice = choiceForShot(
      input.project,
      input.projection,
      shotId,
      location.shotIndex === location.segmentHeadIndex
    );
    if (choice === null || (choice.purpose === 'seed_still' && location.shotIndex !== location.segmentHeadIndex)) {
      selectionIsExact = false;
      break;
    }
    segmentKeys.add(segmentKey);
    derivedBaseChoices.push(choice);
  }
  if (!selectionIsExact || requested.length !== input.orderedShotIds.length) {
    return null;
  }
  if (
    input.baseChoices !== undefined &&
    (input.baseChoices.length !== derivedBaseChoices.length ||
      input.baseChoices.some(
        (choice, index) =>
          choiceShotId(choice) !==
            (derivedBaseChoices[index] === undefined ? null : choiceShotId(derivedBaseChoices[index]!)) ||
          choice.purpose !== derivedBaseChoices[index]?.purpose
      ))
  ) {
    return null;
  }
  const baseChoices = input.baseChoices === undefined ? derivedBaseChoices : [...input.baseChoices];
  if (baseChoices.length === 0) return null;

  let previousFilmIndex = -1;
  const validatedSegments = new Set<string>();
  for (const choice of baseChoices) {
    const shotId = choiceShotId(choice);
    const location = shotId === null ? undefined : locations.get(shotId);
    if (
      location === undefined ||
      !validGenerationChoice(choice, locations) ||
      location.filmIndex <= previousFilmIndex ||
      (choice.purpose === 'seed_still' && location.shotIndex !== location.segmentHeadIndex)
    ) {
      return null;
    }
    const segmentKey = `${location.beatId}\0${location.segmentHeadIndex}`;
    if (validatedSegments.has(segmentKey)) return null;
    validatedSegments.add(segmentKey);
    previousFilmIndex = location.filmIndex;
  }

  const cascadeByPair = new Map<string, StudioPrepareGenerationChoiceV2>();
  for (const baseChoice of baseChoices) {
    const baseShotId = choiceShotId(baseChoice);
    const location = baseShotId === null ? undefined : locations.get(baseShotId);
    const beat = location === undefined ? undefined : input.project.beats[location.beatId];
    if (location === undefined || beat?.id !== location.beatId) return null;
    const firstCascadeIndex = baseChoice.purpose === 'seed_still' ? location.shotIndex : location.shotIndex + 1;
    for (let shotIndex = firstCascadeIndex; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      const downstreamId = beat.shotOrder[shotIndex]!;
      const downstream = Object.hasOwn(input.project.shots, downstreamId)
        ? input.project.shots[downstreamId]
        : undefined;
      if (downstream?.id !== downstreamId) return null;
      if (shotIndex > location.shotIndex && downstream.chainBreak === 'hard_cut') break;
      if (projectedShots.get(downstreamId)?.videoGenerationInFlight === true) break;
      cascadeByPair.set(`${downstreamId}\0video_take`, {
        target: { kind: 'shot', shotId: downstreamId },
        purpose: 'video_take',
      });
    }
  }
  const cascadeChoices = [...cascadeByPair.values()].toSorted(
    (left, right) =>
      (locations.get(choiceShotId(left) ?? '')?.filmIndex ?? 0) -
      (locations.get(choiceShotId(right) ?? '')?.filmIndex ?? 0)
  );
  const requestedCascade = input.cascadeChoices === undefined ? cascadeChoices : [...input.cascadeChoices];
  const conditioningFailures = new Set(input.projection.conditioningFailures.map((row) => row.dependentShotId));
  if (
    baseChoices.some((choice) => conditioningFailures.has(choiceShotId(choice) ?? '')) ||
    requestedCascade.some((choice) => conditioningFailures.has(choiceShotId(choice) ?? ''))
  ) {
    return null;
  }
  if (
    requestedCascade.length !== cascadeChoices.length ||
    requestedCascade.some(
      (choice, index) =>
        !validGenerationChoice(choice, locations) ||
        choice.purpose !== 'video_take' ||
        choiceShotId(choice) !== (cascadeChoices[index] === undefined ? null : choiceShotId(cascadeChoices[index]!))
    ) ||
    !withinNativeSubmissionBounds(baseChoices, requestedCascade)
  ) {
    return null;
  }
  return {
    projectId: input.project.id,
    expectedRevision: input.project.revision,
    originReferenceHandoffId: null,
    baseChoices,
    cascadeChoices: requestedCascade,
  };
};

/** Builds the exact paid wave for regenerating a segment head's first frame and every dependent picture. */
export const seedRegenerationGateDraft = (input: {
  project: StudioRendererProjectV2;
  projection: WorkspaceProjection;
  shotId: string;
}): StudioPrepareSubmissionRequestV2 | null => {
  const locations = activeShotLocations(input.project);
  const location = locations.get(input.shotId);
  const beat = location === undefined ? undefined : input.project.beats[location.beatId];
  const projected = input.projection.activeBeats.flatMap((candidate) => candidate.shots);
  const projectedById = new Map(projected.map((shot) => [shot.id, shot] as const));
  const head = projectedById.get(input.shotId);
  if (
    input.projection.projectId !== input.project.id ||
    input.projection.projectRevision !== input.project.revision ||
    !input.projection.workspaceStatusReady ||
    !input.projection.chainStatusReady ||
    location === undefined ||
    beat?.id !== location.beatId ||
    location.shotIndex !== location.segmentHeadIndex ||
    head === undefined ||
    head.seedGenerationBlocked ||
    head.seedAuthorizationLock !== null
  ) {
    return null;
  }

  const cascadeChoices: StudioPrepareGenerationChoiceV2[] = [];
  for (let shotIndex = location.shotIndex; shotIndex < beat.shotOrder.length; shotIndex += 1) {
    const shotId = beat.shotOrder[shotIndex]!;
    const shot = Object.hasOwn(input.project.shots, shotId) ? input.project.shots[shotId] : undefined;
    const projectedShot = projectedById.get(shotId);
    if (shot?.id !== shotId || projectedShot === undefined) return null;
    if (shotIndex > location.shotIndex && shot.chainBreak === 'hard_cut') break;
    if (projectedShot.videoGenerationBlocked || projectedShot.seedAuthorizationLock !== null) return null;
    cascadeChoices.push(shotGenerationChoice(shotId, 'video_take'));
  }
  const baseChoices = [shotGenerationChoice(input.shotId, 'seed_still')];
  if (!withinNativeSubmissionBounds(baseChoices, cascadeChoices)) return null;
  return {
    projectId: input.project.id,
    expectedRevision: input.project.revision,
    originReferenceHandoffId: null,
    baseChoices,
    cascadeChoices,
  };
};

export const handoffGateDraft = (
  project: StudioRendererProjectV2,
  projection: WorkspaceProjection,
  handoff: StudioRendererReferenceGenerationHandoffV2
): StudioPrepareProjectReferencesRequestV2 | null => {
  if (
    projection.projectId !== project.id ||
    projection.projectRevision !== project.revision ||
    !projection.workspaceStatusReady ||
    !projection.chainStatusReady
  ) {
    return null;
  }
  if (handoff.status !== 'awaiting_spend' || handoff.completedAt !== null) return null;
  const seen = new Set<string>();
  let previousIndex = -1;
  for (const referenceId of handoff.referenceIds) {
    const reference = Object.hasOwn(project.references, referenceId) ? project.references[referenceId] : undefined;
    const index = project.referenceOrder.indexOf(referenceId);
    if (reference?.id !== referenceId || seen.has(referenceId) || index <= previousIndex) return null;
    seen.add(referenceId);
    previousIndex = index;
  }
  if (seen.size === 0) return null;
  return {
    projectId: project.id,
    expectedRevision: project.revision,
    referenceIds: [...handoff.referenceIds],
  };
};
