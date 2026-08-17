/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { StudioJobErrorCode } from '@/common/types/project/creativeStudioTypes';
import { studioJobChargePossibility } from '@/common/types/project/creativeStudioChargeDisclosure';

const CLASSIFICATIONS = [
  { code: 'invalid_request', expected: 'certainly_not_charged' },
  { code: 'auth', expected: 'certainly_not_charged' },
  { code: 'quota', expected: 'certainly_not_charged' },
  { code: 'rate_limited', expected: 'certainly_not_charged' },
  { code: 'provider_unavailable', expected: 'certainly_not_charged' },
  { code: 'unsupported', expected: 'certainly_not_charged' },
  { code: 'timeout', expected: 'may_have_been_charged' },
  { code: 'poll_deadline', expected: 'may_have_been_charged' },
  { code: 'no_output', expected: 'may_have_been_charged' },
  { code: 'submission_unknown', expected: 'may_have_been_charged' },
  { code: 'download_failed', expected: 'may_have_been_charged' },
  { code: 'unknown', expected: 'may_have_been_charged' },
] as const satisfies ReadonlyArray<{
  code: StudioJobErrorCode;
  expected: 'certainly_not_charged' | 'may_have_been_charged';
}>;

describe('studioJobChargePossibility', () => {
  it.each(CLASSIFICATIONS)('classifies $code as $expected', ({ code, expected }) => {
    expect(studioJobChargePossibility(code)).toBe(expected);
  });

  it('treats an unrecognised persisted code as possibly charged', () => {
    // Product decision: assuming no charge is the expensive direction to be wrong in.
    expect(studioJobChargePossibility('future_provider_error')).toBe('may_have_been_charged');
  });
});
