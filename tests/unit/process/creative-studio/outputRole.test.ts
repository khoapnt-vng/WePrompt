/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { StudioJob } from '@/common/types/project/creativeStudioTypes';
import { jobOutputRole } from '@/common/types/project/creativeStudioOutputRole';

const makeJob = (overrides: Partial<StudioJob> = {}): StudioJob => ({
  id: 'job_1',
  projectId: 'project_1',
  sceneId: 'scene_1',
  status: 'succeeded',
  provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' },
  idempotencyKey: 'key_1',
  providerJobId: null,
  cancellationPolicy: 'none',
  outputAssetIds: [],
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
  ...overrides,
});

describe('jobOutputRole', () => {
  it('defaults an old schema-v1 job that lacks the field to take', () => {
    expect(jobOutputRole(makeJob())).toBe('take');
  });

  it('reads an explicit take role', () => {
    expect(jobOutputRole(makeJob({ outputRole: 'take' }))).toBe('take');
  });

  it('reads an explicit reference role', () => {
    expect(jobOutputRole(makeJob({ outputRole: 'reference' }))).toBe('reference');
  });
});
