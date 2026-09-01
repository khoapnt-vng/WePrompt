/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  disposeCreativeStudioPilotProductionRuntimeV3,
  getCreativeStudioPilotProductionRuntimeV3,
  resumeCreativeStudioPilotAfterBackendReadyV3,
  type CreativeStudioPilotProductionRuntimeV3,
} from './pilotProductionRuntime';

/** Stable app-startup facade. Production Studio is schema 6 only after the Pilot cutover. */
export type CreativeStudioRuntime = CreativeStudioPilotProductionRuntimeV3;

export const getCreativeStudioRuntime = getCreativeStudioPilotProductionRuntimeV3;
export const resumeCreativeStudioAfterBackendReady = resumeCreativeStudioPilotAfterBackendReadyV3;
export const disposeCreativeStudioRuntime = disposeCreativeStudioPilotProductionRuntimeV3;
