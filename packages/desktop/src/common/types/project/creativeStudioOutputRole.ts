/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioJob, StudioJobV2, StudioMediaKind, StudioOutputRole } from './creativeStudioTypes';

/**
 * A reference plate is always produced on the image route, whatever the scene's own media kind;
 * a take follows the scene. Every route, routing-selection and provider-request decision keys off this.
 */
export const requestedMediaKind = (sceneMediaKind: StudioMediaKind, role: StudioOutputRole): StudioMediaKind =>
  role === 'reference' ? 'image' : sceneMediaKind;

/** A job's output role. Absent on the durable record means 'take', the pre-existing default; never backfilled. */
export const jobOutputRole = (job: StudioJob | StudioJobV2): StudioOutputRole => job.outputRole ?? 'take';
