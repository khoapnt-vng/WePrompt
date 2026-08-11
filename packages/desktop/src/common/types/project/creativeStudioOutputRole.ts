/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioJob, StudioOutputRole } from './creativeStudioTypes';

/** A job's output role. Absent on the durable record means 'take', the pre-existing default; never backfilled. */
export const jobOutputRole = (job: StudioJob): StudioOutputRole => job.outputRole ?? 'take';
