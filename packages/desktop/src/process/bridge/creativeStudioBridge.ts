/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { initCreativeStudioConnectionBridgeV1 } from './creativeStudioConnectionBridge';
import { initCreativeStudioPilotBridgeV3 } from './creativeStudioPilotBridge';

export { createCreativeStudioCloseHandshake } from './creativeStudioCloseHandshake';
export type {
  CreativeStudioCloseHandshake,
  CreativeStudioCloseHandshakeDependencies,
} from './creativeStudioCloseHandshake';

export type CreativeStudioBridgeDependencies = {
  initConnections: () => void;
  initPilot: () => void;
};

const defaultDependencies: CreativeStudioBridgeDependencies = {
  initConnections: initCreativeStudioConnectionBridgeV1,
  initPilot: initCreativeStudioPilotBridgeV3,
};

/** Stable bridge registration facade. No schema-5 provider is registered or imported. */
export const initCreativeStudioBridge = (
  dependencies: CreativeStudioBridgeDependencies = defaultDependencies
): void => {
  dependencies.initConnections();
  dependencies.initPilot();
};
