/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** A safe, stable service error that can cross only through the bridge error mapper. */
export class CreativeStudioServiceError extends Error {
  readonly code: 'provider_error' | 'invalid_route';

  constructor(code: CreativeStudioServiceError['code']) {
    super(code);
    this.name = 'CreativeStudioServiceError';
    this.code = code;
  }
}
