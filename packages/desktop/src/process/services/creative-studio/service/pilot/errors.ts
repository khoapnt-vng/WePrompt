/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CreativeStudioPilotErrorCodeV3 } from '@/common/types/project/creativeStudioTypes';
import {
  CreativeStudioPilotStoreErrorV3,
  type CreativeStudioPilotStoreErrorCodeV3,
} from '@process/services/creative-studio/store/pilotStore';
import { StudioDeletionClaimErrorV3 } from '../schema2/mutations/deletionClaimsV3';
import { StudioPreparedPhotoCacheErrorV3 } from '../schema2/pricing/preparedSubmissionCache';
import { CreativeStudioPilotContractErrorV3 } from './contracts';
import { StudioPieceRouteResolutionErrorV3 } from './pricing';

/** Detail-free failure exposed by the isolated schema-6 service boundary. */
export class CreativeStudioPilotServiceErrorV3 extends Error {
  readonly code: CreativeStudioPilotErrorCodeV3;

  constructor(code: CreativeStudioPilotErrorCodeV3) {
    super(code);
    this.name = 'CreativeStudioPilotServiceErrorV3';
    this.code = code;
  }
}

const STORE_ERROR_CODES: Readonly<Record<CreativeStudioPilotStoreErrorCodeV3, CreativeStudioPilotErrorCodeV3>> = {
  invalid_payload: 'invalid_payload',
  not_found: 'not_found',
  stale_project: 'stale_project',
  unsupported: 'unsupported_project',
  quarantined: 'project_quarantined',
  already_exists: 'storage_error',
  storage_error: 'storage_error',
};

/** Converts process-internal failures to the stable Pilot service vocabulary without leaking details. */
export const normalizeCreativeStudioPilotErrorV3 = (error: unknown): never => {
  if (error instanceof CreativeStudioPilotServiceErrorV3) throw error;
  if (error instanceof CreativeStudioPilotContractErrorV3) {
    throw new CreativeStudioPilotServiceErrorV3(error.code);
  }
  if (error instanceof CreativeStudioPilotStoreErrorV3) {
    throw new CreativeStudioPilotServiceErrorV3(STORE_ERROR_CODES[error.code]);
  }
  if (error instanceof StudioPieceRouteResolutionErrorV3) {
    throw new CreativeStudioPilotServiceErrorV3(error.code);
  }
  if (error instanceof StudioPreparedPhotoCacheErrorV3) {
    const code: CreativeStudioPilotErrorCodeV3 =
      error.code === 'quote_in_use'
        ? 'quote_in_use'
        : error.code === 'quote_cache_full'
          ? 'busy'
          : error.code === 'quote_too_large'
            ? 'invalid_payload'
            : 'quote_not_found';
    throw new CreativeStudioPilotServiceErrorV3(code);
  }
  if (error instanceof StudioDeletionClaimErrorV3) {
    const code: CreativeStudioPilotErrorCodeV3 =
      error.code === 'claim_not_found'
        ? 'deletion_claim_not_found'
        : error.code === 'claim_expired'
          ? 'deletion_claim_expired'
          : error.code === 'claim_mismatch'
            ? 'deletion_claim_mismatch'
            : 'deletion_claim_capacity';
    throw new CreativeStudioPilotServiceErrorV3(code);
  }
  throw new CreativeStudioPilotServiceErrorV3('storage_error');
};
