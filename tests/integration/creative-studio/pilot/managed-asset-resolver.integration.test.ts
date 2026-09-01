/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { promises as nodeFs } from 'node:fs';
import { mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import {
  createStudioPilotMediaStoreV3,
  type StudioPilotNativePhotoSelectionV3,
} from '@/process/services/creative-studio/service/pilot/runtime/media';
import { createCreativeStudioPilotStoreV3 } from '@/process/services/creative-studio/store/pilotStore';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { createPilotPhotoFixtureV3 } from './presentation/realFixture';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-resolver-'));
  roots.push(root);
  return root;
};

const createClock = () => {
  let milliseconds = Date.parse('2026-09-01T08:00:00.000Z');
  return () => new Date(milliseconds++).toISOString();
};

const writePng = async (file: string): Promise<string> => {
  await sharp({
    create: { width: 32, height: 20, channels: 3, background: { r: 20, g: 80, b: 140 } },
  })
    .png()
    .toFile(file);
  return file;
};

const collect = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const expectPilotError = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ name: 'CreativeStudioPilotServiceErrorV3', code });
};

const createHarness = async () => {
  const root = await temporaryRoot();
  const sourceRoot = await temporaryRoot();
  const source = await writePng(path.join(sourceRoot, 'source.png'));
  const now = createClock();
  let projectIdentity = 0;
  let temporary = 0;
  const store = createCreativeStudioPilotStoreV3({
    rootDir: root,
    now,
    createProjectId: () => `project_media_${++projectIdentity}`,
    createTemporaryId: () => `store_temp_${String(++temporary).padStart(8, '0')}`,
  });
  const project = await store.createProjectV3({ name: 'Resolver', brief: 'One photograph.' });
  let mediaTemporary = 0;
  let verifierFailureFileName: string | null = null;
  let verifierFailureHandle: Awaited<ReturnType<typeof nodeFs.open>> | null = null;
  const instrumentedFs = Object.create(nodeFs) as typeof nodeFs;
  Object.defineProperty(instrumentedFs, 'open', {
    configurable: true,
    enumerable: true,
    value: async (...args: Parameters<typeof nodeFs.open>) => {
      const handle = await nodeFs.open(...args);
      if (verifierFailureFileName !== null && path.basename(String(args[0])) === verifierFailureFileName) {
        verifierFailureFileName = null;
        verifierFailureHandle = handle;
        Object.defineProperty(handle, 'read', {
          configurable: true,
          value: async () => {
            throw new Error('injected verifier read failure');
          },
        });
      }
      return handle;
    },
  });
  const media = createStudioPilotMediaStoreV3({
    store,
    pickPhoto: async (): Promise<StudioPilotNativePhotoSelectionV3> => ({
      path: source,
      fileName: 'source.png',
    }),
    now,
    mintIdentity: (kind) => `${kind}_media`,
    createTemporaryId: () => `media_temp_${String(++mediaTemporary).padStart(8, '0')}`,
    detectVariationGrid: async () => false,
    fs: instrumentedFs,
  });
  const imported = await media.importPhotoV3({
    projectId: project.id,
    expectedAuthoringRevision: project.authoringRevision,
  });
  if (imported.status !== 'imported') throw new Error('expected imported photo');
  const current = await store.loadProjectV3(project.id);
  const asset = current.assets[imported.assetId]!;
  const managedPath = path.join(
    root,
    project.id,
    'media-v3',
    asset.managedAsset.collection,
    asset.managedAsset.fileName
  );
  return {
    root,
    source,
    store,
    media,
    project: current,
    asset,
    managedPath,
    failNextVerifierRead() {
      verifierFailureFileName = path.basename(managedPath);
    },
    verifierFailureWasInjected: () => verifierFailureHandle !== null,
    verifierFailureWasClosed: () => verifierFailureHandle?.fd === -1,
  };
};

describe('schema-6 managed asset protocol resolver', () => {
  it('resolves the real generated-current asset through its producer Job and assets collection', async () => {
    const fixture = await createPilotPhotoFixtureV3({ origin: 'generated', generatedOutcome: 'succeeded' });
    try {
      if (fixture.assetId === null || fixture.jobId === null) throw new Error('expected generated fixture authority');
      const asset = fixture.project.assets[fixture.assetId];
      expect(asset).toMatchObject({
        origin: 'generated',
        producerJobId: fixture.jobId,
        managedAsset: { collection: 'assets' },
      });
      expect(fixture.project.jobs[fixture.jobId]).toMatchObject({
        status: 'succeeded',
        outputAssetId: fixture.assetId,
        target: { kind: 'piece', pieceId: fixture.pieceId },
      });

      const expected = await readFile(fixture.managedPhotoPath);
      const resolved = await fixture.runtime.media.resolveManagedAssetV3(fixture.project.id, fixture.assetId);
      expect(resolved).not.toBeNull();
      expect(resolved!.asset).toEqual({ mimeType: asset!.mimeType, byteSize: expected.length });
      await expect(collect(await resolved!.openVerifiedStream())).resolves.toEqual(expected);
      await expect(collect(await resolved!.openVerifiedStream(5, 23))).resolves.toEqual(expected.subarray(5, 24));
    } finally {
      await fixture.cleanup();
    }
  });

  it('returns only protocol-safe facts and streams exact full and ranged bytes from verified handles', async () => {
    const harness = await createHarness();
    const expected = await readFile(harness.managedPath);
    const resolved = await harness.media.resolveManagedAssetV3(harness.project.id, harness.asset.id);

    expect(resolved).not.toBeNull();
    expect(resolved!.asset).toEqual({ mimeType: 'image/png', byteSize: expected.length });
    expect(Object.keys(resolved!.asset)).toEqual(['mimeType', 'byteSize']);
    expect(JSON.stringify(resolved)).not.toContain(harness.root);

    const full = await resolved!.openVerifiedStream();
    await expect(collect(full)).resolves.toEqual(expected);
    expect(full.closed).toBe(true);

    const ranged = await resolved!.openVerifiedStream(3, 17);
    await expect(collect(ranged)).resolves.toEqual(expected.subarray(3, 18));
    expect(ranged.closed).toBe(true);
  });

  it('revalidates exact asset ownership and manifest facts on every stream open', async () => {
    const harness = await createHarness();
    const resolved = await harness.media.resolveManagedAssetV3(harness.project.id, harness.asset.id);
    expect(resolved).not.toBeNull();

    await harness.store.updateProjectV3(
      harness.project.id,
      (draft) => {
        const next = structuredClone(draft);
        next.assets[harness.asset.id]!.sha256 = 'f'.repeat(64);
        return next;
      },
      { kind: 'runtime', expectedRevision: harness.project.revision }
    );

    await expectPilotError(resolved!.openVerifiedStream(), 'storage_error');
    await expect(harness.media.resolveManagedAssetV3(harness.project.id, harness.asset.id)).resolves.toBeNull();

    const other = await harness.store.createProjectV3({ name: 'Other', brief: 'No photograph.' });
    await expect(harness.media.resolveManagedAssetV3(other.id, harness.asset.id)).resolves.toBeNull();
    await expect(harness.media.resolveManagedAssetV3('bad/project', harness.asset.id)).resolves.toBeNull();
  });

  it('rejects in-place tampering, same-byte path replacement, and removal after resolution', async () => {
    const tampered = await createHarness();
    const tamperedResolution = await tampered.media.resolveManagedAssetV3(tampered.project.id, tampered.asset.id);
    const tamperedBytes = await readFile(tampered.managedPath);
    tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
    await writeFile(tampered.managedPath, tamperedBytes);
    await expectPilotError(tamperedResolution!.openVerifiedStream(), 'storage_error');
    await expect(tampered.media.resolveManagedAssetV3(tampered.project.id, tampered.asset.id)).resolves.toBeNull();

    const replaced = await createHarness();
    const replacementResolution = await replaced.media.resolveManagedAssetV3(replaced.project.id, replaced.asset.id);
    const originalBytes = await readFile(replaced.managedPath);
    await rename(replaced.managedPath, `${replaced.managedPath}.old`);
    await writeFile(replaced.managedPath, originalBytes);
    await expectPilotError(replacementResolution!.openVerifiedStream(), 'storage_error');

    const removed = await createHarness();
    const removalResolution = await removed.media.resolveManagedAssetV3(removed.project.id, removed.asset.id);
    await unlink(removed.managedPath);
    await expectPilotError(removalResolution!.openVerifiedStream(), 'storage_error');
    await expect(removed.media.resolveManagedAssetV3(removed.project.id, removed.asset.id)).resolves.toBeNull();
  });

  it('keeps streaming the verified handle when the managed path is replaced after open', async () => {
    const harness = await createHarness();
    const expected = await readFile(harness.managedPath);
    const resolved = await harness.media.resolveManagedAssetV3(harness.project.id, harness.asset.id);
    const stream = await resolved!.openVerifiedStream();

    await rename(harness.managedPath, `${harness.managedPath}.opened`);
    const replacement = Buffer.from(expected);
    replacement[replacement.length - 1] ^= 0xff;
    await writeFile(harness.managedPath, replacement);

    await expect(collect(stream)).resolves.toEqual(expected);
    expect(stream.closed).toBe(true);
  });

  it('rejects symlink substitution and invalid direct ranges without exposing a path', async () => {
    const harness = await createHarness();
    const resolved = await harness.media.resolveManagedAssetV3(harness.project.id, harness.asset.id);
    expect(resolved).not.toBeNull();

    await expectPilotError(resolved!.openVerifiedStream(-1, 2), 'invalid_payload');
    await expectPilotError(resolved!.openVerifiedStream(2, harness.asset.byteSize), 'invalid_payload');

    await unlink(harness.managedPath);
    await symlink(harness.source, harness.managedPath);
    await expectPilotError(resolved!.openVerifiedStream(), 'storage_error');
    await expect(harness.media.resolveManagedAssetV3(harness.project.id, harness.asset.id)).resolves.toBeNull();
  });

  it('closes the exact opened handle when verification fails before a stream is returned', async () => {
    const harness = await createHarness();
    const resolved = await harness.media.resolveManagedAssetV3(harness.project.id, harness.asset.id);
    expect(resolved).not.toBeNull();

    harness.failNextVerifierRead();
    const operation = resolved!.openVerifiedStream();
    await expectPilotError(operation, 'storage_error');
    expect(harness.verifierFailureWasInjected()).toBe(true);
    expect(harness.verifierFailureWasClosed()).toBe(true);
  });
});
