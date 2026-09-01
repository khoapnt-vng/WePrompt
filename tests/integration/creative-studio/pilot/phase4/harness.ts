/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
  type StudioApplyMutationBatchResultV3,
  type StudioConfirmPreparedPhotoResultV3,
  type StudioCreateProjectResultV3,
  type StudioDeleteProjectRequestV3,
  type StudioDeleteProjectResultV3,
  type StudioExportPieceResultV3,
  type StudioImportPhotoResultV3,
  type StudioPieceJobV3,
  type StudioPiecePhotoSettingsV3,
  type StudioMutationOperationV3,
  type StudioPreparePhotoResultV3,
  type StudioProjectListResultV3,
  type StudioProjectLoadResultV3,
  type StudioProjectV3,
  type StudioRendererPieceActivityJobV3,
  type StudioRendererPreparedPhotoQuoteV3,
  type StudioSpendPolicy,
} from '@/common/types/project/creativeStudioTypes';
import {
  createGenerationProviderAdapterRegistry,
  type GenerationProviderAdapterRegistry,
} from '@/process/services/creative-studio/adapters';
import {
  createStudioE2EFakeBundle,
  createStudioE2EFakeRemoteState,
  STUDIO_E2E_FAKE_IMAGE_BASE64,
  type StudioE2EFakeBundle,
  type StudioE2EFakeProviderCallCounts,
  type StudioE2EFakeRemoteState,
  type StudioE2EFakeTaskScript,
} from '@/process/services/creative-studio/adapters/e2eFakeAdapter';
import { createStudioProviderResolver } from '@/process/services/creative-studio/providerResolver';
import { createStudioConnectionManifestV1 } from '@/process/services/creative-studio/store/connectionManifest';
import {
  createCreativeStudioPilotRuntimeV3,
  type CreativeStudioPilotEntryPointV3,
  type CreativeStudioPilotRuntimeV3,
  type StudioPilotMediaStorageStepV3,
  type StudioPilotNativePhotoSelectionV3,
  type StudioPilotRuntimeIdentityKindV3,
} from '@/process/services/creative-studio/service/pilot';
import { createStudioPilotGeneratedUrlResolverV3 } from '@/process/services/creative-studio/service/pilot/runtime/generatedUrlResolver';
import { validateStudioProjectV3 } from '@/process/services/creative-studio/service/schema2/validation';
import type { RemoteMediaResponse } from '@/process/services/remote-media/remoteMediaDownloader';

const PUBLIC_DOWNLOAD_ADDRESS = '8.8.8.8';
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]{1,256}$/u;
const ACTIVE_JOB_STATUSES = new Set<StudioPieceJobV3['status']>([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
]);
const DEFAULT_SETTINGS: StudioPiecePhotoSettingsV3 = { aspectRatio: '16:9', resolution: '1080p' };
const DEFAULT_TIMEOUT_MS = 10_000;

export type Phase4SupportedProject = Extract<StudioProjectLoadResultV3, { status: 'supported' }>;

export type Phase4MutableClock = {
  now(): number;
  advance(milliseconds: number): number;
  set(milliseconds: number): number;
  value(): number;
};

export type Phase4MediaStepBarrier = {
  readonly reached: Promise<{ step: StudioPilotMediaStorageStepV3; projectId: string }>;
  release(): void;
};

export type Phase4PrepareCreateOptions = {
  expectedAuthoringRevision?: number;
  words?: string;
  settings?: StudioPiecePhotoSettingsV3;
  suggestedHandle?: string | null;
  referencePieceIds?: string[];
};

export type Phase4ConfirmOptions = {
  explicitHumanConfirmation?: boolean;
  duplicateChargeAcknowledged?: boolean;
};

export type Phase4ImportSelection = {
  fileName?: string;
  sourcePath?: string;
  bytes?: Uint8Array;
} | null;

export type Phase4WaitOptions = { timeoutMs?: number; intervalMs?: number };

export type Phase4JobExpectation =
  | StudioPieceJobV3['status']
  | readonly StudioPieceJobV3['status'][]
  | ((job: StudioRendererPieceActivityJobV3, project: Phase4SupportedProject) => boolean);

export type Phase4EvidenceCounts = {
  resolverRouteCalls: number;
  providerLookups: number;
  providerCalls: StudioE2EFakeProviderCallCounts;
  preparedQuotes: number;
  authorizations: number;
  persistedQuotes: number;
  jobs: number;
  spendReceipts: number;
  totalRecordedSpendMinorUnits: number;
};

export type Phase4HarnessOptions = {
  now?: number;
  taskScripts?: readonly StudioE2EFakeTaskScript[];
  start?: boolean;
};

/** Independent process-local runtime over the same durable root; startup recovery is deliberately not run. */
export type Phase4DetachedRuntime = {
  readonly runtime: CreativeStudioPilotRuntimeV3;
  readonly entryPoint: CreativeStudioPilotEntryPointV3;
  readonly fake: StudioE2EFakeBundle;
  dispose(): Promise<void>;
};

export type Phase4Harness = {
  readonly sandbox: string;
  readonly rootDir: string;
  readonly sourcePath: string;
  readonly sourceBytes: Buffer;
  readonly runtime: CreativeStudioPilotRuntimeV3;
  readonly entryPoint: CreativeStudioPilotEntryPointV3;
  readonly fake: StudioE2EFakeBundle;
  readonly remoteState: StudioE2EFakeRemoteState;
  readonly clock: Phase4MutableClock;
  readonly identityCounts: ReadonlyMap<StudioPilotRuntimeIdentityKindV3, number>;
  readonly mediaSteps: readonly { step: StudioPilotMediaStorageStepV3; projectId: string }[];
  readonly downloadRequestCount: number;
  createDetachedRuntime(): Promise<Phase4DetachedRuntime>;
  createProject(input?: string | { name?: string; brief?: string }): Promise<StudioCreateProjectResultV3>;
  listProjects(): Promise<StudioProjectListResultV3>;
  loadResult(projectId: string): Promise<StudioProjectLoadResultV3>;
  loadSupported(projectId: string): Promise<Phase4SupportedProject>;
  deleteProject(input: StudioDeleteProjectRequestV3): Promise<StudioDeleteProjectResultV3>;
  setSpendPolicy(
    projectId: string,
    policy: StudioSpendPolicy | null,
    expectedAuthoringRevision?: number
  ): Promise<StudioApplyMutationBatchResultV3>;
  renamePiece(
    projectId: string,
    pieceId: string,
    handle: string,
    expectedAuthoringRevision?: number
  ): Promise<StudioApplyMutationBatchResultV3>;
  undo(
    projectId: string,
    undoEntryId: string,
    expectedAuthoringRevision?: number
  ): Promise<StudioApplyMutationBatchResultV3>;
  prepareCreate(projectId: string, options?: Phase4PrepareCreateOptions): Promise<StudioPreparePhotoResultV3>;
  prepareRetry(
    projectId: string,
    pieceId: string,
    sourceJobId: string,
    expectedAuthoringRevision?: number
  ): Promise<StudioPreparePhotoResultV3>;
  confirm(
    prepared: StudioPreparePhotoResultV3 | StudioRendererPreparedPhotoQuoteV3,
    options?: Phase4ConfirmOptions
  ): Promise<StudioConfirmPreparedPhotoResultV3>;
  enqueueImport(selection?: Phase4ImportSelection): Promise<StudioPilotNativePhotoSelectionV3 | null>;
  importPhoto(projectId: string, expectedAuthoringRevision?: number): Promise<StudioImportPhotoResultV3>;
  exportPiece(projectId: string, pieceId: string): Promise<StudioExportPieceResultV3>;
  waitForJob(
    projectId: string,
    jobId: string,
    expectation: Phase4JobExpectation,
    options?: Phase4WaitOptions
  ): Promise<StudioRendererPieceActivityJobV3>;
  waitForIdle(projectId: string, options?: Phase4WaitOptions): Promise<Phase4SupportedProject>;
  enqueueTaskScript(script: StudioE2EFakeTaskScript): void;
  releaseSubmitHold(idempotencyKey: string): boolean;
  releaseTaskHold(providerJobId: string): boolean;
  enqueueDownloadFailure(): void;
  failMediaStepOnce(step: StudioPilotMediaStorageStepV3, error?: Error): void;
  pauseMediaStepOnce(step: StudioPilotMediaStorageStepV3): Phase4MediaStepBarrier;
  readProjectManifest(projectId: string): Promise<StudioProjectV3>;
  evidenceCounts(projectId: string): Promise<Phase4EvidenceCounts>;
  projectPath(projectId: string): string;
  manifestPath(projectId: string): string;
  exportsPath(projectId: string): string;
  exportCatalogPath(projectId: string): string;
  exportArtifactPath(projectId: string, folderName: string): string;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(options?: { start?: boolean }): Promise<void>;
  cleanup(): Promise<void>;
};

type MediaStepAction =
  | { kind: 'fail'; error: Error }
  | {
      kind: 'pause';
      reached: (value: { step: StudioPilotMediaStorageStepV3; projectId: string }) => void;
      released: Promise<void>;
    };

const createMutableClock = (initial: number): Phase4MutableClock => {
  let milliseconds = initial;
  const accept = (value: number): number => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Phase 4 clock requires a non-negative integer');
    milliseconds = value;
    return milliseconds;
  };
  return {
    now: () => milliseconds,
    advance: (amount) => accept(milliseconds + amount),
    set: accept,
    value: () => milliseconds,
  };
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const exactPathSegment = (value: string): string => {
  if (value === '.' || value === '..' || !SAFE_PATH_SEGMENT.test(value)) {
    throw new Error(`Unsafe Phase 4 fixture path segment: ${value}`);
  }
  return value;
};

const response = (bytes: Buffer, statusCode = 200): RemoteMediaResponse => ({
  statusCode,
  headers:
    statusCode === 200
      ? { 'content-type': 'image/png', 'content-length': String(bytes.byteLength) }
      : { 'content-type': 'text/plain', 'content-length': '0' },
  remoteAddress: PUBLIC_DOWNLOAD_ADDRESS,
  body: Readable.from(statusCode === 200 ? [bytes] : []),
});

/** Builds the reusable public-only schema-6 Phase 4 integration fixture. */
export const createPhase4Harness = async (options: Phase4HarnessOptions = {}): Promise<Phase4Harness> => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-phase4-'));
  const rootDir = path.join(sandbox, 'projects');
  const downloadsDirectory = path.join(sandbox, 'downloads');
  const pickerDirectory = path.join(sandbox, 'picker');
  await Promise.all([
    mkdir(rootDir, { recursive: true }),
    mkdir(downloadsDirectory, { recursive: true }),
    mkdir(pickerDirectory, { recursive: true }),
  ]);
  const sourceBytes = Buffer.from(STUDIO_E2E_FAKE_IMAGE_BASE64, 'base64');
  const sourcePath = path.join(pickerDirectory, 'shared-import.png');
  await writeFile(sourcePath, sourceBytes, { flag: 'wx' });

  const clock = createMutableClock(options.now ?? Date.parse('2026-08-31T12:00:00.000Z'));
  const remoteState = createStudioE2EFakeRemoteState(options.taskScripts);
  const identityCounts = new Map<StudioPilotRuntimeIdentityKindV3, number>();
  const pickerQueue: Array<StudioPilotNativePhotoSelectionV3 | null> = [];
  const downloadOutcomes: Array<'success' | 'failure'> = [];
  const mediaStepActions = new Map<StudioPilotMediaStorageStepV3, MediaStepAction[]>();
  const mediaSteps: Array<{ step: StudioPilotMediaStorageStepV3; projectId: string }> = [];
  const dependencyCounts = { listProviders: 0, listConnections: 0 };
  let pickerSourceCounter = 0;
  let generatedDownloadCounter = 0;
  let downloadRequestCount = 0;
  let runtime: CreativeStudioPilotRuntimeV3 | null = null;
  let fake: StudioE2EFakeBundle | null = null;
  const detachedRuntimes = new Set<Phase4DetachedRuntime>();
  let cleaned = false;

  const requireRuntime = (): CreativeStudioPilotRuntimeV3 => {
    if (runtime === null) throw new Error('Phase 4 runtime is not started');
    return runtime;
  };
  const requireFake = (): StudioE2EFakeBundle => {
    if (fake === null) throw new Error('Phase 4 fake adapter is not started');
    return fake;
  };
  const projectPath = (projectId: string): string => path.join(rootDir, exactPathSegment(projectId));
  const manifestPath = (projectId: string): string => path.join(projectPath(projectId), 'project.json');
  const exportsPath = (projectId: string): string => path.join(projectPath(projectId), 'exports');
  const exportCatalogPath = (projectId: string): string => path.join(exportsPath(projectId), 'catalog-v3.json');
  const exportArtifactPath = (projectId: string, folderName: string): string =>
    path.join(exportsPath(projectId), exactPathSegment(folderName));

  const mintIdentity = (kind: StudioPilotRuntimeIdentityKindV3): string => {
    const next = (identityCounts.get(kind) ?? 0) + 1;
    identityCounts.set(kind, next);
    return `${kind}_${String(next).padStart(8, '0')}`;
  };

  const onMediaStorageStep = async (step: StudioPilotMediaStorageStepV3, projectId: string): Promise<void> => {
    mediaSteps.push({ step, projectId });
    const queue = mediaStepActions.get(step);
    const action = queue?.shift();
    if (queue?.length === 0) mediaStepActions.delete(step);
    if (action === undefined) return;
    if (action.kind === 'fail') throw action.error;
    action.reached({ step, projectId });
    await action.released;
  };

  const connectionManifest = createStudioConnectionManifestV1({ rootDir });

  const constructRuntime = async (): Promise<{
    runtime: CreativeStudioPilotRuntimeV3;
    fake: StudioE2EFakeBundle;
  }> => {
    const nextFake = createStudioE2EFakeBundle({ rootDir, catalogProfile: 'lifecycle', remoteState });
    for (const connection of nextFake.connections) {
      if (connection.adapterId === 'weprompt-image-v1' && connection.model === 'weprompt-e2e-image') {
        // Exercise the same durable manifest boundary as production rather than injecting a route catalog.
        // eslint-disable-next-line no-await-in-loop -- the manifest serializes its own crash-safe writes.
        await connectionManifest.saveConnection(connection);
      }
    }
    const listProviders = async () => {
      dependencyCounts.listProviders += 1;
      return [structuredClone(nextFake.provider)];
    };
    const listConnections = async () => {
      dependencyCounts.listConnections += 1;
      return connectionManifest.listConnections();
    };
    const providerResolver = createStudioProviderResolver({ listProviders, listConnections });
    const baseAdapters = createGenerationProviderAdapterRegistry({ image: { workspaceDir: sandbox } });
    const adapters: GenerationProviderAdapterRegistry = new Map([...baseAdapters, ...nextFake.adapters]);
    const generatedUrlResolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: downloadsDirectory,
      lookup: async () => [{ address: PUBLIC_DOWNLOAD_ADDRESS, family: 4 }],
      request: async (_target, requestOptions) => {
        requestOptions?.signal?.throwIfAborted();
        downloadRequestCount += 1;
        const outcome = downloadOutcomes.shift() ?? 'success';
        return outcome === 'success' ? response(sourceBytes) : response(Buffer.alloc(0), 503);
      },
      createTemporaryId: () => `download_${String(++generatedDownloadCounter).padStart(8, '0')}`,
    });
    const nextRuntime = createCreativeStudioPilotRuntimeV3({
      rootDir,
      providerResolver,
      adapters,
      listProviders,
      pickPhoto: async () => pickerQueue.shift() ?? null,
      resolveGeneratedUrl: generatedUrlResolver,
      now: clock.now,
      mintIdentity,
      sleep: async (_milliseconds, signal) => {
        signal.throwIfAborted();
        await Promise.resolve();
        signal.throwIfAborted();
      },
      onMediaStorageStep,
    });
    return { runtime: nextRuntime, fake: nextFake };
  };

  const start = async (): Promise<void> => {
    if (cleaned) throw new Error('Phase 4 harness has been cleaned up');
    if (runtime !== null || fake !== null) return;
    const constructed = await constructRuntime();
    const nextRuntime = constructed.runtime;
    const nextFake = constructed.fake;
    fake = nextFake;
    runtime = nextRuntime;
    try {
      await nextRuntime.startV3();
    } catch (error) {
      runtime = null;
      fake = null;
      await Promise.allSettled([nextRuntime.dispose(), nextFake.dispose()]);
      throw error;
    }
  };

  const stop = async (): Promise<void> => {
    const stoppedRuntime = runtime;
    const stoppedFake = fake;
    runtime = null;
    fake = null;
    if (stoppedRuntime !== null) {
      try {
        await stoppedRuntime.dispose();
      } finally {
        await stoppedFake?.dispose();
      }
    } else {
      await stoppedFake?.dispose();
    }
  };

  const loadResult = (projectId: string): Promise<StudioProjectLoadResultV3> =>
    requireRuntime().entryPoint.loadProjectV3(projectId);
  const loadSupported = async (projectId: string): Promise<Phase4SupportedProject> => {
    const loaded = await loadResult(projectId);
    if (loaded.status !== 'supported') throw new Error(`Expected supported project, received ${loaded.status}`);
    return loaded;
  };
  const expectedAuthoringRevision = async (projectId: string, supplied?: number): Promise<number> =>
    supplied ?? (await loadSupported(projectId)).canvas.authoringRevision;

  const applySingleMutation = async (
    projectId: string,
    operation: StudioMutationOperationV3,
    suppliedRevision?: number
  ): Promise<StudioApplyMutationBatchResultV3> =>
    requireRuntime().entryPoint.applyMutationBatchV3({
      schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
      projectId,
      expectedAuthoringRevision: await expectedAuthoringRevision(projectId, suppliedRevision),
      operations: [operation],
    });

  const waitForJob = async (
    projectId: string,
    jobId: string,
    expectation: Phase4JobExpectation,
    waitOptions: Phase4WaitOptions = {}
  ): Promise<StudioRendererPieceActivityJobV3> => {
    const deadline = Date.now() + (waitOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const accepts = (job: StudioRendererPieceActivityJobV3, project: Phase4SupportedProject): boolean =>
      typeof expectation === 'function'
        ? expectation(job, project)
        : Array.isArray(expectation)
          ? expectation.includes(job.status)
          : job.status === expectation;
    while (Date.now() <= deadline) {
      // eslint-disable-next-line no-await-in-loop -- polling only renderer-safe public projections.
      const project = await loadSupported(projectId);
      const job = project.activity.jobs.find((candidate) => candidate.jobId === jobId);
      if (job !== undefined && accepts(job, project)) return job;
      // eslint-disable-next-line no-await-in-loop -- bounded test wait yields to the Main Job loop.
      await delay(waitOptions.intervalMs ?? 5);
    }
    throw new Error(`Timed out waiting for projected Job ${jobId}`);
  };

  const waitForIdle = async (
    projectId: string,
    waitOptions: Phase4WaitOptions = {}
  ): Promise<Phase4SupportedProject> => {
    const deadline = Date.now() + (waitOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    while (Date.now() <= deadline) {
      // eslint-disable-next-line no-await-in-loop -- polling only renderer-safe public projections.
      const project = await loadSupported(projectId);
      if (project.activity.jobs.every((job) => !ACTIVE_JOB_STATUSES.has(job.status))) return project;
      // eslint-disable-next-line no-await-in-loop -- bounded test wait yields to the Main Job loop.
      await delay(waitOptions.intervalMs ?? 5);
    }
    throw new Error(`Timed out waiting for project ${projectId} to become idle`);
  };

  const readProjectManifest = async (projectId: string): Promise<StudioProjectV3> => {
    const [manifestBytes, brief] = await Promise.all([
      readFile(manifestPath(projectId), 'utf8'),
      readFile(path.join(projectPath(projectId), 'brief.md'), 'utf8'),
    ]);
    const envelope: unknown = JSON.parse(manifestBytes);
    if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
      throw new Error(`Invalid schema-6 envelope for ${projectId}`);
    }
    const { briefFile: _briefFile, ...manifest } = envelope as Record<string, unknown>;
    const value: unknown = { ...manifest, brief };
    if (!validateStudioProjectV3(value)) throw new Error(`Invalid schema-6 manifest for ${projectId}`);
    return value;
  };

  const harness: Phase4Harness = {
    sandbox,
    rootDir,
    sourcePath,
    sourceBytes,
    get runtime() {
      return requireRuntime();
    },
    get entryPoint() {
      return requireRuntime().entryPoint;
    },
    get fake() {
      return requireFake();
    },
    remoteState,
    clock,
    identityCounts,
    mediaSteps,
    get downloadRequestCount() {
      return downloadRequestCount;
    },
    async createDetachedRuntime() {
      if (cleaned) throw new Error('Phase 4 harness has been cleaned up');
      const constructed = await constructRuntime();
      let disposed = false;
      const detached: Phase4DetachedRuntime = {
        runtime: constructed.runtime,
        entryPoint: constructed.runtime.entryPoint,
        fake: constructed.fake,
        async dispose() {
          if (disposed) return;
          disposed = true;
          detachedRuntimes.delete(detached);
          try {
            await constructed.runtime.dispose();
          } finally {
            await constructed.fake.dispose();
          }
        },
      };
      detachedRuntimes.add(detached);
      return detached;
    },
    createProject(input = {}) {
      const normalized = typeof input === 'string' ? { name: input, brief: '' } : input;
      return requireRuntime().entryPoint.createProjectV3({
        name: normalized.name ?? 'Phase 4 Pilot',
        brief: normalized.brief ?? '',
      });
    },
    listProjects: () => requireRuntime().entryPoint.listProjectsV3(),
    loadResult,
    loadSupported,
    deleteProject: (input) => requireRuntime().entryPoint.deleteProjectV3(input),
    setSpendPolicy: (projectId, policy, revision) =>
      applySingleMutation(projectId, { kind: 'set_spend_policy', policy }, revision),
    renamePiece: (projectId, pieceId, handle, revision) =>
      applySingleMutation(projectId, { kind: 'rename_piece', pieceId, handle }, revision),
    undo: (projectId, undoEntryId, revision) =>
      applySingleMutation(projectId, { kind: 'undo_last', entryId: undoEntryId }, revision),
    async prepareCreate(projectId, prepareOptions = {}) {
      return requireRuntime().entryPoint.preparePhotoV3({
        mode: 'create',
        projectId,
        expectedAuthoringRevision: await expectedAuthoringRevision(projectId, prepareOptions.expectedAuthoringRevision),
        words: prepareOptions.words ?? 'A quiet photograph in soft morning light.',
        settings: prepareOptions.settings ?? DEFAULT_SETTINGS,
        suggestedHandle: prepareOptions.suggestedHandle ?? null,
        referencePieceIds: prepareOptions.referencePieceIds ?? [],
      });
    },
    async prepareRetry(projectId, pieceId, sourceJobId, revision) {
      return requireRuntime().entryPoint.preparePhotoV3({
        mode: 'retry',
        projectId,
        expectedAuthoringRevision: await expectedAuthoringRevision(projectId, revision),
        pieceId,
        sourceJobId,
      });
    },
    confirm(prepared, confirmOptions = {}) {
      const quote = 'quote' in prepared ? prepared.quote : prepared;
      return requireRuntime().entryPoint.confirmPreparedPhotoV3({
        reservationId: quote.reservationId,
        quoteId: quote.quoteId,
        quoteRevision: quote.quoteRevision,
        explicitHumanConfirmation: confirmOptions.explicitHumanConfirmation ?? quote.requiresExplicitHumanAction,
        duplicateChargeAcknowledged:
          confirmOptions.duplicateChargeAcknowledged ?? quote.duplicateChargeAcknowledgementRequired,
      });
    },
    async enqueueImport(selection = {}) {
      if (selection === null) {
        pickerQueue.push(null);
        return null;
      }
      let selectedPath = selection.sourcePath ?? sourcePath;
      if (selection.bytes !== undefined) {
        pickerSourceCounter += 1;
        selectedPath = path.join(pickerDirectory, `selection-${String(pickerSourceCounter).padStart(4, '0')}.png`);
        await writeFile(selectedPath, selection.bytes, { flag: 'wx' });
      }
      const queued = { path: selectedPath, fileName: selection.fileName ?? 'Imported photo.png' };
      pickerQueue.push(queued);
      return queued;
    },
    async importPhoto(projectId, revision) {
      return requireRuntime().entryPoint.importPhotoV3({
        projectId,
        expectedAuthoringRevision: await expectedAuthoringRevision(projectId, revision),
      });
    },
    async exportPiece(projectId, pieceId) {
      const [project, catalog] = await Promise.all([
        loadSupported(projectId),
        requireRuntime().entryPoint.listPieceExportsV3(projectId),
      ]);
      return requireRuntime().entryPoint.exportPieceV3({
        projectId,
        pieceId,
        expectedRevision: project.canvas.revision,
        expectedCatalogRevision: catalog.revision,
      });
    },
    waitForJob,
    waitForIdle,
    enqueueTaskScript: (script) => requireFake().enqueueTaskScript(script),
    releaseSubmitHold: (idempotencyKey) => requireFake().releaseSubmitHold(idempotencyKey),
    releaseTaskHold: (providerJobId) => requireFake().releaseTaskHold(providerJobId),
    enqueueDownloadFailure() {
      downloadOutcomes.push('failure');
    },
    failMediaStepOnce(step, error = new Error(`Injected Phase 4 media fault at ${step}`)) {
      const actions = mediaStepActions.get(step) ?? [];
      actions.push({ kind: 'fail', error });
      mediaStepActions.set(step, actions);
    },
    pauseMediaStepOnce(step) {
      let reach: ((value: { step: StudioPilotMediaStorageStepV3; projectId: string }) => void) | null = null;
      let releaseWait: (() => void) | null = null;
      const reached = new Promise<{ step: StudioPilotMediaStorageStepV3; projectId: string }>((resolve) => {
        reach = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseWait = resolve;
      });
      const actions = mediaStepActions.get(step) ?? [];
      actions.push({
        kind: 'pause',
        reached: (value) => {
          reach?.(value);
          reach = null;
        },
        released,
      });
      mediaStepActions.set(step, actions);
      return {
        reached,
        release() {
          releaseWait?.();
          releaseWait = null;
        },
      };
    },
    readProjectManifest,
    async evidenceCounts(projectId) {
      const [project, manifest] = await Promise.all([loadSupported(projectId), readProjectManifest(projectId)]);
      const jobs = Object.values(manifest.jobs);
      return {
        resolverRouteCalls: dependencyCounts.listConnections,
        providerLookups: dependencyCounts.listProviders,
        providerCalls: requireFake().getProviderCallCounts(),
        preparedQuotes: project.activity.preparedPhotoQuotes.length,
        authorizations: manifest.spendAuthorizations.length,
        persistedQuotes: manifest.spendAuthorizations.length,
        jobs: jobs.length,
        spendReceipts: jobs.filter((job) => job.spendReceipt !== null).length,
        totalRecordedSpendMinorUnits: jobs.reduce((total, job) => total + (job.spendReceipt?.totalMinorUnits ?? 0), 0),
      };
    },
    projectPath,
    manifestPath,
    exportsPath,
    exportCatalogPath,
    exportArtifactPath,
    start,
    stop,
    async restart(restartOptions = {}) {
      await stop();
      if (restartOptions.start !== false) await start();
    },
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      try {
        await Promise.allSettled([...detachedRuntimes].map((detached) => detached.dispose()));
        await stop();
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  };

  if (options.start !== false) await start();
  return harness;
};

/** Returns deterministic export payload files while excluding the manifest itself. */
export const phase4ExportPayloadFiles = async (artifactDirectory: string): Promise<string[]> =>
  (await readdir(artifactDirectory))
    .filter((entry) => entry !== 'manifest.json')
    .toSorted()
    .map((entry) => path.join(artifactDirectory, entry));
