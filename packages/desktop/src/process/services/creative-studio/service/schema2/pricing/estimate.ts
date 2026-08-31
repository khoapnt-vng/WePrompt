/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_REFERENCE_LABEL_LENGTH,
  type StudioAssetV2,
  type StudioAuthorizedConditioningDependency,
  type StudioConditioningInputSnapshot,
  type StudioGenerationRequestPlan,
  type StudioGenerationRequestTemplate,
  type StudioGenerationTargetV2,
  type StudioMediaModelRef,
  type StudioPrepareGenerationChoiceV2,
  type StudioPreparedSubmissionRequestV2,
  type StudioPricingRefusalDetailsV2,
  type StudioPrepareProjectReferencesRequestV2,
  type StudioPrepareSubmissionRequestV2,
  type StudioProjectV2,
  type StudioQuotedGeneration,
  type StudioRendererBudgetVerdictV2,
  type StudioRendererMediaModelRef,
  type StudioRendererQuotedGenerationV2,
  type StudioRendererSubmissionQuoteV2,
  type StudioShot,
  type StudioSpendPolicy,
  type StudioSubmissionQuote,
  type StudioSubmissionQuoteCore,
  type StudioReferenceKindV2,
} from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import {
  resolveStudioCanonicalBoardAssetV2,
  resolveStudioCurrentBoardPanelAuthorityV2,
} from '../generation/boardPanel';
import { deriveStudioInboundShotReferencesV2 } from '../chain';
import {
  calculateStudioQuoteTotals,
  calculateStudioQuotedGenerationAmounts,
  createStudioBoardGenerationRequestPlan,
  composeStudioGenerationV2,
  createStudioDeferredGenerationRequestPlan,
  createStudioFrameExtractionId,
  createStudioGenerationRequestTemplate,
  createStudioQuotedGenerationId,
  createStudioReferenceGenerationRequestPlan,
  createStudioResolvedGenerationRequestPlan,
  deriveStudioInstructionProfileV2,
  resolveStudioReferenceBindingV2,
  studioGenerationTargetKey,
} from '../generation';
import { studioBoardAuthorizationScopeIsValidV2 } from './authorization';
import {
  createStudioRateCardV2,
  getStudioRateCardEntryV2,
  StudioRateCardErrorV2,
  type StudioRateCardErrorCodeV2,
  type StudioRateCardV2,
} from './rateCard';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const CURRENCY = /^[A-Z]{3}$/;
const isGenerationTarget = (value: unknown): value is StudioGenerationTargetV2 => {
  if (value === null || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  return (
    Reflect.ownKeys(target).length === 2 &&
    ((target.kind === 'shot' && typeof target.shotId === 'string' && SAFE_ID.test(target.shotId)) ||
      (target.kind === 'reference' && typeof target.referenceId === 'string' && SAFE_ID.test(target.referenceId)))
  );
};
const NONTERMINAL_STATUSES = new Set([
  'waiting_for_conditioning',
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);

export type StudioUnpricedQuotedGenerationV2 = Omit<StudioQuotedGeneration, 'id' | 'rateUnit' | 'rateMinorUnits'>;

export type StudioCompositionRouteAuthorityV2 = {
  provider: StudioMediaModelRef;
  maxConditioningImages: number;
};

export type StudioCompositionRouteLookupV2 = (
  routeId: string,
  purpose: StudioQuotedGeneration['purpose']
) => StudioCompositionRouteAuthorityV2;

export type StudioSubmissionQuoteEstimateInputV2 = {
  project: Pick<StudioProjectV2, 'id' | 'revision' | 'beatOrder' | 'beats' | 'shots' | 'references' | 'jobs'>;
  originReferenceHandoffId: string | null;
  rateCard: StudioRateCardV2;
  baseItems: StudioUnpricedQuotedGenerationV2[];
  cascadeItems: StudioUnpricedQuotedGenerationV2[];
};

export type StudioPricingErrorCodeV2 =
  | StudioRateCardErrorCodeV2
  | 'invalid_quote'
  | 'inactive_shot'
  | 'in_flight'
  | 'duplicate_shot_purpose'
  | 'mixed_currency'
  | 'invalid_dependency'
  | 'invalid_prepare_request'
  | 'invalid_reference'
  | 'missing_shooting_script'
  | 'missing_route'
  | 'missing_conditioning'
  | 'unsafe_total';

export class StudioPricingErrorV2 extends Error {
  readonly code: StudioPricingErrorCodeV2;
  readonly details: StudioPricingRefusalDetailsV2 | null;

  constructor(code: StudioPricingErrorCodeV2, details: StudioPricingRefusalDetailsV2 | null = null) {
    super(code);
    this.name = 'StudioPricingErrorV2';
    this.code = code;
    this.details = details === null ? null : structuredClone(details);
  }
}

export type StudioBudgetEvaluationV2 =
  | { allowed: true; verdict: Extract<StudioRendererBudgetVerdictV2, { kind: 'no_policy' | 'within_cap' }> }
  | {
      allowed: false;
      reason: 'over_cap' | 'currency_mismatch';
      verdict: Extract<StudioRendererBudgetVerdictV2, { kind: 'over_cap' | 'currency_mismatch' }>;
    };

const fail = (code: StudioPricingErrorCodeV2, details: StudioPricingRefusalDetailsV2 | null = null): never => {
  throw new StudioPricingErrorV2(code, details);
};

const isDenseArray = (value: unknown): value is unknown[] => {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
};

const cloneRequestPlan = (
  purpose: StudioQuotedGeneration['purpose'],
  plan: StudioGenerationRequestPlan
): StudioGenerationRequestPlan => {
  try {
    if (plan.kind === 'resolved') {
      const { conditioningInput, ...template } = plan.snapshot;
      return createStudioResolvedGenerationRequestPlan({ purpose, template, conditioningInput });
    }
    if (purpose !== 'video_take' || plan.kind !== 'after_take_selection') return fail('invalid_dependency');
    return createStudioDeferredGenerationRequestPlan({ template: plan.template, dependency: plan.dependency });
  } catch {
    return fail(plan.kind === 'after_take_selection' ? 'invalid_dependency' : 'invalid_quote');
  }
};

type ActiveShotLocation = { beatId: string; shotIndex: number };

const activeShotLocations = (
  project: StudioSubmissionQuoteEstimateInputV2['project']
): Map<string, ActiveShotLocation> => {
  const result = new Map<string, ActiveShotLocation>();
  for (const beatId of project.beatOrder) {
    const beat = Object.hasOwn(project.beats, beatId) ? project.beats[beatId] : undefined;
    if (beat === undefined) continue;
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      result.set(beat.shotOrder[shotIndex]!, { beatId, shotIndex });
    }
  }
  return result;
};

const ownValue = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const PREPARE_REQUEST_KEYS = new Set([
  'projectId',
  'expectedRevision',
  'originReferenceHandoffId',
  'baseChoices',
  'cascadeChoices',
]);
const CONTINUITY_PREPARE_REQUEST_KEYS = new Set([...PREPARE_REQUEST_KEYS, 'continuityChange']);
const BOARD_PROMOTION_PREPARE_REQUEST_KEYS = new Set([...PREPARE_REQUEST_KEYS, 'boardPromotion']);
const PREPARE_CHOICE_KEYS = new Set(['target', 'purpose']);
const SHOT_TARGET_KEYS = new Set(['kind', 'shotId']);
const CONTINUITY_CHANGE_KEYS = new Set(['shotId', 'hardCut', 'requiresSeedGeneration']);
const BOARD_PROMOTION_KEYS = new Set(['shotId', 'boardAssetId']);

const isExactOwnDataRecord = (value: unknown, keys: ReadonlySet<string>): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.size) return false;
  return ownKeys.every((key) => {
    if (typeof key !== 'string' || !keys.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
};

const isExactDenseOwnDataArray = (value: unknown): value is unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return ownKeys.every(
    (key) =>
      key === 'length' || (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)
  );
};

const parsePrepareChoice = (value: unknown): StudioPrepareGenerationChoiceV2 => {
  if (!isExactOwnDataRecord(value, PREPARE_CHOICE_KEYS)) return fail('invalid_prepare_request');
  const { target, purpose } = value;
  if (
    !isExactOwnDataRecord(target, SHOT_TARGET_KEYS) ||
    target.kind !== 'shot' ||
    typeof target.shotId !== 'string' ||
    !SAFE_ID.test(target.shotId) ||
    (purpose !== 'seed_still' && purpose !== 'board_still' && purpose !== 'video_take')
  ) {
    return fail('invalid_prepare_request');
  }
  return {
    target: { kind: 'shot', shotId: target.shotId },
    purpose: purpose as StudioPrepareGenerationChoiceV2['purpose'],
  };
};

const parsePrepareRequest = (value: unknown, project: StudioProjectV2): StudioPrepareSubmissionRequestV2 => {
  const continuityRequest = isExactOwnDataRecord(value, CONTINUITY_PREPARE_REQUEST_KEYS);
  const boardPromotionRequest = isExactOwnDataRecord(value, BOARD_PROMOTION_PREPARE_REQUEST_KEYS);
  if (!continuityRequest && !boardPromotionRequest && !isExactOwnDataRecord(value, PREPARE_REQUEST_KEYS)) {
    return fail('invalid_prepare_request');
  }
  const { projectId, expectedRevision, originReferenceHandoffId, baseChoices, cascadeChoices } = value;
  if (
    projectId !== project.id ||
    typeof projectId !== 'string' ||
    !SAFE_ID.test(projectId) ||
    expectedRevision !== project.revision ||
    typeof expectedRevision !== 'number' ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1 ||
    originReferenceHandoffId !== null ||
    !isExactDenseOwnDataArray(baseChoices) ||
    !isExactDenseOwnDataArray(cascadeChoices) ||
    (!continuityRequest && !boardPromotionRequest && baseChoices.length === 0) ||
    baseChoices.length + cascadeChoices.length > STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST
  ) {
    return fail('invalid_prepare_request');
  }
  const parsed: StudioPrepareSubmissionRequestV2 = {
    projectId,
    expectedRevision,
    originReferenceHandoffId: null,
    baseChoices: baseChoices.map(parsePrepareChoice),
    cascadeChoices: cascadeChoices.map(parsePrepareChoice),
  };
  if (continuityRequest) {
    const { continuityChange } = value;
    if (
      originReferenceHandoffId !== null ||
      baseChoices.length !== 0 ||
      cascadeChoices.length !== 0 ||
      !isExactOwnDataRecord(continuityChange, CONTINUITY_CHANGE_KEYS) ||
      typeof continuityChange.shotId !== 'string' ||
      !SAFE_ID.test(continuityChange.shotId) ||
      typeof continuityChange.hardCut !== 'boolean' ||
      typeof continuityChange.requiresSeedGeneration !== 'boolean'
    ) {
      return fail('invalid_prepare_request');
    }
    return {
      ...parsed,
      continuityChange: {
        shotId: continuityChange.shotId,
        hardCut: continuityChange.hardCut,
        requiresSeedGeneration: continuityChange.requiresSeedGeneration,
      },
    };
  }
  if (!boardPromotionRequest) return parsed;
  const boardPromotion = (value as unknown as Record<string, unknown>).boardPromotion;
  if (
    originReferenceHandoffId !== null ||
    baseChoices.length !== 0 ||
    cascadeChoices.length !== 0 ||
    !isExactOwnDataRecord(boardPromotion, BOARD_PROMOTION_KEYS) ||
    typeof boardPromotion.shotId !== 'string' ||
    !SAFE_ID.test(boardPromotion.shotId) ||
    typeof boardPromotion.boardAssetId !== 'string' ||
    !SAFE_ID.test(boardPromotion.boardAssetId)
  ) {
    return fail('invalid_prepare_request');
  }
  return {
    ...parsed,
    boardPromotion: {
      shotId: boardPromotion.shotId,
      boardAssetId: boardPromotion.boardAssetId,
    },
  };
};

type ActiveFilmShotLocation = ActiveShotLocation & { filmIndex: number };

const activeFilmShotLocations = (project: StudioProjectV2): Map<string, ActiveFilmShotLocation> => {
  const result = new Map<string, ActiveFilmShotLocation>();
  let filmIndex = 0;
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat?.id !== beatId) return fail('invalid_prepare_request');
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      const shotId = beat.shotOrder[shotIndex]!;
      if (result.has(shotId) || ownValue(project.shots, shotId)?.id !== shotId) return fail('invalid_prepare_request');
      result.set(shotId, { beatId, shotIndex, filmIndex });
      filmIndex += 1;
    }
  }
  return result;
};

const choicePurposeOrder = (purpose: StudioPrepareGenerationChoiceV2['purpose']): number =>
  purpose === 'seed_still' ? 0 : purpose === 'board_still' ? 1 : 2;

const choiceShotId = (choice: StudioPrepareGenerationChoiceV2): string => {
  if (choice.target.kind !== 'shot') return fail('invalid_prepare_request');
  return choice.target.shotId;
};

const comparePrepareChoices = (
  left: StudioPrepareGenerationChoiceV2,
  right: StudioPrepareGenerationChoiceV2,
  locations: ReadonlyMap<string, ActiveFilmShotLocation>
): number => {
  const leftIndex = locations.get(choiceShotId(left))?.filmIndex ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = locations.get(choiceShotId(right))?.filmIndex ?? Number.MAX_SAFE_INTEGER;
  return leftIndex - rightIndex || choicePurposeOrder(left.purpose) - choicePurposeOrder(right.purpose);
};

const choicePairKey = (choice: StudioPrepareGenerationChoiceV2): string =>
  `${studioGenerationTargetKey(choice.target)}\0${choice.purpose}`;

const validateChoiceOrderAndIdentity = (
  request: StudioPrepareSubmissionRequestV2,
  locations: ReadonlyMap<string, ActiveFilmShotLocation>
): void => {
  const combined = [...request.baseChoices, ...request.cascadeChoices];
  if (combined.length > STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST) fail('invalid_prepare_request');
  const pairKeys = new Set<string>();
  const shotIds = new Set<string>();
  for (const choice of combined) {
    const shotId = choiceShotId(choice);
    if (!locations.has(shotId)) fail('inactive_shot');
    const pairKey = choicePairKey(choice);
    if (pairKeys.has(pairKey)) fail('duplicate_shot_purpose');
    pairKeys.add(pairKey);
    shotIds.add(shotId);
    if (shotIds.size > STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST) fail('invalid_prepare_request');
  }
  for (const choices of [request.baseChoices, request.cascadeChoices]) {
    for (let index = 1; index < choices.length; index += 1) {
      if (comparePrepareChoices(choices[index - 1]!, choices[index]!, locations) >= 0) {
        fail('invalid_prepare_request');
      }
    }
  }
};

const segmentHeadIndex = (project: StudioProjectV2, location: ActiveFilmShotLocation): number => {
  const beat = ownValue(project.beats, location.beatId);
  if (beat === undefined) return fail('invalid_prepare_request');
  for (let shotIndex = location.shotIndex; shotIndex > 0; shotIndex -= 1) {
    const shotId = beat.shotOrder[shotIndex];
    const shot = shotId === undefined ? undefined : ownValue(project.shots, shotId);
    if (shot === undefined) return fail('invalid_prepare_request');
    if (shot.chainBreak === 'hard_cut') return shotIndex;
  }
  return 0;
};

const validateIndependentBaseAnchors = (
  project: StudioProjectV2,
  baseChoices: readonly StudioPrepareGenerationChoiceV2[],
  locations: ReadonlyMap<string, ActiveFilmShotLocation>
): void => {
  const segmentKeys = new Set<string>();
  for (const choice of baseChoices) {
    const location = locations.get(choiceShotId(choice));
    if (location === undefined) return fail('inactive_shot');
    const headIndex = segmentHeadIndex(project, location);
    if (choice.purpose === 'seed_still' && location.shotIndex !== headIndex) fail('invalid_prepare_request');
    const segmentKey = `${location.beatId}\0${headIndex}`;
    if (segmentKeys.has(segmentKey)) fail('invalid_prepare_request');
    segmentKeys.add(segmentKey);
  }
};

const deriveExpectedCascadePairs = (
  project: StudioProjectV2,
  baseChoices: readonly StudioPrepareGenerationChoiceV2[],
  locations: ReadonlyMap<string, ActiveFilmShotLocation>
): { shotId: string; purpose: 'video_take' }[] => {
  const expected = new Map<string, { shotId: string; purpose: 'video_take' }>();
  for (const baseChoice of baseChoices) {
    const baseShotId = choiceShotId(baseChoice);
    const location = locations.get(baseShotId);
    const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
    const shot = ownValue(project.shots, baseShotId);
    if (location === undefined || beat === undefined || shot === undefined) fail('inactive_shot');

    const firstCascadeIndex = baseChoice.purpose === 'seed_still' ? location.shotIndex : location.shotIndex + 1;
    for (let shotIndex = firstCascadeIndex; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      const downstreamId = beat.shotOrder[shotIndex]!;
      const downstream = ownValue(project.shots, downstreamId);
      if (downstream === undefined) fail('invalid_prepare_request');
      if (shotIndex > location.shotIndex && downstream.chainBreak === 'hard_cut') break;
      if (hasInFlightItem(project, { kind: 'shot', shotId: downstreamId }, 'video_take')) break;
      const pairKey = `${downstreamId}\0video_take`;
      expected.set(pairKey, { shotId: downstreamId, purpose: 'video_take' });
    }
  }
  return [...expected.values()].toSorted((left, right) =>
    comparePrepareChoices(
      { target: { kind: 'shot', shotId: left.shotId }, purpose: left.purpose },
      { target: { kind: 'shot', shotId: right.shotId }, purpose: right.purpose },
      locations
    )
  );
};

const canonicalizeExactCascade = (
  project: StudioProjectV2,
  request: StudioPrepareSubmissionRequestV2,
  locations: ReadonlyMap<string, ActiveFilmShotLocation>
): StudioPrepareSubmissionRequestV2 => {
  const expected = deriveExpectedCascadePairs(project, request.baseChoices, locations);
  if (request.cascadeChoices.length === 0) {
    if (expected.length === 0) return request;
    return {
      ...request,
      cascadeChoices: expected.map<StudioPrepareGenerationChoiceV2>(({ shotId, purpose }) => ({
        target: { kind: 'shot', shotId },
        purpose,
      })),
    };
  }
  if (expected.length !== request.cascadeChoices.length) fail('invalid_prepare_request');
  for (let index = 0; index < expected.length; index += 1) {
    const choice = request.cascadeChoices[index]!;
    const expectedChoice = expected[index]!;
    if (choiceShotId(choice) !== expectedChoice.shotId || choice.purpose !== expectedChoice.purpose) {
      fail('invalid_prepare_request');
    }
  }
  return request;
};

const isProjectReferenceAsset = (project: StudioProjectV2, assetId: string): boolean =>
  ownValue(project.assets, assetId)?.projectReferenceId !== null;

const eligibleSeedAsset = (project: StudioProjectV2, shotId: string, assetId: string): StudioAssetV2 | null => {
  const shot = ownValue(project.shots, shotId);
  const asset = ownValue(project.assets, assetId);
  return shot !== undefined &&
    asset?.id === assetId &&
    asset.projectId === project.id &&
    asset.shotId === shotId &&
    asset.mediaKind === 'image' &&
    (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports') &&
    !isProjectReferenceAsset(project, assetId) &&
    shot.assetIds.includes(assetId)
    ? asset
    : null;
};

const eligibleExplicitSeedAsset = (project: StudioProjectV2, shotId: string, assetId: string): StudioAssetV2 | null => {
  const ordinary = eligibleSeedAsset(project, shotId, assetId);
  if (ordinary !== null) return ordinary;
  const shot = ownValue(project.shots, shotId);
  return shot === undefined ? null : (resolveStudioCanonicalBoardAssetV2(project, shot, assetId)?.asset ?? null);
};

const effectiveSeedAsset = (project: StudioProjectV2, shotId: string): StudioAssetV2 | null => {
  const shot = ownValue(project.shots, shotId);
  if (shot === undefined) return null;
  if (shot.seedStillId !== null && !shot.dismissedSeedStillIds.includes(shot.seedStillId)) {
    return eligibleExplicitSeedAsset(project, shot.id, shot.seedStillId);
  }
  const candidates = shot.assetIds.flatMap((assetId) => {
    if (shot.dismissedSeedStillIds.includes(assetId)) return [];
    const asset = eligibleSeedAsset(project, shot.id, assetId);
    return asset === null ? [] : [asset];
  });
  candidates.sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id < right.id
        ? 1
        : left.id > right.id
          ? -1
          : 0
      : left.createdAt < right.createdAt
        ? 1
        : -1
  );
  return candidates[0] ?? null;
};

const selectedVideoAsset = (project: StudioProjectV2, shotId: string): StudioAssetV2 | null => {
  const shot = ownValue(project.shots, shotId);
  if (shot?.videoAssetId === null || shot === undefined) return null;
  const asset = ownValue(project.assets, shot.videoAssetId);
  return asset?.mediaKind === 'video' && isCanonicalStudioGeneratedTakeV2(asset, project.id, shot) ? asset : null;
};

const hasInFlightItem = (
  project: StudioSubmissionQuoteEstimateInputV2['project'],
  target: StudioGenerationTargetV2,
  purpose: StudioQuotedGeneration['purpose']
): boolean =>
  Object.values(project.jobs).some(
    (job) =>
      studioGenerationTargetKey(job.target) === studioGenerationTargetKey(target) &&
      job.purpose === purpose &&
      NONTERMINAL_STATUSES.has(job.status)
  );

const hasInFlightProjectReferenceItem = (
  project: StudioSubmissionQuoteEstimateInputV2['project'],
  projectReferenceId: string
): boolean => hasInFlightItem(project, { kind: 'reference', referenceId: projectReferenceId }, 'reference_image');

const requireShootingScript = (shot: Pick<StudioShot, 'shootingScript'>): void => {
  if (shot.shootingScript.trim().length === 0) fail('missing_shooting_script');
};

const requireShootingScripts = (project: StudioProjectV2, shotIds: Iterable<string>): void => {
  for (const shotId of shotIds) {
    const shot = ownValue(project.shots, shotId);
    if (shot !== undefined) requireShootingScript(shot);
  }
};

const affectedSegmentShotIds = (
  project: StudioProjectV2,
  shotId: string,
  locations: ReadonlyMap<string, ActiveFilmShotLocation>
): string[] => {
  const location = locations.get(shotId);
  const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
  if (location === undefined || beat === undefined) return [];
  const result: string[] = [];
  for (let shotIndex = location.shotIndex; shotIndex < beat.shotOrder.length; shotIndex += 1) {
    const affectedShotId = beat.shotOrder[shotIndex]!;
    const affectedShot = ownValue(project.shots, affectedShotId);
    if (affectedShot === undefined) return [];
    if (shotIndex > location.shotIndex && affectedShot.chainBreak === 'hard_cut') break;
    result.push(affectedShotId);
  }
  return result;
};

const createChoiceTemplate = (
  project: StudioProjectV2,
  choice: StudioPrepareGenerationChoiceV2,
  locations: ReadonlyMap<string, ActiveFilmShotLocation>,
  resolveRoute: StudioCompositionRouteLookupV2
): StudioGenerationRequestTemplate => {
  const shotId = choiceShotId(choice);
  const location = locations.get(shotId);
  const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
  const shot = ownValue(project.shots, shotId);
  if (location === undefined || beat === undefined || shot === undefined) return fail('inactive_shot');
  requireShootingScript(shot);
  const routeId = choice.purpose === 'video_take' ? project.videoRouteId : project.imageRouteId;
  if (routeId === null) return fail('missing_route');
  const authority = resolveRoute(routeId, choice.purpose);
  const resolution =
    choice.purpose === 'video_take'
      ? { ok: true as const, referenceInputs: [] }
      : resolveStudioReferenceBindingV2({
          project,
          shotId,
          maxConditioningImages: authority.maxConditioningImages,
        });
  if (resolution.ok === false) {
    return fail('invalid_reference', {
      kind: 'reference_binding',
      shotId: resolution.shotId,
      reason: resolution.reason,
    });
  }
  try {
    const source = {
      kind: 'shot' as const,
      beatId: beat.id,
      story: beat.story,
      shotId: shot.id,
      shootingScript: shot.shootingScript,
    };
    const composition = composeStudioGenerationV2({
      projectRevision: project.revision,
      brief: project.brief,
      rules: project.rules,
      source,
      purpose: choice.purpose,
      referenceInputs: resolution.referenceInputs,
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      route: authority.provider,
      boardStyle: null,
      instructionProfile: deriveStudioInstructionProfileV2(authority.provider, choice.purpose, source),
    });
    return createStudioGenerationRequestTemplate({
      composition,
      durationSeconds: shot.durationSeconds,
    });
  } catch {
    return fail('invalid_prepare_request');
  }
};

const currentConditioningInput = (
  project: StudioProjectV2,
  shotId: string,
  locations: ReadonlyMap<string, ActiveFilmShotLocation>
): StudioConditioningInputSnapshot | null => {
  const location = locations.get(shotId);
  const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
  const shot = ownValue(project.shots, shotId);
  if (location === undefined || beat === undefined || shot === undefined) return null;
  if (location.shotIndex === 0 || shot.chainBreak === 'hard_cut') {
    const seed = effectiveSeedAsset(project, shot.id);
    return seed === null ? null : { kind: 'seed_still', assetId: seed.id };
  }
  const predecessorId = beat.shotOrder[location.shotIndex - 1];
  if (predecessorId === undefined) return null;
  const predecessor = ownValue(project.shots, predecessorId);
  const take = selectedVideoAsset(project, predecessorId);
  if (predecessor === undefined || take?.durationSeconds === undefined) return null;
  const endpointSeconds = take.durationSeconds - (predecessor.trimOutSeconds ?? 0);
  if (!Number.isFinite(endpointSeconds) || endpointSeconds <= 0) return null;
  let extractionId: string;
  try {
    extractionId = createStudioFrameExtractionId({ shotId: predecessor.id, videoAssetId: take.id, endpointSeconds });
  } catch {
    return null;
  }
  const extraction = ownValue(project.frameExtractions, extractionId);
  const frameAsset =
    extraction?.frameAssetId === null ? undefined : ownValue(project.assets, extraction?.frameAssetId ?? '');
  return extraction?.id === extractionId &&
    extraction.status === 'ready' &&
    extraction.shotId === predecessor.id &&
    extraction.videoAssetId === take.id &&
    Object.is(extraction.endpointSeconds, endpointSeconds) &&
    extraction.frameAssetId !== null &&
    frameAsset?.id === extraction.frameAssetId &&
    frameAsset.projectId === project.id &&
    frameAsset.shotId === predecessor.id &&
    frameAsset.mediaKind === 'image' &&
    frameAsset.managedAsset.collection === 'conditioningFrames' &&
    predecessor.assetIds.includes(frameAsset.id)
    ? {
        kind: 'predecessor_frame',
        predecessorShotId: predecessor.id,
        takeAssetId: take.id,
        frameAssetId: frameAsset.id,
        endpointSeconds,
      }
    : null;
};

/**
 * Performs every ordinary-prepare check that depends only on persisted project authority. This
 * runs before provider discovery so malformed intent, missing base routes, and missing reviewed
 * first frames cannot observe live adapter work.
 */
export const preflightStudioSubmissionPreparationV2 = (input: {
  project: StudioProjectV2;
  request: unknown;
}): StudioPrepareSubmissionRequestV2 => {
  let request = parsePrepareRequest(input.request, input.project);
  const locations = activeFilmShotLocations(input.project);
  if (request.boardPromotion !== undefined) {
    requireShootingScripts(
      input.project,
      affectedSegmentShotIds(input.project, request.boardPromotion.shotId, locations).filter(
        (shotId) => selectedVideoAsset(input.project, shotId) !== null
      )
    );
    return request;
  }
  if (request.continuityChange !== undefined) {
    requireShootingScripts(
      input.project,
      affectedSegmentShotIds(input.project, request.continuityChange.shotId, locations)
    );
    return request;
  }
  validateChoiceOrderAndIdentity(request, locations);
  const choices = [...request.baseChoices, ...request.cascadeChoices];
  const boardChoiceCount = choices.filter((choice) => choice.purpose === 'board_still').length;
  if (boardChoiceCount > 0) {
    if (boardChoiceCount !== choices.length || request.cascadeChoices.length > 0 || input.project.boardStyle === null) {
      return fail('invalid_prepare_request');
    }
    requireShootingScripts(input.project, choices.map(choiceShotId));
    if (input.project.imageRouteId === null || !SAFE_ID.test(input.project.imageRouteId)) return fail('missing_route');
    return request;
  }
  validateIndependentBaseAnchors(input.project, request.baseChoices, locations);
  request = canonicalizeExactCascade(input.project, request, locations);
  validateChoiceOrderAndIdentity(request, locations);
  requireShootingScripts(input.project, [...request.baseChoices, ...request.cascadeChoices].map(choiceShotId));

  const earlierPairs = new Set<string>();
  for (const choice of [...request.baseChoices, ...request.cascadeChoices]) {
    const shotId = choiceShotId(choice);
    const location = locations.get(shotId);
    const beat = location === undefined ? undefined : ownValue(input.project.beats, location.beatId);
    if (location === undefined || beat === undefined) return fail('inactive_shot');
    if (request.baseChoices.includes(choice)) {
      const routeId = choice.purpose === 'seed_still' ? input.project.imageRouteId : input.project.videoRouteId;
      if (routeId === null || !SAFE_ID.test(routeId)) return fail('missing_route');
      if (choice.purpose === 'video_take') {
        const predecessorId = location.shotIndex === 0 ? undefined : beat.shotOrder[location.shotIndex - 1];
        const hasAuthorizedSeed = earlierPairs.has(`shot:${shotId}\0seed_still`);
        const hasAuthorizedPredecessor =
          predecessorId !== undefined && earlierPairs.has(`shot:${predecessorId}\0video_take`);
        if (
          !hasAuthorizedSeed &&
          !hasAuthorizedPredecessor &&
          currentConditioningInput(input.project, shotId, locations) === null
        ) {
          return fail('missing_conditioning');
        }
      }
    }
    earlierPairs.add(choicePairKey(choice));
  }
  return request;
};

const deriveUnpricedItems = (
  project: StudioProjectV2,
  choices: readonly StudioPrepareGenerationChoiceV2[],
  locations: ReadonlyMap<string, ActiveFilmShotLocation>,
  resolveRoute: StudioCompositionRouteLookupV2,
  initialDependencies: ReadonlyMap<string, StudioAuthorizedConditioningDependency> = new Map()
): StudioUnpricedQuotedGenerationV2[] => {
  const earlierItemIds = new Map<string, string>();
  const result: StudioUnpricedQuotedGenerationV2[] = [];
  for (const choice of choices) {
    if (choice.purpose === 'board_still') return fail('invalid_prepare_request');
    const shotId = choiceShotId(choice);
    const routeId = choice.purpose === 'seed_still' ? project.imageRouteId : project.videoRouteId;
    if (routeId === null || !SAFE_ID.test(routeId)) fail('missing_route');
    const template = createChoiceTemplate(project, choice, locations, resolveRoute);
    let requestPlan: StudioGenerationRequestPlan;
    if (choice.purpose === 'seed_still') {
      requestPlan = createStudioResolvedGenerationRequestPlan({
        purpose: 'seed_still',
        template,
        conditioningInput: null,
      });
    } else {
      const initialDependency = initialDependencies.get(shotId);
      const sameShotSeedId = earlierItemIds.get(`shot:${shotId}\0seed_still`);
      const location = locations.get(shotId);
      const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
      if (location === undefined || beat === undefined) return fail('inactive_shot');
      const predecessorId = location.shotIndex === 0 ? undefined : beat.shotOrder[location.shotIndex - 1];
      const predecessorItemId =
        predecessorId === undefined ? undefined : earlierItemIds.get(`shot:${predecessorId}\0video_take`);
      if (initialDependency !== undefined) {
        requestPlan = createStudioDeferredGenerationRequestPlan({ template, dependency: initialDependency });
      } else if (sameShotSeedId !== undefined) {
        if (location.shotIndex !== 0 && ownValue(project.shots, shotId)?.chainBreak !== 'hard_cut') {
          return fail('invalid_dependency');
        }
        requestPlan = createStudioDeferredGenerationRequestPlan({
          template,
          dependency: { kind: 'authorized_seed', upstreamItemId: sameShotSeedId, shotId },
        });
      } else if (predecessorItemId !== undefined) {
        requestPlan = createStudioDeferredGenerationRequestPlan({
          template,
          dependency: {
            kind: 'authorized_predecessor',
            upstreamItemId: predecessorItemId,
            predecessorShotId: predecessorId!,
          },
        });
      } else {
        const conditioningInput = currentConditioningInput(project, shotId, locations);
        if (conditioningInput === null) return fail('missing_conditioning');
        requestPlan = createStudioResolvedGenerationRequestPlan({
          purpose: 'video_take',
          template,
          conditioningInput,
        });
      }
    }
    result.push({
      target: { kind: 'shot', shotId },
      purpose: choice.purpose,
      routeId,
      generationCount: 1,
      requestPlan,
    });
    earlierItemIds.set(
      choicePairKey(choice),
      createStudioQuotedGenerationId({
        projectId: project.id,
        projectRevision: project.revision,
        target: { kind: 'shot', shotId },
        purpose: choice.purpose,
      })
    );
  }
  return result;
};

const deriveBoardUnpricedItems = (
  project: StudioProjectV2,
  choices: readonly StudioPrepareGenerationChoiceV2[],
  locations: ReadonlyMap<string, ActiveFilmShotLocation>,
  resolveRoute: StudioCompositionRouteLookupV2
): StudioUnpricedQuotedGenerationV2[] => {
  const routeId = project.imageRouteId;
  if (routeId === null || !SAFE_ID.test(routeId)) fail('missing_route');
  if (project.boardStyle === null) fail('invalid_prepare_request');
  for (const choice of choices) {
    const shotId = choiceShotId(choice);
    const location = locations.get(shotId);
    const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
    const shot = ownValue(project.shots, shotId);
    if (choice.purpose !== 'board_still' || location === undefined || beat === undefined || shot === undefined) {
      fail(location === undefined || shot === undefined ? 'inactive_shot' : 'invalid_prepare_request');
    }
    requireShootingScript(shot);
  }
  const authority = resolveRoute(routeId, 'board_still');
  return choices.map((choice) => {
    const shotId = choiceShotId(choice);
    const location = locations.get(shotId);
    const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
    const shot = ownValue(project.shots, shotId);
    if (choice.purpose !== 'board_still' || location === undefined || beat === undefined || shot === undefined) {
      return fail(location === undefined || shot === undefined ? 'inactive_shot' : 'invalid_prepare_request');
    }
    const resolution = resolveStudioReferenceBindingV2({
      project,
      shotId,
      maxConditioningImages: authority.maxConditioningImages,
    });
    if (resolution.ok === false) {
      return fail('invalid_reference', {
        kind: 'reference_binding',
        shotId: resolution.shotId,
        reason: resolution.reason,
      });
    }
    let requestPlan: StudioGenerationRequestPlan;
    try {
      const source = {
        kind: 'shot' as const,
        beatId: beat.id,
        story: beat.story,
        shotId: shot.id,
        shootingScript: shot.shootingScript,
      };
      requestPlan = createStudioBoardGenerationRequestPlan({
        composition: composeStudioGenerationV2({
          projectRevision: project.revision,
          brief: project.brief,
          rules: project.rules,
          source,
          purpose: 'board_still',
          referenceInputs: resolution.referenceInputs,
          aspectRatio: project.aspectRatio,
          resolution: project.resolution,
          route: authority.provider,
          boardStyle: project.boardStyle,
          instructionProfile: deriveStudioInstructionProfileV2(authority.provider, 'board_still', source),
        }),
      });
    } catch {
      return fail('invalid_prepare_request');
    }
    return {
      target: { kind: 'shot', shotId },
      purpose: 'board_still',
      routeId,
      generationCount: 1,
      requestPlan,
    };
  });
};

const deriveContinuitySubmissionQuoteGraphV2 = (
  project: StudioProjectV2,
  request: StudioPrepareSubmissionRequestV2,
  locations: ReadonlyMap<string, ActiveFilmShotLocation>,
  resolveRoute: StudioCompositionRouteLookupV2
): StudioDerivedSubmissionQuoteGraphV2 => {
  const change = request.continuityChange;
  if (change === undefined) return fail('invalid_prepare_request');
  const location = locations.get(change.shotId);
  const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
  const shot = ownValue(project.shots, change.shotId);
  if (
    location === undefined ||
    beat === undefined ||
    shot === undefined ||
    location.shotIndex === 0 ||
    shot.chainBreak !== (change.hardCut ? 'none' : 'hard_cut')
  ) {
    return fail('invalid_prepare_request');
  }

  const affectedShotIds: string[] = [];
  for (let shotIndex = location.shotIndex; shotIndex < beat.shotOrder.length; shotIndex += 1) {
    const affectedShotId = beat.shotOrder[shotIndex]!;
    const affectedShot = ownValue(project.shots, affectedShotId);
    if (affectedShot === undefined) return fail('invalid_prepare_request');
    if (shotIndex > location.shotIndex && affectedShot.chainBreak === 'hard_cut') break;
    affectedShotIds.push(affectedShotId);
  }
  if (
    affectedShotIds.length === 0 ||
    affectedShotIds.some((shotId) => hasInFlightItem(project, { kind: 'shot', shotId }, 'video_take')) ||
    hasInFlightItem(project, { kind: 'shot', shotId: change.shotId }, 'seed_still')
  ) {
    return fail('in_flight');
  }

  const reusableSeed = change.hardCut ? effectiveSeedAsset(project, change.shotId) : null;
  const requiresSeedGeneration = change.hardCut && reusableSeed === null;
  if (change.requiresSeedGeneration !== requiresSeedGeneration) return fail('invalid_prepare_request');

  const choices: StudioPrepareGenerationChoiceV2[] = [];
  if (requiresSeedGeneration) {
    choices.push({
      target: { kind: 'shot', shotId: change.shotId },
      purpose: 'seed_still',
    });
  }
  choices.push(
    ...affectedShotIds.map<StudioPrepareGenerationChoiceV2>((shotId) => ({
      target: { kind: 'shot', shotId },
      purpose: 'video_take',
    }))
  );

  const candidate = structuredClone(project);
  candidate.shots[change.shotId]!.chainBreak = change.hardCut ? 'hard_cut' : 'none';
  const initialDependencies = new Map<string, StudioAuthorizedConditioningDependency>();
  if (!change.hardCut) {
    candidate.shots[change.shotId]!.seedStillId = null;
    const predecessorShotId = beat.shotOrder[location.shotIndex - 1];
    const predecessor = predecessorShotId === undefined ? undefined : ownValue(project.shots, predecessorShotId);
    const take = predecessorShotId === undefined ? null : selectedVideoAsset(project, predecessorShotId);
    const endpointSeconds =
      predecessor === undefined || take?.durationSeconds === undefined
        ? Number.NaN
        : take.durationSeconds - (predecessor.trimOutSeconds ?? 0);
    if (
      predecessor === undefined ||
      take === null ||
      !Number.isFinite(endpointSeconds) ||
      endpointSeconds <= 0 ||
      Object.is(endpointSeconds, -0)
    ) {
      return fail('missing_conditioning');
    }
    initialDependencies.set(change.shotId, {
      kind: 'existing_predecessor',
      predecessorShotId: predecessor.id,
      takeAssetId: take.id,
      endpointSeconds,
    });
  }

  return {
    request,
    baseItems: deriveUnpricedItems(candidate, choices, locations, resolveRoute, initialDependencies),
    cascadeItems: null,
  };
};

const deriveBoardPromotionSubmissionQuoteGraphV2 = (
  project: StudioProjectV2,
  request: StudioPrepareSubmissionRequestV2,
  locations: ReadonlyMap<string, ActiveFilmShotLocation>,
  resolveRoute: StudioCompositionRouteLookupV2
): StudioDerivedSubmissionQuoteGraphV2 => {
  const promotion = request.boardPromotion;
  if (promotion === undefined) return fail('invalid_prepare_request');
  const authority = resolveStudioCurrentBoardPanelAuthorityV2(project, promotion.shotId, promotion.boardAssetId);
  if (
    authority === null ||
    (authority.shotIndex !== 0 && authority.shot.chainBreak !== 'hard_cut') ||
    authority.shot.dismissedSeedStillIds.includes(promotion.boardAssetId) ||
    authority.shot.seedStillId === promotion.boardAssetId
  ) {
    return fail('invalid_prepare_request');
  }

  const segmentShotIds: string[] = [];
  for (let shotIndex = authority.shotIndex; shotIndex < authority.beat.shotOrder.length; shotIndex += 1) {
    const shotId = authority.beat.shotOrder[shotIndex]!;
    const shot = ownValue(project.shots, shotId);
    if (shot === undefined) return fail('invalid_prepare_request');
    if (shotIndex > authority.shotIndex && shot.chainBreak === 'hard_cut') break;
    segmentShotIds.push(shotId);
  }
  if (segmentShotIds.length === 0 || deriveStudioInboundShotReferencesV2(project, segmentShotIds).length > 0) {
    return fail('in_flight');
  }
  const selectedShotIds = segmentShotIds.filter((shotId) => selectedVideoAsset(project, shotId) !== null);
  if (selectedShotIds.length === 0) return fail('invalid_prepare_request');

  const candidate = structuredClone(project);
  const candidateHead = ownValue(candidate.shots, promotion.shotId);
  if (candidateHead === undefined) return fail('invalid_prepare_request');
  candidateHead.seedStillId = promotion.boardAssetId;
  const choices = selectedShotIds.map<StudioPrepareGenerationChoiceV2>((shotId) => ({
    target: { kind: 'shot', shotId },
    purpose: 'video_take',
  }));
  return {
    request,
    baseItems: deriveUnpricedItems(candidate, choices, locations, resolveRoute),
    cascadeItems: null,
  };
};

export type StudioSubmissionQuoteCoreDerivationInputV2 = {
  project: StudioProjectV2;
  request: unknown;
  rateCard: StudioRateCardV2;
  resolveRoute: StudioCompositionRouteLookupV2;
};

export type StudioSubmissionQuoteGraphDerivationInputV2 = Omit<StudioSubmissionQuoteCoreDerivationInputV2, 'rateCard'>;

export type StudioDerivedSubmissionQuoteGraphV2 = {
  request: StudioPreparedSubmissionRequestV2;
  baseItems: StudioUnpricedQuotedGenerationV2[];
  cascadeItems: StudioUnpricedQuotedGenerationV2[] | null;
  /** Main-only correlation for a Director handoff; never accepted in the renderer request. */
  originReferenceHandoffId?: string | null;
};

export type StudioDerivedSubmissionQuoteCoresV2 = {
  request: StudioPreparedSubmissionRequestV2;
  baseOnly: StudioSubmissionQuoteCore;
  withCascade: StudioSubmissionQuoteCore | null;
};

/** Builds paid candidate jobs for exact project references without exposing an alternate generic prepare path. */
export const deriveStudioProjectReferenceSubmissionQuoteGraphV2 = (input: {
  project: StudioProjectV2;
  request: StudioPrepareProjectReferencesRequestV2;
  resolveRoute: StudioCompositionRouteLookupV2;
  originReferenceHandoffId?: string | null;
}): StudioDerivedSubmissionQuoteGraphV2 => {
  const { project, request } = input;
  if (
    input.originReferenceHandoffId !== undefined &&
    input.originReferenceHandoffId !== null &&
    !SAFE_ID.test(input.originReferenceHandoffId)
  ) {
    return fail('invalid_prepare_request');
  }
  preflightStudioProjectReferencePreparationV2({ project, request });
  const route = input.resolveRoute(project.imageRouteId!, 'reference_image');
  const baseItems = request.referenceIds.map<StudioUnpricedQuotedGenerationV2>((referenceId) => {
    const reference = ownValue(project.references, referenceId)!;
    let requestPlan: StudioGenerationRequestPlan;
    try {
      requestPlan = createStudioReferenceGenerationRequestPlan({
        project,
        reference,
        route: route.provider,
      });
    } catch {
      return fail('invalid_prepare_request');
    }
    return {
      target: { kind: 'reference', referenceId: reference.id },
      purpose: 'reference_image',
      routeId: project.imageRouteId!,
      // The upper bound reserves one stochastic retry if the provider returns a variation grid.
      // Only submitted attempts receive receipts, so a clean first result still spends the lower line.
      generationCount: 2,
      requestPlan,
    };
  });
  return {
    request: structuredClone(request),
    baseItems,
    cascadeItems: null,
    ...(input.originReferenceHandoffId === undefined
      ? {}
      : { originReferenceHandoffId: input.originReferenceHandoffId }),
  };
};

/** Rejects reference intent and ordering errors before provider discovery or pricing. */
export const preflightStudioProjectReferencePreparationV2 = (input: {
  project: StudioProjectV2;
  request: StudioPrepareProjectReferencesRequestV2;
}): void => {
  const { project, request } = input;
  if (
    !isExactOwnDataRecord(request, new Set(['projectId', 'expectedRevision', 'referenceIds'])) ||
    request.projectId !== project.id ||
    request.expectedRevision !== project.revision ||
    !isExactDenseOwnDataArray(request.referenceIds) ||
    request.referenceIds.length < 1 ||
    request.referenceIds.length > STUDIO_MAX_PROJECT_REFERENCES ||
    request.referenceIds.some((referenceId) => !SAFE_ID.test(referenceId)) ||
    new Set(request.referenceIds).size !== request.referenceIds.length
  ) {
    return fail('invalid_prepare_request');
  }
  if (project.imageRouteId === null || !SAFE_ID.test(project.imageRouteId)) return fail('missing_route');
  let previousReferencePosition = -1;
  for (const referenceId of request.referenceIds) {
    const position = project.referenceOrder.indexOf(referenceId);
    if (position < 0 || position <= previousReferencePosition) return fail('invalid_reference');
    previousReferencePosition = position;
  }
  const charactersApproved = project.referenceOrder
    .map((referenceId) => ownValue(project.references, referenceId))
    .filter((reference) => reference?.kind === 'character')
    .every((reference) => reference?.approvedAssetId !== null);
  for (const referenceId of request.referenceIds) {
    const reference = ownValue(project.references, referenceId);
    if (reference === undefined || (reference.kind === 'background' && !charactersApproved)) {
      return fail('invalid_reference');
    }
    if (hasInFlightProjectReferenceItem(project, reference.id)) return fail('in_flight');
  }
};

/** Validates the exact request graph before any live route or rate dependency is consulted. */
export const deriveStudioSubmissionQuoteGraphV2 = (
  input: StudioSubmissionQuoteGraphDerivationInputV2
): StudioDerivedSubmissionQuoteGraphV2 => {
  let request = preflightStudioSubmissionPreparationV2({ project: input.project, request: input.request });
  const locations = activeFilmShotLocations(input.project);
  if (request.boardPromotion !== undefined) {
    return deriveBoardPromotionSubmissionQuoteGraphV2(input.project, request, locations, input.resolveRoute);
  }
  if (request.continuityChange !== undefined) {
    return deriveContinuitySubmissionQuoteGraphV2(input.project, request, locations, input.resolveRoute);
  }
  validateChoiceOrderAndIdentity(request, locations);
  const choices = [...request.baseChoices, ...request.cascadeChoices];
  const boardChoiceCount = choices.filter((choice) => choice.purpose === 'board_still').length;
  if (boardChoiceCount > 0) {
    if (boardChoiceCount !== choices.length || request.cascadeChoices.length > 0) {
      return fail('invalid_prepare_request');
    }
    return {
      request,
      baseItems: deriveBoardUnpricedItems(input.project, request.baseChoices, locations, input.resolveRoute),
      cascadeItems: null,
    };
  }
  validateIndependentBaseAnchors(input.project, request.baseChoices, locations);
  request = canonicalizeExactCascade(input.project, request, locations);
  validateChoiceOrderAndIdentity(request, locations);

  const baseItems = deriveUnpricedItems(input.project, request.baseChoices, locations, input.resolveRoute);
  let cascadeItems: StudioUnpricedQuotedGenerationV2[] | null = null;
  if (request.cascadeChoices.length > 0) {
    try {
      const combinedItems = deriveUnpricedItems(
        input.project,
        [...request.baseChoices, ...request.cascadeChoices],
        locations,
        input.resolveRoute
      );
      cascadeItems = combinedItems.slice(request.baseChoices.length);
    } catch (error) {
      if (!(error instanceof StudioPricingErrorV2) || error.code !== 'missing_route') throw error;
    }
  }
  return { request, baseItems, cascadeItems };
};

/**
 * Canonicalizes every and only route entry priced by one option. This keeps a base digest stable
 * when an optional sibling route changes without weakening exact rate parity for the selected core.
 */
const scopedRateCard = (
  rateCard: StudioRateCardV2,
  items: readonly StudioUnpricedQuotedGenerationV2[]
): StudioRateCardV2 => {
  const entries = new Map<string, StudioRateCardV2['entries'][number]>();
  for (const item of items) {
    try {
      entries.set(item.routeId, getStudioRateCardEntryV2(rateCard, item.routeId, item.purpose));
    } catch (error) {
      if (error instanceof StudioRateCardErrorV2) fail(error.code);
      throw error;
    }
  }
  return createStudioRateCardV2([...entries.values()]);
};

/** Prices an already validated graph, keeping the base authority independent from cascade availability. */
export const priceStudioSubmissionQuoteGraphV2 = (input: {
  project: StudioProjectV2;
  graph: StudioDerivedSubmissionQuoteGraphV2;
  rateCard: StudioRateCardV2;
}): StudioDerivedSubmissionQuoteCoresV2 => {
  const { graph } = input;
  const originReferenceHandoffId =
    graph.originReferenceHandoffId ??
    ('originReferenceHandoffId' in graph.request ? graph.request.originReferenceHandoffId : null);
  const baseOnly = createStudioSubmissionQuoteCoreV2({
    project: input.project,
    originReferenceHandoffId,
    rateCard: scopedRateCard(input.rateCard, graph.baseItems),
    baseItems: graph.baseItems,
    cascadeItems: [],
  });

  let withCascade: StudioSubmissionQuoteCore | null = null;
  if (graph.cascadeItems !== null && graph.cascadeItems.length > 0) {
    try {
      withCascade = createStudioSubmissionQuoteCoreV2({
        project: input.project,
        originReferenceHandoffId,
        rateCard: scopedRateCard(input.rateCard, [...graph.baseItems, ...graph.cascadeItems]),
        baseItems: graph.baseItems,
        cascadeItems: graph.cascadeItems,
      });
    } catch (error) {
      if (
        !(error instanceof StudioPricingErrorV2) ||
        (error.code !== 'rate_not_found' && error.code !== 'route_kind_mismatch')
      ) {
        throw error;
      }
    }
  }
  return { request: graph.request, baseOnly, withCascade };
};

/** Re-derives the complete active-film graph and both deterministic quote cores from one untrusted prepare request. */
export const deriveStudioSubmissionQuoteCoresV2 = (
  input: StudioSubmissionQuoteCoreDerivationInputV2
): StudioDerivedSubmissionQuoteCoresV2 => {
  const graph = deriveStudioSubmissionQuoteGraphV2(input);
  return priceStudioSubmissionQuoteGraphV2({ project: input.project, graph, rateCard: input.rateCard });
};

const validateDependency = (
  item: StudioQuotedGeneration,
  itemIndex: number,
  combined: readonly StudioQuotedGeneration[],
  locations: ReadonlyMap<string, ActiveShotLocation>,
  project: StudioSubmissionQuoteEstimateInputV2['project']
): void => {
  if (item.requestPlan.kind !== 'after_take_selection') return;
  if (item.target.kind !== 'shot') return fail('invalid_dependency');
  if (item.purpose !== 'video_take') return fail('invalid_dependency');
  const shotId = item.target.shotId;
  const dependency = item.requestPlan.dependency;
  const location = locations.get(shotId);
  if (location === undefined) fail('inactive_shot');

  if (dependency.kind === 'existing_predecessor') {
    const predecessor = locations.get(dependency.predecessorShotId);
    const shot = Object.hasOwn(project.shots, shotId) ? project.shots[shotId] : undefined;
    const fullProject = project as StudioProjectV2;
    if (
      !Object.hasOwn(project, 'assets') ||
      typeof fullProject.assets !== 'object' ||
      fullProject.assets === null ||
      !Object.hasOwn(project, 'bin') ||
      !Array.isArray(fullProject.bin)
    ) {
      return fail('invalid_dependency');
    }
    const take = selectedVideoAsset(fullProject, dependency.predecessorShotId);
    const predecessorShot = ownValue(fullProject.shots, dependency.predecessorShotId);
    const endpointSeconds =
      predecessorShot === undefined || take?.durationSeconds === undefined
        ? Number.NaN
        : take.durationSeconds - (predecessorShot.trimOutSeconds ?? 0);
    if (
      predecessor === undefined ||
      predecessor.beatId !== location.beatId ||
      predecessor.shotIndex + 1 !== location.shotIndex ||
      shot?.chainBreak !== 'hard_cut' ||
      take?.id !== dependency.takeAssetId ||
      !Object.is(endpointSeconds, dependency.endpointSeconds)
    ) {
      fail('invalid_dependency');
    }
    return;
  }

  const upstreamIndex = combined.findIndex((candidate) => candidate.id === dependency.upstreamItemId);
  if (upstreamIndex < 0 || upstreamIndex >= itemIndex) fail('invalid_dependency');
  const upstream = combined[upstreamIndex]!;

  if (dependency.kind === 'authorized_seed') {
    if (
      dependency.shotId !== shotId ||
      upstream.target.kind !== 'shot' ||
      upstream.target.shotId !== shotId ||
      upstream.purpose !== 'seed_still'
    ) {
      fail('invalid_dependency');
    }
    return;
  }

  const predecessor = locations.get(dependency.predecessorShotId);
  const shot = Object.hasOwn(project.shots, shotId) ? project.shots[shotId] : undefined;
  if (
    predecessor === undefined ||
    predecessor.beatId !== location.beatId ||
    predecessor.shotIndex + 1 !== location.shotIndex ||
    shot?.chainBreak !== 'none' ||
    upstream.target.kind !== 'shot' ||
    upstream.target.shotId !== dependency.predecessorShotId ||
    upstream.purpose !== 'video_take'
  ) {
    fail('invalid_dependency');
  }
};

/** Prices one already-derived active base/cascade graph against an immutable main-only rate card. */
export const createStudioSubmissionQuoteCoreV2 = (
  input: StudioSubmissionQuoteEstimateInputV2
): StudioSubmissionQuoteCore => {
  const { project } = input;
  if (
    !SAFE_ID.test(project.id) ||
    !Number.isSafeInteger(project.revision) ||
    project.revision < 1 ||
    (input.originReferenceHandoffId !== null && !SAFE_ID.test(input.originReferenceHandoffId)) ||
    !isDenseArray(input.baseItems) ||
    !isDenseArray(input.cascadeItems) ||
    input.baseItems.length === 0
  ) {
    return fail('invalid_quote');
  }
  const drafts = [...input.baseItems, ...input.cascadeItems];
  if (drafts.length > STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST) fail('invalid_quote');

  const locations = activeShotLocations(project);
  const pairKeys = new Set<string>();
  const shotIds = new Set<string>();
  const currencies = new Set<string>();
  const items: StudioQuotedGeneration[] = [];

  for (const draft of drafts) {
    if (draft === null || typeof draft !== 'object' || !isGenerationTarget(draft.target)) {
      return fail('invalid_quote');
    }
    let targetExists = false;
    if (draft.target.kind === 'shot') {
      targetExists = locations.has(draft.target.shotId);
      if (!SAFE_ID.test(draft.target.shotId) || draft.purpose === 'reference_image') {
        return fail(targetExists ? 'invalid_quote' : 'inactive_shot');
      }
    } else if (draft.target.kind === 'reference') {
      targetExists = ownValue(project.references, draft.target.referenceId)?.id === draft.target.referenceId;
      if (!SAFE_ID.test(draft.target.referenceId) || draft.purpose !== 'reference_image') {
        return fail('invalid_reference');
      }
    } else {
      return fail('invalid_quote');
    }
    if (
      !SAFE_ID.test(draft.routeId) ||
      (draft.purpose !== 'seed_still' &&
        draft.purpose !== 'board_still' &&
        draft.purpose !== 'video_take' &&
        draft.purpose !== 'reference_image') ||
      (draft.generationCount !== 1 && !(draft.generationCount === 2 && draft.purpose === 'reference_image'))
    ) {
      return fail('invalid_quote');
    }
    if (!targetExists) {
      return fail(draft.target.kind === 'shot' ? 'inactive_shot' : 'invalid_reference');
    }
    const pairKey = `${studioGenerationTargetKey(draft.target)}\0${draft.purpose}`;
    if (pairKeys.has(pairKey)) fail('duplicate_shot_purpose');
    pairKeys.add(pairKey);
    if (draft.target.kind === 'shot') {
      shotIds.add(draft.target.shotId);
      if (shotIds.size > STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST) fail('invalid_quote');
    }
    if (hasInFlightItem(project, draft.target, draft.purpose)) fail('in_flight');

    let rate;
    try {
      rate = getStudioRateCardEntryV2(input.rateCard, draft.routeId, draft.purpose);
    } catch (error) {
      if (error instanceof Error && 'code' in error) return fail(error.code as StudioRateCardErrorCodeV2);
      throw error;
    }
    currencies.add(rate.currency);
    if (currencies.size > 1) fail('mixed_currency');
    const requestPlan = cloneRequestPlan(draft.purpose, draft.requestPlan);
    const composition =
      requestPlan.kind === 'resolved' ? requestPlan.snapshot.composition : requestPlan.template.composition;
    const sourceMatchesTarget =
      draft.target.kind === 'shot'
        ? composition.inputs.source.kind === 'shot' && composition.inputs.source.shotId === draft.target.shotId
        : composition.inputs.source.kind === 'project_reference' &&
          composition.inputs.source.referenceId === draft.target.referenceId;
    if (
      !sourceMatchesTarget ||
      composition.inputs.purpose !== draft.purpose ||
      composition.inputs.projectRevision !== project.revision
    ) {
      fail('invalid_quote');
    }
    const item: StudioQuotedGeneration = {
      id: createStudioQuotedGenerationId({
        projectId: project.id,
        projectRevision: project.revision,
        target: draft.target,
        purpose: draft.purpose,
      }),
      target: structuredClone(draft.target),
      purpose: draft.purpose,
      routeId: draft.routeId,
      generationCount: draft.generationCount,
      requestPlan,
      rateUnit: rate.rateUnit,
      rateMinorUnits: rate.rateMinorUnits,
    };
    if (calculateStudioQuotedGenerationAmounts(item) === null) fail('unsafe_total');
    items.push(item);
  }

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    validateDependency(items[itemIndex]!, itemIndex, items, locations, project);
  }
  const totals = calculateStudioQuoteTotals(items);
  if (totals === null) fail('unsafe_total');
  const baseItems = items.slice(0, input.baseItems.length);
  const cascadeItems = items.slice(input.baseItems.length);
  if (
    !studioBoardAuthorizationScopeIsValidV2({
      originReferenceHandoffId: input.originReferenceHandoffId,
      baseItems,
      cascadeItems,
    })
  ) {
    fail('invalid_quote');
  }
  return {
    projectId: project.id,
    projectRevision: project.revision,
    originReferenceHandoffId: input.originReferenceHandoffId,
    rateCardDigest: input.rateCard.digest,
    currency: [...currencies][0]!,
    baseItems,
    cascadeItems,
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
  };
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

/** Compares only deterministic quote authority, excluding opaque ID/expiry metadata. */
export const studioSubmissionQuoteCoresEqual = (
  left: StudioSubmissionQuoteCore,
  right: StudioSubmissionQuoteCore
): boolean => canonicalJson(left) === canonicalJson(right);

/** Applies the exact persisted per-batch policy used again immediately before authorization. */
export const evaluateStudioBudgetV2 = (
  quote: Pick<StudioSubmissionQuoteCore, 'currency' | 'upperMinorUnits'>,
  policy: StudioSpendPolicy | null
): StudioBudgetEvaluationV2 => {
  if (!CURRENCY.test(quote.currency) || !Number.isSafeInteger(quote.upperMinorUnits) || quote.upperMinorUnits < 0) {
    return fail('invalid_quote');
  }
  if (policy === null) return { allowed: true, verdict: { kind: 'no_policy' } };
  if (
    !CURRENCY.test(policy.currency) ||
    !Number.isSafeInteger(policy.maxPerBatchMinorUnits) ||
    policy.maxPerBatchMinorUnits < 0
  ) {
    return fail('invalid_quote');
  }
  const facts = { policyCurrency: policy.currency, maxPerBatchMinorUnits: policy.maxPerBatchMinorUnits };
  if (policy.currency !== quote.currency) {
    return { allowed: false, reason: 'currency_mismatch', verdict: { kind: 'currency_mismatch', ...facts } };
  }
  if (quote.upperMinorUnits > policy.maxPerBatchMinorUnits) {
    return { allowed: false, reason: 'over_cap', verdict: { kind: 'over_cap', ...facts } };
  }
  return { allowed: true, verdict: { kind: 'within_cap', ...facts } };
};

export type StudioRendererRouteLookupV2 = (
  routeId: string,
  purpose: StudioQuotedGeneration['purpose']
) => StudioRendererMediaModelRef;

export type StudioRendererReferenceLookupV2 = (
  referenceId: string
) => { kind: StudioReferenceKindV2; label: string } | null;

const rendererDurationSeconds = (item: StudioQuotedGeneration): number | null => {
  const purpose = item.purpose;
  switch (purpose) {
    case 'seed_still':
    case 'board_still':
    case 'reference_image':
      return null;
    case 'video_take':
      return item.requestPlan.kind === 'resolved'
        ? item.requestPlan.snapshot.durationSeconds
        : item.requestPlan.template.durationSeconds;
    default: {
      const exhaustivePurpose: never = purpose;
      void exhaustivePurpose;
      return fail('invalid_quote');
    }
  }
};

const projectRendererItem = (
  item: StudioQuotedGeneration,
  resolveRoute: StudioRendererRouteLookupV2,
  resolveReference: StudioRendererReferenceLookupV2
): StudioRendererQuotedGenerationV2 => {
  const amounts = calculateStudioQuotedGenerationAmounts(item);
  if (amounts === null) return fail('unsafe_total');
  const route = resolveRoute(item.routeId, item.purpose);
  if (route.choiceId !== item.routeId) fail('invalid_quote');
  const durationSeconds = rendererDurationSeconds(item);
  const conditioningAssetId =
    item.requestPlan.kind === 'resolved' && item.requestPlan.snapshot.conditioningInput !== null
      ? item.requestPlan.snapshot.conditioningInput.kind === 'seed_still'
        ? item.requestPlan.snapshot.conditioningInput.assetId
        : item.requestPlan.snapshot.conditioningInput.frameAssetId
      : null;
  const composition =
    item.requestPlan.kind === 'resolved'
      ? item.requestPlan.snapshot.composition
      : item.requestPlan.template.composition;
  const rendererReference = (referenceId: string, expectedKind?: StudioReferenceKindV2) => {
    const semantic = resolveReference(referenceId);
    if (
      semantic === null ||
      (expectedKind !== undefined && semantic.kind !== expectedKind) ||
      semantic.label.length < 1 ||
      semantic.label.length > STUDIO_MAX_REFERENCE_LABEL_LENGTH ||
      semantic.label !== semantic.label.trim()
    ) {
      return fail('invalid_quote');
    }
    return { referenceId, label: semantic.label, kind: semantic.kind };
  };
  const referenceInputs = composition.inputs.referenceInputs.map((reference) => {
    const semantic = rendererReference(reference.referenceId, reference.kind);
    return {
      referenceId: reference.referenceId,
      label: semantic.label,
      kind: reference.kind,
      assetId: reference.assetId,
    };
  });
  return {
    target: structuredClone(item.target),
    referenceTarget: item.target.kind === 'reference' ? rendererReference(item.target.referenceId) : null,
    purpose: item.purpose,
    route: { ...route },
    generationCount: item.generationCount,
    durationSeconds,
    conditioningAssetId,
    oneGenerationMinorUnits: amounts.oneGenerationMinorUnits,
    requestedTotalMinorUnits: amounts.requestedTotalMinorUnits,
    composition: {
      prompt: composition.prompt,
      inputs: { ...structuredClone(composition.inputs), referenceInputs },
    },
  };
};

/** Projects one immutable internal quote without exposing item/rate/request authority. */
export const toStudioRendererSubmissionQuoteV2 = (
  quote: StudioSubmissionQuote,
  policy: StudioSpendPolicy | null,
  resolveRoute: StudioRendererRouteLookupV2,
  resolveReference: StudioRendererReferenceLookupV2 = () => null
): StudioRendererSubmissionQuoteV2 => ({
  id: quote.id,
  projectId: quote.projectId,
  projectRevision: quote.projectRevision,
  expiresAt: quote.expiresAt,
  currency: quote.currency,
  baseItems: quote.baseItems.map((item) => projectRendererItem(item, resolveRoute, resolveReference)),
  cascadeItems: quote.cascadeItems.map((item) => projectRendererItem(item, resolveRoute, resolveReference)),
  lowerMinorUnits: quote.lowerMinorUnits,
  upperMinorUnits: quote.upperMinorUnits,
  budget: evaluateStudioBudgetV2(quote, policy).verdict,
});
