/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { ipcBridge } from '@/common';
import { httpRequest } from '@/common/adapter/httpBridge';
import { CREATIVE_STUDIO_ENABLED } from '@/common/config/constants';
import type { IProvider } from '@/common/config/storage';
import type { IAttestedSessionMcpServer, ISessionMcpServer } from '@/common/config/storage';
import type { StudioPilotDirectorSessionAuthorityV3 } from '@/common/types/project/creativeStudioPilotMcpEnv';
import { app, BrowserWindow, dialog, protocol } from 'electron';
import { createGenerationProviderAdapterRegistry } from './adapters';
import { createStudioE2EFakeBundle, type StudioE2EFakeBundle } from './adapters/e2eFakeAdapter';
import { createStudioConnectionControllerV1, type StudioConnectionControllerV1 } from './connectionController';
import {
  installCreativeStudioProtocol,
  type CreativeStudioProtocolInstallation,
  type CreativeStudioProtocolInstaller,
} from './mediaProtocol';
import { createStudioProviderResolver } from './providerResolver';
import { createStudioPilotGeneratedUrlResolverV3 } from './service/pilot/runtime/generatedUrlResolver';
import {
  createCreativeStudioPilotRuntimeV3,
  type CreativeStudioPilotRuntimeDepsV3,
  type CreativeStudioPilotRuntimeV3,
} from './service/pilot/runtime/factory';
import { createStudioConnectionManifestV1 } from './store/connectionManifest';
import { getCreativeStudioRootDir } from '@process/utils/initStorage';
import { getBuiltinMcpScriptPath } from '@process/utils/initStorage';
import { BUILTIN_STUDIO_NAME, BUILTIN_STUDIO_SCRIPT } from '@process/resources/builtinMcp/constants';
import { createSessionMcpTrustClaim, fingerprintSessionMcpServer } from '@process/backend/sessionMcpTrust';
import { STUDIO_PILOT_ENV } from '@/common/types/project/creativeStudioPilotMcpEnv';

type RuntimeEnvironmentV3 = {
  AIONUI_E2E_TEST?: string;
  AIONUI_E2E_STUDIO_FAKE?: string;
};

export type CreativeStudioPilotProductionProtocolV3 = {
  install(
    installer: CreativeStudioProtocolInstaller,
    runtime: CreativeStudioPilotRuntimeV3
  ): CreativeStudioProtocolInstallation;
  uninstall(installation: CreativeStudioProtocolInstallation | null): Promise<void> | void;
};

export type CreativeStudioPilotProductionRuntimeDepsV3 = CreativeStudioPilotRuntimeDepsV3 & {
  enabled: boolean;
  connections: StudioConnectionControllerV1;
  protocol: CreativeStudioPilotProductionProtocolV3;
  createPilotRuntime?: (deps: CreativeStudioPilotRuntimeDepsV3) => CreativeStudioPilotRuntimeV3;
  disposeDependencies?: () => Promise<void> | void;
  onUpdate?: (
    update: Parameters<CreativeStudioPilotRuntimeV3['entryPoint']['watchProjectUpdatesV3']>[0] extends (
      update: infer T
    ) => void
      ? T
      : never
  ) => void;
};

export type CreativeStudioPilotProductionRuntimeV3 = {
  readonly entryPoint: CreativeStudioPilotRuntimeV3['entryPoint'];
  readonly pilot: CreativeStudioPilotRuntimeV3;
  readonly connections: StudioConnectionControllerV1;
  getDirectorSessionAuthority(projectId: string): Promise<StudioPilotDirectorSessionAuthorityV3>;
  getDirectorSessionServer(projectId: string): Promise<IAttestedSessionMcpServer>;
  start(): Promise<void>;
  onBackendReady(): Promise<void>;
  dispose(): Promise<void>;
};

const DIRECTOR_POLL_INTERVAL_MS = 100;

/** Owns the one production schema-6 runtime, protocol registration, updates, and disposal. */
export const createCreativeStudioPilotProductionRuntimeV3 = (
  deps: CreativeStudioPilotProductionRuntimeDepsV3
): CreativeStudioPilotProductionRuntimeV3 => {
  const pilot = (deps.createPilotRuntime ?? createCreativeStudioPilotRuntimeV3)(deps);
  let installation: CreativeStudioProtocolInstallation | null = null;
  let startPromise: Promise<void> | null = null;
  let backendReadyPromise: Promise<void> | null = null;
  let disposePromise: Promise<void> | null = null;
  let disposed = false;
  let directorTimer: ReturnType<typeof setTimeout> | null = null;
  let directorTickRunning = false;
  let directorTickPromise: Promise<void> | null = null;
  const unwatch = pilot.entryPoint.watchProjectUpdatesV3((update) => deps.onUpdate?.(update));

  const start = (): Promise<void> => {
    if (disposed || !deps.enabled) return Promise.resolve();
    startPromise ??= (async () => {
      installation = deps.protocol.install(protocol, pilot);
    })();
    return startPromise;
  };

  const onBackendReady = async (): Promise<void> => {
    await start();
    if (disposed || !deps.enabled) return;
    if (backendReadyPromise === null) {
      const attempt = pilot.startV3();
      backendReadyPromise = attempt;
      try {
        await attempt;
      } catch (error) {
        if (backendReadyPromise === attempt) backendReadyPromise = null;
        throw error;
      }
      const scheduleDirectorTick = (): void => {
        if (disposed || directorTimer !== null) return;
        directorTimer = setTimeout(() => {
          directorTimer = null;
          if (directorTickRunning || disposed) return scheduleDirectorTick();
          directorTickRunning = true;
          directorTickPromise = pilot.store
            .inspectProjectsV3()
            .then(async ({ healthyProjectIds }) => {
              for (const projectId of healthyProjectIds) {
                // One project's malformed mailbox cannot stop other Director sessions.
                // eslint-disable-next-line no-await-in-loop
                await pilot.directorProcessor.processProject(projectId).catch((): null => null);
              }
            })
            .catch((): undefined => undefined)
            .finally(() => {
              directorTickRunning = false;
              directorTickPromise = null;
              scheduleDirectorTick();
            });
        }, DIRECTOR_POLL_INTERVAL_MS);
        directorTimer.unref?.();
      };
      scheduleDirectorTick();
      return;
    }
    await backendReadyPromise;
  };

  return {
    entryPoint: pilot.entryPoint,
    pilot,
    connections: deps.connections,
    async getDirectorSessionAuthority(projectId) {
      const projectDir = await pilot.store.getVerifiedProjectDirectoryV3(projectId);
      if (projectDir === null) throw new Error('Studio Pilot project is unavailable');
      return {
        serverId: `studio-pilot-${projectId}`,
        serverName: BUILTIN_STUDIO_NAME,
        scriptPath: getBuiltinMcpScriptPath(BUILTIN_STUDIO_SCRIPT),
        projectDir,
      };
    },
    async getDirectorSessionServer(projectId) {
      const authority = await this.getDirectorSessionAuthority(projectId);
      const server: ISessionMcpServer = {
        id: authority.serverId,
        name: authority.serverName,
        transport: {
          type: 'stdio',
          command: 'node',
          args: [authority.scriptPath],
          env: {
            [STUDIO_PILOT_ENV.projectId]: projectId,
            [STUDIO_PILOT_ENV.projectDir]: authority.projectDir,
          },
        },
      };
      return {
        server,
        serverFingerprint: fingerprintSessionMcpServer(server),
        trustClaim: createSessionMcpTrustClaim(server),
      };
    },
    start,
    onBackendReady,
    dispose(): Promise<void> {
      disposePromise ??= (async () => {
        disposed = true;
        if (directorTimer !== null) clearTimeout(directorTimer);
        directorTimer = null;
        unwatch();
        const errors: unknown[] = [];
        await backendReadyPromise?.catch((): undefined => undefined);
        await directorTickPromise?.catch((): undefined => undefined);
        try {
          await deps.protocol.uninstall(installation);
        } catch (error) {
          errors.push(error);
        }
        try {
          await pilot.dispose();
        } catch (error) {
          errors.push(error);
        }
        try {
          await deps.disposeDependencies?.();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length > 0) throw new AggregateError(errors, 'Creative Studio Pilot disposal failed');
      })();
      return disposePromise;
    },
  };
};

const shouldEnableFakeAdapter = (environment: RuntimeEnvironmentV3, isPackaged: boolean): boolean =>
  !isPackaged && environment.AIONUI_E2E_TEST === '1' && environment.AIONUI_E2E_STUDIO_FAKE === '1';

const mergeProviders = (
  listProviders: () => Promise<IProvider[]>,
  fake: StudioE2EFakeBundle | null
): (() => Promise<IProvider[]>) => {
  if (fake === null) return listProviders;
  return async () => [...(await listProviders()).filter((provider) => provider.id !== fake.provider.id), fake.provider];
};

let productionRuntime: CreativeStudioPilotProductionRuntimeV3 | null = null;

/** The sole production Studio constructor selected by app startup and the Pilot bridge. */
export const getCreativeStudioPilotProductionRuntimeV3 = (): CreativeStudioPilotProductionRuntimeV3 => {
  if (productionRuntime !== null) return productionRuntime;

  const rootDir = getCreativeStudioRootDir();
  const connectionManifest = createStudioConnectionManifestV1({ rootDir });
  const fake = shouldEnableFakeAdapter(process.env, app.isPackaged)
    ? createStudioE2EFakeBundle({ rootDir, catalogProfile: 'lifecycle' })
    : null;
  const baseAdapters = createGenerationProviderAdapterRegistry({ image: { workspaceDir: rootDir } });
  const adapters = fake === null ? baseAdapters : new Map([...baseAdapters, ...fake.adapters]);
  const listProviders = mergeProviders(() => httpRequest<IProvider[]>('GET', '/api/providers'), fake);
  const injectedBindings = fake?.connections.filter((connection) => connection.adapterId === 'weprompt-image-v1') ?? [];
  const injectedBindingIds = new Set(injectedBindings.map((connection) => connection.id));
  const listConnections = async () => [
    ...(await connectionManifest.listConnections())
      .filter((connection) => fake === null || !fake.connections.some((candidate) => candidate.id === connection.id))
      .filter((connection) => connection.adapterId === 'weprompt-image-v1' && !injectedBindingIds.has(connection.id)),
    ...injectedBindings,
  ];
  const providerResolver = createStudioProviderResolver({ listProviders, listConnections });
  const connections = createStudioConnectionControllerV1({
    manifest: connectionManifest,
    listProviders,
    adapters,
    injectedBindings,
  });

  productionRuntime = createCreativeStudioPilotProductionRuntimeV3({
    rootDir,
    enabled: CREATIVE_STUDIO_ENABLED,
    connections,
    providerResolver,
    adapters,
    listProviders,
    pickPhoto: async () => {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = await dialog.showOpenDialog(parent, {
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      });
      const selected = result.canceled ? undefined : result.filePaths[0];
      return selected === undefined ? null : { path: selected, fileName: path.basename(selected) };
    },
    resolveGeneratedUrl: createStudioPilotGeneratedUrlResolverV3(),
    onProjectUpdated: () => undefined,
    protocol: {
      install: (installer, runtime) =>
        installCreativeStudioProtocol(installer, {
          resolveAsset: (projectId, assetId) => runtime.media.resolveManagedAssetV3(projectId, assetId),
        }),
      uninstall: async (current) => {
        try {
          protocol.unhandle('weprompt-studio');
        } finally {
          await current?.dispose();
        }
      },
    },
    onUpdate: (update) => {
      if (update.source === 'prepared') {
        ipcBridge.creativeStudioPilot.projectUpdated.emit({ source: 'prepared', projectId: update.projectId });
      } else {
        ipcBridge.creativeStudioPilot.projectUpdated.emit({
          source: 'durable',
          facts: { projectId: update.facts.projectId },
        });
      }
    },
    disposeDependencies: async () => {
      await fake?.dispose();
    },
  });
  return productionRuntime;
};

/** Starts recovery after backend availability without exposing provider details in logs. */
export const resumeCreativeStudioPilotAfterBackendReadyV3 = (
  runtime: Pick<CreativeStudioPilotProductionRuntimeV3, 'onBackendReady'>,
  logError: (message: string, errorName: string) => void = console.error
): void => {
  void runtime
    .onBackendReady()
    .catch((error: unknown) =>
      logError('[CreativeStudio] Failed to resume Pilot jobs:', error instanceof Error ? error.name : 'UnknownError')
    );
};

/** Does not instantiate Studio on a quit path that never selected it. */
export const disposeCreativeStudioPilotProductionRuntimeV3 = async (): Promise<void> => {
  await productionRuntime?.dispose();
};
