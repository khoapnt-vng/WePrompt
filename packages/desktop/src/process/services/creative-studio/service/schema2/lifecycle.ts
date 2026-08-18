/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioConditioningInputSnapshot,
  StudioProjectV2,
  StudioQuotedGeneration,
} from '@/common/types/project/creativeStudioTypes';
import { createStudioFrameExtractionId, materializeStudioGenerationRequestPlan } from './generation';

export type StudioWaitingBindingAdvanceV2 = {
  dispatchJobIds: string[];
  extractionIds: string[];
  projectChanged: boolean;
};

export type StudioVerifiedConditioningFrameV2 = {
  extractionId: string;
  shotId: string;
  takeAssetId: string;
  endpointSeconds: number;
  frameAssetId: string;
  byteSize: number;
  sha256: string;
};

const ownValue = <Value>(record: Record<string, Value>, id: string): Value | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const defineOwn = <Value>(record: Record<string, Value>, id: string, value: Value): void => {
  Object.defineProperty(record, id, { value, configurable: true, enumerable: true, writable: true });
};

const quotedItems = (authorization: StudioProjectV2['spendAuthorizations'][number]): StudioQuotedGeneration[] => [
  ...authorization.baseItems,
  ...authorization.cascadeItems,
];

const TERMINAL_JOB_STATUSES: ReadonlySet<StudioProjectV2['jobs'][string]['status']> = new Set([
  'succeeded',
  'failed',
  'cancelled',
]);

const isSelectablePrimary = (
  project: StudioProjectV2,
  authorizationId: string,
  item: StudioQuotedGeneration,
  binnedTakeIds: ReadonlySet<string>
): boolean =>
  Object.values(project.jobs).some((job) => {
    if (
      job.authorizationId !== authorizationId ||
      job.authorizationItemId !== item.id ||
      job.status !== 'succeeded' ||
      job.outputAssetIdsByRole.primary === null
    ) {
      return false;
    }
    const primaryId = job.outputAssetIdsByRole.primary;
    const primary = ownValue(project.assets, primaryId);
    return (
      job.outputAssetIds.filter((assetId) => assetId === primaryId).length === 1 &&
      primary !== undefined &&
      primary.projectId === project.id &&
      primary.shotId === item.shotId &&
      ownValue(project.shots, item.shotId)?.assetIds.includes(primary.id) === true &&
      !binnedTakeIds.has(primary.id) &&
      (item.purpose === 'seed_still'
        ? primary.mediaKind === 'image'
        : primary.mediaKind === 'video' && primary.managedAsset.collection === 'assets')
    );
  });

/** Fails only pristine, unbound dependents whose exact earlier item is exhausted without a primary. */
export const terminalizeStudioUnboundDependenciesV2 = (project: StudioProjectV2, capturedAt: string): string[] => {
  const failedJobIds: string[] = [];
  const binnedTakeIds = new Set(project.bin.flatMap((item) => (item.kind === 'take' ? [item.assetId] : [])));
  for (const authorization of project.spendAuthorizations) {
    const items = quotedItems(authorization);
    for (const item of items) {
      if (item.requestPlan.kind !== 'after_take_selection') continue;
      const dependency = item.requestPlan.dependency;
      const siblings = Object.values(project.jobs)
        .filter((job) => job.authorizationId === authorization.id && job.authorizationItemId === item.id)
        .sort((left, right) => left.generationIndex - right.generationIndex);
      const remaining = siblings.filter((job) => job.status !== 'cancelled');
      if (
        siblings.length !== item.generationCount ||
        remaining.length === 0 ||
        remaining.some(
          (job) =>
            job.status !== 'waiting_for_conditioning' ||
            job.requestSnapshot !== null ||
            job.providerJobId !== null ||
            (job.remoteStartedAt !== undefined && job.remoteStartedAt !== null) ||
            job.spendReceipt !== null ||
            job.outputAssetIds.length !== 0 ||
            job.outputAssetIdsByRole.primary !== null ||
            job.outputAssetIdsByRole.poster !== null ||
            job.error !== null ||
            job.progress !== undefined
        )
      ) {
        continue;
      }
      const upstreamItem = items.find((candidate) => candidate.id === dependency.upstreamItemId);
      if (upstreamItem === undefined) continue;
      const upstreamJobs = Object.values(project.jobs).filter(
        (job) => job.authorizationId === authorization.id && job.authorizationItemId === upstreamItem.id
      );
      if (
        upstreamJobs.length !== upstreamItem.generationCount ||
        upstreamJobs.some((job) => !TERMINAL_JOB_STATUSES.has(job.status)) ||
        isSelectablePrimary(project, authorization.id, upstreamItem, binnedTakeIds)
      ) {
        continue;
      }
      for (const job of remaining) {
        job.status = 'failed';
        job.error = { code: 'dependency_failed', messageKey: 'dependency_failed' };
        job.updatedAt = capturedAt;
        failedJobIds.push(job.id);
      }
    }
  }
  return failedJobIds;
};

/**
 * Advances only explicitly selected primaries from the exact earlier item in the same authorization.
 * The caller owns the project queue, persistence, local extraction, and provider dispatch.
 */
export const advanceStudioWaitingBindingsV2 = (
  project: StudioProjectV2,
  capturedAt: string,
  verifiedReadyExtractions: ReadonlyMap<string, StudioVerifiedConditioningFrameV2> = new Map()
): StudioWaitingBindingAdvanceV2 => {
  const dispatchJobIds: string[] = [];
  const extractionIds: string[] = [];
  const seenExtractions = new Set<string>();
  const binnedTakeIds = new Set(project.bin.flatMap((item) => (item.kind === 'take' ? [item.assetId] : [])));
  let projectChanged = terminalizeStudioUnboundDependenciesV2(project, capturedAt).length > 0;

  for (const authorization of project.spendAuthorizations) {
    const items = quotedItems(authorization);
    for (const item of items) {
      if (item.requestPlan.kind !== 'after_take_selection') continue;
      const siblings = Object.values(project.jobs)
        .filter((job) => job.authorizationId === authorization.id && job.authorizationItemId === item.id)
        .sort((left, right) => left.generationIndex - right.generationIndex);
      const bindable = siblings.filter((job) => job.status !== 'cancelled');
      if (
        siblings.length !== item.generationCount ||
        bindable.length === 0 ||
        bindable.some(
          (job) =>
            job.status !== 'waiting_for_conditioning' ||
            job.requestSnapshot !== null ||
            job.providerJobId !== null ||
            (job.remoteStartedAt !== undefined && job.remoteStartedAt !== null) ||
            job.spendReceipt !== null ||
            job.outputAssetIds.length !== 0 ||
            job.outputAssetIdsByRole.primary !== null ||
            job.outputAssetIdsByRole.poster !== null ||
            job.error !== null ||
            job.progress !== undefined
        )
      ) {
        continue;
      }

      const dependency = item.requestPlan.dependency;
      const upstreamItem = items.find((candidate) => candidate.id === dependency.upstreamItemId);
      if (upstreamItem === undefined) continue;
      const upstreamShotId = dependency.kind === 'authorized_seed' ? dependency.shotId : dependency.predecessorShotId;
      const upstreamShot = ownValue(project.shots, upstreamShotId);
      const selectedAssetId =
        dependency.kind === 'authorized_seed' ? upstreamShot?.seedStillId : upstreamShot?.selectedTakeId;
      if (upstreamShot === undefined || selectedAssetId === undefined || selectedAssetId === null) continue;

      const producers = Object.values(project.jobs).filter(
        (job) =>
          job.authorizationId === authorization.id &&
          job.authorizationItemId === upstreamItem.id &&
          job.shotId === upstreamShot.id &&
          job.purpose === upstreamItem.purpose &&
          job.status === 'succeeded' &&
          job.outputAssetIdsByRole.primary === selectedAssetId &&
          job.outputAssetIds.filter((assetId) => assetId === selectedAssetId).length === 1
      );
      const selectedAsset = ownValue(project.assets, selectedAssetId);
      if (
        producers.length !== 1 ||
        selectedAsset === undefined ||
        selectedAsset.projectId !== project.id ||
        selectedAsset.shotId !== upstreamShot.id ||
        !upstreamShot.assetIds.includes(selectedAsset.id) ||
        binnedTakeIds.has(selectedAsset.id) ||
        (dependency.kind === 'authorized_seed'
          ? selectedAsset.mediaKind !== 'image'
          : selectedAsset.mediaKind !== 'video' || selectedAsset.managedAsset.collection !== 'assets')
      ) {
        continue;
      }

      let conditioningInput: StudioConditioningInputSnapshot;
      if (dependency.kind === 'authorized_seed') {
        conditioningInput = { kind: 'seed_still', assetId: selectedAsset.id };
      } else {
        if (selectedAsset.durationSeconds === undefined) continue;
        const endpointSeconds = selectedAsset.durationSeconds - (upstreamShot.trimOutSeconds ?? 0);
        if (!Number.isFinite(endpointSeconds) || endpointSeconds <= 0) continue;
        const extractionId = createStudioFrameExtractionId({
          shotId: upstreamShot.id,
          takeAssetId: selectedAsset.id,
          endpointSeconds,
        });
        let extraction = ownValue(project.frameExtractions, extractionId);
        if (extraction === undefined) {
          extraction = {
            id: extractionId,
            shotId: upstreamShot.id,
            takeAssetId: selectedAsset.id,
            endpointSeconds,
            frameAssetId: null,
            status: 'pending',
            errorCode: null,
          };
          defineOwn(project.frameExtractions, extractionId, extraction);
          projectChanged = true;
        }
        if (extraction.status === 'pending' || extraction.status === 'extracting') {
          if (!seenExtractions.has(extraction.id)) {
            seenExtractions.add(extraction.id);
            extractionIds.push(extraction.id);
          }
          continue;
        }
        if (extraction.status !== 'ready' || extraction.frameAssetId === null) continue;
        const frameAsset = ownValue(project.assets, extraction.frameAssetId);
        if (
          extraction.shotId !== upstreamShot.id ||
          extraction.takeAssetId !== selectedAsset.id ||
          !Object.is(extraction.endpointSeconds, endpointSeconds) ||
          frameAsset?.projectId !== project.id ||
          frameAsset.shotId !== upstreamShot.id ||
          frameAsset.mediaKind !== 'image' ||
          frameAsset.managedAsset.collection !== 'conditioningFrames' ||
          !upstreamShot.assetIds.includes(frameAsset.id)
        ) {
          continue;
        }
        const verification = verifiedReadyExtractions.get(extraction.id);
        if (
          verification === undefined ||
          verification.extractionId !== extraction.id ||
          verification.shotId !== extraction.shotId ||
          verification.takeAssetId !== extraction.takeAssetId ||
          !Object.is(verification.endpointSeconds, extraction.endpointSeconds) ||
          verification.frameAssetId !== frameAsset.id ||
          verification.byteSize !== frameAsset.byteSize ||
          verification.sha256 !== frameAsset.sha256
        ) {
          if (!seenExtractions.has(extraction.id)) {
            seenExtractions.add(extraction.id);
            extractionIds.push(extraction.id);
          }
          continue;
        }
        conditioningInput = {
          kind: 'predecessor_frame',
          predecessorShotId: upstreamShot.id,
          takeAssetId: selectedAsset.id,
          frameAssetId: frameAsset.id,
          endpointSeconds,
        };
      }

      const snapshot = materializeStudioGenerationRequestPlan(item.requestPlan, conditioningInput);
      for (const job of bindable) {
        job.requestSnapshot = structuredClone(snapshot);
        job.status = 'queued_local';
        job.updatedAt = capturedAt;
        dispatchJobIds.push(job.id);
      }
      projectChanged = true;
    }
  }
  return { dispatchJobIds, extractionIds, projectChanged };
};
