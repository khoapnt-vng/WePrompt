/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderStudioRulesBlock } from '@/common/types/project/creativeStudioRules';
import {
  STUDIO_MAX_GENERATION_PROMPT_LENGTH,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  type StudioAspectRatio,
  type StudioAuthorizedConditioningDependency,
  type StudioBriefRule,
  type StudioConditioningInputSnapshot,
  type StudioGenerationReferenceInputSnapshot,
  type StudioGenerationRequestPlan,
  type StudioGenerationRequestSnapshot,
  type StudioGenerationRequestTemplate,
  type StudioQuotedGeneration,
  type StudioResolution,
} from '@/common/types/project/creativeStudioTypes';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const ASPECT_RATIOS: ReadonlySet<StudioAspectRatio> = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS: ReadonlySet<StudioResolution> = new Set(['720p', '1080p']);

export type StudioGenerationPromptInput = {
  brief: string;
  rules: readonly StudioBriefRule[];
  look: string;
  line: string;
};

export type StudioGenerationRequestTemplateInput = StudioGenerationPromptInput & {
  purpose: StudioQuotedGeneration['purpose'];
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  durationSeconds: number;
  referenceInputs: readonly StudioGenerationReferenceInputSnapshot[];
};

export type StudioResolvedGenerationRequestPlanInput = {
  purpose: StudioQuotedGeneration['purpose'];
  template: StudioGenerationRequestTemplate;
  conditioningInput: StudioConditioningInputSnapshot | null;
};

export type StudioDeferredGenerationRequestPlanInput = {
  template: StudioGenerationRequestTemplate;
  dependency: StudioAuthorizedConditioningDependency;
};

const assertSafeId = (value: string, field: string): void => {
  if (!SAFE_STUDIO_ID.test(value)) throw new TypeError(`${field} must be a safe Studio ID`);
};

const assertEndpoint = (value: number): void => {
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER || Object.is(value, -0)) {
    throw new RangeError('endpointSeconds must be finite, positive, and no greater than Number.MAX_SAFE_INTEGER');
  }
};

const cloneReferenceInput = (input: StudioGenerationReferenceInputSnapshot): StudioGenerationReferenceInputSnapshot => {
  assertSafeId(input.assetId, 'referenceInput.assetId');
  if (!LOWERCASE_SHA256.test(input.sha256)) throw new TypeError('referenceInput.sha256 must be lowercase SHA-256');
  return { assetId: input.assetId, sha256: input.sha256 };
};

const cloneReferenceInputs = (
  inputs: readonly StudioGenerationReferenceInputSnapshot[]
): StudioGenerationReferenceInputSnapshot[] => {
  if (!Array.isArray(inputs)) throw new TypeError('referenceInputs must be an array');
  const seen = new Set<string>();
  return inputs.map((input) => {
    const cloned = cloneReferenceInput(input);
    if (seen.has(cloned.assetId)) throw new TypeError('referenceInputs must not repeat an asset');
    seen.add(cloned.assetId);
    return cloned;
  });
};

const cloneConditioningInput = (input: StudioConditioningInputSnapshot): StudioConditioningInputSnapshot => {
  if (input.kind === 'seed_still') {
    assertSafeId(input.assetId, 'conditioningInput.assetId');
    return { kind: 'seed_still', assetId: input.assetId };
  }
  if (input.kind !== 'predecessor_frame') throw new TypeError('conditioningInput.kind is invalid');
  assertSafeId(input.predecessorShotId, 'conditioningInput.predecessorShotId');
  assertSafeId(input.takeAssetId, 'conditioningInput.takeAssetId');
  assertSafeId(input.frameAssetId, 'conditioningInput.frameAssetId');
  assertEndpoint(input.endpointSeconds);
  return {
    kind: 'predecessor_frame',
    predecessorShotId: input.predecessorShotId,
    takeAssetId: input.takeAssetId,
    frameAssetId: input.frameAssetId,
    endpointSeconds: input.endpointSeconds,
  };
};

const cloneDependency = (
  dependency: StudioAuthorizedConditioningDependency
): StudioAuthorizedConditioningDependency => {
  if (dependency.kind === 'authorized_seed') {
    assertSafeId(dependency.upstreamItemId, 'dependency.upstreamItemId');
    assertSafeId(dependency.shotId, 'dependency.shotId');
    return { kind: 'authorized_seed', upstreamItemId: dependency.upstreamItemId, shotId: dependency.shotId };
  }
  if (dependency.kind === 'existing_predecessor') {
    assertSafeId(dependency.predecessorShotId, 'dependency.predecessorShotId');
    assertSafeId(dependency.takeAssetId, 'dependency.takeAssetId');
    assertEndpoint(dependency.endpointSeconds);
    return {
      kind: 'existing_predecessor',
      predecessorShotId: dependency.predecessorShotId,
      takeAssetId: dependency.takeAssetId,
      endpointSeconds: dependency.endpointSeconds,
    };
  }
  if (dependency.kind !== 'authorized_predecessor') throw new TypeError('dependency.kind is invalid');
  assertSafeId(dependency.upstreamItemId, 'dependency.upstreamItemId');
  assertSafeId(dependency.predecessorShotId, 'dependency.predecessorShotId');
  return {
    kind: 'authorized_predecessor',
    upstreamItemId: dependency.upstreamItemId,
    predecessorShotId: dependency.predecessorShotId,
  };
};

const assertTemplate = (template: StudioGenerationRequestTemplate): StudioGenerationRequestTemplate => {
  if (
    typeof template.prompt !== 'string' ||
    template.prompt.length === 0 ||
    template.prompt !== template.prompt.trim() ||
    template.prompt.length > STUDIO_MAX_GENERATION_PROMPT_LENGTH
  ) {
    throw new RangeError('prompt must be nonempty, trimmed, and within the generation prompt bound');
  }
  if (!ASPECT_RATIOS.has(template.aspectRatio)) throw new TypeError('aspectRatio is invalid');
  if (!RESOLUTIONS.has(template.resolution)) throw new TypeError('resolution is invalid');
  if (
    !Number.isSafeInteger(template.durationSeconds) ||
    template.durationSeconds < STUDIO_MIN_SHOT_SECONDS ||
    template.durationSeconds > STUDIO_MAX_SHOT_SECONDS
  ) {
    throw new RangeError('durationSeconds is outside the Studio shot bound');
  }
  return {
    prompt: template.prompt,
    aspectRatio: template.aspectRatio,
    resolution: template.resolution,
    durationSeconds: template.durationSeconds,
    referenceInputs: cloneReferenceInputs(template.referenceInputs),
  };
};

/** Composes the exact nonempty provider prompt from the current authored request inputs. */
export const composeStudioGenerationPrompt = (input: StudioGenerationPromptInput): string => {
  const brief = input.brief.trim();
  const rules = renderStudioRulesBlock(input.rules).trim();
  const look = input.look.trim();
  const line = input.line.trim();
  const sections = [
    ...(brief.length === 0 ? [] : [`BRIEF\n${brief}`]),
    ...(rules.length === 0 ? [] : [rules]),
    ...(look.length === 0 ? [] : [`LOOK\n${look}`]),
    ...(line.length === 0 ? [] : [`SHOT\n${line}`]),
  ];
  const prompt = sections.join('\n\n');
  if (prompt.length === 0 || prompt.length > STUDIO_MAX_GENERATION_PROMPT_LENGTH) {
    throw new RangeError('composed prompt is empty or exceeds the generation prompt bound');
  }
  return prompt;
};

/** Builds the immutable non-conditioning portion shared by resolved and deferred request plans. */
export const createStudioGenerationRequestTemplate = (
  input: StudioGenerationRequestTemplateInput
): StudioGenerationRequestTemplate => {
  if (input.purpose !== 'seed_still' && input.purpose !== 'video_take') {
    throw new TypeError('purpose must be a Studio generation purpose');
  }
  if (input.purpose === 'video_take' && input.referenceInputs.length > 0) {
    throw new TypeError('video requests cannot carry a Brief reference input');
  }
  return assertTemplate({
    prompt: composeStudioGenerationPrompt(input),
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    durationSeconds: input.durationSeconds,
    referenceInputs: cloneReferenceInputs(input.referenceInputs),
  });
};

/** Builds a concrete authorization-time request plan that can be queued immediately. */
export const createStudioResolvedGenerationRequestPlan = (
  input: StudioResolvedGenerationRequestPlanInput
): Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> => {
  const template = assertTemplate(input.template);
  if (input.purpose === 'seed_still' || input.purpose === 'board_still') {
    if (input.conditioningInput !== null) throw new TypeError('still requests cannot carry conditioning input');
    if (input.purpose === 'board_still' && template.referenceInputs.length > 0) {
      throw new TypeError('board requests cannot carry a Brief reference input');
    }
  } else if (input.purpose === 'video_take') {
    if (input.conditioningInput === null) throw new TypeError('direct video requests require conditioning input');
    if (template.referenceInputs.length > 0) throw new TypeError('video requests cannot carry a Brief reference input');
  } else {
    throw new TypeError('purpose must be a Studio generation purpose');
  }
  return {
    kind: 'resolved',
    snapshot: {
      ...template,
      conditioningInput: input.conditioningInput === null ? null : cloneConditioningInput(input.conditioningInput),
    },
  };
};

/** Builds a symbolic video plan that waits for one reviewed output selection. */
export const createStudioDeferredGenerationRequestPlan = (
  input: StudioDeferredGenerationRequestPlanInput
): Extract<StudioGenerationRequestPlan, { kind: 'after_take_selection' }> => {
  const template = assertTemplate(input.template);
  if (template.referenceInputs.length > 0)
    throw new TypeError('deferred video requests cannot carry a Brief reference input');
  return { kind: 'after_take_selection', template, dependency: cloneDependency(input.dependency) };
};

/** Materializes one symbolic plan from the exact human-selected conditioning input. */
export const materializeStudioGenerationRequestPlan = (
  plan: StudioGenerationRequestPlan,
  conditioningInput: StudioConditioningInputSnapshot
): StudioGenerationRequestSnapshot => {
  if (plan.kind !== 'after_take_selection') throw new TypeError('only deferred plans can be materialized');
  const template = assertTemplate(plan.template);
  const dependency = cloneDependency(plan.dependency);
  const conditioning = cloneConditioningInput(conditioningInput);
  const dependencyMatches =
    (dependency.kind === 'authorized_seed' && conditioning.kind === 'seed_still') ||
    (dependency.kind === 'authorized_predecessor' &&
      conditioning.kind === 'predecessor_frame' &&
      dependency.predecessorShotId === conditioning.predecessorShotId) ||
    (dependency.kind === 'existing_predecessor' &&
      conditioning.kind === 'predecessor_frame' &&
      dependency.predecessorShotId === conditioning.predecessorShotId &&
      dependency.takeAssetId === conditioning.takeAssetId &&
      Object.is(dependency.endpointSeconds, conditioning.endpointSeconds));
  if (!dependencyMatches) throw new TypeError('conditioning input does not satisfy the authorized dependency');
  return { ...template, conditioningInput: conditioning };
};

export const studioGenerationRequestTemplatesEqual = (
  left: StudioGenerationRequestTemplate,
  right: StudioGenerationRequestTemplate
): boolean =>
  left.prompt === right.prompt &&
  left.aspectRatio === right.aspectRatio &&
  left.resolution === right.resolution &&
  Object.is(left.durationSeconds, right.durationSeconds) &&
  left.referenceInputs.length === right.referenceInputs.length &&
  left.referenceInputs.every(
    (reference, index) =>
      reference.assetId === right.referenceInputs[index]?.assetId &&
      reference.sha256 === right.referenceInputs[index]?.sha256
  );

export const studioConditioningInputsEqual = (
  left: StudioConditioningInputSnapshot | null,
  right: StudioConditioningInputSnapshot | null
): boolean => {
  if (left === null || right === null) return left === right;
  if (left.kind !== right.kind) return false;
  if (left.kind === 'seed_still') return left.assetId === (right as typeof left).assetId;
  const rightFrame = right as typeof left;
  return (
    left.predecessorShotId === rightFrame.predecessorShotId &&
    left.takeAssetId === rightFrame.takeAssetId &&
    left.frameAssetId === rightFrame.frameAssetId &&
    Object.is(left.endpointSeconds, rightFrame.endpointSeconds)
  );
};

export const studioGenerationRequestSnapshotsEqual = (
  left: StudioGenerationRequestSnapshot,
  right: StudioGenerationRequestSnapshot
): boolean =>
  studioGenerationRequestTemplatesEqual(left, right) &&
  studioConditioningInputsEqual(left.conditioningInput, right.conditioningInput);

/** Compares one recorded concrete provider request with the freshly recomposed current request. */
export const isStudioGenerationRequestCurrent = (
  recorded: StudioGenerationRequestSnapshot,
  current: StudioGenerationRequestSnapshot
): boolean => studioGenerationRequestSnapshotsEqual(recorded, current);
