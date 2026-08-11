/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioJobErrorCode } from './creativeStudioTypes';

type StudioJobChargePossibility = 'certainly_not_charged' | 'may_have_been_charged';

const STUDIO_JOB_CHARGE_POSSIBILITY = {
  invalid_request: 'certainly_not_charged',
  auth: 'certainly_not_charged',
  quota: 'certainly_not_charged',
  rate_limited: 'certainly_not_charged',
  provider_unavailable: 'certainly_not_charged',
  timeout: 'may_have_been_charged',
  poll_deadline: 'may_have_been_charged',
  no_output: 'may_have_been_charged',
  submission_unknown: 'may_have_been_charged',
  download_failed: 'may_have_been_charged',
  unsupported: 'certainly_not_charged',
  unknown: 'may_have_been_charged',
} satisfies Record<StudioJobErrorCode, StudioJobChargePossibility>;

/** Returns whether a generation failure may still have resulted in a provider charge. */
export const studioJobChargePossibility = (code: string): StudioJobChargePossibility =>
  Object.prototype.hasOwnProperty.call(STUDIO_JOB_CHARGE_POSSIBILITY, code)
    ? STUDIO_JOB_CHARGE_POSSIBILITY[code as StudioJobErrorCode]
    : 'may_have_been_charged';
