/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioPrepareGenerationChoiceV2,
  StudioPrepareSubmissionRequestV2,
  StudioRendererPreparedSubmissionOptionsV2,
  StudioRendererProjectV2,
  StudioRendererQuotedGenerationV2,
  StudioRendererReferenceGenerationHandoffV2,
  StudioRendererSubmissionQuoteV2,
  StudioSubmissionCacheErrorCodeV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
  STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION,
} from '@/common/types/project/creativeStudioTypes';
import type { WorkspaceProjection } from './workspaceProjection';

export type SpendGateDraft = StudioPrepareSubmissionRequestV2;

export type SpendGateSelectedOption = 'baseOnly' | 'withCascade';

export type SpendGatePhase =
  | 'closed'
  | 'choices'
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
  options: StudioRendererPreparedSubmissionOptionsV2 | null;
  selectedOption: SpendGateSelectedOption;
  errorCode: string | null;
};

export type SpendGateAction =
  | { type: 'open'; draft: SpendGateDraft }
  | { type: 'close' }
  | { type: 'prepare_started' }
  | { type: 'prepare_succeeded'; options: StudioRendererPreparedSubmissionOptionsV2 }
  | { type: 'prepare_failed'; code: string }
  | { type: 'select_option'; option: SpendGateSelectedOption }
  | { type: 'confirm_started' }
  | { type: 'confirm_failed'; code: string }
  | { type: 'confirmed' };

export const initialSpendGateState = (): SpendGateState => ({
  phase: 'closed',
  draft: null,
  options: null,
  selectedOption: 'baseOnly',
  errorCode: null,
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
    return { phase: 'choices', draft: action.draft, options: null, selectedOption: 'baseOnly', errorCode: null };
  }
  if (action.type === 'close') return initialSpendGateState();
  if (action.type === 'prepare_started') {
    return state.draft === null
      ? state
      : { ...state, phase: 'preparing', options: null, selectedOption: 'baseOnly', errorCode: null };
  }
  if (action.type === 'prepare_succeeded') {
    return state.draft === null
      ? state
      : { ...state, phase: 'review', options: action.options, selectedOption: 'baseOnly', errorCode: null };
  }
  if (action.type === 'select_option') {
    if (state.options === null || (action.option === 'withCascade' && state.options.withCascade === null)) return state;
    return { ...state, selectedOption: action.option };
  }
  if (action.type === 'confirm_started') {
    return state.options === null ? state : { ...state, phase: 'confirming', errorCode: null };
  }
  if (action.type === 'confirmed') {
    return state.options === null ? state : { ...state, phase: 'confirmed', errorCode: null };
  }
  if (action.type === 'prepare_failed' || action.type === 'confirm_failed') {
    const classifiedPhase = cacheFailurePhase(action.code);
    const phase = classifiedPhase === 'quote_in_use' && state.options === null ? 'error' : classifiedPhase;
    return {
      ...state,
      phase,
      options: phase === 'quote_in_use' ? state.options : null,
      errorCode: action.code,
    };
  }
  return state;
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
  generationCount: number;
  currency: string;
  lowerMinorUnits: number;
  upperMinorUnits: number;
  exactPrice: boolean;
  hasWaitingRows: boolean;
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
    generationCount: rows.reduce((total, row) => total + row.generationCount, 0),
    currency: quote.currency,
    lowerMinorUnits: quote.lowerMinorUnits,
    upperMinorUnits: quote.upperMinorUnits,
    exactPrice: quote.lowerMinorUnits === quote.upperMinorUnits,
    hasWaitingRows: rows.some((row) => row.waitsForTakeSelection),
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
    return projectedShot.seedGenerationInFlight
      ? null
      : { shotId, purpose: 'seed_still', generationCount: 1, referenceAssetId: null };
  }
  return projectedShot.videoGenerationInFlight
    ? null
    : { shotId, purpose: 'video_take', generationCount: 1, referenceAssetId: null };
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

const withinNativeSubmissionBounds = (
  baseChoices: readonly StudioPrepareGenerationChoiceV2[],
  cascadeChoices: readonly StudioPrepareGenerationChoiceV2[]
): boolean => {
  const choices = [...baseChoices, ...cascadeChoices];
  return (
    choices.length <= STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST &&
    new Set(choices.map((choice) => choice.shotId)).size <= STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST
  );
};

const validGenerationChoice = (
  choice: StudioPrepareGenerationChoiceV2,
  locations: ReadonlyMap<string, ActiveShotLocation>
): boolean =>
  locations.has(choice.shotId) &&
  Number.isSafeInteger(choice.generationCount) &&
  choice.generationCount >= 1 &&
  choice.generationCount <= STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION &&
  (choice.referenceAssetId === null ||
    (choice.purpose === 'seed_still' && /^[A-Za-z0-9_-]{1,256}$/.test(choice.referenceAssetId)));

export const selectionGateDraft = (input: {
  project: StudioRendererProjectV2;
  projection: WorkspaceProjection;
  orderedShotIds: readonly string[];
  baseChoices?: readonly StudioPrepareGenerationChoiceV2[];
  cascadeChoices?: readonly StudioPrepareGenerationChoiceV2[];
}): SpendGateDraft | null => {
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
          choice.shotId !== derivedBaseChoices[index]?.shotId || choice.purpose !== derivedBaseChoices[index]?.purpose
      ))
  ) {
    return null;
  }
  const baseChoices = input.baseChoices === undefined ? derivedBaseChoices : [...input.baseChoices];
  if (baseChoices.length === 0) return null;

  let previousFilmIndex = -1;
  const validatedSegments = new Set<string>();
  for (const choice of baseChoices) {
    const location = locations.get(choice.shotId);
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
    const location = locations.get(baseChoice.shotId);
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
        shotId: downstreamId,
        purpose: 'video_take',
        generationCount: 1,
        referenceAssetId: null,
      });
    }
  }
  const cascadeChoices = [...cascadeByPair.values()].toSorted(
    (left, right) => (locations.get(left.shotId)?.filmIndex ?? 0) - (locations.get(right.shotId)?.filmIndex ?? 0)
  );
  const requestedCascade = input.cascadeChoices === undefined ? cascadeChoices : [...input.cascadeChoices];
  const conditioningFailures = new Set(input.projection.conditioningFailures.map((row) => row.dependentShotId));
  if (
    baseChoices.some((choice) => conditioningFailures.has(choice.shotId)) ||
    requestedCascade.some((choice) => conditioningFailures.has(choice.shotId))
  ) {
    return null;
  }
  if (
    requestedCascade.length !== cascadeChoices.length ||
    requestedCascade.some(
      (choice, index) =>
        !validGenerationChoice(choice, locations) ||
        choice.purpose !== 'video_take' ||
        choice.referenceAssetId !== null ||
        choice.shotId !== cascadeChoices[index]?.shotId
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

export const handoffGateDraft = (
  project: StudioRendererProjectV2,
  projection: WorkspaceProjection,
  handoff: StudioRendererReferenceGenerationHandoffV2
): SpendGateDraft | null => {
  if (
    projection.projectId !== project.id ||
    projection.projectRevision !== project.revision ||
    !projection.workspaceStatusReady ||
    !projection.chainStatusReady
  ) {
    return null;
  }
  if (handoff.status !== 'open' || handoff.completedAt !== null) return null;
  const locations = activeShotLocations(project);
  const seen = new Set<string>();
  let previousIndex = -1;
  const baseChoices: StudioPrepareGenerationChoiceV2[] = [];
  for (const shotId of handoff.shotIds) {
    const location = locations.get(shotId);
    if (location === undefined || seen.has(shotId) || location.filmIndex <= previousIndex) return null;
    seen.add(shotId);
    previousIndex = location.filmIndex;
    baseChoices.push({ shotId, purpose: 'seed_still', generationCount: 1, referenceAssetId: null });
  }
  if (baseChoices.length === 0 || !withinNativeSubmissionBounds(baseChoices, [])) return null;
  return {
    projectId: project.id,
    expectedRevision: project.revision,
    originReferenceHandoffId: handoff.handoffId,
    baseChoices,
    cascadeChoices: [],
  };
};
