/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioConnectionValidationFailureReason } from '@/common/types/project/creativeStudioTypes';

/** A safe, stable service error that can cross only through the bridge error mapper. */
export class CreativeStudioServiceError extends Error {
  readonly code: 'provider_error' | 'invalid_route' | 'runtime_inactive' | 'project_quarantined';
  readonly projectId: string | null;

  constructor(code: CreativeStudioServiceError['code'], projectId: string | null = null) {
    super(code);
    this.name = 'CreativeStudioServiceError';
    this.code = code;
    this.projectId = projectId;
  }
}

/** Preserves a provider-body-free connection failure through save-time revalidation. */
export class StudioConnectionValidationError extends Error {
  readonly code = 'connection_validation_failed' as const;

  constructor(readonly reason: StudioConnectionValidationFailureReason) {
    super(reason);
    this.name = 'StudioConnectionValidationError';
  }
}
