/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { StudioProjectV2, StudioRendererProjectV2 } from '@/common/types/project/creativeStudioTypes';
import {
  captureSchema5Baseline,
  SCHEMA5_CAPTURE_BASELINE_COMMIT,
  SCHEMA5_CAPTURE_COMMAND,
  SCHEMA5_CAPTURE_FIXTURE_DIRECTORY,
  SCHEMA5_CAPTURE_PROJECT_ID,
  type Schema5CaptureMetadata,
} from '../../fixtures/creative-studio';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import { afterEach, describe, expect, it } from 'vitest';

const HEALTHY_STORAGE_DIRECTORY = path.join(SCHEMA5_CAPTURE_FIXTURE_DIRECTORY, 'healthy', 'storage');
const HEALTHY_MANIFEST_PATH = path.join(HEALTHY_STORAGE_DIRECTORY, SCHEMA5_CAPTURE_PROJECT_ID, 'project.json');
const UNSUPPORTED_MANIFEST_PATH = path.join(
  SCHEMA5_CAPTURE_FIXTURE_DIRECTORY,
  'classifiers',
  'unsupported-project.json'
);
const MALFORMED_MANIFEST_PATH = path.join(SCHEMA5_CAPTURE_FIXTURE_DIRECTORY, 'classifiers', 'malformed-project.json');

const temporaryRoots: string[] = [];

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const collectFixturePayloads = async (): Promise<Map<string, Buffer>> => {
  const payloads = new Map<string, Buffer>();
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).toSorted((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const relativePath = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop -- committed fixture traversal is deliberately lexical.
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        // eslint-disable-next-line no-await-in-loop -- committed fixture traversal is deliberately lexical.
        payloads.set(relativePath, await readFile(absolutePath));
      } else {
        throw new Error(`Unsafe node in committed schema-5 fixture: ${relativePath}`);
      }
    }
  };
  await visit(SCHEMA5_CAPTURE_FIXTURE_DIRECTORY, '');
  return payloads;
};

const digestPayloads = (payloads: ReadonlyMap<string, Uint8Array>): Record<string, string> =>
  Object.fromEntries(
    [...payloads]
      .map(([payloadPath, bytes]) => [payloadPath, sha256(bytes)] as const)
      .toSorted(([left], [right]) => left.localeCompare(right))
  );

const parseJson = <Value>(bytes: Uint8Array): Value => JSON.parse(Buffer.from(bytes).toString('utf8')) as Value;

const materializeClassifierRoot = async (classifierPath: string): Promise<string> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'weprompt-schema5-classifier-'));
  temporaryRoots.push(rootDir);
  await cp(HEALTHY_STORAGE_DIRECTORY, rootDir, { recursive: true });
  await writeFile(path.join(rootDir, SCHEMA5_CAPTURE_PROJECT_ID, 'project.json'), await readFile(classifierPath));
  return rootDir;
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true })));
});

describe('Creative Studio schema-5 baseline capture', { timeout: 120_000 }, () => {
  it('reproduces every committed payload byte for byte across two fresh Main runs', async () => {
    const [first, second, committed] = await Promise.all([
      captureSchema5Baseline(),
      captureSchema5Baseline(),
      collectFixturePayloads(),
    ]);

    expect(digestPayloads(first)).toEqual(digestPayloads(second));
    expect(digestPayloads(first)).toEqual(digestPayloads(committed));
  });

  it('records the baseline command, transforms, and exact SHA-256 inventory', async () => {
    const committed = await collectFixturePayloads();
    const metadata = parseJson<Schema5CaptureMetadata>(committed.get('capture-metadata.json')!);
    const recorded = Object.fromEntries(metadata.payloads.map((payload) => [payload.path, payload.sha256]));
    const actual = digestPayloads(
      new Map([...committed].filter(([payloadPath]) => payloadPath !== 'capture-metadata.json'))
    );

    expect({ baselineCommit: metadata.baselineCommit, command: metadata.command }).toEqual({
      baselineCommit: SCHEMA5_CAPTURE_BASELINE_COMMIT,
      command: SCHEMA5_CAPTURE_COMMAND,
    });
    expect(recorded).toEqual(actual);
  });

  it('captures one correlated project, authorization, successful Job, verified asset, and export', async () => {
    const rootDir = await materializeClassifierRoot(HEALTHY_MANIFEST_PATH);
    const loaded = await createCreativeStudioStore({ rootDir }).getProjectV2(SCHEMA5_CAPTURE_PROJECT_ID);
    if (loaded.status !== 'supported') throw new Error('Committed healthy fixture did not load');
    const jobs = Object.values(loaded.project.jobs);
    const assets = Object.values(loaded.project.assets);
    const exportCatalog = parseJson<{ artifacts: unknown[] }>(
      await readFile(path.join(SCHEMA5_CAPTURE_FIXTURE_DIRECTORY, 'healthy', 'projections', 'export-catalog.json'))
    );

    expect({ brief: loaded.project.brief, authorizations: loaded.project.spendAuthorizations.length }).toEqual({
      brief: 'A lantern maker prepares one portrait beside the river before dawn.',
      authorizations: 1,
    });
    expect(jobs).toEqual([expect.objectContaining({ status: 'succeeded', spendReceipt: expect.any(Object) })]);
    expect({ assetProducer: assets[0]?.producerJobId, exports: exportCatalog.artifacts.length }).toEqual({
      assetProducer: jobs[0]?.id,
      exports: 1,
    });
  });

  it('keeps runtime and renderer-safe observations on one final revision without provider secrets', async () => {
    const runtime = parseJson<StudioProjectV2>(
      await readFile(path.join(SCHEMA5_CAPTURE_FIXTURE_DIRECTORY, 'healthy', 'projections', 'runtime-project.json'))
    );
    const rendererBytes = await readFile(
      path.join(SCHEMA5_CAPTURE_FIXTURE_DIRECTORY, 'healthy', 'projections', 'renderer-project.json')
    );
    const renderer = parseJson<StudioRendererProjectV2>(rendererBytes);
    const workspace = parseJson<{ project: StudioRendererProjectV2 }>(
      await readFile(path.join(SCHEMA5_CAPTURE_FIXTURE_DIRECTORY, 'healthy', 'projections', 'workspace.json'))
    );
    const status = parseJson<{ projectRevision: number }>(
      await readFile(path.join(SCHEMA5_CAPTURE_FIXTURE_DIRECTORY, 'healthy', 'projections', 'project-status.json'))
    );
    const rendererText = rendererBytes.toString('utf8');

    expect([renderer.revision, workspace.project.revision, status.projectRevision]).toEqual([
      runtime.revision,
      runtime.revision,
      runtime.revision,
    ]);
    expect(rendererText).not.toMatch(
      /idempotency|STUDIO_SECRET|STUDIO_PROVIDER_JOB|STUDIO_RAW_OUTPUT|studio-provider-url|\/private\//u
    );
  });

  it('derives the unsupported fixture by changing only the root schema discriminator', async () => {
    const healthy = parseJson<Record<string, unknown>>(await readFile(HEALTHY_MANIFEST_PATH));
    const unsupported = parseJson<Record<string, unknown>>(await readFile(UNSUPPORTED_MANIFEST_PATH));
    const rootDir = await materializeClassifierRoot(UNSUPPORTED_MANIFEST_PATH);
    const inventory = await createCreativeStudioStore({ rootDir }).inspectProjectsV2();

    expect({ ...unsupported, schemaVersion: healthy.schemaVersion }).toEqual(healthy);
    expect(inventory).toEqual({
      supportedProjectIds: [],
      unsupportedProjectIds: [SCHEMA5_CAPTURE_PROJECT_ID],
      quarantinedProjectIds: [],
    });
  });

  it('derives the malformed fixture independently and quarantines it', async () => {
    const healthy = parseJson<Record<string, unknown>>(await readFile(HEALTHY_MANIFEST_PATH));
    const malformed = parseJson<Record<string, unknown>>(await readFile(MALFORMED_MANIFEST_PATH));
    const rootDir = await materializeClassifierRoot(MALFORMED_MANIFEST_PATH);
    const inventory = await createCreativeStudioStore({ rootDir }).inspectProjectsV2();

    expect({ ...malformed, revision: healthy.revision }).toEqual(healthy);
    expect(inventory).toEqual({
      supportedProjectIds: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [SCHEMA5_CAPTURE_PROJECT_ID],
    });
  });
});
