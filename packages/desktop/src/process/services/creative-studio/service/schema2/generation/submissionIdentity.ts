/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type {
  StudioGenerationTargetV2,
  StudioJobErrorCode,
  StudioQuotedGeneration,
} from '@/common/types/project/creativeStudioTypes';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;
const QUOTED_GENERATION_ID_NAMESPACE = 'creative-studio/quoted-generation/v2';
const AUTOMATIC_REFERENCE_RETRY_JOB_ID_NAMESPACE = 'creative-studio/automatic-reference-retry-job/v2';
const AUTOMATIC_VIDEO_RETRY_JOB_ID_NAMESPACE = 'creative-studio/automatic-video-retry-job/v2';
const AUTOMATIC_VIDEO_RETRY_FAILURE_CODES: ReadonlySet<StudioJobErrorCode> = new Set([
  'rate_limited',
  'provider_unavailable',
  'timeout',
  'no_output',
  'unknown',
]);

export type StudioQuotedGenerationIdentityInput = {
  projectId: string;
  projectRevision: number;
  target: StudioGenerationTargetV2;
  purpose: StudioQuotedGeneration['purpose'];
};

const assertSafeId = (value: string, field: string): void => {
  if (!SAFE_STUDIO_ID.test(value)) throw new TypeError(`${field} must be a safe Studio ID`);
};

export const studioGenerationTargetKey = (target: StudioGenerationTargetV2): string => {
  const id = target.kind === 'shot' ? target.shotId : target.referenceId;
  assertSafeId(id, target.kind === 'shot' ? 'shotId' : 'referenceId');
  return `${target.kind}:${id}`;
};

/** Exact stochastic terminal causes that may consume a video's pre-authorized second attempt. */
export const studioAutomaticVideoRetryFailureCodeIsEligibleV2 = (code: StudioJobErrorCode): boolean =>
  AUTOMATIC_VIDEO_RETRY_FAILURE_CODES.has(code);

/** Returns the deterministic identity of one quoted target/purpose pair at one project revision. */
export const createStudioQuotedGenerationId = (input: StudioQuotedGenerationIdentityInput): string => {
  assertSafeId(input.projectId, 'projectId');
  const targetKey = studioGenerationTargetKey(input.target);
  if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 1) {
    throw new RangeError('projectRevision must be a positive safe integer');
  }
  if (
    input.purpose !== 'seed_still' &&
    input.purpose !== 'board_still' &&
    input.purpose !== 'video_take' &&
    input.purpose !== 'reference_image'
  ) {
    throw new TypeError('purpose must be a Studio generation purpose');
  }
  const canonical = [
    QUOTED_GENERATION_ID_NAMESPACE,
    input.projectId,
    Number.prototype.toString.call(input.projectRevision),
    targetKey,
    input.purpose,
  ].join('\0');
  return `item_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};

/**
 * Returns the one deterministic job identity for an authorization's reserved reference retry.
 * Re-derivation after a crash therefore finds the same durable attempt instead of minting another.
 */
export const createStudioAutomaticReferenceRetryJobId = (input: {
  authorizationId: string;
  itemId: string;
  idempotencyKey: string;
}): string => {
  assertSafeId(input.authorizationId, 'authorizationId');
  assertSafeId(input.itemId, 'itemId');
  assertSafeId(input.idempotencyKey, 'idempotencyKey');
  const canonical = [
    AUTOMATIC_REFERENCE_RETRY_JOB_ID_NAMESPACE,
    input.authorizationId,
    input.itemId,
    input.idempotencyKey,
  ].join('\0');
  return `job_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};

/**
 * Returns the deterministic identity for the one provider-failure retry reserved by a video item.
 * A distinct namespace preserves every reference-retry identity already derived by schema 5.
 */
export const createStudioAutomaticVideoRetryJobId = (input: {
  authorizationId: string;
  itemId: string;
  idempotencyKey: string;
}): string => {
  assertSafeId(input.authorizationId, 'authorizationId');
  assertSafeId(input.itemId, 'itemId');
  assertSafeId(input.idempotencyKey, 'idempotencyKey');
  const canonical = [
    AUTOMATIC_VIDEO_RETRY_JOB_ID_NAMESPACE,
    input.authorizationId,
    input.itemId,
    input.idempotencyKey,
  ].join('\0');
  return `job_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};
