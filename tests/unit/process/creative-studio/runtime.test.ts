/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type {
  CreateStudioProjectInput,
  StudioConnectionBinding,
  StudioJob,
  StudioRenderProgressEvent,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import {
  createCreativeStudioRuntime,
  shouldEnableStudioE2EFakeAdapter,
  resumeCreativeStudioAfterBackendReady,
  type CreativeStudioRuntimeFactories,
} from '@process/services/creative-studio/runtime';
import type { CreativeStudioProtocolInstallation } from '@process/services/creative-studio/mediaProtocol';
import {
  createStudioE2EFakeBundle,
  STUDIO_E2E_BOUNDARY_SENTINELS,
  STUDIO_E2E_FAKE_FIXTURE_DIRECTORY,
  STUDIO_E2E_FAKE_PROVIDER_ID,
  STUDIO_E2E_RAW_OUTPUT_BODY_SENTINEL,
} from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import type {
  GenerationProviderAdapter,
  GenerationProviderAdapterRegistry,
  ProviderJobSnapshot,
} from '@process/services/creative-studio/adapters';
import { createStudioJobManager, type StudioJobManager } from '@process/services/creative-studio/jobManager';
import { createStudioMediaStore, type StudioMediaStore } from '@process/services/creative-studio/mediaStore';
import type { StudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import {
  createCreativeStudioService,
  type CreativeStudioService,
} from '@process/services/creative-studio/creativeStudioService';
import type { CreativeStudioStore } from '@process/services/creative-studio/store';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import type { StudioStoryboardPlanner } from '@process/services/creative-studio/planning/storyboardPlanner';
import { createStudioProviderResolver } from '@process/services/creative-studio/providerResolver';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

const provider = (id = 'provider_1'): IProvider => ({
  id,
  platform: 'openai',
  name: 'Provider',
  base_url: 'https://provider.example.test/v1',
  api_key: 'secret',
  models: ['model_1'],
});

type RuntimeHarness = {
  runtime: ReturnType<typeof createCreativeStudioRuntime>;
  calls: string[];
  captures: {
    mediaStoreInput?: { store: CreativeStudioStore };
    resolverInput?: {
      listProviders: () => Promise<IProvider[]>;
      listConnections: () => Promise<StudioConnectionBinding[]>;
    };
    plannerInput?: {
      listProviders: () => Promise<IProvider[]>;
    };
    managerInput?: {
      store: CreativeStudioStore;
      mediaStore: StudioMediaStore;
      providerResolver: StudioProviderResolver;
      adapters: GenerationProviderAdapterRegistry;
      listProviders: () => Promise<IProvider[]>;
    };
    serviceInput?: {
      store: CreativeStudioStore;
      mediaStore: StudioMediaStore;
      providerResolver: StudioProviderResolver;
      adapterRegistry: GenerationProviderAdapterRegistry;
      jobManager: StudioJobManager;
      storyboardPlanner: StudioStoryboardPlanner;
    };
  };
  resumePendingJobs: ReturnType<typeof vi.fn<() => Promise<void>>>;
  disposeJobs: ReturnType<typeof vi.fn<() => Promise<void>>>;
  disposePlanner: ReturnType<typeof vi.fn<() => Promise<void>>>;
  uninstallProtocol: ReturnType<
    typeof vi.fn<(installation: CreativeStudioProtocolInstallation | null) => Promise<void>>
  >;
};

const createHarness = (
  environment: Record<string, string | undefined> = {},
  overrides: {
    resumePendingJobs?: () => Promise<void>;
    disposeJobs?: () => Promise<void>;
    disposePlanner?: () => Promise<void>;
    installProtocol?: (
      resolver: StudioMediaStore
    ) => Promise<CreativeStudioProtocolInstallation> | CreativeStudioProtocolInstallation;
    uninstallProtocol?: (installation: CreativeStudioProtocolInstallation | null) => Promise<void>;
    rootDir?: string;
    isPackaged?: boolean;
    createE2EFakeBundle?: CreativeStudioRuntimeFactories['createE2EFakeBundle'];
    store?: CreativeStudioStore;
    onProposalUpdated?: (projectId: string, proposalId: string) => void;
    onRenderProgress?: (event: StudioRenderProgressEvent) => void;
    enabled?: boolean;
  } = {}
): RuntimeHarness => {
  const calls: string[] = [];
  const captures: RuntimeHarness['captures'] = {};
  const store =
    overrides.store ??
    ({
      listConnections: async () => [],
      reapAbandonedProposals: async () => {},
      watchProposals: async () => async () => {},
    } as unknown as CreativeStudioStore);
  const mediaStore = {
    cleanupOrphanParts: async () => {
      calls.push('cleanup-parts');
    },
  } as unknown as StudioMediaStore;
  const adapters = new Map() as GenerationProviderAdapterRegistry;
  const providerResolver = {} as StudioProviderResolver;
  const disposePlanner = vi.fn(overrides.disposePlanner ?? (async () => calls.push('dispose-planner')));
  const storyboardPlanner = {
    dispose: disposePlanner,
  } as unknown as StudioStoryboardPlanner;
  const resumePendingJobs = vi.fn(overrides.resumePendingJobs ?? (async () => calls.push('resume-jobs')));
  const disposeJobs = vi.fn(overrides.disposeJobs ?? (async () => calls.push('dispose-jobs')));
  const jobManager = {
    resumePendingJobs,
    dispose: disposeJobs,
  } as unknown as StudioJobManager;
  const service = {} as CreativeStudioService;
  const protocolInstallation: CreativeStudioProtocolInstallation = {
    dispose: vi.fn(async () => {}),
  };
  const uninstallProtocol = vi.fn(
    overrides.uninstallProtocol ??
      (async (installation: CreativeStudioProtocolInstallation | null) => {
        calls.push('uninstall-protocol');
        await installation?.dispose();
      })
  );

  const factories: CreativeStudioRuntimeFactories = {
    createStore: () => store,
    createMediaStore: (input) => {
      captures.mediaStoreInput = input;
      return mediaStore;
    },
    createAdapters: () => adapters,
    createPlanner: (input) => {
      captures.plannerInput = input;
      return storyboardPlanner;
    },
    createProviderResolver: (input) => {
      captures.resolverInput = input;
      return providerResolver;
    },
    createJobManager: (input) => {
      captures.managerInput = input;
      return jobManager;
    },
    createService: (input) => {
      captures.serviceInput = input;
      return service;
    },
    createE2EFakeBundle:
      overrides.createE2EFakeBundle ??
      (() => {
        throw new Error('fake bundle was not expected');
      }),
  };

  const runtime = createCreativeStudioRuntime({
    rootDir: overrides.rootDir ?? '/tmp/creative-studio-runtime-test',
    enabled: overrides.enabled ?? true,
    environment,
    isPackaged: overrides.isPackaged ?? false,
    factories,
    listProviders: async () => [provider()],
    onProjectUpdated: vi.fn(),
    onProposalUpdated: overrides.onProposalUpdated ?? vi.fn(),
    onRenderProgress: overrides.onRenderProgress,
    protocol: {
      install:
        overrides.installProtocol ??
        ((resolver) => {
          expect(resolver).toBe(mediaStore);
          calls.push('install-protocol');
          return protocolInstallation;
        }),
      uninstall: uninstallProtocol,
    },
  });

  return { runtime, calls, captures, resumePendingJobs, disposeJobs, disposePlanner, uninstallProtocol };
};

const interruptedScene: StudioScene = {
  id: 'scene_interrupted',
  title: 'Interrupted render',
  purpose: 'Prove disabled recovery stays dormant',
  visualPrompt: 'A paid video render still running at shutdown',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: ['job_interrupted'],
  reviewState: 'generating',
};

const createPersistedRecoveryHarness = async (enabled: boolean) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-runtime-recovery-'));
  temporaryDirectories.push(rootDir);
  const store = createCreativeStudioStore({ rootDir });
  const created = await store.createProject({
    name: 'Interrupted film',
    brief: 'Recover a paid render only while Studio is enabled',
    aspectRatio: '16:9',
    targetDurationSeconds: 5,
    resolution: '720p',
  });
  const project = await store.updateProject(created.id, (current) => {
    const next = structuredClone(current);
    const timestamp = current.createdAt;
    const job: StudioJob = {
      id: 'job_interrupted',
      projectId: current.id,
      sceneId: interruptedScene.id,
      status: 'running',
      provider: {
        providerId: 'provider_1',
        adapterId: 'weprompt-media-gateway-v1',
        model: 'model_1',
      },
      idempotencyKey: 'key_interrupted',
      providerJobId: 'remote_interrupted',
      remoteStartedAt: timestamp,
      cancellationPolicy: 'queued_and_running',
      outputAssetIds: [],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    next.sceneOrder = [interruptedScene.id];
    next.scenes = { [interruptedScene.id]: interruptedScene };
    next.jobs = { [job.id]: job };
    next.routing.video = job.provider;
    return next;
  });
  const runtimeStore: CreativeStudioStore = {
    ...store,
    watchProposals: async () => async () => {},
  };
  const mediaStore = createStudioMediaStore({ store: runtimeStore });
  const listProviders = vi.fn<() => Promise<IProvider[]>>(async () => [provider()]);
  const resolveProvider = vi.fn(async () => true);
  const poll = vi.fn<NonNullable<GenerationProviderAdapter['poll']>>(
    async (): Promise<ProviderJobSnapshot> => ({ status: 'failed', error: { code: 'unknown' } })
  );
  const adapter: GenerationProviderAdapter = {
    id: 'weprompt-media-gateway-v1',
    validateConnection: async () => ({ ok: true }),
    validateRequest: () => ({ ok: false, issues: [{ code: 'invalid_request' }] }),
    submit: async () => ({ kind: 'remote', providerJobId: 'remote_unexpected' }),
    poll,
  };
  const factories: CreativeStudioRuntimeFactories = {
    createStore: () => runtimeStore,
    createMediaStore: () => mediaStore,
    createAdapters: () => new Map([[adapter.id, adapter]]),
    createPlanner: () => ({ dispose: async () => {} }) as StudioStoryboardPlanner,
    createProviderResolver: () => ({
      listConnectionCandidates: async () => [],
      listGenerationRoutes: async () => ({ routes: [], generationCatalogVersion: 'unused' }),
      isGenerationRouteAvailable: resolveProvider,
    }),
    createJobManager: (input) => createStudioJobManager({ ...input, sleep: async () => undefined }),
    createService: () => ({}) as CreativeStudioService,
    createE2EFakeBundle: () => {
      throw new Error('fake bundle was not expected');
    },
  };
  const runtime = createCreativeStudioRuntime({
    rootDir,
    enabled,
    isPackaged: false,
    factories,
    listProviders,
    onProjectUpdated: vi.fn(),
    onProposalUpdated: vi.fn(),
    protocol: {
      install: () => ({ dispose: async () => {} }),
      uninstall: async (installation) => installation?.dispose(),
    },
  });
  return { runtime, store, project, listProviders, resolveProvider, poll };
};

describe('Creative Studio runtime identity and lifecycle', () => {
  it('relays local render progress and terminal state through the runtime boundary', async () => {
    const events: StudioRenderProgressEvent[] = [];
    const { runtime } = createHarness({}, { onRenderProgress: (event) => events.push(event) });

    await expect(runtime.renderRunner.renderCut('project_1')).rejects.toMatchObject({ code: 'render_failed' });

    expect(events).toEqual([
      { projectId: 'project_1', status: 'running', progress: 0 },
      { projectId: 'project_1', status: 'failed', progress: 0, errorCode: 'render_failed' },
    ]);
  });

  it('observes an externally recorded proposal without a manual refresh and reloads it after restart', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-proposal-runtime-'));
    temporaryDirectories.push(rootDir);
    const now = () => '2026-08-06T00:00:00.000Z';
    const projectInput: CreateStudioProjectInput = {
      name: 'Observed film',
      brief: 'Watch the durable proposal inbox',
      aspectRatio: '16:9',
      targetDurationSeconds: 15,
      resolution: '1080p',
    };
    let emitProposalFile: ((relativeFile: string) => void) | undefined;
    const logError = vi.fn();
    const runtimeStore = createCreativeStudioStore({
      rootDir,
      now,
      createId: () => 'project_observed',
      logError,
      watchProposalTree: ({ onChange }) => {
        emitProposalFile = onChange;
        return { close: () => {} };
      },
    });
    const project = await runtimeStore.createProject(projectInput);
    const onProposalUpdated = vi.fn();
    const { runtime } = createHarness({}, { rootDir, store: runtimeStore, onProposalUpdated });
    await runtime.start();
    const subprocessWriter = createCreativeStudioStore({ rootDir, now });

    await subprocessWriter.recordProposal({
      projectId: project.id,
      proposalId: 'proposal_external',
      baseRevision: project.revision,
      payload: {
        kind: 'replace_storyboard',
        sceneOrder: ['scene_external'],
        scenes: {
          scene_external: {
            title: 'External scene',
            purpose: 'Prove filesystem observation',
            visualPrompt: 'A proposal appears without turn completion',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
          },
        },
      },
    });
    emitProposalFile?.(path.join(project.id, 'proposals', 'pending', 'proposal_external.json'));

    await vi.waitFor(() => {
      expect(onProposalUpdated).toHaveBeenCalledWith(project.id, 'proposal_external');
    });
    onProposalUpdated.mockClear();
    await writeFile(
      path.join(rootDir, project.id, 'proposals', 'pending', 'proposal_invalid.json'),
      JSON.stringify({ status: 'pending' })
    );
    emitProposalFile?.(path.join(project.id, 'proposals', 'pending', 'proposal_invalid.json'));
    await vi.waitFor(() => expect(logError).toHaveBeenCalled());
    expect(onProposalUpdated).not.toHaveBeenCalled();
    await runtime.dispose();

    const restartedStore = createCreativeStudioStore({ rootDir, now });
    await expect(restartedStore.listProposals(project.id)).resolves.toMatchObject([
      { id: 'proposal_external', status: 'pending' },
    ]);
  });

  it('assembles one shared store, media store, resolver, adapter registry, manager, and service graph', async () => {
    const { runtime, captures } = createHarness();

    expect(captures.mediaStoreInput?.store).toBe(runtime.store);
    expect(captures.managerInput).toMatchObject({
      store: runtime.store,
      mediaStore: runtime.mediaStore,
      providerResolver: runtime.providerResolver,
      adapters: runtime.adapterRegistry,
    });
    expect(captures.serviceInput).toMatchObject({
      store: runtime.store,
      mediaStore: runtime.mediaStore,
      providerResolver: runtime.providerResolver,
      adapterRegistry: runtime.adapterRegistry,
      jobManager: runtime.jobManager,
      storyboardPlanner: runtime.storyboardPlanner,
    });
    await expect(captures.managerInput?.listProviders()).resolves.toEqual([provider()]);
    await expect(captures.plannerInput?.listProviders()).resolves.toEqual([provider()]);
  });

  it('cleans stale parts before installing the protocol and starts only once', async () => {
    const { runtime, calls } = createHarness();

    await Promise.all([runtime.start(), runtime.start()]);

    expect(calls).toEqual(['cleanup-parts', 'install-protocol']);
  });

  it('does no startup or pending-job recovery work while the release gate is disabled', async () => {
    const { runtime, calls, resumePendingJobs } = createHarness({}, { enabled: false });

    await Promise.all([runtime.start(), runtime.onBackendReady(), runtime.onBackendReady()]);

    expect(calls).toEqual([]);
    expect(resumePendingJobs).not.toHaveBeenCalled();
  });

  it('leaves a persisted remote job dormant without resolving or polling its provider while disabled', async () => {
    const { runtime, store, project, listProviders, resolveProvider, poll } =
      await createPersistedRecoveryHarness(false);

    await runtime.onBackendReady();

    expect(resolveProvider).not.toHaveBeenCalled();
    expect(listProviders).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
    await expect(store.getProject(project.id)).resolves.toMatchObject({
      jobs: { job_interrupted: { status: 'running', providerJobId: 'remote_interrupted' } },
    });
    await runtime.dispose();
  });

  it('still resolves and polls a persisted remote job while the release gate is enabled', async () => {
    const { runtime, listProviders, resolveProvider, poll } = await createPersistedRecoveryHarness(true);

    await runtime.onBackendReady();
    await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(1));

    expect(resolveProvider).toHaveBeenCalledTimes(1);
    expect(listProviders).toHaveBeenCalledTimes(1);
    await runtime.dispose();
  });

  it('shares normal and late backend-ready calls and resumes jobs exactly once', async () => {
    let releaseResume: (() => void) | undefined;
    let markResumeStarted: (() => void) | undefined;
    const resumeStarted = new Promise<void>((resolve) => {
      markResumeStarted = resolve;
    });
    const { runtime, calls, resumePendingJobs } = createHarness(
      {},
      {
        resumePendingJobs: () =>
          new Promise<void>((resolve) => {
            calls.push('resume-jobs-start');
            markResumeStarted?.();
            releaseResume = resolve;
          }),
      }
    );

    const normalReady = runtime.onBackendReady();
    const lateReady = runtime.onBackendReady();
    await resumeStarted;

    expect(calls).toEqual(['cleanup-parts', 'install-protocol', 'resume-jobs-start']);
    expect(resumePendingJobs).toHaveBeenCalledTimes(1);

    releaseResume?.();
    await Promise.all([normalReady, lateReady]);
    await runtime.onBackendReady();
    expect(resumePendingJobs).toHaveBeenCalledTimes(1);
  });

  it('disposes planner, jobs, and protocol references once even when cleanup rejects', async () => {
    const jobFailure = new Error('job-dispose-failed');
    const plannerFailure = new Error('planner-dispose-failed');
    const protocolFailure = new Error('protocol-uninstall-failed');
    const { runtime, disposeJobs, disposePlanner, uninstallProtocol } = createHarness(
      {},
      {
        disposeJobs: async () => {
          throw jobFailure;
        },
        disposePlanner: async () => {
          throw plannerFailure;
        },
        uninstallProtocol: async () => {
          throw protocolFailure;
        },
      }
    );

    await runtime.start();
    const first = runtime.dispose();
    const second = runtime.dispose();

    await expect(first).rejects.toBeInstanceOf(AggregateError);
    await expect(second).rejects.toBeInstanceOf(AggregateError);
    expect(disposeJobs).toHaveBeenCalledTimes(1);
    expect(disposePlanner).toHaveBeenCalledTimes(1);
    expect(uninstallProtocol).toHaveBeenCalledTimes(1);
  });

  it('cancels and awaits active renders before runtime disposal completes', async () => {
    let releaseRenders: (() => void) | undefined;
    const rendersDisposed = new Promise<void>((resolve) => {
      releaseRenders = resolve;
    });
    const { runtime } = createHarness();
    const disposeRenders = vi.fn(() => rendersDisposed);
    Object.assign(runtime.renderRunner, { dispose: disposeRenders });

    let disposalFinished = false;
    const disposal = runtime.dispose().then(() => {
      disposalFinished = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(disposeRenders).toHaveBeenCalledOnce();
    expect(disposalFinished).toBe(false);
    releaseRenders?.();
    await disposal;
  });

  it('waits for an in-flight protocol install and removes the handler before disposal completes', async () => {
    let releaseInstall: (() => void) | undefined;
    let markInstallStarted: (() => void) | undefined;
    const installStarted = new Promise<void>((resolve) => {
      markInstallStarted = resolve;
    });
    const calls: string[] = [];
    const { runtime, uninstallProtocol } = createHarness(
      {},
      {
        installProtocol: () =>
          new Promise<CreativeStudioProtocolInstallation>((resolve) => {
            calls.push('install-protocol-start');
            markInstallStarted?.();
            releaseInstall = () => resolve({ dispose: async () => {} });
          }),
      }
    );

    const start = runtime.start();
    await installStarted;
    const dispose = runtime.dispose();
    await Promise.resolve();

    expect(uninstallProtocol).not.toHaveBeenCalled();
    releaseInstall?.();
    await Promise.all([start, dispose]);
    expect(uninstallProtocol).toHaveBeenCalledTimes(1);
  });

  it('passes the installed protocol controller to uninstall and awaits its disposal', async () => {
    const calls: string[] = [];
    const installation: CreativeStudioProtocolInstallation = {
      dispose: vi.fn(async () => {
        calls.push('dispose-protocol-controller');
      }),
    };
    const { runtime } = createHarness(
      {},
      {
        installProtocol: () => installation,
        uninstallProtocol: async (received) => {
          calls.push('unhandle-protocol');
          expect(received).toBe(installation);
          await received?.dispose();
        },
      }
    );

    await runtime.start();
    await runtime.dispose();

    expect(calls).toEqual(['unhandle-protocol', 'dispose-protocol-controller']);
  });

  it('does not finish disposal while backend-ready recovery is still in flight', async () => {
    let releaseRecovery: (() => void) | undefined;
    let markRecoveryStarted: (() => void) | undefined;
    const recoveryStarted = new Promise<void>((resolve) => {
      markRecoveryStarted = resolve;
    });
    const { runtime } = createHarness(
      {},
      {
        resumePendingJobs: () =>
          new Promise<void>((resolve) => {
            markRecoveryStarted?.();
            releaseRecovery = resolve;
          }),
      }
    );
    const backendReady = runtime.onBackendReady();
    await recoveryStarted;

    let disposalFinished = false;
    const disposal = runtime.dispose().then(() => {
      disposalFinished = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(disposalFinished).toBe(false);
    releaseRecovery?.();
    await Promise.all([backendReady, disposal]);
  });

  it('logs only a stable error name when backend-ready recovery rejects', async () => {
    const logError = vi.fn();
    const rawFailure = new Error(Object.values(STUDIO_E2E_BOUNDARY_SENTINELS).join(' | '));
    Object.assign(rawFailure, STUDIO_E2E_BOUNDARY_SENTINELS);

    resumeCreativeStudioAfterBackendReady(
      {
        onBackendReady: async () => {
          throw rawFailure;
        },
      },
      logError
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(logError).toHaveBeenCalledWith('[CreativeStudio] Failed to resume pending jobs:', 'Error');
    const serializedLog = JSON.stringify(logError.mock.calls);
    for (const sentinel of Object.values(STUDIO_E2E_BOUNDARY_SENTINELS)) {
      expect(serializedLog).not.toContain(sentinel);
    }
  });
});

describe('Creative Studio E2E fake gate', () => {
  it.each([
    [{}, false],
    [{ AIONUI_E2E_TEST: '1' }, false],
    [{ AIONUI_E2E_STUDIO_FAKE: '1' }, false],
    [{ AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' }, true],
  ] as const)('requires both explicit flags for %o', (environment, expected) => {
    expect(shouldEnableStudioE2EFakeAdapter(environment, { isPackaged: false })).toBe(expected);
  });

  it('cannot enable the fake adapter in a packaged production runtime', () => {
    expect(
      shouldEnableStudioE2EFakeAdapter({ AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' }, { isPackaged: true })
    ).toBe(false);
  });

  it.each([{ AIONUI_E2E_TEST: '1' }, { AIONUI_E2E_STUDIO_FAKE: '1' }] as const)(
    'does not install the fake bundle when only one gate flag is present: %o',
    async (environment) => {
      const { runtime, captures } = createHarness(environment);

      expect(runtime.adapterRegistry.size).toBe(0);
      await expect(captures.resolverInput?.listProviders()).resolves.toEqual([provider()]);
      await expect(captures.resolverInput?.listConnections()).resolves.toEqual([]);
    }
  );

  it('does not construct or expose the fake provider in a packaged runtime even with both flags', async () => {
    const { captures } = createHarness({ AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' }, { isPackaged: true });

    await expect(captures.resolverInput?.listProviders()).resolves.toEqual([provider()]);
    await expect(captures.resolverInput?.listConnections()).resolves.toEqual([]);
  });

  it('constructs the fake bundle only when both flags are present', async () => {
    const calls: Array<{ rootDir: string; catalogProfile?: string }> = [];
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'weprompt-studio-runtime-'));
    temporaryDirectories.push(rootDir);
    const fakeBundle = createStudioE2EFakeBundle({ rootDir, catalogProfile: 'explicit-selection' });
    const { captures } = createHarness(
      { AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' },
      {
        rootDir,
        createE2EFakeBundle: (input) => {
          calls.push(input);
          return fakeBundle;
        },
      }
    );

    const providers = await captures.resolverInput?.listProviders();
    const plannerProviders = await captures.plannerInput?.listProviders();
    const connections = await captures.resolverInput?.listConnections();

    expect(calls).toEqual([{ rootDir, catalogProfile: 'explicit-selection' }]);
    expect(providers?.map((item) => item.id)).toEqual(['provider_1', STUDIO_E2E_FAKE_PROVIDER_ID]);
    expect(plannerProviders?.map((item) => item.id)).toEqual(['provider_1', STUDIO_E2E_FAKE_PROVIDER_ID]);
    expect(connections).toEqual(fakeBundle.connections);
    expect(connections?.[0]?.capabilities).toMatchObject({ cancellationPolicy: 'queued_only' });
    expect(connections?.[0]?.capabilities).not.toHaveProperty('cancellation');
  });
});

describe('Creative Studio E2E fake adapter', () => {
  it('provides an explicit-selection catalog with one image and two runnable video integrations', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'weprompt-studio-fake-explicit-selection-'));
    temporaryDirectories.push(rootDir);
    const bundle = createStudioE2EFakeBundle({ rootDir, catalogProfile: 'explicit-selection' });
    const lifecycleBundle = createStudioE2EFakeBundle({ rootDir });
    const imageConnections = bundle.connections.filter(
      (connection) => connection.capabilities.mediaKinds[0] === 'image'
    );
    const videoConnections = bundle.connections.filter(
      (connection) => connection.capabilities.mediaKinds[0] === 'video'
    );

    expect(imageConnections).toHaveLength(1);
    expect(videoConnections).toHaveLength(2);
    expect(new Set(videoConnections.map((connection) => connection.model))).toEqual(
      new Set(['dreamina-seedance-2-0-260128'])
    );
    expect(new Set(videoConnections.map((connection) => connection.adapterId))).toEqual(
      new Set(['byteplus-seedance-v1', 'weprompt-media-gateway-v1'])
    );

    const fakeProvider = {
      ...bundle.provider,
      use_model: 'dreamina-seedance-2-0-260128',
    } satisfies TProviderWithModel;
    await expect(
      bundle.adapters
        .get('byteplus-seedance-v1')
        ?.validateConnection({ model: fakeProvider.use_model }, fakeProvider, new AbortController().signal)
    ).resolves.toMatchObject({ ok: true });

    const store = createCreativeStudioStore({ rootDir });
    const providerResolver = createStudioProviderResolver({
      listProviders: async () => [bundle.provider],
      listConnections: () => Promise.resolve(bundle.connections),
    });
    const service = createCreativeStudioService({
      store,
      onProjectUpdated: vi.fn(),
      providerResolver,
      storyboardPlanner: {
        listModels: async () => [],
        draft: async () => {
          throw new Error('not used by catalog projection');
        },
        dispose: async () => {},
      },
    });
    const project = await service.createProject({
      name: 'Explicit selection',
      brief: 'Choose each engine before the paid review.',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const catalog = await service.listRoutes({ projectId: project.id });

    expect(catalog.image.options).toHaveLength(1);
    expect(
      catalog.video.options.map(({ choiceId, model, integrationLabelKey }) => ({
        choiceId,
        model,
        integrationLabelKey,
      }))
    ).toEqual([
      {
        choiceId: expect.stringMatching(/^choice_[A-Za-z0-9_-]+$/),
        model: 'dreamina-seedance-2-0-260128',
        integrationLabelKey: 'bytePlusSeedance',
      },
      {
        choiceId: expect.stringMatching(/^choice_[A-Za-z0-9_-]+$/),
        model: 'dreamina-seedance-2-0-260128',
        integrationLabelKey: 'selfHostedVideoGateway',
      },
    ]);
    expect(new Set(catalog.video.options.map(({ choiceId }) => choiceId)).size).toBe(2);
    expect(lifecycleBundle.catalogProfile).toBe('lifecycle');
    expect(lifecycleBundle.connections).toHaveLength(3);
  });

  it('emits a decodable non-zero-dimension PNG for image generation', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'weprompt-studio-fake-image-'));
    temporaryDirectories.push(rootDir);
    const bundle = createStudioE2EFakeBundle({ rootDir });
    const adapter = bundle.adapters.get('weprompt-image-v1');
    const fakeProvider = { ...bundle.provider, use_model: 'weprompt-e2e-image' } satisfies TProviderWithModel;
    const request = {
      prompt: 'A renderable E2E image',
      mediaKind: 'image' as const,
      aspectRatio: '16:9' as const,
      resolution: '720p' as const,
      durationSeconds: 4,
      idempotencyKey: 'e2e_image_key_1',
    };
    const submitted = await adapter?.submit(request, fakeProvider, new AbortController().signal);
    if (!submitted || submitted.kind !== 'remote') throw new Error('expected remote fake task');
    await adapter?.poll?.(submitted.providerJobId, fakeProvider, new AbortController().signal);
    await adapter?.poll?.(submitted.providerJobId, fakeProvider, new AbortController().signal);
    const completed = await adapter?.poll?.(submitted.providerJobId, fakeProvider, new AbortController().signal);
    if (!completed || completed.status !== 'succeeded') throw new Error('expected successful fake task');
    const output = completed.outputs[0];
    if (!output || output.source.kind !== 'file') throw new Error('expected file-backed fake output');

    await expect(sharp(output.source.path).metadata()).resolves.toMatchObject({
      format: 'png',
      width: 1,
      height: 1,
    });
  });

  it('reports queued and running before returning a tiny managed-output fixture', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'weprompt-studio-fake-'));
    temporaryDirectories.push(rootDir);
    const bundle = createStudioE2EFakeBundle({ rootDir });
    const adapter = bundle.adapters.get('weprompt-media-gateway-v1');
    const fakeProvider = {
      ...bundle.provider,
      use_model: 'weprompt-e2e-video',
    } satisfies TProviderWithModel;
    const request = {
      prompt: 'A safe E2E video',
      mediaKind: 'video' as const,
      aspectRatio: '16:9' as const,
      resolution: '720p' as const,
      durationSeconds: 4,
      idempotencyKey: 'e2e_key_1',
    };

    const submitted = await adapter?.submit(request, fakeProvider, new AbortController().signal);
    expect(submitted?.kind).toBe('remote');
    if (!submitted || submitted.kind !== 'remote') throw new Error('expected remote fake task');

    await expect(adapter?.poll?.(submitted.providerJobId, fakeProvider, new AbortController().signal)).resolves.toEqual(
      {
        status: 'queued',
      }
    );
    await expect(adapter?.poll?.(submitted.providerJobId, fakeProvider, new AbortController().signal)).resolves.toEqual(
      {
        status: 'running',
        progress: 50,
      }
    );
    const completed = await adapter?.poll?.(submitted.providerJobId, fakeProvider, new AbortController().signal);
    expect(completed).toMatchObject({
      status: 'succeeded',
      outputs: [{ mediaKind: 'video', role: 'primary', mimeType: 'video/mp4' }],
    });
    if (!completed || completed.status !== 'succeeded') throw new Error('expected successful fake task');
    const output = completed.outputs[0];
    if (!output || output.source.kind !== 'file') throw new Error('expected file-backed fake output');
    await expect(stat(output.source.path)).resolves.toMatchObject({
      size: 24 + Buffer.byteLength(STUDIO_E2E_RAW_OUTPUT_BODY_SENTINEL),
    });
    const outputBytes = await readFile(output.source.path);
    expect(outputBytes.subarray(0, 24)).toEqual(Buffer.from('000000186674797069736f6d0000000069736f6d69736f32', 'hex'));
    expect(outputBytes.toString()).toContain(STUDIO_E2E_RAW_OUTPUT_BODY_SENTINEL);
  });

  it('confirms queued cancellation without creating an output fixture', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'weprompt-studio-fake-cancel-'));
    temporaryDirectories.push(rootDir);
    const bundle = createStudioE2EFakeBundle({ rootDir });
    const adapter = bundle.adapters.get('weprompt-media-gateway-v1');
    const fakeProvider = {
      ...bundle.provider,
      use_model: 'weprompt-e2e-video',
    } satisfies TProviderWithModel;
    const submitted = await adapter?.submit(
      {
        prompt: 'Cancel this E2E video',
        mediaKind: 'video',
        aspectRatio: '16:9',
        resolution: '720p',
        durationSeconds: 4,
        idempotencyKey: 'e2e_key_2',
      },
      fakeProvider,
      new AbortController().signal
    );
    if (!submitted || submitted.kind !== 'remote') throw new Error('expected remote fake task');

    await expect(
      adapter?.cancel?.(submitted.providerJobId, fakeProvider, new AbortController().signal)
    ).resolves.toEqual({
      kind: 'cancelled',
    });
    await expect(adapter?.poll?.(submitted.providerJobId, fakeProvider, new AbortController().signal)).resolves.toEqual(
      {
        status: 'cancelled',
        error: { code: 'unknown' },
      }
    );
    await expect(stat(path.join(rootDir, STUDIO_E2E_FAKE_FIXTURE_DIRECTORY))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
