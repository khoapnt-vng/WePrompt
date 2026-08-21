/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { IProvider } from '@/common/config/storage';
import type {
  StudioConnectionBinding,
  StudioConnectionCandidate,
  StudioConnectionCapabilities,
  StudioCancellationPolicy,
  StudioMediaKind,
  StudioProviderAdapterId,
  StudioProviderRef,
  StudioRouteCatalogEntry,
  StudioRouteConstraints,
} from '@/common/types/project/creativeStudioTypes';
import { isImageGenSupported, isImagesApiModel } from '@/common/utils/imageModelAllowlist';
import { getBytePlusSeedanceModelSpec, isSupportedBytePlusSeedanceProvider } from './adapters/bytePlusSeedanceAdapter';
import {
  getOpenRouterVideoModelSpec,
  isSupportedOpenRouterVideoProvider,
  OPENROUTER_VIDEO_MODELS,
} from './adapters/openRouterVideoAdapter';

export type StudioProviderResolverDeps = {
  listProviders: () => Promise<IProvider[]>;
  listConnections: () => Promise<StudioConnectionBinding[]>;
};

export type StudioGenerationRouteCatalog = {
  routes: StudioGenerationRoute[];
  diagnostics: StudioGenerationRouteDiagnostic[];
  generationCatalogVersion: string;
};

/** Main-only route. The renderer receives the opaque choiceId projection. */
export type StudioGenerationRoute = Omit<StudioRouteCatalogEntry, 'integrationLabelKey'> & {
  adapterId: StudioProviderAdapterId;
  cancellationPolicy: StudioCancellationPolicy;
};

export type StudioGenerationRouteDiagnostic =
  | { status: 'available'; route: StudioGenerationRoute }
  | { status: 'retired'; providerId: string; adapterId: StudioProviderAdapterId; model: string }
  | {
      status: 'needs_setup';
      providerId: string;
      providerName: string;
      adapterId: StudioProviderAdapterId;
      model: string;
    }
  | { status: 'health'; providerId: string; adapterId: StudioProviderAdapterId; model: string };

export type StudioProviderResolver = {
  listConnectionCandidates(): Promise<StudioConnectionCandidate[]>;
  listGenerationRoutes(): Promise<StudioGenerationRouteCatalog>;
  isGenerationRouteAvailable(route: StudioProviderRef & { kind: StudioMediaKind }): Promise<boolean>;
};

const IMAGE_ADAPTER: StudioProviderAdapterId = 'weprompt-image-v1';
const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const ALL_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
const ALL_RESOLUTIONS = ['720p', '1080p'] as const;
const CANCELLATION_POLICY_RANK: Record<StudioCancellationPolicy, number> = {
  none: 0,
  queued_only: 1,
  queued_and_running: 2,
};

const isUnsafeTextCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0)!;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff);
};

const isSafeProviderId = (value: string): boolean => SAFE_ID.test(value);
const isSafeProviderModel = (value: string): boolean =>
  value.length > 0 && value.length <= 256 && value === value.trim() && !Array.from(value).some(isUnsafeTextCharacter);
const providerIsConfigured = (provider: IProvider): boolean => {
  const apiKey = typeof provider.api_key === 'string' ? provider.api_key.trim() : '';
  const baseUrl = typeof provider.base_url === 'string' ? provider.base_url.trim() : '';
  return apiKey.length > 0 && baseUrl.length > 0;
};

/** Creates a stable opaque renderer choice without exposing the adapter tuple. */
export const createStudioMediaChoiceId = (route: StudioProviderRef & { kind: StudioMediaKind }): string =>
  `choice_${createHash('sha256')
    .update(
      `studio-media-choice-v1\u0000${route.providerId}\u0000${route.adapterId}\u0000${route.model}\u0000${route.kind}`
    )
    .digest('hex')
    .slice(0, 24)}`;

const sanitizedProviderName = (provider: IProvider): string => {
  const normalized = Array.from(provider.name, (character) => (isUnsafeTextCharacter(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256);
  return normalized || provider.id;
};

const available = (provider: IProvider, model: string): boolean =>
  provider.enabled !== false &&
  provider.model_enabled?.[model] !== false &&
  provider.model_health?.[model]?.status !== 'unhealthy' &&
  providerIsConfigured(provider);

const modelHealth = (provider: IProvider, model: string): StudioGenerationRoute['health'] => {
  if (!available(provider, model)) return 'unavailable';
  return provider.model_health?.[model]?.status === 'healthy' ? 'available' : 'unknown';
};

const connectionCandidateModels = (provider: IProvider, models: readonly string[]) =>
  [...new Set(models.filter((model) => isSafeProviderModel(model) && available(provider, model)))]
    .map((model) => ({
      model,
      health: modelHealth(provider, model),
    }))
    .toSorted((left, right) => left.model.localeCompare(right.model));

const imageConstraints = (model: string, capabilities: StudioConnectionCapabilities): StudioRouteConstraints => ({
  aspectRatios: [...ALL_RATIOS],
  resolutions: [...ALL_RESOLUTIONS],
  minDurationSeconds: 1,
  maxDurationSeconds: 60,
  supportsFirstFrame: !isImagesApiModel(model),
  maxConditioningImages: isImagesApiModel(model) ? 0 : (capabilities.maxConditioningImages ?? 0),
  silentOutput: true,
});

const seedanceConstraints = (model: string): StudioRouteConstraints | null => {
  const spec = getBytePlusSeedanceModelSpec(model);
  return spec
    ? {
        aspectRatios: [...spec.ratios],
        resolutions: [...spec.resolutions],
        minDurationSeconds: spec.minDuration,
        maxDurationSeconds: spec.maxDuration,
        supportsFirstFrame: true,
        maxConditioningImages: 0,
        silentOutput: true,
      }
    : null;
};

const openRouterConstraints = (model: string): StudioRouteConstraints | null => {
  const spec = getOpenRouterVideoModelSpec(model);
  return spec
    ? {
        aspectRatios: [...spec.ratios],
        resolutions: [...spec.resolutions],
        minDurationSeconds: spec.minDuration,
        maxDurationSeconds: spec.maxDuration,
        supportsFirstFrame: spec.supportsFirstFrame,
        maxConditioningImages: 0,
        silentOutput: !spec.supportsAudio,
      }
    : null;
};

const bindingConstraints = (capabilities: StudioConnectionCapabilities): StudioRouteConstraints | null => {
  if (
    !capabilities.aspectRatios?.length ||
    !capabilities.resolutions?.length ||
    capabilities.minDurationSeconds === undefined ||
    capabilities.maxDurationSeconds === undefined
  ) {
    return null;
  }
  return {
    aspectRatios: [...capabilities.aspectRatios].toSorted(),
    resolutions: [...capabilities.resolutions].toSorted(),
    minDurationSeconds: capabilities.minDurationSeconds,
    maxDurationSeconds: capabilities.maxDurationSeconds,
    supportsFirstFrame: capabilities.supportsFirstFrame ?? false,
    maxConditioningImages: 0,
    silentOutput: capabilities.audioModes?.includes('none') ?? false,
  };
};

const bindingMediaKind = (binding: StudioConnectionBinding): StudioMediaKind | null => {
  const expected = binding.adapterId === IMAGE_ADAPTER ? 'image' : 'video';
  return binding.capabilities.mediaKinds.length === 1 && binding.capabilities.mediaKinds[0] === expected
    ? expected
    : null;
};

const bindingCancellationPolicy = (capabilities: StudioConnectionCapabilities): StudioCancellationPolicy => {
  const explicit = capabilities.cancellationPolicy;
  if (explicit === 'none' || explicit === 'queued_only' || explicit === 'queued_and_running') return explicit;
  return capabilities.cancellation === true ? 'queued_only' : 'none';
};

const routeIdentity = (route: StudioGenerationRoute): string =>
  `${route.adapterId}\u0000${route.providerId}\u0000${route.model}\u0000${route.kind}`;

const diagnosticIdentity = (diagnostic: Exclude<StudioGenerationRouteDiagnostic, { status: 'available' }>): string =>
  `${diagnostic.adapterId}\u0000${diagnostic.providerId}\u0000${diagnostic.model}`;

const resolveBindingRoute = (
  binding: StudioConnectionBinding,
  providers: IProvider[]
): StudioGenerationRouteDiagnostic => {
  const provider = providers.find((candidate) => candidate.id === binding.providerId);
  const kind = bindingMediaKind(binding);
  const retired = (): StudioGenerationRouteDiagnostic => ({
    status: 'retired',
    providerId: binding.providerId,
    adapterId: binding.adapterId,
    model: binding.model,
  });
  if (!provider || !isSafeProviderId(provider.id) || !isSafeProviderModel(binding.model) || !kind) {
    return retired();
  }
  if (!providerIsConfigured(provider)) {
    return {
      status: 'needs_setup',
      providerId: provider.id,
      providerName: sanitizedProviderName(provider),
      adapterId: binding.adapterId,
      model: binding.model,
    };
  }
  if (
    provider.enabled === false ||
    provider.model_enabled?.[binding.model] === false ||
    provider.model_health?.[binding.model]?.status === 'unhealthy'
  ) {
    return {
      status: 'health',
      providerId: provider.id,
      adapterId: binding.adapterId,
      model: binding.model,
    };
  }
  if (binding.adapterId === IMAGE_ADAPTER && !isImageGenSupported(provider, binding.model)) return retired();
  if (binding.adapterId === 'weprompt-media-gateway-v1' && !binding.capabilities.audioModes?.includes('none')) {
    return retired();
  }
  if (binding.adapterId === 'byteplus-seedance-v1' && !isSupportedBytePlusSeedanceProvider(provider, binding.model)) {
    return retired();
  }
  if (binding.adapterId === 'openrouter-video-v1' && !isSupportedOpenRouterVideoProvider(provider, binding.model)) {
    return retired();
  }
  const constraints =
    binding.adapterId === IMAGE_ADAPTER
      ? imageConstraints(binding.model, binding.capabilities)
      : binding.adapterId === 'byteplus-seedance-v1'
        ? seedanceConstraints(binding.model)
        : binding.adapterId === 'openrouter-video-v1'
          ? openRouterConstraints(binding.model)
          : bindingConstraints(binding.capabilities);
  if (!constraints) return retired();
  // Only the host-locked OpenRouter adapter may surface audio-capable output;
  // every other adapter retains the existing silent-only security invariant.
  if (!constraints.silentOutput && binding.adapterId !== 'openrouter-video-v1') return retired();
  return {
    status: 'available',
    route: {
      choiceId: createStudioMediaChoiceId({
        providerId: provider.id,
        adapterId: binding.adapterId,
        model: binding.model,
        kind,
      }),
      providerId: provider.id,
      providerName: sanitizedProviderName(provider),
      model: binding.model,
      health: modelHealth(provider, binding.model),
      adapterId: binding.adapterId,
      cancellationPolicy: bindingCancellationPolicy(binding.capabilities),
      kind,
      constraints,
    },
  };
};

/** Resolves fresh provider rows and validated bindings into generation-only routes. */
export const createStudioProviderResolver = (deps: StudioProviderResolverDeps): StudioProviderResolver => {
  const listConnectionCandidates = async (): Promise<StudioConnectionCandidate[]> => {
    const providers = await deps.listProviders();
    return providers
      .filter(
        (provider) => isSafeProviderId(provider.id) && provider.enabled !== false && providerIsConfigured(provider)
      )
      .map((provider) => ({
        providerId: provider.id,
        providerName: sanitizedProviderName(provider),
        models: connectionCandidateModels(provider, provider.models),
        integrationModels: [
          {
            integrationLabelKey: 'openRouterVideo' as const,
            models: isSupportedOpenRouterVideoProvider(provider)
              ? connectionCandidateModels(provider, Object.keys(OPENROUTER_VIDEO_MODELS))
              : [],
          },
        ],
      }))
      .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
  };

  const listGenerationRoutes = async (): Promise<StudioGenerationRouteCatalog> => {
    const [providers, connections] = await Promise.all([deps.listProviders(), deps.listConnections()]);
    const uniqueRoutes = new Map<string, StudioGenerationRoute>();
    const rejected = new Map<string, Exclude<StudioGenerationRouteDiagnostic, { status: 'available' }>>();
    for (const binding of connections) {
      const diagnostic = resolveBindingRoute(binding, providers);
      if (diagnostic.status === 'available') {
        const route = diagnostic.route;
        const identity = routeIdentity(route);
        const existing = uniqueRoutes.get(identity);
        if (
          existing === undefined ||
          CANCELLATION_POLICY_RANK[route.cancellationPolicy] < CANCELLATION_POLICY_RANK[existing.cancellationPolicy]
        ) {
          uniqueRoutes.set(identity, route);
        }
        rejected.delete(`${route.adapterId}\u0000${route.providerId}\u0000${route.model}`);
      } else {
        const identity = diagnosticIdentity(diagnostic);
        if (!uniqueRoutes.has(`${identity}\u0000${bindingMediaKind(binding) ?? ''}`) && !rejected.has(identity)) {
          rejected.set(identity, diagnostic);
        }
      }
    }
    const routes = [...uniqueRoutes.values()].toSorted((left, right) =>
      routeIdentity(left).localeCompare(routeIdentity(right))
    );
    const stable = routes.map(
      ({ choiceId, providerId, providerName, adapterId, model, health, kind, constraints, cancellationPolicy }) => ({
        choiceId,
        providerId,
        providerName,
        adapterId,
        model,
        health,
        kind,
        constraints,
        cancellationPolicy,
      })
    );
    return {
      routes,
      diagnostics: [...rejected.values()].toSorted((left, right) =>
        diagnosticIdentity(left).localeCompare(diagnosticIdentity(right))
      ),
      generationCatalogVersion: createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16),
    };
  };

  const isGenerationRouteAvailable = async (route: StudioProviderRef & { kind: StudioMediaKind }): Promise<boolean> => {
    const catalog = await listGenerationRoutes();
    return catalog.routes.some(
      (candidate) =>
        candidate.providerId === route.providerId &&
        candidate.adapterId === route.adapterId &&
        candidate.model === route.model &&
        candidate.kind === route.kind
    );
  };

  return { listConnectionCandidates, listGenerationRoutes, isGenerationRouteAvailable };
};
