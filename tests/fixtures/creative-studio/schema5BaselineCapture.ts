/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDIO_MUTATION_BATCH_SCHEMA_VERSION } from '@/common/types/project/creativeStudioTypes';
import { createStudioE2EFakeBundle } from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import { createStudioJobManager } from '@process/services/creative-studio/jobManager';
import { createStudioMediaStore } from '@process/services/creative-studio/mediaStore';
import { createStudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import { createCreativeStudioServiceV2 } from '@process/services/creative-studio/service';
import {
  createStudioExportCatalogStoreV2,
  createStudioRateCardV2,
} from '@process/services/creative-studio/service/schema2';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import {
  assertSchema5CaptureBaseline,
  deriveSchema5ClassifierFixtures,
  SCHEMA5_CLASSIFIER_TRANSFORMS,
} from './schema5ClassifierFixtures';

export const SCHEMA5_CAPTURE_BASELINE_COMMIT = 'f3f9f764b';
export const SCHEMA5_CAPTURE_COMMAND = 'bun tests/fixtures/creative-studio/schema5BaselineCapture.ts --write';
export const SCHEMA5_CAPTURE_PROJECT_ID = 'project_capture';
export const SCHEMA5_CAPTURE_FIXTURE_DIRECTORY = fileURLToPath(new URL('./schema5-baseline/', import.meta.url));

const CAPTURE_START_MS = Date.parse('2026-08-30T00:00:00.000Z');
const FAKE_PROVIDER_SCRATCH_DIRECTORY = '.studio-raw-output-path-sentinel';
const UNSETTLED_PUBLICATION_ALIAS = /(?:\.publish|\.\d+_\d+\.(?:ready|tmp))$/u;
const HEALTHY_PROJECT_MANIFEST = `healthy/storage/${SCHEMA5_CAPTURE_PROJECT_ID}/project.json`;
const METADATA_PATH = 'capture-metadata.json';
const CAPTURE_TIMEOUT_ATTEMPTS = 2_000;

type CapturePayloads = ReadonlyMap<string, Buffer>;

export type Schema5CaptureMetadata = Readonly<{
  schemaVersion: 1;
  baselineCommit: typeof SCHEMA5_CAPTURE_BASELINE_COMMIT;
  command: typeof SCHEMA5_CAPTURE_COMMAND;
  healthyCapture: Readonly<{
    source: 'public_current_main_runtime';
    projectSchemaVersion: 5;
    projectId: typeof SCHEMA5_CAPTURE_PROJECT_ID;
    fakeAdapterProfile: 'explicit-selection';
    excludedStorageNodes: readonly [typeof FAKE_PROVIDER_SCRATCH_DIRECTORY];
  }>;
  classifierTransforms: typeof SCHEMA5_CLASSIFIER_TRANSFORMS;
  payloads: ReadonlyArray<Readonly<{ path: string; byteSize: number; sha256: string }>>;
}>;

class DeterministicCaptureClock {
  private ordinal = 0;

  private nextEpochMs(): number {
    const value = CAPTURE_START_MS + this.ordinal * 1_000;
    this.ordinal += 1;
    return value;
  }

  readonly iso = (): string => new Date(this.nextEpochMs()).toISOString();
  readonly date = (): Date => new Date(this.nextEpochMs());
  readonly epochMs = (): number => this.nextEpochMs();
}

const sequentialId = (prefix: string): (() => string) => {
  let ordinal = 0;
  return () => {
    ordinal += 1;
    return `${prefix}_${String(ordinal).padStart(3, '0')}`;
  };
};

const jsonBytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), 'utf8');

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const waitFor = async <Value>(read: () => Promise<Value | null>): Promise<Value> => {
  for (let attempt = 0; attempt < CAPTURE_TIMEOUT_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- completion publication is intentionally serialized.
    const value = await read();
    if (value !== null) return value;
    // eslint-disable-next-line no-await-in-loop -- bounded yield lets the real Job manager publish.
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out capturing the schema-5 Creative Studio baseline');
};

const collectStoragePayloads = async (rootDir: string): Promise<Map<string, Buffer>> => {
  const payloads = new Map<string, Buffer>();
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).toSorted((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      if (relativeDirectory.length === 0 && entry.name === FAKE_PROVIDER_SCRATCH_DIRECTORY) continue;
      const relativePath = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      const absolutePath = path.join(directory, entry.name);
      if (UNSETTLED_PUBLICATION_ALIAS.test(entry.name)) {
        throw new Error(`Schema-5 capture observed unsettled publication state: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop -- deterministic lexical traversal is the fixture contract.
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        // eslint-disable-next-line no-await-in-loop -- deterministic lexical traversal is the fixture contract.
        payloads.set(`healthy/storage/${relativePath}`, await readFile(absolutePath));
      } else {
        throw new Error(`Unsafe node in schema-5 capture: ${relativePath}`);
      }
    }
  };
  await visit(rootDir, '');
  return payloads;
};

const verifyGeneratedAsset = async (
  mediaStore: ReturnType<typeof createStudioMediaStore>,
  projectId: string,
  assetId: string,
  expected: Readonly<{ byteSize: number; sha256: string }>
): Promise<void> => {
  const resolved = await mediaStore.resolveAssetV2(projectId, assetId);
  if (resolved === null) throw new Error('Captured generated asset did not resolve');
  const chunks: Buffer[] = [];
  const stream = await resolved.openVerifiedStream();
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength !== expected.byteSize || sha256(bytes) !== expected.sha256) {
    throw new Error('Captured generated asset failed verified readback');
  }
};

const captureHealthyPayloads = async (): Promise<Map<string, Buffer>> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'weprompt-schema5-capture-'));
  const clock = new DeterministicCaptureClock();
  const fake = createStudioE2EFakeBundle({ rootDir, catalogProfile: 'explicit-selection' });
  const store = createCreativeStudioStore({
    rootDir,
    now: clock.iso,
    createId: () => SCHEMA5_CAPTURE_PROJECT_ID,
  });
  const exportCatalogStore = createStudioExportCatalogStoreV2({ createNonce: sequentialId('export_nonce_capture') });
  const mediaStore = createStudioMediaStore({
    store,
    withManagedMediaAuthority: exportCatalogStore.withManagedMediaAuthority.bind(exportCatalogStore),
    createId: sequentialId('asset_capture'),
    createMutationId: sequentialId('media_mutation_capture'),
    now: clock.iso,
  });
  const providerResolver = createStudioProviderResolver({
    listProviders: async () => [fake.provider],
    listConnections: () => store.listConnections(),
  });
  const jobManager = createStudioJobManager({
    store,
    mediaStore,
    providerResolver,
    adapters: fake.adapters,
    listProviders: async () => [fake.provider],
    now: clock.iso,
    nowEpochMs: clock.epochMs,
    sleep: async () => undefined,
    jitterMs: (baseMs) => baseMs,
  });
  const service = createCreativeStudioServiceV2({
    store,
    mediaStore,
    providerResolver,
    jobManager,
    exportCatalogStore,
    listProviders: async () => [fake.provider],
    getAdapterRegistry: () => fake.adapters,
    rateCard: async (generation) =>
      createStudioRateCardV2(
        generation.routes
          .filter((route) => route.kind === 'image')
          .map((route) => ({
            routeId: route.choiceId,
            kind: 'image' as const,
            currency: 'USD',
            rateUnit: 'generation' as const,
            rateMinorUnits: 7,
          }))
      ),
    createQuoteId: sequentialId('quote_capture'),
    createJobId: sequentialId('job_capture'),
    createIdempotencyKey: sequentialId('idempotency_capture'),
    createExportId: sequentialId('export_capture'),
    createConnectionId: sequentialId('connection_capture'),
    now: clock.date,
    onProjectUpdated: () => undefined,
  });

  try {
    for (const connection of fake.connections) {
      // eslint-disable-next-line no-await-in-loop -- connection-manifest order is fixture authority.
      await store.saveConnection(connection);
    }
    const created = await service.createProject({
      name: 'Schema 5 capture',
      brief: 'A lantern maker prepares one portrait beside the river before dawn.',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    if (created.id !== SCHEMA5_CAPTURE_PROJECT_ID) throw new Error('Unexpected capture project identity');

    const routes = await service.listRoutes({ projectId: created.id });
    const imageRouteId = routes.image.options[0]?.choiceId;
    if (imageRouteId === undefined) throw new Error('Fake adapter did not expose an image route');
    const planned = await service.applyMutations(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: created.id,
        expectedRevision: created.revision,
        operations: [
          {
            kind: 'add_beat',
            beatId: 'beat_capture',
            beat: {
              title: 'Before dawn',
              story: 'The lantern maker pauses beside the river as the first blue light appears.',
              targetSeconds: null,
            },
            beforeBeatId: null,
          },
          {
            kind: 'add_shot',
            beatId: 'beat_capture',
            shotId: 'shot_capture',
            shot: {
              shootingScript: 'A quiet medium portrait beside the river, lanterns glowing behind the maker.',
              durationSeconds: 5,
            },
            beforeShotId: null,
          },
          {
            kind: 'set_reference_plan',
            references: [
              {
                kind: 'character',
                label: 'Lantern maker',
                prompt: 'A consistent portrait of an elderly lantern maker in an indigo work coat.',
              },
            ],
          },
          { kind: 'set_routes', imageRouteId, videoRouteId: null },
        ],
      },
      { mutationId: 'mutation_capture_plan', capturedAt: clock.iso() }
    );
    const referenceId = planned.project.referenceOrder[0];
    if (referenceId === undefined) throw new Error('Capture reference plan was not committed');

    const preparedQuote = await service.prepareProjectReferences({
      projectId: created.id,
      expectedRevision: planned.project.revision,
      referenceIds: [referenceId],
    });
    await service.confirmSubmission({
      projectId: created.id,
      quoteId: preparedQuote.baseOnly.id,
      expectedRevision: planned.project.revision,
    });

    const completed = await waitFor(async () => {
      const loaded = await service.getProject(created.id);
      if (loaded.status !== 'supported') throw new Error('Capture project became unsupported');
      const reference = loaded.project.references[referenceId];
      const jobId = reference?.jobIds[0];
      const job = jobId === undefined ? undefined : loaded.project.jobs[jobId];
      return job?.status === 'succeeded' && reference?.approvedAssetId !== null
        ? { project: loaded.project, assetId: reference.approvedAssetId }
        : null;
    });
    const generatedAsset = completed.project.assets[completed.assetId];
    if (
      generatedAsset === undefined ||
      generatedAsset.producerJobId === null ||
      generatedAsset.compositionDigest === null
    ) {
      throw new Error('Capture did not publish a generated asset with provenance');
    }
    await verifyGeneratedAsset(mediaStore, created.id, completed.assetId, generatedAsset);

    const emptyCatalog = await service.listExports({ projectId: created.id });
    const exportCatalog = await service.createExport({
      projectId: created.id,
      expectedRevision: completed.project.revision,
      expectedCatalogRevision: emptyCatalog.revision,
      shape: 'script',
    });

    // Keep the capture sequence lexical. These public reads own distinct storage authorities and
    // production callers serialize them; racing repair-capable reads would make the fixture itself
    // an artificial concurrency test.
    const runtime = await store.getProjectV2(created.id);
    const renderer = await service.getProject(created.id);
    const workspace = await service.getProjectWorkspace({ projectId: created.id });
    const status = await service.getProjectStatus({ projectId: created.id, detail: true });
    const projectList = await service.listProjects();
    if (runtime.status !== 'supported' || renderer.status !== 'supported' || workspace.status !== 'supported') {
      throw new Error('Capture projections did not resolve the supported project');
    }
    if (
      runtime.project.revision !== renderer.project.revision ||
      runtime.project.revision !== workspace.snapshot.project.revision ||
      runtime.project.revision !== status.projectRevision
    ) {
      throw new Error('Capture projections do not share one project revision');
    }

    const payloads = await collectStoragePayloads(rootDir);
    payloads.set('healthy/projections/runtime-project.json', jsonBytes(runtime.project));
    payloads.set('healthy/projections/renderer-project.json', jsonBytes(renderer.project));
    payloads.set('healthy/projections/workspace.json', jsonBytes(workspace.snapshot));
    payloads.set('healthy/projections/project-status.json', jsonBytes(status));
    payloads.set('healthy/projections/project-list.json', jsonBytes(projectList));
    payloads.set('healthy/projections/prepared-quote.json', jsonBytes(preparedQuote));
    payloads.set('healthy/projections/export-catalog.json', jsonBytes(exportCatalog));
    return payloads;
  } finally {
    service.dispose();
    await jobManager.dispose().catch((): undefined => undefined);
    await fake.dispose().catch((): undefined => undefined);
    await rm(rootDir, { recursive: true, force: true });
  }
};

const createMetadata = (payloads: CapturePayloads): Schema5CaptureMetadata => ({
  schemaVersion: 1,
  baselineCommit: SCHEMA5_CAPTURE_BASELINE_COMMIT,
  command: SCHEMA5_CAPTURE_COMMAND,
  healthyCapture: {
    source: 'public_current_main_runtime',
    projectSchemaVersion: 5,
    projectId: SCHEMA5_CAPTURE_PROJECT_ID,
    fakeAdapterProfile: 'explicit-selection',
    excludedStorageNodes: [FAKE_PROVIDER_SCRATCH_DIRECTORY],
  },
  classifierTransforms: SCHEMA5_CLASSIFIER_TRANSFORMS,
  payloads: [...payloads]
    .map(([payloadPath, bytes]) => ({ path: payloadPath, byteSize: bytes.byteLength, sha256: sha256(bytes) }))
    .toSorted((left, right) => left.path.localeCompare(right.path)),
});

/** Captures public-runtime bytes and then derives the two storage classifier fixtures separately. */
export const captureSchema5Baseline = async (): Promise<Map<string, Buffer>> => {
  assertSchema5CaptureBaseline();
  const payloads = await captureHealthyPayloads();
  const manifest = payloads.get(HEALTHY_PROJECT_MANIFEST);
  if (manifest === undefined) throw new Error('Healthy capture omitted the project manifest');
  const classifiers = deriveSchema5ClassifierFixtures(manifest);
  payloads.set(SCHEMA5_CLASSIFIER_TRANSFORMS.unsupported.output, classifiers.unsupported);
  payloads.set(SCHEMA5_CLASSIFIER_TRANSFORMS.malformed.output, classifiers.malformed);
  payloads.set(METADATA_PATH, Buffer.from(`${JSON.stringify(createMetadata(payloads), null, 2)}\n`, 'utf8'));
  return payloads;
};

const publishCapture = async (outputDirectory: string, payloads: CapturePayloads): Promise<void> => {
  const parent = path.dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, '.schema5-baseline-'));
  try {
    for (const [relativePath, bytes] of [...payloads].toSorted(([left], [right]) => left.localeCompare(right))) {
      const outputPath = path.join(staging, ...relativePath.split('/'));
      // eslint-disable-next-line no-await-in-loop -- fixture publication follows deterministic lexical order.
      await mkdir(path.dirname(outputPath), { recursive: true });
      // eslint-disable-next-line no-await-in-loop -- fixture publication follows deterministic lexical order.
      await writeFile(outputPath, bytes, { flag: 'wx' });
    }
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(staging, outputDirectory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
};

export const writeSchema5BaselineFixture = async (): Promise<void> => {
  await publishCapture(SCHEMA5_CAPTURE_FIXTURE_DIRECTORY, await captureSchema5Baseline());
};

const isDirectInvocation =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectInvocation) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    throw new Error(`Usage: ${SCHEMA5_CAPTURE_COMMAND}`);
  }
  await writeSchema5BaselineFixture();
}
