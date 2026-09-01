/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { httpRequest } from '@/common/adapter/httpBridge';
import { CREATIVE_STUDIO_ENABLED } from '@/common/config/constants';
import type { IProvider } from '@/common/config/storage';
import { app, protocol } from 'electron';
import {
  createCreativeStudioServiceV2,
  type CreativeStudioServiceV2,
  type CreativeStudioServiceV2Deps,
} from './service/v2Service';
import {
  createCreativeStudioStore,
  CreativeStudioStoreError,
  type CreativeStudioStore,
  type StudioProjectCommitFacts,
  type StudioProjectCommitObserver,
} from './store';
import {
  createStudioDirectorCommandMailboxV2,
  type StudioDirectorCommandMailboxDepsV2,
  type StudioDirectorCommandMailboxV2,
} from './service/director/mailbox';
import {
  createStudioDirectorCommandServiceV2,
  type StudioDirectorCommandServiceDepsV2,
  type StudioDirectorCommandServiceV2,
} from './service/director/service';
import {
  createStudioDirectorCommandProcessorV2,
  createStudioDirectorCommitTrackerV2,
  type StudioDirectorCommandProcessorDepsV2,
  type StudioDirectorCommandProcessorV2,
  type StudioDirectorCommitTrackerV2,
} from './service/director/processor';
import { createStudioMediaStore, getAvailableStudioDiskBytes, type StudioMediaStore } from './mediaStore';
import {
  createStudioProviderResolver,
  type StudioProviderResolver,
  type StudioProviderResolverDeps,
} from './providerResolver';
import { createGenerationProviderAdapterRegistry, type GenerationProviderAdapterRegistry } from './adapters';
import {
  createStudioE2EFakeBundle,
  type StudioE2EFakeBundle,
  type StudioE2EFakeBundleDeps,
} from './adapters/e2eFakeAdapter';
import { createStudioJobManager, type StudioJobManagerDeps, type StudioJobManagerV2 } from './jobManager';
import { createConfiguredStudioRateCardV2 } from './rateCardConfig';
import { createStudioExportCatalogStoreV2, type StudioExportCatalogStoreV2 } from './service/schema2/exports';
import { CreativeStudioServiceError } from './service/projectMutations';
import {
  installCreativeStudioProtocol,
  type CreativeStudioAssetResolver,
  type CreativeStudioProtocolInstallation,
} from './mediaProtocol';
import { getBuiltinMcpScriptPath, getCreativeStudioRootDir } from '@process/utils/initStorage';
import { BUILTIN_STUDIO_SCRIPT } from '@process/resources/builtinMcp/constants';
import { createSessionMcpTrustClaim, fingerprintSessionMcpServer } from '@process/backend/sessionMcpTrust';

type RuntimeEnvironment = {
  AIONUI_E2E_TEST?: string;
  AIONUI_E2E_STUDIO_FAKE?: string;
};

const STUDIO_JOB_RUN_LOOP_INTERVAL_MS = 5_000;

const sleepForStudioRunLoop = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    timer.unref?.();
    signal.addEventListener('abort', finish, { once: true });
  });

export type CreativeStudioRuntimeActivationState = 'inactive' | 'activating' | 'active' | 'degraded' | 'disposed';

export type CreativeStudioRuntimeProtocol = {
  install(
    resolver: CreativeStudioAssetResolver
  ): Promise<CreativeStudioProtocolInstallation> | CreativeStudioProtocolInstallation;
  uninstall(installation: CreativeStudioProtocolInstallation | null): Promise<void> | void;
};

type RuntimeJobManager = StudioJobManagerV2;

export type CreativeStudioRuntimeFactories = {
  createStore(input: { rootDir: string; onProjectCommitted: StudioProjectCommitObserver }): CreativeStudioStore;
  createMediaStore(input: {
    store: CreativeStudioStore;
    exportCatalogStore: StudioExportCatalogStoreV2;
    assertActive: () => void;
  }): StudioMediaStore;
  createAdapters(input: { rootDir: string }): GenerationProviderAdapterRegistry;
  createProviderResolver(input: StudioProviderResolverDeps): StudioProviderResolver;
  createJobManager(input: StudioJobManagerDeps): RuntimeJobManager;
  createExportCatalogStore(): StudioExportCatalogStoreV2;
  createService(input: CreativeStudioServiceV2Deps): CreativeStudioServiceV2;
  createE2EFakeBundle(input: StudioE2EFakeBundleDeps): StudioE2EFakeBundle;
  createDirectorCommitTracker(): StudioDirectorCommitTrackerV2;
  createDirectorCommandMailbox(input: StudioDirectorCommandMailboxDepsV2): StudioDirectorCommandMailboxV2;
  createDirectorCommandService(input: StudioDirectorCommandServiceDepsV2): StudioDirectorCommandServiceV2;
  createDirectorCommandProcessor(input: StudioDirectorCommandProcessorDepsV2): StudioDirectorCommandProcessorV2;
};

export type CreativeStudioRuntimeDeps = {
  rootDir: string;
  enabled: boolean;
  environment?: RuntimeEnvironment;
  isPackaged: boolean;
  factories?: CreativeStudioRuntimeFactories;
  listProviders(): Promise<IProvider[]>;
  onProjectUpdated(projectId: string): void;
  onProposalUpdated(projectId: string, proposalId: string): void;
  onReferenceUpdated(projectId: string, requestId: string): void;
  protocol: CreativeStudioRuntimeProtocol;
  logError?: (message: string, errorName: string) => void;
  runLoopSleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

export type CreativeStudioRuntime = {
  readonly store: CreativeStudioStore;
  readonly service: CreativeStudioServiceV2;
  readonly activationState: CreativeStudioRuntimeActivationState;
  readonly supportedProjectIds: string[];
  start(): Promise<void>;
  refreshInventory(): Promise<void>;
  onBackendReady(): Promise<void>;
  dispose(): Promise<void>;
};

const defaultFactories: CreativeStudioRuntimeFactories = {
  createStore: ({ rootDir, onProjectCommitted }) => createCreativeStudioStore({ rootDir, onProjectCommitted }),
  createMediaStore: ({ store, exportCatalogStore, assertActive }) =>
    createStudioMediaStore({
      store,
      getAvailableDiskBytes: getAvailableStudioDiskBytes,
      withManagedMediaAuthority: exportCatalogStore.withManagedMediaAuthority.bind(exportCatalogStore),
      assertActive,
    }),
  createAdapters: ({ rootDir }) =>
    createGenerationProviderAdapterRegistry({
      image: { workspaceDir: rootDir },
    }),
  createProviderResolver: createStudioProviderResolver,
  createJobManager: createStudioJobManager,
  createExportCatalogStore: createStudioExportCatalogStoreV2,
  createService: createCreativeStudioServiceV2,
  createE2EFakeBundle: createStudioE2EFakeBundle,
  createDirectorCommitTracker: createStudioDirectorCommitTrackerV2,
  createDirectorCommandMailbox: createStudioDirectorCommandMailboxV2,
  createDirectorCommandService: createStudioDirectorCommandServiceV2,
  createDirectorCommandProcessor: createStudioDirectorCommandProcessorV2,
};

/** E2E generation is never enabled by a broad test mode or Studio flag alone. */
export const shouldEnableStudioE2EFakeAdapter = (
  environment: RuntimeEnvironment,
  runtime: { isPackaged: boolean }
): boolean => !runtime.isPackaged && environment.AIONUI_E2E_TEST === '1' && environment.AIONUI_E2E_STUDIO_FAKE === '1';

const mergeProviders = (
  listProviders: () => Promise<IProvider[]>,
  fakeBundle: StudioE2EFakeBundle | null
): (() => Promise<IProvider[]>) => {
  if (fakeBundle === null) return listProviders;
  return async () => [
    ...(await listProviders()).filter((provider) => provider.id !== fakeBundle.provider.id),
    fakeBundle.provider,
  ];
};

type ActivationGraph = {
  authorityToken: object;
  mediaStore: StudioMediaStore;
  adapterRegistry: GenerationProviderAdapterRegistry;
  listProviders: () => Promise<IProvider[]>;
  providerResolver: StudioProviderResolver;
  jobManager: RuntimeJobManager;
  directorCommitTracker: StudioDirectorCommitTrackerV2;
  directorCommandMailbox: StudioDirectorCommandMailboxV2;
  directorCommandService: StudioDirectorCommandProcessorDepsV2['service'];
  directorCommandProcessor: StudioDirectorCommandProcessorV2;
  fakeBundle: StudioE2EFakeBundle | null;
  briefWatcher: (() => Promise<void>) | null;
  proposalWatcher: (() => Promise<void>) | null;
  referenceWatcher: (() => Promise<void>) | null;
  processorStartAttempted: boolean;
  protocolInstallAttempted: boolean;
  protocolInstallation: CreativeStudioProtocolInstallation | null;
  recoverySignature: string | null;
  recoveryPromise: Promise<void> | null;
  runLoopController: AbortController | null;
  runLoopPromise: Promise<void> | null;
  disposePromise: Promise<void> | null;
};

const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'UnknownError');

/** Builds the cold schema-2 facade and installs paid/local lifecycle only after root classification. */
export const createCreativeStudioRuntime = (deps: CreativeStudioRuntimeDeps): CreativeStudioRuntime => {
  const factories = deps.factories ?? defaultFactories;
  const logError = deps.logError ?? ((message: string, name: string): void => console.error(message, name));
  const runLoopSleep = deps.runLoopSleep ?? sleepForStudioRunLoop;
  let activationState: CreativeStudioRuntimeActivationState = 'inactive';
  let supportedProjectIds: string[] = [];
  let quarantinedProjectIds: string[] = [];
  let activeGraph: ActivationGraph | null = null;
  let activatingDirectorCommitTracker: StudioDirectorCommitTrackerV2 | null = null;
  let activationPromise: Promise<void> | null = null;
  let inventoryPromise: Promise<void> | null = null;
  let inventoryRefreshQueued = false;
  let startPromise: Promise<void> | null = null;
  let backendReadyPromise: Promise<void> | null = null;
  let disposePromise: Promise<void> | null = null;
  let backendReady = false;
  let disposed = false;

  const report = (message: string, error: unknown): void => {
    try {
      logError(message, errorName(error));
    } catch {
      // Diagnostics cannot alter lifecycle authority.
    }
  };

  let refreshInventoryImpl: () => Promise<void> = async () => undefined;

  const observeProjectCommit = (facts: StudioProjectCommitFacts): void => {
    const activeTracker = activeGraph?.directorCommitTracker ?? null;
    activeTracker?.observe(facts);
    if (activatingDirectorCommitTracker !== null && activatingDirectorCommitTracker !== activeTracker) {
      activatingDirectorCommitTracker.observe(facts);
    }
    if (!deps.enabled || disposed) return;
    void refreshInventoryImpl().catch((error: unknown) => {
      report('[CreativeStudio] Failed to refresh the schema-2 project inventory:', error);
    });
  };

  const store = factories.createStore({ rootDir: deps.rootDir, onProjectCommitted: observeProjectCommit });
  const exportCatalogStore = factories.createExportCatalogStore();

  const requireActiveGraph = (): ActivationGraph => {
    if (activeGraph === null || activationState !== 'active') {
      const quarantinedProjectId = supportedProjectIds.length === 0 ? (quarantinedProjectIds[0] ?? null) : null;
      throw quarantinedProjectId === null
        ? new CreativeStudioServiceError('runtime_inactive')
        : new CreativeStudioServiceError('project_quarantined', quarantinedProjectId);
    }
    return activeGraph;
  };

  const lazyMediaStore = new Proxy({} as StudioMediaStore, {
    get(_target, property) {
      const mediaStore = requireActiveGraph().mediaStore;
      const value: unknown = Reflect.get(mediaStore, property);
      return typeof value === 'function' ? value.bind(mediaStore) : value;
    },
  });
  const lazyProviderResolver = new Proxy({} as StudioProviderResolver, {
    get(_target, property) {
      const providerResolver = requireActiveGraph().providerResolver;
      const value: unknown = Reflect.get(providerResolver, property);
      return typeof value === 'function' ? value.bind(providerResolver) : value;
    },
  });
  const lazyJobManager = new Proxy({} as StudioJobManagerV2, {
    get(_target, property) {
      const jobManager = requireActiveGraph().jobManager;
      const value: unknown = Reflect.get(jobManager, property);
      return typeof value === 'function' ? value.bind(jobManager) : value;
    },
  });

  const coldService = factories.createService({
    store,
    mediaStore: lazyMediaStore,
    providerResolver: lazyProviderResolver,
    jobManager: lazyJobManager,
    listProviders: () => requireActiveGraph().listProviders(),
    getAdapterRegistry: () => requireActiveGraph().adapterRegistry,
    getStudioServerScriptPath: () => getBuiltinMcpScriptPath(BUILTIN_STUDIO_SCRIPT),
    fingerprintSessionMcpServer,
    createSessionMcpTrustClaim,
    ensureDirectorCommandMailbox: (projectId) => requireActiveGraph().directorCommandMailbox.ensure(projectId),
    rateCard: async (generation) => createConfiguredStudioRateCardV2(generation),
    exportCatalogStore,
    onProjectUpdated: (projectId) => {
      deps.onProjectUpdated(projectId);
      if (!disposed) {
        void refreshInventoryImpl().catch((error: unknown) => {
          report('[CreativeStudio] Failed to refresh the schema-2 project inventory:', error);
        });
      }
    },
  });

  const recoverGraph = (graph: ActivationGraph): Promise<void> => {
    if (!backendReady || disposed || activeGraph !== graph) return Promise.resolve();
    if (graph.recoveryPromise !== null) return graph.recoveryPromise;
    graph.recoveryPromise = (async () => {
      while (!disposed && activeGraph === graph) {
        const ids = [...supportedProjectIds];
        const signature = ids.join('\0');
        if (graph.recoverySignature === signature) return;
        let exportRepairFailed = false;
        for (const projectId of ids) {
          try {
            // eslint-disable-next-line no-await-in-loop -- export repair is serialized by the project's authority queue.
            await store.withProjectAuthorityV2(projectId, (authority) => exportCatalogStore.repair(authority));
          } catch (error) {
            exportRepairFailed = true;
            report(`[CreativeStudio] Export-catalog recovery failed for project ${projectId}:`, error);
          }
          if (disposed || activeGraph !== graph) return;
        }
        await graph.mediaStore.resumeConditioningFramesV2(ids);
        if (disposed || activeGraph !== graph) return;
        await graph.jobManager.resumePendingJobsV2(ids);
        if (disposed || activeGraph !== graph) return;
        if (exportRepairFailed) return;
        graph.recoverySignature = signature;
      }
    })().finally(() => {
      graph.recoveryPromise = null;
    });
    return graph.recoveryPromise;
  };

  const startRunLoop = (graph: ActivationGraph): void => {
    if (!backendReady || disposed || activeGraph !== graph || graph.runLoopPromise !== null) return;
    const controller = new AbortController();
    graph.runLoopController = controller;
    const runNextScan = async (): Promise<void> => {
      await runLoopSleep(STUDIO_JOB_RUN_LOOP_INTERVAL_MS, controller.signal);
      if (controller.signal.aborted || disposed || activeGraph !== graph) return;
      const projectIds = [...supportedProjectIds];
      if (projectIds.length > 0) {
        try {
          await graph.jobManager.resumePendingJobsV2(projectIds);
        } catch (error) {
          report('[CreativeStudio] Paid-job run loop scan failed:', error);
        }
      }
      return runNextScan();
    };
    const operation = runNextScan().finally(() => {
      if (graph.runLoopController === controller) graph.runLoopController = null;
      if (graph.runLoopPromise === operation) graph.runLoopPromise = null;
    });
    graph.runLoopPromise = operation;
  };

  const disposeGraph = (graph: ActivationGraph): Promise<void> => {
    graph.disposePromise ??= (async () => {
      const errors: unknown[] = [];
      graph.runLoopController?.abort();
      if (graph.runLoopPromise !== null) {
        try {
          await graph.runLoopPromise;
        } catch (error) {
          errors.push(error);
        }
      }
      if (graph.recoveryPromise !== null) {
        try {
          await graph.recoveryPromise;
        } catch (error) {
          errors.push(error);
        }
      }
      if (graph.protocolInstallAttempted) {
        try {
          await deps.protocol.uninstall(graph.protocolInstallation);
        } catch (error) {
          errors.push(error);
        }
      }
      if (graph.processorStartAttempted) {
        try {
          await graph.directorCommandProcessor.stop();
        } catch (error) {
          errors.push(error);
        }
      } else {
        try {
          await graph.directorCommandMailbox.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (graph.referenceWatcher !== null) {
        try {
          await graph.referenceWatcher();
        } catch (error) {
          errors.push(error);
        }
        graph.referenceWatcher = null;
      }
      if (graph.proposalWatcher !== null) {
        try {
          await graph.proposalWatcher();
        } catch (error) {
          errors.push(error);
        }
        graph.proposalWatcher = null;
      }
      if (graph.briefWatcher !== null) {
        try {
          await graph.briefWatcher();
        } catch (error) {
          errors.push(error);
        }
        graph.briefWatcher = null;
      }
      try {
        await graph.jobManager.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (graph.fakeBundle !== null) {
        try {
          await graph.fakeBundle.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, 'Creative Studio activation disposal failed');
    })();
    return graph.disposePromise;
  };

  const degradeInstalledGraph = async (graph: ActivationGraph, error: unknown): Promise<void> => {
    if (disposed || activeGraph !== graph) return;
    activeGraph = null;
    let activationError = error;
    try {
      await disposeGraph(graph);
    } catch (rollbackError) {
      activationError = new AggregateError(
        [error, rollbackError],
        'Creative Studio activation recovery rollback failed'
      );
    }
    if (!disposed) {
      activationState = 'degraded';
      report('[CreativeStudio] Schema-2 runtime activation failed:', activationError);
    }
  };

  const buildActivationGraph = async (): Promise<ActivationGraph> => {
    const authorityToken = Object.freeze({});
    const fakeBundle = shouldEnableStudioE2EFakeAdapter(deps.environment ?? process.env, {
      isPackaged: deps.isPackaged,
    })
      ? factories.createE2EFakeBundle({
          rootDir: deps.rootDir,
          catalogProfile: 'explicit-selection',
        })
      : null;
    const mediaStore = factories.createMediaStore({
      store,
      exportCatalogStore,
      assertActive: () => {
        if (disposed || activeGraph?.authorityToken !== authorityToken) {
          throw new CreativeStudioStoreError('storage_error', 'Creative Studio runtime is not active');
        }
      },
    });
    const baseAdapters = factories.createAdapters({ rootDir: deps.rootDir });
    const adapterRegistry: GenerationProviderAdapterRegistry = fakeBundle
      ? new Map([...baseAdapters, ...fakeBundle.adapters])
      : baseAdapters;
    const listProviders = mergeProviders(deps.listProviders, fakeBundle);
    const listConnections = async () => {
      const persisted = await store.listConnections();
      if (fakeBundle === null) return persisted;
      const fakeIds = new Set(fakeBundle.connections.map((connection) => connection.id));
      return [...persisted.filter((connection) => !fakeIds.has(connection.id)), ...fakeBundle.connections];
    };
    const providerResolver = factories.createProviderResolver({ listProviders, listConnections });
    const jobManager = factories.createJobManager({
      store,
      mediaStore,
      providerResolver,
      adapters: adapterRegistry,
      listProviders,
      onProjectUpdated: deps.onProjectUpdated,
    });
    const directorCommitTracker = factories.createDirectorCommitTracker();
    const directorCommandMailbox = factories.createDirectorCommandMailbox({ rootDir: deps.rootDir, store });
    const directorMutationService = factories.createDirectorCommandService({ store });
    const directorCommandService: StudioDirectorCommandProcessorDepsV2['service'] = {
      ...directorMutationService,
      getProjectStatus: (input) => coldService.getProjectStatus(input),
      listRoutes: (input) => coldService.listRoutes(input),
      proposePaidRecovery: (command) => coldService.proposePaidRecovery(command),
      retryConditioningFrame: (input, commitTag) => coldService.retryConditioningFrame(input, commitTag),
      terminalizeRefusedJob: (input, commitTag) => jobManager.terminalizeRefusedJobV2(input, commitTag),
    };
    const directorCommandProcessor = factories.createDirectorCommandProcessor({
      store,
      mailbox: directorCommandMailbox,
      service: directorCommandService,
      tracker: directorCommitTracker,
      queryAuthorityActive: () =>
        !disposed && activationState === 'active' && activeGraph?.authorityToken === authorityToken,
      onProjectUpdated: deps.onProjectUpdated,
    });
    const graph: ActivationGraph = {
      authorityToken,
      mediaStore,
      adapterRegistry,
      listProviders,
      providerResolver,
      jobManager,
      directorCommitTracker,
      directorCommandMailbox,
      directorCommandService,
      directorCommandProcessor,
      fakeBundle,
      briefWatcher: null,
      proposalWatcher: null,
      referenceWatcher: null,
      processorStartAttempted: false,
      protocolInstallAttempted: false,
      protocolInstallation: null,
      recoverySignature: null,
      recoveryPromise: null,
      runLoopController: null,
      runLoopPromise: null,
      disposePromise: null,
    };
    try {
      await mediaStore.cleanupOrphanPartsV2();
      if (disposed) throw new Error('Creative Studio runtime was disposed during activation');
      await store.reapAbandonedProposalsV2();
      if (disposed) throw new Error('Creative Studio runtime was disposed during activation');
      await store.reapAbandonedReferenceRequestsV2();
      if (disposed) throw new Error('Creative Studio runtime was disposed during activation');
      graph.briefWatcher = await store.watchBriefsV2(deps.onProjectUpdated);
      if (disposed) throw new Error('Creative Studio runtime was disposed during activation');
      graph.proposalWatcher = await store.watchProposalsV2(deps.onProposalUpdated);
      if (disposed) throw new Error('Creative Studio runtime was disposed during activation');
      graph.referenceWatcher = await store.watchReferenceRequestsV2(deps.onReferenceUpdated);
      if (disposed) throw new Error('Creative Studio runtime was disposed during activation');
      // The processor performs its initial sweep before this graph gains active authority. Route
      // tagged commits from that sweep to its tracker without exposing the graph as active.
      activatingDirectorCommitTracker = directorCommitTracker;
      graph.processorStartAttempted = true;
      await directorCommandProcessor.start();
      if (disposed) throw new Error('Creative Studio runtime was disposed during activation');
      graph.protocolInstallAttempted = true;
      graph.protocolInstallation = await deps.protocol.install({
        resolveAsset: (projectId, assetId) => mediaStore.resolveAssetV2(projectId, assetId),
      });
      if (disposed) throw new Error('Creative Studio runtime was disposed during activation');
      return graph;
    } catch (error) {
      if (activatingDirectorCommitTracker === directorCommitTracker) activatingDirectorCommitTracker = null;
      try {
        await disposeGraph(graph);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Creative Studio activation rollback failed', {
          cause: rollbackError,
        });
      }
      throw error;
    }
  };

  const activate = (): Promise<void> => {
    if (disposed || supportedProjectIds.length === 0 || activationState === 'active') return Promise.resolve();
    if (activationPromise !== null) return activationPromise;
    activationState = 'activating';
    activationPromise = (async () => {
      let graph: ActivationGraph | null = null;
      try {
        graph = await buildActivationGraph();
        if (disposed) {
          if (activatingDirectorCommitTracker === graph.directorCommitTracker) activatingDirectorCommitTracker = null;
          await disposeGraph(graph);
          return;
        }
        activeGraph = graph;
        if (activatingDirectorCommitTracker === graph.directorCommitTracker) activatingDirectorCommitTracker = null;
        await recoverGraph(graph);
        if (!disposed && activeGraph === graph) {
          activationState = 'active';
          startRunLoop(graph);
        }
      } catch (error) {
        if (graph !== null && activatingDirectorCommitTracker === graph.directorCommitTracker) {
          activatingDirectorCommitTracker = null;
        }
        if (!disposed && graph !== null && activeGraph === graph) {
          await degradeInstalledGraph(graph, error);
        } else if (!disposed) {
          activationState = 'degraded';
          report('[CreativeStudio] Schema-2 runtime activation failed:', error);
        }
      }
    })().finally(() => {
      activationPromise = null;
    });
    return activationPromise;
  };

  refreshInventoryImpl = (): Promise<void> => {
    if (!deps.enabled || disposed) return Promise.resolve();
    inventoryRefreshQueued = true;
    if (inventoryPromise !== null) return inventoryPromise;
    inventoryPromise = (async () => {
      while (inventoryRefreshQueued && !disposed) {
        inventoryRefreshQueued = false;
        const next = await store.inspectProjectsV2();
        if (disposed) return;
        supportedProjectIds = [...new Set(next.supportedProjectIds)].toSorted((left, right) =>
          left.localeCompare(right)
        );
        quarantinedProjectIds = [...new Set(next.quarantinedProjectIds)].toSorted((left, right) =>
          left.localeCompare(right)
        );
        if (activeGraph !== null) {
          await recoverGraph(activeGraph);
          continue;
        }
        if (supportedProjectIds.length === 0) {
          activationState = 'inactive';
          continue;
        }
        await activate();
      }
    })().finally(() => {
      inventoryPromise = null;
    });
    return inventoryPromise;
  };

  const service: CreativeStudioServiceV2 = {
    ...coldService,
    async createProject(input) {
      const project = await coldService.createProject(input);
      await refreshInventoryImpl();
      return project;
    },
    async deleteProject(input) {
      const deleted = await coldService.deleteProject(input);
      if (deleted) await refreshInventoryImpl();
      return deleted;
    },
  };

  const start = (): Promise<void> => {
    if (!deps.enabled || disposed) return Promise.resolve();
    startPromise ??= refreshInventoryImpl();
    return startPromise;
  };

  const onBackendReady = (): Promise<void> => {
    if (!deps.enabled || disposed) return Promise.resolve();
    backendReady = true;
    backendReadyPromise ??= (async () => {
      await start();
      const graph = activeGraph;
      if (graph === null || disposed) return;
      try {
        await recoverGraph(graph);
        startRunLoop(graph);
      } catch (error) {
        await degradeInstalledGraph(graph, error);
      }
    })();
    return backendReadyPromise;
  };

  const dispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      disposed = true;
      activationState = 'disposed';
      const errors: unknown[] = [];
      try {
        // Close public command admission before waiting for graph teardown, so no export can begin
        // after the runtime has crossed its disposal boundary.
        coldService.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (activationPromise !== null) {
        try {
          await activationPromise;
        } catch (error) {
          errors.push(error);
        }
      }
      if (backendReadyPromise !== null) {
        try {
          // Backend-ready recovery may already have revoked activeGraph while it tears the
          // failed graph down. Join that owner before deciding whether any graph remains.
          await backendReadyPromise;
        } catch (error) {
          errors.push(error);
        }
      }
      if (activeGraph !== null) {
        try {
          await disposeGraph(activeGraph);
        } catch (error) {
          errors.push(error);
        }
        activeGraph = null;
      }
      if (errors.length > 0) throw new AggregateError(errors, 'Creative Studio runtime disposal failed');
    })();
    return disposePromise;
  };

  return {
    store,
    service,
    get activationState(): CreativeStudioRuntimeActivationState {
      return activationState;
    },
    get supportedProjectIds(): string[] {
      return [...supportedProjectIds];
    },
    start,
    refreshInventory: refreshInventoryImpl,
    onBackendReady,
    dispose,
  };
};

type BackendReadyStudioRuntime = Pick<CreativeStudioRuntime, 'onBackendReady'>;

/** Starts the shared recovery promise without leaking provider details into startup logs. */
export const resumeCreativeStudioAfterBackendReady = (
  runtime: BackendReadyStudioRuntime,
  logError: (message: string, errorName: string) => void = console.error
): void => {
  void runtime
    .onBackendReady()
    .catch((error: unknown) =>
      logError('[CreativeStudio] Failed to resume pending jobs:', error instanceof Error ? error.name : 'UnknownError')
    );
};

let productionRuntime: CreativeStudioRuntime | null = null;

/** The only production runtime constructor; every caller receives this exact object graph. */
export const getCreativeStudioRuntime = (): CreativeStudioRuntime => {
  productionRuntime ??= createCreativeStudioRuntime({
    rootDir: getCreativeStudioRootDir(),
    enabled: CREATIVE_STUDIO_ENABLED,
    environment: process.env,
    isPackaged: app.isPackaged,
    listProviders: () => httpRequest<IProvider[]>('GET', '/api/providers'),
    onProjectUpdated: (projectId) => ipcBridge.creativeStudio.projectUpdated.emit({ projectId }),
    onProposalUpdated: (projectId, proposalId) =>
      ipcBridge.creativeStudio.proposalUpdated.emit({ projectId, proposalId }),
    onReferenceUpdated: (projectId, requestId) =>
      ipcBridge.creativeStudio.referenceUpdated.emit({ projectId, requestId }),
    protocol: {
      install: (resolver) => installCreativeStudioProtocol(protocol, resolver),
      uninstall: async (installation) => {
        try {
          protocol.unhandle('weprompt-studio');
        } finally {
          await installation?.dispose();
        }
      },
    },
  });
  return productionRuntime;
};

export const getCreativeStudioService = (): CreativeStudioServiceV2 => getCreativeStudioRuntime().service;

/** Does not instantiate Studio during a quit path that never started it. */
export const disposeCreativeStudioRuntime = async (): Promise<void> => {
  await productionRuntime?.dispose();
};
