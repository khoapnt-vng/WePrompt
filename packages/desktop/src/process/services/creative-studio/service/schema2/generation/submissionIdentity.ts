/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { StudioQuotedGeneration } from '@/common/types/project/creativeStudioTypes';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;
const QUOTED_GENERATION_ID_NAMESPACE = 'creative-studio/quoted-generation/v1';

export type StudioQuotedGenerationIdentityInput = {
  projectId: string;
  projectRevision: number;
  shotId: string;
  purpose: StudioQuotedGeneration['purpose'];
};

const assertSafeId = (value: string, field: string): void => {
  if (!SAFE_STUDIO_ID.test(value)) throw new TypeError(`${field} must be a safe Studio ID`);
};

/** Returns the deterministic identity of one quoted shot/purpose pair at one project revision. */
export const createStudioQuotedGenerationId = (input: StudioQuotedGenerationIdentityInput): string => {
  assertSafeId(input.projectId, 'projectId');
  assertSafeId(input.shotId, 'shotId');
  if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 1) {
    throw new RangeError('projectRevision must be a positive safe integer');
  }
  if (input.purpose !== 'seed_still' && input.purpose !== 'video_take') {
    throw new TypeError('purpose must be a Studio generation purpose');
  }
  const canonical = [
    QUOTED_GENERATION_ID_NAMESPACE,
    input.projectId,
    Number.prototype.toString.call(input.projectRevision),
    input.shotId,
    input.purpose,
  ].join('\0');
  return `item_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};
