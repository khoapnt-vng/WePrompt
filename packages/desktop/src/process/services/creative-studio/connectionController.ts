/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { IProvider } from '@/common/config/storage';
import type {
  StudioConnectionBinding,
  StudioConnectionCandidate,
  StudioConnectionInventory,
  StudioConnectionRecord,
  StudioConnectionValidationFailureReason,
  StudioConnectionValidationResult,
  StudioConnectionValidationSuccess,
  StudioRemoveConnectionRequest,
  StudioSaveConnectionRequest,
  StudioValidateConnectionRequest,
} from '@/common/types/project/creativeStudioTypes';
import { isImagesApiModel } from '@/common/utils/imageModelAllowlist';
import { ProviderDeadlineError, runWithProviderDeadline, type GenerationProviderAdapterRegistry } from './adapters';
import { projectStudioImageConnectionCandidates } from './providerResolver';
import { CreativeStudioServiceError, StudioConnectionValidationError } from './service/projectMutations';
import type { StudioConnectionManifestV1 } from './store/connectionManifest';
import { CreativeStudioStoreError } from './store/contracts';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const IMAGE_INTEGRATION = {
  integrationId: 'integration_g7Q2mB4p',
  adapterId: 'weprompt-image-v1',
  kind: 'image',
  labelKey: 'imageApi',
} as const;
const VALIDATION_TIMEOUT_MS = 30_000;

export type StudioConnectionControllerV1 = {
  listConnectionCandidates(): Promise<StudioConnectionCandidate[]>;
  listConnections(): Promise<StudioConnectionInventory>;
  listImageBindings(): Promise<StudioConnectionBinding[]>;
  validateConnection(input: StudioValidateConnectionRequest): Promise<StudioConnectionValidationResult>;
  saveConnection(input: StudioSaveConnectionRequest): Promise<StudioConnectionRecord>;
  removeConnection(input: StudioRemoveConnectionRequest): Promise<boolean>;
};

export type StudioConnectionControllerDepsV1 = {
  manifest: Pick<StudioConnectionManifestV1, 'listConnections' | 'saveConnection' | 'removeConnection'>;
  listProviders(): Promise<IProvider[]>;
  adapters: GenerationProviderAdapterRegistry;
  injectedBindings?: readonly StudioConnectionBinding[];
  now?: () => Date;
  createConnectionId?: () => string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = new Set(keys);
  return (
    Reflect.ownKeys(value).length === expected.size &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string' && expected.has(key))
  );
};

const invalid = (): never => {
  throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio image connection request');
};

const assertRequest = (input: unknown): void => {
  if (!isRecord(input) || !hasExactKeys(input, ['providerId', 'integrationId', 'model'])) return invalid();
  if (
    typeof input.providerId !== 'string' ||
    !SAFE_ID.test(input.providerId) ||
    input.integrationId !== IMAGE_INTEGRATION.integrationId ||
    typeof input.model !== 'string' ||
    input.model.length === 0 ||
    input.model.length > 256 ||
    input.model !== input.model.trim() ||
    Array.from(input.model).some((character) => {
      const codePoint = character.codePointAt(0)!;
      return (
        codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      );
    })
  ) {
    return invalid();
  }
};

const providerIsAvailable = (provider: IProvider, model: string): boolean =>
  provider.enabled !== false &&
  provider.model_enabled?.[model] !== false &&
  provider.model_health?.[model]?.status !== 'unhealthy' &&
  typeof provider.api_key === 'string' &&
  provider.api_key.trim().length > 0 &&
  typeof provider.base_url === 'string' &&
  provider.base_url.trim().length > 0;

const failureReason = (value: unknown): StudioConnectionValidationFailureReason | null => {
  if (!isRecord(value) || !hasExactKeys(value, ['code'])) return null;
  switch (value.code) {
    case 'unsupported':
    case 'auth':
    case 'rate_limited':
    case 'provider_unavailable':
    case 'timeout':
    case 'invalid_response':
    case 'unknown':
      return value.code;
    case 'no_output':
      return 'unknown';
    default:
      return null;
  }
};

const imageCapabilities = (
  model: string,
  capabilities: Record<string, unknown> | undefined
): StudioConnectionBinding['capabilities'] => {
  const maximum = capabilities?.maxConditioningImages;
  return {
    mediaKinds: ['image'],
    supportsFirstFrame: !isImagesApiModel(model),
    maxConditioningImages:
      !isImagesApiModel(model) && Number.isInteger(maximum) && (maximum as number) >= 0 && (maximum as number) <= 6
        ? (maximum as number)
        : 0,
    cancellationPolicy: 'none',
  };
};

const toConnectionRecord = (binding: StudioConnectionBinding): StudioConnectionRecord => {
  const {
    cancellationPolicy: _cancellationPolicy,
    cancellation: _legacyCancellation,
    ...capabilities
  } = imageCapabilities(binding.model, binding.capabilities);
  return {
    bindingId: binding.id,
    providerId: binding.providerId,
    integrationId: IMAGE_INTEGRATION.integrationId,
    labelKey: IMAGE_INTEGRATION.labelKey,
    model: binding.model,
    capabilities,
    validatedAt: binding.validatedAt,
  };
};

const toValidation = (binding: StudioConnectionBinding): StudioConnectionValidationSuccess => {
  const { bindingId: _bindingId, ...validation } = toConnectionRecord(binding);
  return validation;
};

/** Project-schema-independent image connection authority shared by Settings and Pilot generation. */
export const createStudioConnectionControllerV1 = (
  deps: StudioConnectionControllerDepsV1
): StudioConnectionControllerV1 => {
  const now = deps.now ?? (() => new Date());
  const createConnectionId = deps.createConnectionId ?? (() => `connection_${randomUUID().replaceAll('-', '')}`);
  const injected = (deps.injectedBindings ?? []).filter((binding) => binding.adapterId === IMAGE_INTEGRATION.adapterId);
  const injectedIds = new Set(injected.map((binding) => binding.id));

  const listImageBindings = async (): Promise<StudioConnectionBinding[]> => [
    ...(await deps.manifest.listConnections()).filter(
      (binding) => binding.adapterId === IMAGE_INTEGRATION.adapterId && !injectedIds.has(binding.id)
    ),
    ...injected.map((binding) => structuredClone(binding)),
  ];

  const validateBinding = async (
    input: StudioValidateConnectionRequest
  ): Promise<
    | { valid: true; binding: StudioConnectionBinding }
    | { valid: false; reason: StudioConnectionValidationFailureReason }
  > => {
    assertRequest(input);
    let providers: IProvider[];
    try {
      providers = await deps.listProviders();
    } catch {
      throw new CreativeStudioStoreError('storage_error', 'Studio provider inventory is unavailable');
    }
    const provider = providers.find((candidate) => candidate.id === input.providerId);
    if (provider === undefined || !providerIsAvailable(provider, input.model)) {
      throw new CreativeStudioServiceError('invalid_route');
    }
    const adapter = deps.adapters.get(IMAGE_INTEGRATION.adapterId);
    if (adapter === undefined) throw new CreativeStudioServiceError('invalid_route');
    let validation: unknown;
    try {
      validation = await runWithProviderDeadline(new AbortController().signal, VALIDATION_TIMEOUT_MS, (signal) =>
        adapter.validateConnection({ model: input.model }, provider, signal)
      );
    } catch (error) {
      if (error instanceof ProviderDeadlineError) return { valid: false, reason: 'timeout' };
      throw error;
    }
    if (!isRecord(validation) || (validation.ok !== true && validation.ok !== false)) {
      throw new CreativeStudioServiceError('provider_error');
    }
    if (validation.ok === false) {
      const reason = failureReason(validation.error);
      if (reason === null) throw new CreativeStudioServiceError('provider_error');
      return { valid: false, reason };
    }
    const capabilities = isRecord(validation.capabilities) ? validation.capabilities : undefined;
    const validatedAt = now().toISOString();
    if (new Date(validatedAt).toISOString() !== validatedAt) {
      throw new CreativeStudioStoreError('storage_error', 'Studio connection clock is invalid');
    }
    return {
      valid: true,
      binding: {
        schemaVersion: 1,
        id: 'validation_only',
        providerId: provider.id,
        adapterId: IMAGE_INTEGRATION.adapterId,
        model: input.model,
        capabilities: imageCapabilities(input.model, capabilities),
        validatedAt,
      },
    };
  };

  return {
    async listConnectionCandidates() {
      try {
        return projectStudioImageConnectionCandidates(await deps.listProviders());
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio provider inventory is unavailable');
      }
    },
    async listConnections() {
      return {
        integrations: [
          {
            integrationId: IMAGE_INTEGRATION.integrationId,
            kind: IMAGE_INTEGRATION.kind,
            labelKey: IMAGE_INTEGRATION.labelKey,
          },
        ],
        connections: (await listImageBindings()).map(toConnectionRecord),
      };
    },
    listImageBindings,
    async validateConnection(input) {
      const validation = await validateBinding(input);
      if (validation.valid === false) return { valid: false, reason: validation.reason };
      return { valid: true, connection: toValidation(validation.binding) };
    },
    async saveConnection(input) {
      const validation = await validateBinding(input);
      if (validation.valid === false) throw new StudioConnectionValidationError(validation.reason);
      const id = createConnectionId();
      if (!SAFE_ID.test(id)) throw new CreativeStudioStoreError('storage_error', 'Invalid Studio connection id');
      const saved = await deps.manifest.saveConnection({ ...validation.binding, id });
      return toConnectionRecord(saved);
    },
    async removeConnection(input) {
      if (
        !isRecord(input) ||
        !hasExactKeys(input, ['bindingId']) ||
        typeof input.bindingId !== 'string' ||
        !SAFE_ID.test(input.bindingId)
      ) {
        return invalid();
      }
      const bindingId = input.bindingId;
      if (injectedIds.has(bindingId)) return false;
      const current = await deps.manifest.listConnections();
      if (!current.some((binding) => binding.id === bindingId && binding.adapterId === IMAGE_INTEGRATION.adapterId)) {
        return false;
      }
      return deps.manifest.removeConnection(bindingId);
    },
  };
};
