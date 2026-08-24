/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '@/common/config/storage';
import type { StudioProjectV2 } from '@/common/types/project/creativeStudioTypes';
import type { StudioProjectCommitFacts } from '@process/services/creative-studio/store';
import {
  createCreativeStudioRuntime,
  resumeCreativeStudioAfterBackendReady,
  shouldEnableStudioE2EFakeAdapter,
  type CreativeStudioRuntimeFactories,
} from '@process/services/creative-studio/runtime';
import type { CreativeStudioProtocolInstallation } from '@process/services/creative-studio/mediaProtocol';
import { createCreativeStudioServiceV2, type CreativeStudioServiceV2 } from '@process/services/creative-studio/service';
import { createEmptyStudioProjectV2 } from '@process/services/creative-studio/service/schema2';
import type { CreativeStudioStore, StudioProjectInventoryV2 } from '@process/services/creative-studio/store';
import type { StudioMediaStore } from '@process/services/creative-studio/mediaStore';
import type { GenerationProviderAdapterRegistry } from '@process/services/creative-studio/adapters';
import {
  createStudioMediaChoiceId,
  type StudioGenerationRouteCatalog,
  type StudioProviderResolver,
} from '@process/services/creative-studio/providerResolver';
import type { StudioJobManagerV2 } from '@process/services/creative-studio/jobManager';
import type { StudioExportCatalogStoreV2 } from '@process/services/creative-studio/service/schema2/exports';
import type { StudioDirectorCommandMailboxV2 } from '@process/services/creative-studio/service/directorCommandMailbox';
import type { StudioDirectorCommandServiceV2 } from '@process/services/creative-studio/service/directorCommandService';
import type {
  StudioDirectorCommandProcessorV2,
  StudioDirectorCommitTrackerV2,
} from '@process/services/creative-studio/service/directorCommandProcessor';
import { describe, expect, it, vi } from 'vitest';

const provider = (): IProvider => ({
  id: 'provider_1',
  platform: 'openai',
  name: 'Provider',
  base_url: 'https://provider.example.test/v1',
  api_key: 'secret',
  models: ['model_1'],
});

const inventory = (supportedProjectIds: string[] = []): StudioProjectInventoryV2 => ({
  supportedProjectIds,
  unsupportedProjectIds: [],
  quarantinedProjectIds: [],
});

type RuntimeHarness = ReturnType<typeof createHarness>;

const createHarness = (
  input: {
    initialInventory?: StudioProjectInventoryV2;
    enabled?: boolean;
    failProcessorStarts?: number;
    failRecoveryResumes?: number;
    assertMediaStoreActiveOnResume?: boolean;
    holdFirstInventory?: boolean;
    holdCleanup?: boolean;
    service?: Partial<CreativeStudioServiceV2>;
    realService?: { project: StudioProjectV2; generationCatalog: StudioGenerationRouteCatalog };
    environment?: Record<string, string | undefined>;
    useRuntimeTimers?: boolean;
    disposeFailures?: readonly string[];
    holdActivationAt?:
      | 'reap-proposals'
      | 'reap-references'
      | 'watch-proposals'
      | 'watch-references'
      | 'processor'
      | 'protocol';
  } = {}
) => {
  let currentInventory = structuredClone(input.initialInventory ?? inventory());
  let commitObserver: ((facts: StudioProjectCommitFacts) => void) | undefined;
  let releaseCleanup: (() => void) | undefined;
  let markCleanupStarted: (() => void) | undefined;
  const cleanupStarted = new Promise<void>((resolve) => {
    markCleanupStarted = resolve;
  });
  let releaseActivation: (() => void) | undefined;
  let markActivationHeld: (() => void) | undefined;
  const activationHeld = new Promise<void>((resolve) => {
    markActivationHeld = resolve;
  });
  let remainingProcessorFailures = input.failProcessorStarts ?? 0;
  let remainingRecoveryFailures = input.failRecoveryResumes ?? 0;
  let holdNextRecovery = false;
  let releaseRecovery: (() => void) | undefined;
  let markRecoveryHeld: (() => void) | undefined;
  const recoveryHeld = new Promise<void>((resolve) => {
    markRecoveryHeld = resolve;
  });
  let releaseInventory: (() => void) | undefined;
  let markInventoryCaptured: (() => void) | undefined;
  let holdNextInventory = input.holdFirstInventory ?? false;
  let resolverDependencies: Parameters<CreativeStudioRuntimeFactories['createProviderResolver']>[0] | undefined;
  let mediaStoreAssertActive: (() => void) | undefined;
  const mediaStoreAssertActives: Array<() => void> = [];
  const inventoryCaptured = new Promise<void>((resolve) => {
    markInventoryCaptured = resolve;
  });
  const calls: string[] = [];
  const logError = vi.fn();
  const failDispose = (boundary: string): void => {
    if (input.disposeFailures?.includes(boundary) === true) throw new Error(`dispose-${boundary}-failed`);
  };
  const holdActivation = async (boundary: NonNullable<typeof input.holdActivationAt>): Promise<void> => {
    if (input.holdActivationAt !== boundary) return;
    markActivationHeld?.();
    await new Promise<void>((resolve) => (releaseActivation = resolve));
  };
  const inspectProjectsV2 = vi.fn(async () => {
    const snapshot = structuredClone(currentInventory);
    if (holdNextInventory) {
      holdNextInventory = false;
      markInventoryCaptured?.();
      await new Promise<void>((resolve) => (releaseInventory = resolve));
    }
    return snapshot;
  });
  const proposalDisposer = vi.fn(async () => {
    calls.push('dispose-proposal-watch');
    failDispose('proposal');
  });
  const referenceDisposer = vi.fn(async () => {
    calls.push('dispose-reference-watch');
    failDispose('reference');
  });
  const watchBriefsV2 = vi.fn(async () => async () => undefined);
  const store = {
    inspectProjectsV2,
    getProjectV2: vi.fn(async (projectId: string) =>
      input.realService?.project.id === projectId
        ? { status: 'supported' as const, project: structuredClone(input.realService.project) }
        : { status: 'not_found' as const, projectId }
    ),
    withProjectAuthorityV2: vi.fn(async (projectId: string, operation: (authority: never) => Promise<unknown>) => {
      const project =
        input.realService?.project.id === projectId
          ? structuredClone(input.realService.project)
          : createEmptyStudioProjectV2(
              {
                name: 'Runtime recovery',
                brief: '',
                aspectRatio: '16:9',
                targetDurationSeconds: 5,
                resolution: '720p',
              },
              projectId,
              '2026-08-19T00:00:00.000Z'
            );
      return operation({ project, projectDir: `/tmp/creative-studio-runtime-test/${projectId}` } as never);
    }),
    listConnections: vi.fn(async () => [{ id: 'fake_connection' }, { id: 'persisted_connection' }]),
    reapAbandonedProposalsV2: vi.fn(async () => {
      calls.push('reap-proposals');
      await holdActivation('reap-proposals');
    }),
    reapAbandonedReferenceRequestsV2: vi.fn(async () => {
      calls.push('reap-references');
      await holdActivation('reap-references');
    }),
    watchBriefsV2,
    watchProposalsV2: vi.fn(async () => {
      calls.push('watch-proposals');
      await holdActivation('watch-proposals');
      return proposalDisposer;
    }),
    watchReferenceRequestsV2: vi.fn(async () => {
      calls.push('watch-references');
      await holdActivation('watch-references');
      return referenceDisposer;
    }),
  } as unknown as CreativeStudioStore;
  const mediaStore = {
    cleanupOrphanPartsV2: vi.fn(async () => {
      calls.push('cleanup-parts');
      markCleanupStarted?.();
      if (input.holdCleanup) await new Promise<void>((resolve) => (releaseCleanup = resolve));
    }),
    resumeConditioningFramesV2: vi.fn(async (projectIds: readonly string[]) => {
      calls.push(`resume-frames:${projectIds.join(',')}`);
      if (input.assertMediaStoreActiveOnResume) {
        if (mediaStoreAssertActive === undefined) throw new Error('Expected media store runtime authority');
        mediaStoreAssertActive();
      }
    }),
  } as unknown as StudioMediaStore;
  const adapters = new Map() as GenerationProviderAdapterRegistry;
  const providerResolver = {
    listGenerationRoutes: vi.fn(async () =>
      structuredClone(
        input.realService?.generationCatalog ?? {
          routes: [],
          diagnostics: [],
          generationCatalogVersion: 'runtime_test_catalog',
        }
      )
    ),
  } as unknown as StudioProviderResolver;
  const jobManager = {
    resumePendingJobsV2: vi.fn(async (projectIds: readonly string[]) => {
      calls.push(`resume-jobs:${projectIds.join(',')}`);
      if (remainingRecoveryFailures > 0) {
        remainingRecoveryFailures -= 1;
        throw new Error('job-recovery-failed');
      }
      if (holdNextRecovery) {
        holdNextRecovery = false;
        markRecoveryHeld?.();
        await new Promise<void>((resolve) => (releaseRecovery = resolve));
      }
    }),
    dispose: vi.fn(async () => {
      calls.push('dispose-jobs');
      failDispose('jobs');
    }),
  } as unknown as StudioJobManagerV2;
  const exportCatalogStore = {
    list: vi.fn(),
    create: vi.fn(),
    copy: vi.fn(),
    resolveRevealPath: vi.fn(),
    repair: vi.fn(async () => ({
      schemaVersion: 5 as const,
      projectId: 'runtime_recovery',
      revision: 1,
      artifacts: [],
    })),
  } as unknown as StudioExportCatalogStoreV2;
  const service = {
    createProject: vi.fn(async () => {
      throw new Error('create-not-configured');
    }),
    listExports: vi.fn(async () => ({ revision: 1, artifacts: [] })),
    dispose: vi.fn(),
    ...input.service,
  } as CreativeStudioServiceV2;
  const tracker = {
    expect: vi.fn(),
    observe: vi.fn(),
    materialize: vi.fn(),
    pendingReceipt: vi.fn(() => null),
    clear: vi.fn(),
  } as unknown as StudioDirectorCommitTrackerV2;
  const mailbox = { dispose: vi.fn(async () => {}) } as unknown as StudioDirectorCommandMailboxV2;
  const directorService = {} as StudioDirectorCommandServiceV2;
  const processor = {
    start: vi.fn(async () => {
      calls.push('start-director');
      await holdActivation('processor');
      if (remainingProcessorFailures > 0) {
        remainingProcessorFailures -= 1;
        throw new Error('processor-start-failed');
      }
    }),
    trigger: vi.fn(),
    stop: vi.fn(async () => {
      calls.push('stop-director');
      failDispose('processor');
    }),
  } as StudioDirectorCommandProcessorV2;
  const protocolInstallation = { dispose: vi.fn(async () => {}) } satisfies CreativeStudioProtocolInstallation;
  const factoryCalls = {
    mediaStore: 0,
    adapters: 0,
    providerResolver: 0,
    jobManager: 0,
    tracker: 0,
    mailbox: 0,
    directorService: 0,
    processor: 0,
    fakeBundle: 0,
  };

  const factories: CreativeStudioRuntimeFactories = {
    createStore: ({ onProjectCommitted }) => {
      commitObserver = onProjectCommitted;
      return store;
    },
    createMediaStore: (dependencies) => {
      factoryCalls.mediaStore += 1;
      mediaStoreAssertActive = dependencies.assertActive;
      mediaStoreAssertActives.push(dependencies.assertActive);
      return mediaStore;
    },
    createAdapters: () => {
      factoryCalls.adapters += 1;
      return adapters;
    },
    createProviderResolver: (dependencies) => {
      factoryCalls.providerResolver += 1;
      resolverDependencies = dependencies;
      return providerResolver;
    },
    createJobManager: () => {
      factoryCalls.jobManager += 1;
      return jobManager;
    },
    createExportCatalogStore: () => exportCatalogStore,
    createService: (deps) => (input.realService === undefined ? service : createCreativeStudioServiceV2(deps)),
    createE2EFakeBundle: () => {
      factoryCalls.fakeBundle += 1;
      return {
        provider: { ...provider(), name: 'Fake provider' },
        connections: [{ id: 'fake_connection' }],
        adapters: new Map(),
        catalogProfile: 'lifecycle',
        dispose: vi.fn(async () => {
          calls.push('dispose-fake');
          failDispose('fake');
        }),
      };
    },
    createDirectorCommitTracker: () => {
      factoryCalls.tracker += 1;
      return tracker;
    },
    createDirectorCommandMailbox: () => {
      factoryCalls.mailbox += 1;
      return mailbox;
    },
    createDirectorCommandService: () => {
      factoryCalls.directorService += 1;
      return directorService;
    },
    createDirectorCommandProcessor: () => {
      factoryCalls.processor += 1;
      return processor;
    },
  };

  const runtime = createCreativeStudioRuntime({
    rootDir: '/tmp/creative-studio-runtime-test',
    enabled: input.enabled ?? true,
    environment: input.environment ?? {},
    isPackaged: false,
    factories,
    listProviders: async () => [provider(), { ...provider(), id: 'provider_2', name: 'Second provider' }],
    onProjectUpdated: vi.fn(),
    onProposalUpdated: vi.fn(),
    onReferenceUpdated: vi.fn(),
    logError,
    protocol: {
      install: vi.fn(async () => {
        calls.push('install-protocol');
        await holdActivation('protocol');
        return protocolInstallation;
      }),
      uninstall: vi.fn(async (installation) => {
        calls.push('uninstall-protocol');
        await installation?.dispose();
        failDispose('protocol');
      }),
    },
    ...(input.useRuntimeTimers === true
      ? {}
      : {
          runLoopSleep: (_delayMs: number, signal: AbortSignal) =>
            new Promise<void>((resolve) => {
              if (signal.aborted) {
                resolve();
                return;
              }
              signal.addEventListener('abort', () => resolve(), { once: true });
            }),
        }),
  });

  return {
    runtime,
    store,
    mediaStore,
    providerResolver,
    jobManager,
    exportCatalogStore,
    processor,
    service,
    calls,
    logError,
    factoryCalls,
    inspectProjectsV2,
    watchBriefsV2,
    proposalDisposer,
    referenceDisposer,
    getResolverDependencies: () => resolverDependencies,
    getMediaStoreAssertActives: () => [...mediaStoreAssertActives],
    inventoryCaptured,
    cleanupStarted,
    activationHeld,
    recoveryHeld,
    releaseInventory: () => releaseInventory?.(),
    releaseCleanup: () => releaseCleanup?.(),
    releaseActivation: () => releaseActivation?.(),
    releaseRecovery: () => releaseRecovery?.(),
    setInventory: (next: StudioProjectInventoryV2) => {
      currentInventory = structuredClone(next);
    },
    failNextRecovery: () => {
      remainingRecoveryFailures += 1;
    },
    holdNextRecovery: () => {
      holdNextRecovery = true;
    },
    commit: () =>
      commitObserver?.({
        projectId: 'project_v2',
        previousRevision: 0,
        committedRevision: 1,
        committedAt: '2026-08-19T00:00:00.000Z',
        commitTag: null,
      }),
  };
};

const activatedFactoryCounts = (harness: RuntimeHarness) => ({
  mediaStore: harness.factoryCalls.mediaStore,
  adapters: harness.factoryCalls.adapters,
  providerResolver: harness.factoryCalls.providerResolver,
  jobManager: harness.factoryCalls.jobManager,
  tracker: harness.factoryCalls.tracker,
  mailbox: harness.factoryCalls.mailbox,
  directorService: harness.factoryCalls.directorService,
  processor: harness.factoryCalls.processor,
});

describe('Creative Studio schema-2 runtime activation', () => {
  it('classifies a V1-only root and stays inactive without constructing a lifecycle boundary', async () => {
    const harness = createHarness({
      initialInventory: {
        supportedProjectIds: [],
        unsupportedProjectIds: ['legacy_project'],
        quarantinedProjectIds: [],
      },
    });

    await harness.runtime.start();

    expect(harness.runtime.activationState).toBe('inactive');
    expect(harness.runtime.supportedProjectIds).toEqual([]);
    expect(activatedFactoryCounts(harness)).toEqual({
      mediaStore: 0,
      adapters: 0,
      providerResolver: 0,
      jobManager: 0,
      tracker: 0,
      mailbox: 0,
      directorService: 0,
      processor: 0,
    });
    expect(harness.calls).toEqual([]);
  });

  it('activates a mixed root for supported IDs only and resumes local/provider work after backend ready', async () => {
    const harness = createHarness({
      initialInventory: {
        supportedProjectIds: ['project_b', 'project_a'],
        unsupportedProjectIds: ['legacy_project'],
        quarantinedProjectIds: ['broken_project'],
      },
    });

    await harness.runtime.onBackendReady();

    expect(harness.runtime.activationState).toBe('active');
    expect(harness.runtime.supportedProjectIds).toEqual(['project_a', 'project_b']);
    expect(harness.exportCatalogStore.repair).toHaveBeenCalledTimes(2);
    expect(harness.exportCatalogStore.repair.mock.calls.map(([authority]) => authority.project.id)).toEqual([
      'project_a',
      'project_b',
    ]);
    expect(harness.mediaStore.resumeConditioningFramesV2).toHaveBeenCalledWith(['project_a', 'project_b']);
    expect(harness.jobManager.resumePendingJobsV2).toHaveBeenCalledWith(['project_a', 'project_b']);
    expect(harness.watchBriefsV2).toHaveBeenCalledOnce();
    expect(harness.calls).toEqual([
      'cleanup-parts',
      'reap-proposals',
      'reap-references',
      'watch-proposals',
      'watch-references',
      'start-director',
      'install-protocol',
      'resume-frames:project_a,project_b',
      'resume-jobs:project_a,project_b',
    ]);
  });

  it('keeps scanning for paid jobs that miss the startup dispatch', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ initialInventory: inventory(['project_v2']), useRuntimeTimers: true });
    try {
      await harness.runtime.onBackendReady();
      expect(harness.jobManager.resumePendingJobsV2).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(harness.jobManager.resumePendingJobsV2.mock.calls.length).toBeGreaterThan(1);
    } finally {
      await harness.runtime.dispose();
      vi.useRealTimers();
    }
  });

  it('stops the paid-job scan when the runtime is disposed', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ initialInventory: inventory(['project_v2']), useRuntimeTimers: true });
    try {
      await harness.runtime.onBackendReady();
      await vi.advanceTimersByTimeAsync(60_000);
      const scansBeforeDispose = harness.jobManager.resumePendingJobsV2.mock.calls.length;

      await harness.runtime.dispose();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(harness.jobManager.resumePendingJobsV2).toHaveBeenCalledTimes(scansBeforeDispose);
    } finally {
      await harness.runtime.dispose();
      vi.useRealTimers();
    }
  });

  it('does not overlap paid-job scans when one scan is still running', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ initialInventory: inventory(['project_v2']), useRuntimeTimers: true });
    try {
      await harness.runtime.onBackendReady();
      harness.holdNextRecovery();

      await vi.advanceTimersByTimeAsync(5_000);
      await harness.recoveryHeld;
      expect(harness.jobManager.resumePendingJobsV2).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(harness.jobManager.resumePendingJobsV2).toHaveBeenCalledTimes(2);

      harness.releaseRecovery();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(harness.jobManager.resumePendingJobsV2).toHaveBeenCalledTimes(3);
    } finally {
      harness.releaseRecovery();
      await harness.runtime.dispose();
      vi.useRealTimers();
    }
  });

  it('keeps the active runtime and retries after one paid-job scan fails', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ initialInventory: inventory(['project_v2']), useRuntimeTimers: true });
    try {
      await harness.runtime.onBackendReady();
      harness.failNextRecovery();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(harness.runtime.activationState).toBe('active');
      expect(harness.logError).toHaveBeenCalledWith('[CreativeStudio] Paid-job run loop scan failed:', 'Error');

      await vi.advanceTimersByTimeAsync(5_000);
      expect(harness.jobManager.resumePendingJobsV2).toHaveBeenCalledTimes(3);
    } finally {
      await harness.runtime.dispose();
      vi.useRealTimers();
    }
  });

  it('authorizes the installed graph while backend-ready startup recovery is still activating', async () => {
    const harness = createHarness({
      initialInventory: inventory(['project_v2']),
      assertMediaStoreActiveOnResume: true,
    });

    await harness.runtime.onBackendReady();

    expect(harness.runtime.activationState).toBe('active');
    expect(harness.mediaStore.resumeConditioningFramesV2).toHaveBeenCalledWith(['project_v2']);
    expect(harness.jobManager.resumePendingJobsV2).toHaveBeenCalledWith(['project_v2']);
  });

  it('rejects media authority from degraded, replaced, and disposed activation graphs', async () => {
    const harness = createHarness({
      initialInventory: inventory(['project_v2']),
      failRecoveryResumes: 1,
    });

    await harness.runtime.start();
    const [firstAssertActive] = harness.getMediaStoreAssertActives();
    expect(firstAssertActive).toBeDefined();
    expect(() => firstAssertActive?.()).not.toThrow();

    await harness.runtime.onBackendReady();
    expect(harness.runtime.activationState).toBe('degraded');
    expect(() => firstAssertActive?.()).toThrow('Creative Studio runtime is not active');

    await harness.runtime.refreshInventory();
    const [, replacementAssertActive] = harness.getMediaStoreAssertActives();
    expect(harness.runtime.activationState).toBe('active');
    expect(replacementAssertActive).toBeDefined();
    expect(() => firstAssertActive?.()).toThrow('Creative Studio runtime is not active');
    expect(() => replacementAssertActive?.()).not.toThrow();

    await harness.runtime.dispose();
    expect(() => replacementAssertActive?.()).toThrow('Creative Studio runtime is not active');
  });

  it('prepares through the real runtime service with the main config rate card and an unavailable video sibling', async () => {
    const imageChoiceId = createStudioMediaChoiceId({
      providerId: 'provider_1',
      adapterId: 'weprompt-image-v1',
      model: 'image-model',
      kind: 'image',
    });
    const imageRoute = {
      choiceId: imageChoiceId,
      providerId: 'provider_1',
      providerName: 'Image provider',
      adapterId: 'weprompt-image-v1' as const,
      model: 'image-model',
      health: 'available' as const,
      kind: 'image' as const,
      cancellationPolicy: 'none' as const,
      constraints: {
        aspectRatios: ['16:9' as const],
        resolutions: ['1080p' as const],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: true,
        maxConditioningImages: 1,
        silentOutput: true,
      },
    };
    const project = createEmptyStudioProjectV2(
      {
        name: 'Runtime quote',
        brief: 'A quiet product reveal.',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '1080p',
      },
      'project_runtime_quote',
      '2026-08-19T00:00:00.000Z'
    );
    project.revision = 2;
    project.imageRouteId = imageChoiceId;
    project.videoRouteId = null;
    project.beatOrder = ['beat_1'];
    project.beats.beat_1 = {
      id: 'beat_1',
      title: 'Opening',
      action: 'Reveal the product',
      look: 'Soft daylight',
      actionRevision: 1,
      targetSeconds: null,
      shotOrder: ['shot_1'],
      lineHistory: [],
    };
    project.shots.shot_1 = {
      id: 'shot_1',
      line: 'A clean hero frame',
      derivation: 'derived',
      derivedFromActionRevision: 1,
      narration: '',
      onScreenText: '',
      durationSeconds: 5,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: 'none',
      referenceIds: ['reference_background'],
      seedStillId: null,
      boardAssetId: null,
      supersededBoardAssetIds: [],
      videoAssetId: null,
      supersededVideoAssetIds: [],
      assetIds: [],
      jobIds: [],
    };
    project.referenceOrder = ['reference_background'];
    project.references.reference_background = {
      id: 'reference_background',
      kind: 'background',
      label: 'Reveal space',
      prompt: 'A soft daylight product reveal environment.',
      candidateAssetId: null,
      candidateJobId: null,
      approvedAssetId: 'asset_reference_background',
      supersededAssetIds: [],
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    };
    project.assets.asset_reference_background = {
      id: 'asset_reference_background',
      projectId: project.id,
      shotId: 'shot_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'assets', fileName: 'asset_reference_background.png' },
      byteSize: 1,
      sha256: 'a'.repeat(64),
      referenceAssetIds: [],
      createdAt: '2026-08-19T00:00:00.000Z',
    };
    project.shots.shot_1.assetIds.push('asset_reference_background');
    const generationCatalog: StudioGenerationRouteCatalog = {
      routes: [imageRoute],
      diagnostics: [{ status: 'available', route: imageRoute }],
      generationCatalogVersion: 'runtime_quote_catalog',
    };
    const harness = createHarness({
      initialInventory: inventory([project.id]),
      realService: { project, generationCatalog },
    });

    await harness.runtime.start();
    const prepared = await harness.runtime.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'shot_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'shot_1', purpose: 'video_take', referenceAssetId: null }],
    });

    expect(prepared.baseOnly).toMatchObject({
      currency: 'USD',
      lowerMinorUnits: 3,
      upperMinorUnits: 3,
      baseItems: [{ purpose: 'seed_still', oneGenerationMinorUnits: 3 }],
    });
    expect(prepared.withCascade).toBeNull();
    expect(harness.providerResolver.listGenerationRoutes).toHaveBeenCalledTimes(1);
    await harness.runtime.dispose();
  });

  it('joins concurrent first-commit inventory events into one activation attempt', async () => {
    const harness = createHarness({ holdCleanup: true });
    await harness.runtime.start();
    harness.setInventory(inventory(['project_v2']));

    harness.commit();
    const first = harness.runtime.refreshInventory();
    const second = harness.runtime.refreshInventory();
    await harness.cleanupStarted;

    expect(harness.runtime.activationState).toBe('activating');
    expect(harness.factoryCalls.mediaStore).toBe(1);
    harness.releaseCleanup();
    await Promise.all([first, second]);

    expect(harness.runtime.activationState).toBe('active');
    expect(activatedFactoryCounts(harness)).toEqual({
      mediaStore: 1,
      adapters: 1,
      providerResolver: 1,
      jobManager: 1,
      tracker: 1,
      mailbox: 1,
      directorService: 1,
      processor: 1,
    });
  });

  it('drains a commit-triggered refresh after an older inventory scan captured an empty root', async () => {
    const harness = createHarness({ holdFirstInventory: true });
    const start = harness.runtime.start();
    await harness.inventoryCaptured;

    harness.setInventory(inventory(['project_v2']));
    harness.commit();
    harness.releaseInventory();
    await start;

    expect(harness.inspectProjectsV2).toHaveBeenCalledTimes(2);
    expect(harness.runtime.supportedProjectIds).toEqual(['project_v2']);
    expect(harness.runtime.activationState).toBe('active');
    expect(harness.factoryCalls.mediaStore).toBe(1);
  });

  it('rolls a partial activation back in reverse order, enters degraded, and retries on the next inventory event', async () => {
    const harness = createHarness({ initialInventory: inventory(['project_v2']), failProcessorStarts: 1 });

    await harness.runtime.start();

    expect(harness.runtime.activationState).toBe('degraded');
    expect(harness.proposalDisposer).toHaveBeenCalledOnce();
    expect(harness.referenceDisposer).toHaveBeenCalledOnce();
    expect(harness.jobManager.dispose).toHaveBeenCalledOnce();
    expect(harness.calls).toEqual([
      'cleanup-parts',
      'reap-proposals',
      'reap-references',
      'watch-proposals',
      'watch-references',
      'start-director',
      'stop-director',
      'dispose-reference-watch',
      'dispose-proposal-watch',
      'dispose-jobs',
    ]);

    await harness.runtime.refreshInventory();

    expect(harness.runtime.activationState).toBe('active');
    expect(harness.factoryCalls.processor).toBe(2);
    expect(harness.calls.slice(-7)).toEqual([
      'cleanup-parts',
      'reap-proposals',
      'reap-references',
      'watch-proposals',
      'watch-references',
      'start-director',
      'install-protocol',
    ]);
  });

  it('rolls back an installed graph when backend-ready recovery fails and builds a fresh graph on retry', async () => {
    const harness = createHarness({
      initialInventory: inventory(['project_v2']),
      failRecoveryResumes: 1,
    });

    await harness.runtime.start();
    expect(harness.runtime.activationState).toBe('active');

    await harness.runtime.onBackendReady();

    expect(harness.runtime.activationState).toBe('degraded');
    expect(harness.calls).toEqual([
      'cleanup-parts',
      'reap-proposals',
      'reap-references',
      'watch-proposals',
      'watch-references',
      'start-director',
      'install-protocol',
      'resume-frames:project_v2',
      'resume-jobs:project_v2',
      'uninstall-protocol',
      'stop-director',
      'dispose-reference-watch',
      'dispose-proposal-watch',
      'dispose-jobs',
    ]);

    await harness.runtime.refreshInventory();

    expect(harness.runtime.activationState).toBe('active');
    expect(activatedFactoryCounts(harness)).toEqual({
      mediaStore: 2,
      adapters: 2,
      providerResolver: 2,
      jobManager: 2,
      tracker: 2,
      mailbox: 2,
      directorService: 2,
      processor: 2,
    });
    expect(harness.calls.slice(-9)).toEqual([
      'cleanup-parts',
      'reap-proposals',
      'reap-references',
      'watch-proposals',
      'watch-references',
      'start-director',
      'install-protocol',
      'resume-frames:project_v2',
      'resume-jobs:project_v2',
    ]);
  });

  it('retries the same inventory after recovery fails on an already-active graph', async () => {
    const harness = createHarness({ initialInventory: inventory(['project_a']) });
    await harness.runtime.onBackendReady();
    const factoryCounts = activatedFactoryCounts(harness);

    harness.setInventory(inventory(['project_a', 'project_b']));
    harness.failNextRecovery();
    await expect(harness.runtime.refreshInventory()).rejects.toThrow('job-recovery-failed');

    expect(harness.runtime.activationState).toBe('active');
    await harness.runtime.refreshInventory();

    expect(harness.runtime.activationState).toBe('active');
    expect(activatedFactoryCounts(harness)).toEqual(factoryCounts);
    expect(harness.calls.slice(-4)).toEqual([
      'resume-frames:project_a,project_b',
      'resume-jobs:project_a,project_b',
      'resume-frames:project_a,project_b',
      'resume-jobs:project_a,project_b',
    ]);
  });

  it('keeps global infrastructure ready when the last V2 project is deleted and reuses it on recreation', async () => {
    const harness = createHarness({ initialInventory: inventory(['project_v2']) });
    await harness.runtime.start();
    const firstCounts = activatedFactoryCounts(harness);

    harness.setInventory(inventory());
    await harness.runtime.refreshInventory();
    expect(harness.runtime.activationState).toBe('active');
    expect(harness.runtime.supportedProjectIds).toEqual([]);

    harness.setInventory(inventory(['project_recreated']));
    await harness.runtime.refreshInventory();
    expect(harness.runtime.supportedProjectIds).toEqual(['project_recreated']);
    expect(activatedFactoryCounts(harness)).toEqual(firstCounts);
  });

  it('disposes installed boundaries once when shutdown races an activation', async () => {
    const harness = createHarness({ initialInventory: inventory(['project_v2']), holdCleanup: true });
    const start = harness.runtime.start();
    await harness.cleanupStarted;

    const firstDispose = harness.runtime.dispose();
    const secondDispose = harness.runtime.dispose();
    expect(harness.runtime.activationState).toBe('disposed');
    harness.releaseCleanup();
    await Promise.all([start, firstDispose, secondDispose]);

    expect(harness.calls).not.toContain('install-protocol');
    expect(harness.jobManager.dispose).toHaveBeenCalledOnce();
    expect(harness.runtime.activationState).toBe('disposed');
  });

  it('joins backend-ready degradation teardown after the failed graph revokes active authority', async () => {
    const harness = createHarness({ initialInventory: inventory(['project_v2']), failRecoveryResumes: 1 });
    await harness.runtime.start();
    let releaseProcessorStop: (() => void) | undefined;
    let markProcessorStopStarted: (() => void) | undefined;
    const processorStopStarted = new Promise<void>((resolve) => {
      markProcessorStopStarted = resolve;
    });
    vi.mocked(harness.processor.stop).mockImplementationOnce(async () => {
      harness.calls.push('stop-director');
      markProcessorStopStarted?.();
      await new Promise<void>((resolve) => {
        releaseProcessorStop = resolve;
      });
    });

    const backendReady = harness.runtime.onBackendReady();
    await processorStopStarted;
    let disposalSettled = false;
    const disposal = harness.runtime.dispose().finally(() => {
      disposalSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(disposalSettled).toBe(false);
    releaseProcessorStop?.();
    await Promise.all([backendReady, disposal]);
    expect(disposalSettled).toBe(true);
    expect(harness.runtime.activationState).toBe('disposed');
  });

  it.each([
    'reap-proposals',
    'reap-references',
    'watch-proposals',
    'watch-references',
    'processor',
    'protocol',
  ] as const)('rolls back safely when shutdown lands at the %s activation boundary', async (holdActivationAt) => {
    const harness = createHarness({ initialInventory: inventory(['project_v2']), holdActivationAt });
    const start = harness.runtime.start();
    await harness.activationHeld;

    const dispose = harness.runtime.dispose();
    harness.releaseActivation();
    await Promise.all([start, dispose]);

    expect(harness.runtime.activationState).toBe('disposed');
    expect(harness.jobManager.dispose).toHaveBeenCalledOnce();
  });

  it('does not activate when a project creation rejects before its durable commit', async () => {
    const harness = createHarness({
      service: {
        createProject: vi.fn(async () => {
          throw new Error('commit-failed');
        }),
      },
    });
    await harness.runtime.start();

    await expect(
      harness.runtime.service.createProject({
        name: 'Failed project',
        brief: '',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      })
    ).rejects.toThrow('commit-failed');

    expect(harness.runtime.activationState).toBe('inactive');
    expect(activatedFactoryCounts(harness).mediaStore).toBe(0);
  });

  it('does no inventory or lifecycle work while the feature is disabled', async () => {
    const harness = createHarness({ enabled: false, initialInventory: inventory(['project_v2']) });

    await Promise.all([harness.runtime.start(), harness.runtime.onBackendReady(), harness.runtime.refreshInventory()]);

    expect(harness.inspectProjectsV2).not.toHaveBeenCalled();
    expect(harness.runtime.activationState).toBe('inactive');
    expect(activatedFactoryCounts(harness).mediaStore).toBe(0);
  });
});

describe('Creative Studio runtime support boundaries', () => {
  it.each([
    [{}, false],
    [{ AIONUI_E2E_TEST: '1' }, false],
    [{ AIONUI_E2E_STUDIO_FAKE: '1' }, false],
    [{ AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' }, true],
  ] as const)('requires both explicit fake-adapter flags for %o', (environment, expected) => {
    expect(shouldEnableStudioE2EFakeAdapter(environment, { isPackaged: false })).toBe(expected);
  });

  it('cannot enable the fake adapter in a packaged runtime', () => {
    expect(
      shouldEnableStudioE2EFakeAdapter({ AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' }, { isPackaged: true })
    ).toBe(false);
  });

  it('constructs the fake bundle only after a supported project activates the runtime', async () => {
    const harness = createHarness({
      environment: { AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' },
    });
    await harness.runtime.start();
    expect(harness.factoryCalls.fakeBundle).toBe(0);

    harness.setInventory(inventory(['project_v2']));
    await harness.runtime.refreshInventory();
    expect(harness.factoryCalls.fakeBundle).toBe(1);
  });

  it('replaces colliding fake providers and connections only inside the explicit E2E resolver graph', async () => {
    const harness = createHarness({
      initialInventory: inventory(['project_v2']),
      environment: { AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' },
    });

    await harness.runtime.start();
    const resolverDependencies = harness.getResolverDependencies();
    if (resolverDependencies === undefined) throw new Error('Expected an active resolver graph');

    await expect(resolverDependencies.listProviders()).resolves.toMatchObject([
      { id: 'provider_2', name: 'Second provider' },
      { id: 'provider_1', name: 'Fake provider' },
    ]);
    await expect(resolverDependencies.listConnections()).resolves.toEqual([
      { id: 'persisted_connection' },
      { id: 'fake_connection' },
    ]);
    await harness.runtime.dispose();
  });

  it('keeps start, inventory, and backend-ready hooks inert after disposal', async () => {
    const harness = createHarness({ initialInventory: inventory(['project_v2']) });
    await harness.runtime.start();
    await harness.runtime.dispose();
    const inspections = harness.inspectProjectsV2.mock.calls.length;

    await Promise.all([harness.runtime.start(), harness.runtime.refreshInventory(), harness.runtime.onBackendReady()]);

    expect(harness.runtime.activationState).toBe('disposed');
    expect(harness.inspectProjectsV2).toHaveBeenCalledTimes(inspections);
  });

  it('attempts every installed cleanup boundary before reporting aggregate disposal failures', async () => {
    const harness = createHarness({
      initialInventory: inventory(['project_v2']),
      environment: { AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' },
      disposeFailures: ['protocol', 'processor', 'reference', 'proposal', 'jobs', 'fake'],
    });
    await harness.runtime.start();

    await expect(harness.runtime.dispose()).rejects.toBeInstanceOf(AggregateError);

    expect(harness.calls.slice(-6)).toEqual([
      'uninstall-protocol',
      'stop-director',
      'dispose-reference-watch',
      'dispose-proposal-watch',
      'dispose-jobs',
      'dispose-fake',
    ]);
    expect(harness.runtime.activationState).toBe('disposed');
  });

  it('logs only a stable error name when backend-ready recovery rejects', async () => {
    const logError = vi.fn();
    resumeCreativeStudioAfterBackendReady(
      {
        onBackendReady: async () => {
          throw new Error('provider secret must not cross');
        },
      },
      logError
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(logError).toHaveBeenCalledWith('[CreativeStudio] Failed to resume pending jobs:', 'Error');
    expect(JSON.stringify(logError.mock.calls)).not.toContain('provider secret');
  });

  it('redacts non-Error backend-ready rejections as UnknownError', async () => {
    const logError = vi.fn();
    resumeCreativeStudioAfterBackendReady(
      {
        onBackendReady: async () => Promise.reject('provider secret must not cross'),
      },
      logError
    );
    await vi.waitFor(() =>
      expect(logError).toHaveBeenCalledWith('[CreativeStudio] Failed to resume pending jobs:', 'UnknownError')
    );
  });
});
