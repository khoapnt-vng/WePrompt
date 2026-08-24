/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
  type StudioAssetV2,
  type StudioAuthorizedConditioningDependency,
  type StudioConditioningInputSnapshot,
  type StudioGenerationRequestPlan,
  type StudioGenerationRequestTemplate,
  type StudioPrepareGenerationChoiceV2,
  type StudioPrepareSubmissionRequestV2,
  type StudioProjectV2,
  type StudioQuotedGeneration,
  type StudioRendererBudgetVerdictV2,
  type StudioRendererMediaModelRef,
  type StudioRendererQuotedGenerationV2,
  type StudioRendererSubmissionQuoteV2,
  type StudioSpendPolicy,
  type StudioSubmissionQuote,
  type StudioSubmissionQuoteCore,
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
  createStudioDeferredGenerationRequestPlan,
  createStudioFrameExtractionId,
  createStudioGenerationRequestTemplate,
  createStudioQuotedGenerationId,
  createStudioResolvedGenerationRequestPlan,
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
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const NONTERMINAL_STATUSES = new Set([
  'waiting_for_conditioning',
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);

export type StudioUnpricedQuotedGenerationV2 = Omit<StudioQuotedGeneration, 'id' | 'rateUnit' | 'rateMinorUnits'>;

export type StudioSubmissionQuoteEstimateInputV2 = {
  project: Pick<StudioProjectV2, 'id' | 'revision' | 'beatOrder' | 'beats' | 'shots' | 'jobs'>;
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
  | 'missing_route'
  | 'missing_conditioning'
  | 'unsafe_total';

export class StudioPricingErrorV2 extends Error {
  readonly code: StudioPricingErrorCodeV2;

  constructor(code: StudioPricingErrorCodeV2) {
    super(code);
    this.name = 'StudioPricingErrorV2';
    this.code = code;
  }
}

export type StudioBudgetEvaluationV2 =
  | { allowed: true; verdict: Extract<StudioRendererBudgetVerdictV2, { kind: 'no_policy' | 'within_cap' }> }
  | {
      allowed: false;
      reason: 'over_cap' | 'currency_mismatch';
      verdict: Extract<StudioRendererBudgetVerdictV2, { kind: 'over_cap' | 'currency_mismatch' }>;
    };

const fail = (code: StudioPricingErrorCodeV2): never => {
  throw new StudioPricingErrorV2(code);
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
const PREPARE_CHOICE_KEYS = new Set(['shotId', 'purpose', 'referenceAssetId']);
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
  const { shotId, purpose, referenceAssetId } = value;
  const forbiddenReference = (purpose === 'board_still' || purpose === 'video_take') && referenceAssetId !== null;
  if (
    typeof shotId !== 'string' ||
    !SAFE_ID.test(shotId) ||
    (purpose !== 'seed_still' && purpose !== 'board_still' && purpose !== 'video_take') ||
    (referenceAssetId !== null && (typeof referenceAssetId !== 'string' || !SAFE_ID.test(referenceAssetId))) ||
    forbiddenReference
  ) {
    return fail(forbiddenReference ? 'invalid_reference' : 'invalid_prepare_request');
  }
  return {
    shotId: shotId as string,
    purpose: purpose as StudioPrepareGenerationChoiceV2['purpose'],
    referenceAssetId: referenceAssetId as string | null,
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
    (originReferenceHandoffId !== null &&
      (typeof originReferenceHandoffId !== 'string' || !SAFE_ID.test(originReferenceHandoffId))) ||
    !isExactDenseOwnDataArray(baseChoices) ||
    !isExactDenseOwnDataArray(cascadeChoices) ||
    (!continuityRequest && !boardPromotionRequest && baseChoices.length === 0) ||
    baseChoices.length + cascadeChoices.length > STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST
  ) {
    return fail('invalid_prepare_request');
  }
  const parsed = {
    projectId,
    expectedRevision,
    originReferenceHandoffId: originReferenceHandoffId as string | null,
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

type DerivationShotLocation = ActiveShotLocation & { filmIndex: number };

const derivationShotLocations = (project: StudioProjectV2): Map<string, DerivationShotLocation> => {
  const result = new Map<string, DerivationShotLocation>();
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

const comparePrepareChoices = (
  left: Pick<StudioPrepareGenerationChoiceV2, 'shotId' | 'purpose'>,
  right: Pick<StudioPrepareGenerationChoiceV2, 'shotId' | 'purpose'>,
  locations: ReadonlyMap<string, DerivationShotLocation>
): number => {
  const leftIndex = locations.get(left.shotId)?.filmIndex ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = locations.get(right.shotId)?.filmIndex ?? Number.MAX_SAFE_INTEGER;
  return leftIndex - rightIndex || choicePurposeOrder(left.purpose) - choicePurposeOrder(right.purpose);
};

const choicePairKey = (choice: Pick<StudioPrepareGenerationChoiceV2, 'shotId' | 'purpose'>): string =>
  `${choice.shotId}\0${choice.purpose}`;

const validateChoiceOrderAndIdentity = (
  request: StudioPrepareSubmissionRequestV2,
  locations: ReadonlyMap<string, DerivationShotLocation>
): void => {
  const combined = [...request.baseChoices, ...request.cascadeChoices];
  if (combined.length > STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST) fail('invalid_prepare_request');
  const pairKeys = new Set<string>();
  const shotIds = new Set<string>();
  for (const choice of combined) {
    if (!locations.has(choice.shotId)) fail('inactive_shot');
    const pairKey = choicePairKey(choice);
    if (pairKeys.has(pairKey)) fail('duplicate_shot_purpose');
    pairKeys.add(pairKey);
    shotIds.add(choice.shotId);
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

const segmentHeadIndex = (project: StudioProjectV2, location: DerivationShotLocation): number => {
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
  locations: ReadonlyMap<string, DerivationShotLocation>
): void => {
  const segmentKeys = new Set<string>();
  for (const choice of baseChoices) {
    const location = locations.get(choice.shotId);
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
  locations: ReadonlyMap<string, DerivationShotLocation>
): { shotId: string; purpose: 'video_take' }[] => {
  const expected = new Map<string, { shotId: string; purpose: 'video_take' }>();
  for (const baseChoice of baseChoices) {
    const location = locations.get(baseChoice.shotId);
    const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
    const shot = ownValue(project.shots, baseChoice.shotId);
    if (location === undefined || beat === undefined || shot === undefined) fail('inactive_shot');

    const firstCascadeIndex = baseChoice.purpose === 'seed_still' ? location.shotIndex : location.shotIndex + 1;
    for (let shotIndex = firstCascadeIndex; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      const downstreamId = beat.shotOrder[shotIndex]!;
      const downstream = ownValue(project.shots, downstreamId);
      if (downstream === undefined) fail('invalid_prepare_request');
      if (shotIndex > location.shotIndex && downstream.chainBreak === 'hard_cut') break;
      if (hasInFlightItem(project, downstreamId, 'video_take')) break;
      const pairKey = `${downstreamId}\0video_take`;
      expected.set(pairKey, { shotId: downstreamId, purpose: 'video_take' });
    }
  }
  return [...expected.values()].toSorted((left, right) => comparePrepareChoices(left, right, locations));
};

const canonicalizeExactCascade = (
  project: StudioProjectV2,
  request: StudioPrepareSubmissionRequestV2,
  locations: ReadonlyMap<string, DerivationShotLocation>
): StudioPrepareSubmissionRequestV2 => {
  const expected = deriveExpectedCascadePairs(project, request.baseChoices, locations);
  if (request.cascadeChoices.length === 0) {
    if (expected.length === 0) return request;
    return {
      ...request,
      cascadeChoices: expected.map<StudioPrepareGenerationChoiceV2>(({ shotId, purpose }) => ({
        shotId,
        purpose,
        referenceAssetId: null,
      })),
    };
  }
  if (expected.length !== request.cascadeChoices.length) fail('invalid_prepare_request');
  for (let index = 0; index < expected.length; index += 1) {
    const choice = request.cascadeChoices[index]!;
    const expectedChoice = expected[index]!;
    if (choice.shotId !== expectedChoice.shotId || choice.purpose !== expectedChoice.purpose) {
      fail('invalid_prepare_request');
    }
  }
  return request;
};

const validateReferenceHandoffChoices = (request: StudioPrepareSubmissionRequestV2): void => {
  if (
    request.originReferenceHandoffId === null ||
    request.cascadeChoices.length !== 0 ||
    request.baseChoices.some((choice) => choice.purpose !== 'seed_still' || choice.referenceAssetId !== null)
  ) {
    fail('invalid_prepare_request');
  }
};

const eligibleSeedAsset = (project: StudioProjectV2, shotId: string, assetId: string): StudioAssetV2 | null => {
  const shot = ownValue(project.shots, shotId);
  const asset = ownValue(project.assets, assetId);
  return shot !== undefined &&
    asset?.id === assetId &&
    asset.projectId === project.id &&
    asset.shotId === shotId &&
    asset.mediaKind === 'image' &&
    (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports') &&
    asset.briefReferenceRole === undefined &&
    asset.briefReferenceLabel === undefined &&
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
  if (shot.seedStillId !== null) return eligibleExplicitSeedAsset(project, shot.id, shot.seedStillId);
  const candidates = shot.assetIds.flatMap((assetId) => {
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
  shotId: string,
  purpose: StudioQuotedGeneration['purpose']
): boolean =>
  Object.values(project.jobs).some(
    (job) => job.shotId === shotId && job.purpose === purpose && NONTERMINAL_STATUSES.has(job.status)
  );

const activeBriefReference = (
  project: StudioProjectV2,
  referenceAssetId: string | null
): { assetId: string; sha256: string } | null => {
  if (referenceAssetId === null) return null;
  const asset = ownValue(project.assets, referenceAssetId);
  if (
    asset?.id !== referenceAssetId ||
    asset.projectId !== project.id ||
    asset.shotId !== null ||
    asset.mediaKind !== 'image' ||
    asset.managedAsset.collection !== 'imports' ||
    (asset.briefReferenceRole !== 'cast' && asset.briefReferenceRole !== 'look') ||
    typeof asset.briefReferenceLabel !== 'string' ||
    !LOWERCASE_SHA256.test(asset.sha256)
  ) {
    return fail('invalid_reference');
  }
  return { assetId: asset.id, sha256: asset.sha256 };
};

const createChoiceTemplate = (
  project: StudioProjectV2,
  choice: StudioPrepareGenerationChoiceV2,
  locations: ReadonlyMap<string, DerivationShotLocation>
): StudioGenerationRequestTemplate => {
  const location = locations.get(choice.shotId);
  const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
  const shot = ownValue(project.shots, choice.shotId);
  if (location === undefined || beat === undefined || shot === undefined) return fail('inactive_shot');
  const referenceInput =
    choice.purpose === 'seed_still' ? activeBriefReference(project, choice.referenceAssetId) : null;
  try {
    return createStudioGenerationRequestTemplate({
      purpose: choice.purpose,
      brief: project.brief,
      rules: project.rules,
      look: beat.look,
      line: shot.line,
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      durationSeconds: shot.durationSeconds,
      referenceInput,
    });
  } catch {
    return fail('invalid_prepare_request');
  }
};

const currentConditioningInput = (
  project: StudioProjectV2,
  shotId: string,
  locations: ReadonlyMap<string, DerivationShotLocation>
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

const deriveUnpricedItems = (
  project: StudioProjectV2,
  choices: readonly StudioPrepareGenerationChoiceV2[],
  locations: ReadonlyMap<string, DerivationShotLocation>,
  initialDependencies: ReadonlyMap<string, StudioAuthorizedConditioningDependency> = new Map()
): StudioUnpricedQuotedGenerationV2[] => {
  const earlierItemIds = new Map<string, string>();
  const result: StudioUnpricedQuotedGenerationV2[] = [];
  for (const choice of choices) {
    if (choice.purpose === 'board_still') return fail('invalid_prepare_request');
    const routeId = choice.purpose === 'seed_still' ? project.imageRouteId : project.videoRouteId;
    if (routeId === null || !SAFE_ID.test(routeId)) fail('missing_route');
    const template = createChoiceTemplate(project, choice, locations);
    let requestPlan: StudioGenerationRequestPlan;
    if (choice.purpose === 'seed_still') {
      requestPlan = createStudioResolvedGenerationRequestPlan({
        purpose: 'seed_still',
        template,
        conditioningInput: null,
      });
    } else {
      const initialDependency = initialDependencies.get(choice.shotId);
      const sameShotSeedId = earlierItemIds.get(`${choice.shotId}\0seed_still`);
      const location = locations.get(choice.shotId);
      const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
      if (location === undefined || beat === undefined) return fail('inactive_shot');
      const predecessorId = location.shotIndex === 0 ? undefined : beat.shotOrder[location.shotIndex - 1];
      const predecessorItemId =
        predecessorId === undefined ? undefined : earlierItemIds.get(`${predecessorId}\0video_take`);
      if (initialDependency !== undefined) {
        requestPlan = createStudioDeferredGenerationRequestPlan({ template, dependency: initialDependency });
      } else if (sameShotSeedId !== undefined) {
        if (location.shotIndex !== 0 && ownValue(project.shots, choice.shotId)?.chainBreak !== 'hard_cut') {
          return fail('invalid_dependency');
        }
        requestPlan = createStudioDeferredGenerationRequestPlan({
          template,
          dependency: { kind: 'authorized_seed', upstreamItemId: sameShotSeedId, shotId: choice.shotId },
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
        const conditioningInput = currentConditioningInput(project, choice.shotId, locations);
        if (conditioningInput === null) return fail('missing_conditioning');
        requestPlan = createStudioResolvedGenerationRequestPlan({
          purpose: 'video_take',
          template,
          conditioningInput,
        });
      }
    }
    result.push({
      shotId: choice.shotId,
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
        shotId: choice.shotId,
        purpose: choice.purpose,
      })
    );
  }
  return result;
};

const deriveBoardUnpricedItems = (
  project: StudioProjectV2,
  choices: readonly StudioPrepareGenerationChoiceV2[],
  locations: ReadonlyMap<string, DerivationShotLocation>
): StudioUnpricedQuotedGenerationV2[] => {
  const routeId = project.imageRouteId;
  if (routeId === null || !SAFE_ID.test(routeId)) fail('missing_route');
  if (project.boardStyle === null) fail('invalid_prepare_request');
  return choices.map((choice) => {
    const location = locations.get(choice.shotId);
    const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
    const shot = ownValue(project.shots, choice.shotId);
    if (choice.purpose !== 'board_still' || location === undefined || beat === undefined || shot === undefined) {
      return fail(location === undefined || shot === undefined ? 'inactive_shot' : 'invalid_prepare_request');
    }
    let requestPlan: StudioGenerationRequestPlan;
    try {
      requestPlan = createStudioBoardGenerationRequestPlan({
        brief: project.brief,
        rules: project.rules,
        action: beat.action,
        look: beat.look,
        line: shot.line,
        style: project.boardStyle,
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
      });
    } catch {
      return fail('invalid_prepare_request');
    }
    return {
      shotId: choice.shotId,
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
  locations: ReadonlyMap<string, DerivationShotLocation>
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
    affectedShotIds.some((shotId) => hasInFlightItem(project, shotId, 'video_take')) ||
    hasInFlightItem(project, change.shotId, 'seed_still')
  ) {
    return fail('in_flight');
  }

  const reusableSeed = change.hardCut ? effectiveSeedAsset(project, change.shotId) : null;
  const requiresSeedGeneration = change.hardCut && reusableSeed === null;
  if (change.requiresSeedGeneration !== requiresSeedGeneration) return fail('invalid_prepare_request');

  const choices: StudioPrepareGenerationChoiceV2[] = [];
  if (requiresSeedGeneration) {
    choices.push({
      shotId: change.shotId,
      purpose: 'seed_still',
      referenceAssetId: null,
    });
  }
  choices.push(
    ...affectedShotIds.map<StudioPrepareGenerationChoiceV2>((shotId) => ({
      shotId,
      purpose: 'video_take',
      referenceAssetId: null,
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
    baseItems: deriveUnpricedItems(candidate, choices, locations, initialDependencies),
    cascadeItems: null,
  };
};

const deriveBoardPromotionSubmissionQuoteGraphV2 = (
  project: StudioProjectV2,
  request: StudioPrepareSubmissionRequestV2,
  locations: ReadonlyMap<string, DerivationShotLocation>
): StudioDerivedSubmissionQuoteGraphV2 => {
  const promotion = request.boardPromotion;
  if (promotion === undefined) return fail('invalid_prepare_request');
  const authority = resolveStudioCurrentBoardPanelAuthorityV2(project, promotion.shotId, promotion.boardAssetId);
  if (
    authority === null ||
    (authority.shotIndex !== 0 && authority.shot.chainBreak !== 'hard_cut') ||
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
    shotId,
    purpose: 'video_take',
    referenceAssetId: null,
  }));
  return {
    request,
    baseItems: deriveUnpricedItems(candidate, choices, locations),
    cascadeItems: null,
  };
};

export type StudioSubmissionQuoteCoreDerivationInputV2 = {
  project: StudioProjectV2;
  request: unknown;
  rateCard: StudioRateCardV2;
};

export type StudioSubmissionQuoteGraphDerivationInputV2 = Omit<StudioSubmissionQuoteCoreDerivationInputV2, 'rateCard'>;

export type StudioDerivedSubmissionQuoteGraphV2 = {
  request: StudioPrepareSubmissionRequestV2;
  baseItems: StudioUnpricedQuotedGenerationV2[];
  cascadeItems: StudioUnpricedQuotedGenerationV2[] | null;
};

export type StudioDerivedSubmissionQuoteCoresV2 = {
  request: StudioPrepareSubmissionRequestV2;
  baseOnly: StudioSubmissionQuoteCore;
  withCascade: StudioSubmissionQuoteCore | null;
};

/** Validates the exact request graph before any live route or rate dependency is consulted. */
export const deriveStudioSubmissionQuoteGraphV2 = (
  input: StudioSubmissionQuoteGraphDerivationInputV2
): StudioDerivedSubmissionQuoteGraphV2 => {
  let request = parsePrepareRequest(input.request, input.project);
  const locations = derivationShotLocations(input.project);
  if (request.boardPromotion !== undefined) {
    return deriveBoardPromotionSubmissionQuoteGraphV2(input.project, request, locations);
  }
  if (request.continuityChange !== undefined) {
    return deriveContinuitySubmissionQuoteGraphV2(input.project, request, locations);
  }
  validateChoiceOrderAndIdentity(request, locations);
  const choices = [...request.baseChoices, ...request.cascadeChoices];
  const boardChoiceCount = choices.filter((choice) => choice.purpose === 'board_still').length;
  if (boardChoiceCount > 0) {
    if (
      boardChoiceCount !== choices.length ||
      request.originReferenceHandoffId !== null ||
      request.cascadeChoices.length > 0
    ) {
      return fail('invalid_prepare_request');
    }
    return {
      request,
      baseItems: deriveBoardUnpricedItems(input.project, request.baseChoices, locations),
      cascadeItems: null,
    };
  }
  if (request.originReferenceHandoffId === null) {
    validateIndependentBaseAnchors(input.project, request.baseChoices, locations);
    request = canonicalizeExactCascade(input.project, request, locations);
    validateChoiceOrderAndIdentity(request, locations);
  } else {
    validateReferenceHandoffChoices(request);
  }

  const baseItems = deriveUnpricedItems(input.project, request.baseChoices, locations);
  let cascadeItems: StudioUnpricedQuotedGenerationV2[] | null = null;
  if (request.cascadeChoices.length > 0) {
    try {
      const combinedItems = deriveUnpricedItems(
        input.project,
        [...request.baseChoices, ...request.cascadeChoices],
        locations
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
  const baseOnly = createStudioSubmissionQuoteCoreV2({
    project: input.project,
    originReferenceHandoffId: graph.request.originReferenceHandoffId,
    rateCard: scopedRateCard(input.rateCard, graph.baseItems),
    baseItems: graph.baseItems,
    cascadeItems: [],
  });

  let withCascade: StudioSubmissionQuoteCore | null = null;
  if (graph.cascadeItems !== null && graph.cascadeItems.length > 0) {
    try {
      withCascade = createStudioSubmissionQuoteCoreV2({
        project: input.project,
        originReferenceHandoffId: graph.request.originReferenceHandoffId,
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
  const dependency = item.requestPlan.dependency;
  const location = locations.get(item.shotId);
  if (location === undefined) fail('inactive_shot');

  if (dependency.kind === 'existing_predecessor') {
    const predecessor = locations.get(dependency.predecessorShotId);
    const shot = Object.hasOwn(project.shots, item.shotId) ? project.shots[item.shotId] : undefined;
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
    if (dependency.shotId !== item.shotId || upstream.shotId !== item.shotId || upstream.purpose !== 'seed_still') {
      fail('invalid_dependency');
    }
    return;
  }

  const predecessor = locations.get(dependency.predecessorShotId);
  const shot = Object.hasOwn(project.shots, item.shotId) ? project.shots[item.shotId] : undefined;
  if (
    predecessor === undefined ||
    predecessor.beatId !== location.beatId ||
    predecessor.shotIndex + 1 !== location.shotIndex ||
    shot?.chainBreak !== 'none' ||
    upstream.shotId !== dependency.predecessorShotId ||
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
    if (
      !SAFE_ID.test(draft.shotId) ||
      !SAFE_ID.test(draft.routeId) ||
      (draft.purpose !== 'seed_still' && draft.purpose !== 'board_still' && draft.purpose !== 'video_take') ||
      draft.generationCount !== 1 ||
      !locations.has(draft.shotId)
    ) {
      return fail(locations.has(draft.shotId) ? 'invalid_quote' : 'inactive_shot');
    }
    const pairKey = `${draft.shotId}\0${draft.purpose}`;
    if (pairKeys.has(pairKey)) fail('duplicate_shot_purpose');
    pairKeys.add(pairKey);
    shotIds.add(draft.shotId);
    if (shotIds.size > STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST) fail('invalid_quote');
    if (hasInFlightItem(project, draft.shotId, draft.purpose)) fail('in_flight');

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
    const item: StudioQuotedGeneration = {
      id: createStudioQuotedGenerationId({
        projectId: project.id,
        projectRevision: project.revision,
        shotId: draft.shotId,
        purpose: draft.purpose,
      }),
      shotId: draft.shotId,
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

const rendererDurationSeconds = (item: StudioQuotedGeneration): number | null => {
  const purpose = item.purpose;
  switch (purpose) {
    case 'seed_still':
    case 'board_still':
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
  resolveRoute: StudioRendererRouteLookupV2
): StudioRendererQuotedGenerationV2 => {
  const amounts = calculateStudioQuotedGenerationAmounts(item);
  if (amounts === null) return fail('unsafe_total');
  const route = resolveRoute(item.routeId, item.purpose);
  if (route.choiceId !== item.routeId) fail('invalid_quote');
  const durationSeconds = rendererDurationSeconds(item);
  return {
    shotId: item.shotId,
    purpose: item.purpose,
    route: { ...route },
    generationCount: item.generationCount,
    durationSeconds,
    oneGenerationMinorUnits: amounts.oneGenerationMinorUnits,
    requestedTotalMinorUnits: amounts.requestedTotalMinorUnits,
  };
};

/** Projects one immutable internal quote without exposing item/rate/request authority. */
export const toStudioRendererSubmissionQuoteV2 = (
  quote: StudioSubmissionQuote,
  policy: StudioSpendPolicy | null,
  resolveRoute: StudioRendererRouteLookupV2
): StudioRendererSubmissionQuoteV2 => ({
  id: quote.id,
  projectId: quote.projectId,
  projectRevision: quote.projectRevision,
  expiresAt: quote.expiresAt,
  currency: quote.currency,
  baseItems: quote.baseItems.map((item) => projectRendererItem(item, resolveRoute)),
  cascadeItems: quote.cascadeItems.map((item) => projectRendererItem(item, resolveRoute)),
  lowerMinorUnits: quote.lowerMinorUnits,
  upperMinorUnits: quote.upperMinorUnits,
  budget: evaluateStudioBudgetV2(quote, policy).verdict,
});
