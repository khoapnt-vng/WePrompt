/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { CREATIVE_STUDIO_ENABLED } from '@/common/config/constants';
import type {
  StudioCommandResult,
  StudioConnectionValidationFailureReason,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioConnectionControllerV1 } from '@process/services/creative-studio/connectionController';
import {
  getCreativeStudioPilotProductionRuntimeV3,
  type CreativeStudioPilotProductionRuntimeV3,
} from '@process/services/creative-studio/pilotProductionRuntime';
import {
  CreativeStudioServiceError,
  StudioConnectionValidationError,
} from '@process/services/creative-studio/service/projectMutations';
import { CreativeStudioStoreError } from '@process/services/creative-studio/store/contracts';

const MESSAGE_KEYS = {
  feature_disabled: 'conversation.creativeStudio.errors.featureDisabled',
  invalid_payload: 'conversation.creativeStudio.errors.invalidPayload',
  invalid_route: 'conversation.creativeStudio.errors.invalidRoute',
  provider_error: 'conversation.creativeStudio.errors.provider',
  storage_error: 'conversation.creativeStudio.errors.storage',
} as const;

const VALIDATION_MESSAGE_KEYS: Record<StudioConnectionValidationFailureReason, string> = {
  unsupported: 'settings.mediaModels.validationFailure.unsupported',
  auth: 'settings.mediaModels.validationFailure.auth',
  rate_limited: 'settings.mediaModels.validationFailure.rateLimited',
  provider_unavailable: 'settings.mediaModels.validationFailure.providerUnavailable',
  timeout: 'settings.mediaModels.validationFailure.timeout',
  invalid_response: 'settings.mediaModels.validationFailure.invalidResponse',
  unknown: 'settings.mediaModels.validationFailure.unknown',
};

export type CreativeStudioConnectionBridgeDependenciesV1 = {
  isFeatureEnabled?: () => boolean;
  getController: () => StudioConnectionControllerV1;
};

const defaultDependencies: CreativeStudioConnectionBridgeDependenciesV1 = {
  getController: (): StudioConnectionControllerV1 =>
    (getCreativeStudioPilotProductionRuntimeV3() as Pick<CreativeStudioPilotProductionRuntimeV3, 'connections'>)
      .connections,
};

const command = async <T>(enabled: () => boolean, operation: () => Promise<T>): Promise<StudioCommandResult<T>> => {
  if (!enabled()) {
    return { ok: false, error: { code: 'feature_disabled', messageKey: MESSAGE_KEYS.feature_disabled } };
  }
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof StudioConnectionValidationError) {
      return {
        ok: false,
        error: {
          code: 'connection_validation_failed',
          reason: error.reason,
          messageKey: VALIDATION_MESSAGE_KEYS[error.reason],
        },
      };
    }
    const code =
      error instanceof CreativeStudioStoreError && error.code === 'invalid_payload'
        ? 'invalid_payload'
        : error instanceof CreativeStudioServiceError &&
            (error.code === 'invalid_route' || error.code === 'provider_error')
          ? error.code
          : 'storage_error';
    return { ok: false, error: { code, messageKey: MESSAGE_KEYS[code] } };
  }
};

/** Registers only the project-schema-independent image connection settings surface. */
export const initCreativeStudioConnectionBridgeV1 = (
  dependencies: CreativeStudioConnectionBridgeDependenciesV1 = defaultDependencies
): void => {
  const enabled = dependencies.isFeatureEnabled ?? (() => CREATIVE_STUDIO_ENABLED);
  const run = <T>(operation: () => Promise<T>): Promise<StudioCommandResult<T>> => command(enabled, operation);
  const controller = () => dependencies.getController();

  ipcBridge.creativeStudio.listConnectionCandidates.provider(() => run(() => controller().listConnectionCandidates()));
  ipcBridge.creativeStudio.listConnections.provider(() => run(() => controller().listConnections()));
  ipcBridge.creativeStudio.validateConnection.provider((input) => run(() => controller().validateConnection(input)));
  ipcBridge.creativeStudio.saveConnection.provider((input) => run(() => controller().saveConnection(input)));
  ipcBridge.creativeStudio.removeConnection.provider((input) => run(() => controller().removeConnection(input)));
};
