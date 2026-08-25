/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  type StudioAuthorizedConditioningDependency,
  type StudioConditioningInputSnapshot,
  type StudioGenerationCompositionV2,
  type StudioGenerationReferenceInputSnapshot,
  type StudioGenerationRequestPlan,
  type StudioGenerationRequestSnapshot,
  type StudioGenerationRequestTemplate,
  type StudioJobPurpose,
} from '@/common/types/project/creativeStudioTypes';
import { studioGenerationCompositionsEqualV2 } from './composition';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;

export type StudioGenerationRequestTemplateInput = {
  composition: StudioGenerationCompositionV2;
  durationSeconds: number;
};

export type StudioResolvedGenerationRequestPlanInput = {
  purpose: StudioJobPurpose;
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

const cloneReferenceInputs = (
  inputs: readonly StudioGenerationReferenceInputSnapshot[]
): StudioGenerationReferenceInputSnapshot[] => {
  if (!Array.isArray(inputs) || inputs.length > STUDIO_MAX_PROJECT_REFERENCES) {
    throw new RangeError('referenceInputs exceed the Studio reference bound');
  }
  const referenceIds = new Set<string>();
  const assetIds = new Set<string>();
  return inputs.map((input) => {
    assertSafeId(input.referenceId, 'referenceInputs[].referenceId');
    assertSafeId(input.assetId, 'referenceInputs[].assetId');
    if (input.kind !== 'character' && input.kind !== 'background') {
      throw new TypeError('referenceInputs[].kind is invalid');
    }
    if (!LOWERCASE_SHA256.test(input.sha256)) {
      throw new TypeError('referenceInputs[].sha256 must be lowercase SHA-256');
    }
    if (referenceIds.has(input.referenceId) || assetIds.has(input.assetId)) {
      throw new TypeError('referenceInputs must not repeat a semantic reference or asset');
    }
    referenceIds.add(input.referenceId);
    assetIds.add(input.assetId);
    return { ...input };
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
  return { ...input };
};

const cloneDependency = (
  dependency: StudioAuthorizedConditioningDependency
): StudioAuthorizedConditioningDependency => {
  if (dependency.kind === 'authorized_seed') {
    assertSafeId(dependency.upstreamItemId, 'dependency.upstreamItemId');
    assertSafeId(dependency.shotId, 'dependency.shotId');
    return { ...dependency };
  }
  if (dependency.kind === 'existing_predecessor') {
    assertSafeId(dependency.predecessorShotId, 'dependency.predecessorShotId');
    assertSafeId(dependency.takeAssetId, 'dependency.takeAssetId');
    assertEndpoint(dependency.endpointSeconds);
    return { ...dependency };
  }
  if (dependency.kind !== 'authorized_predecessor') throw new TypeError('dependency.kind is invalid');
  assertSafeId(dependency.upstreamItemId, 'dependency.upstreamItemId');
  assertSafeId(dependency.predecessorShotId, 'dependency.predecessorShotId');
  return { ...dependency };
};

const assertTemplate = (template: StudioGenerationRequestTemplate): StudioGenerationRequestTemplate => {
  const composition = structuredClone(template.composition);
  if (
    composition.prompt.length === 0 ||
    composition.prompt !== composition.prompt.trim() ||
    composition.inputs.referenceInputs.length !== template.referenceInputs.length ||
    composition.inputs.referenceInputs.some(
      (reference, index) =>
        reference.referenceId !== template.referenceInputs[index]?.referenceId ||
        reference.kind !== template.referenceInputs[index]?.kind ||
        reference.assetId !== template.referenceInputs[index]?.assetId ||
        reference.sha256 !== template.referenceInputs[index]?.sha256
    ) ||
    composition.inputs.aspectRatio !== template.aspectRatio ||
    composition.inputs.resolution !== template.resolution
  ) {
    throw new TypeError('template does not match its frozen composition');
  }
  if (
    !Number.isSafeInteger(template.durationSeconds) ||
    template.durationSeconds < STUDIO_MIN_SHOT_SECONDS ||
    template.durationSeconds > STUDIO_MAX_SHOT_SECONDS
  ) {
    throw new RangeError('durationSeconds is outside the Studio shot bound');
  }
  return {
    composition,
    aspectRatio: template.aspectRatio,
    resolution: template.resolution,
    durationSeconds: template.durationSeconds,
    referenceInputs: cloneReferenceInputs(template.referenceInputs),
  };
};

/** Builds the immutable non-conditioning portion shared by resolved and deferred request plans. */
export const createStudioGenerationRequestTemplate = (
  input: StudioGenerationRequestTemplateInput
): StudioGenerationRequestTemplate =>
  assertTemplate({
    composition: structuredClone(input.composition),
    aspectRatio: input.composition.inputs.aspectRatio,
    resolution: input.composition.inputs.resolution,
    durationSeconds: input.durationSeconds,
    referenceInputs: cloneReferenceInputs(input.composition.inputs.referenceInputs),
  });

/** Builds a concrete authorization-time request plan that can be queued immediately. */
export const createStudioResolvedGenerationRequestPlan = (
  input: StudioResolvedGenerationRequestPlanInput
): Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> => {
  const template = assertTemplate(input.template);
  if (template.composition.inputs.purpose !== input.purpose) {
    throw new TypeError('request purpose does not match its frozen composition');
  }
  if (input.purpose === 'video_take') {
    if (input.conditioningInput === null) throw new TypeError('direct video requests require conditioning input');
    if (template.referenceInputs.length > 0) throw new TypeError('video requests cannot carry reference inputs');
  } else if (input.conditioningInput !== null) {
    throw new TypeError('image requests cannot carry conditioning input');
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
  if (template.composition.inputs.purpose !== 'video_take' || template.referenceInputs.length > 0) {
    throw new TypeError('deferred requests must be unreferenced video requests');
  }
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
  studioGenerationCompositionsEqualV2(left.composition, right.composition) &&
  left.aspectRatio === right.aspectRatio &&
  left.resolution === right.resolution &&
  Object.is(left.durationSeconds, right.durationSeconds) &&
  left.referenceInputs.length === right.referenceInputs.length &&
  left.referenceInputs.every(
    (reference, index) =>
      reference.referenceId === right.referenceInputs[index]?.referenceId &&
      reference.kind === right.referenceInputs[index]?.kind &&
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
): boolean => {
  const normalizedCurrent = structuredClone(current);
  normalizedCurrent.composition.inputs.projectRevision = recorded.composition.inputs.projectRevision;
  return studioGenerationRequestSnapshotsEqual(recorded, normalizedCurrent);
};
