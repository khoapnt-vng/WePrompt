/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Public-runtime export evidence for the isolated schema-6 Pilot.
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type StudioPieceExportArtifactV3,
  type StudioProjectV3,
  type StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import {
  buildStudioPieceExportManifestV3,
  parseStudioPieceExportManifestV3,
} from '@/process/services/creative-studio/service/schema2/exports/pieceManifestV3';
import { parseStudioPieceExportManifestV4 } from '@/process/services/creative-studio/service/schema2/exports/pieceManifestV4';
import {
  createStudioPieceExportRuntimeV3,
  createStudioPieceExportRuntimeV4,
  retainStudioPieceExportArtifactsV3,
  type StudioPieceExportProjectStoreV4,
  type StudioPieceExportRuntimeDepsV3,
  type StudioPieceExportRuntimeDepsV4,
  type StudioPieceExportRuntimeStepV3,
} from '@/process/services/creative-studio/service/pilot/runtime/export';
import { CreativeStudioPilotStoreErrorV4 } from '@/process/services/creative-studio/store/pilot/v4';
import { validateStudioProjectV4 } from '@/process/services/creative-studio/service/schema2/validation';
import { makePhase6Project, PHASE_6_CURRENT_AT } from '../../../../fixtures/creative-studio/phase6Project';
import { createPilotPhotoFixtureV3, type PilotPhotoFixtureV3, type PilotPhotoFixtureOptionsV3 } from './realFixture';

const fixtures: PilotPhotoFixtureV3[] = [];
const temporaryRoots: string[] = [];
const EXPORT_TIME = '2026-08-31T00:10:00.000Z';
const PHASE_6_EXPORT_TIME = '2026-09-02T00:10:00.000Z';

afterEach(async () => {
  await Promise.all([
    ...fixtures.splice(0).map((fixture) => fixture.cleanup()),
    ...temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ]);
});

const projectDirectory = (root: string, projectId: string): string => path.join(root, projectId);
const exportsDirectory = (root: string, projectId: string): string =>
  path.join(projectDirectory(root, projectId), 'exports');

const makePng = async (red = 20): Promise<Buffer> =>
  sharp({
    create: { width: 32, height: 24, channels: 4, background: { r: red, g: 40, b: 90, alpha: 1 } },
  })
    .png()
    .toBuffer();

type Harness = {
  fixture: PilotPhotoFixtureV3;
  root: string;
  store: PilotPhotoFixtureV3['runtime']['store'];
  project: StudioProjectV3;
  pieceId: string;
  sourcePath: string;
  sourceBytes: Buffer;
  media: StudioPieceExportRuntimeDepsV3['media'];
  createRuntime(
    overrides?: Partial<StudioPieceExportRuntimeDepsV3>
  ): ReturnType<typeof createStudioPieceExportRuntimeV3>;
};

const runtimeFactory = (harness: Omit<Harness, 'createRuntime'>) => {
  let exportId = 0;
  let nonce = 0;
  return (overrides: Partial<StudioPieceExportRuntimeDepsV3> = {}) =>
    createStudioPieceExportRuntimeV3({
      store: harness.store,
      media: harness.media,
      now: () => EXPORT_TIME,
      createExportId: () => `export_${++exportId}`,
      createNonce: () => `nonce_${++nonce}`,
      ...overrides,
    });
};

const harnessFromFixture = async (options: PilotPhotoFixtureOptionsV3): Promise<Harness> => {
  const fixture = await createPilotPhotoFixtureV3(options);
  fixtures.push(fixture);
  const media = {
    verifyManagedAssetV3: vi.fn((input: { projectId: string; assetId: string }) =>
      fixture.runtime.media.verifyManagedAssetV3(input)
    ),
  };
  const base = {
    fixture,
    root: fixture.rootDir,
    store: fixture.runtime.store,
    project: fixture.project,
    pieceId: fixture.pieceId,
    sourcePath: fixture.managedPhotoPath,
    sourceBytes: fixture.sourceBytes,
    media,
  };
  return { ...base, createRuntime: runtimeFactory(base) };
};

const importedHarness = async (options: Omit<PilotPhotoFixtureOptionsV3, 'origin'> = {}): Promise<Harness> =>
  harnessFromFixture({
    origin: 'imported',
    name: 'Imported lake',
    brief: 'One current photograph.',
    fileName: 'دریاچه شب.png',
    ...options,
  });

const generatedHarness = async (): Promise<Harness> =>
  harnessFromFixture({
    origin: 'generated',
    name: 'Generated lake',
    brief: 'One quiet photograph.',
    words: 'Moonlight reflected on calm water.',
    suggestedHandle: 'generated_lake',
    referencePieceIds: [],
    aspectRatio: '4:3',
  });

const exportRequest = (harness: Harness, expectedCatalogRevision = 1) => ({
  projectId: harness.project.id,
  pieceId: harness.pieceId,
  expectedRevision: harness.project.revision,
  expectedCatalogRevision,
});

const exportedManifest = async (harness: Harness, folderName: string) => {
  const bytes = await readFile(
    path.join(exportsDirectory(harness.root, harness.project.id), folderName, 'manifest.json')
  );
  return parseStudioPieceExportManifestV3(bytes);
};

describe('schema-6 standalone Piece export runtime', () => {
  it('describes native delivery without creating managed export storage', async () => {
    const harness = await importedHarness({ fileName: 'night_lake.png' });
    const runtime = harness.createRuntime();
    const handle = harness.project.pieces[harness.pieceId]!.handle;

    await expect(
      runtime.describe({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        expectedRevision: harness.project.revision,
      })
    ).resolves.toEqual({ suggestedName: `piece-${handle}-export` });
    await expect(readdir(exportsDirectory(harness.root, harness.project.id))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(harness.media.verifyManagedAssetV3).not.toHaveBeenCalled();
    await expect(
      runtime.describe({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        expectedRevision: harness.project.revision - 1,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(
      runtime.describe({
        projectId: harness.project.id,
        pieceId: 'piece_missing',
        expectedRevision: harness.project.revision,
      })
    ).rejects.toMatchObject({ code: 'export_unavailable' });
    await expect(
      runtime.describe({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        expectedRevision: harness.project.revision,
        outputPath: '/private/export',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('uses production clock and identity defaults without weakening the export contract', async () => {
    const harness = await importedHarness();
    const runtime = createStudioPieceExportRuntimeV3({ store: harness.store, media: harness.media });

    const result = await runtime.create(exportRequest(harness));
    expect(result).toMatchObject({ status: 'exported', catalog: { revision: 2 } });
    expect(result.catalog.artifacts).toHaveLength(1);
  });

  it('exports the exact imported current image and deterministic sidecar without an internal path', async () => {
    const harness = await importedHarness();
    const runtime = harness.createRuntime();
    const result = await runtime.create(exportRequest(harness));
    expect(result).toMatchObject({ status: 'exported', catalog: { revision: 2 } });
    const artifact = result.catalog.artifacts[0]!;
    const folder = path.join(exportsDirectory(harness.root, harness.project.id), artifact.folderName);
    expect(await readFile(path.join(folder, 'photo.png'))).toEqual(harness.sourceBytes);
    const manifest = await exportedManifest(harness, artifact.folderName);
    expect(manifest).toEqual(
      buildStudioPieceExportManifestV3(harness.project, {
        exportId: artifact.id,
        pieceId: harness.pieceId,
        relativePath: 'photo.png',
        exportedAt: artifact.createdAt,
      })
    );
    expect(manifest.provenance).toEqual({ origin: 'imported' });
    const sidecarText = await readFile(path.join(folder, 'manifest.json'), 'utf8');
    expect(sidecarText).not.toContain(harness.sourcePath);
    expect(sidecarText).not.toContain(harness.root);
    expect(result.catalog.artifacts[0]).not.toHaveProperty('managedExport');
    expect(result.catalog.artifacts[0]).not.toHaveProperty('manifestSha256');
  });

  it('copies one exact catalog artifact to a new native destination and resolves reveal inside managed storage', async () => {
    const harness = await importedHarness();
    const runtime = harness.createRuntime();
    const exported = await runtime.create(exportRequest(harness));
    const artifact = exported.catalog.artifacts[0]!;
    const destinationParent = await realpath(path.dirname(harness.root));
    const destination = path.join(destinationParent, 'delivered-piece');
    const selection = {
      projectId: harness.project.id,
      expectedCatalogRevision: exported.catalog.revision,
      artifactId: artifact.id,
    };

    await expect(runtime.copy(selection, destination)).resolves.toEqual({ status: 'copied' });
    expect(await readFile(path.join(destination, 'photo.png'))).toEqual(harness.sourceBytes);
    expect(parseStudioPieceExportManifestV3(await readFile(path.join(destination, 'manifest.json')))).toEqual(
      await exportedManifest(harness, artifact.folderName)
    );
    await expect(runtime.resolveRevealPath(selection)).resolves.toBe(
      path.join(await realpath(exportsDirectory(harness.root, harness.project.id)), artifact.folderName)
    );
  });

  it.each([
    ['copy_stage_closed', false],
    ['copy_intent_committed', false],
    ['copy_publish_ready', false],
    ['copy_artifact_published', true],
    ['copy_intent_removed', true],
  ] as const)(
    'recovers the %s native publication boundary without exposing a partial folder',
    async (crashStep, visible) => {
      const harness = await importedHarness();
      const exported = await harness.createRuntime().create(exportRequest(harness));
      const artifact = exported.catalog.artifacts[0]!;
      const destinationParent = await realpath(path.dirname(harness.root));
      const destination = path.join(destinationParent, `delivered-${crashStep}`);
      const selection = {
        projectId: harness.project.id,
        expectedCatalogRevision: exported.catalog.revision,
        artifactId: artifact.id,
      };
      const crashing = harness.createRuntime({
        onStep: async (step) => {
          if (step !== crashStep) return;
          if (visible) {
            expect((await readdir(destination)).toSorted()).toEqual(['manifest.json', 'photo.png']);
          } else {
            await expect(readdir(destination)).rejects.toMatchObject({ code: 'ENOENT' });
          }
          throw new Error(`crash:${step}`);
        },
      });

      await expect(crashing.copy(selection, destination)).rejects.toMatchObject({ code: 'storage_error' });
      await expect(harness.createRuntime().copy(selection, destination)).resolves.toEqual({ status: 'copied' });
      expect((await readdir(destination)).toSorted()).toEqual(['manifest.json', 'photo.png']);
      expect(await readFile(path.join(destination, 'photo.png'))).toEqual(harness.sourceBytes);
      expect((await readdir(destinationParent)).filter((name) => name.startsWith('.copy-'))).toEqual([]);
    }
  );

  it('does not replace a destination claimed at the final publication boundary', async () => {
    const harness = await importedHarness();
    const exported = await harness.createRuntime().create(exportRequest(harness));
    const artifact = exported.catalog.artifacts[0]!;
    const destinationParent = await realpath(path.dirname(harness.root));
    const destination = path.join(destinationParent, 'concurrently-claimed-export');
    const selection = {
      projectId: harness.project.id,
      expectedCatalogRevision: exported.catalog.revision,
      artifactId: artifact.id,
    };
    const racing = harness.createRuntime({
      onStep: async (step) => {
        if (step !== 'copy_publish_ready') return;
        await mkdir(destination);
        await writeFile(path.join(destination, 'person-owned.txt'), 'keep me', 'utf8');
      },
    });

    await expect(racing.copy(selection, destination)).rejects.toMatchObject({ code: 'storage_error' });
    expect(await readFile(path.join(destination, 'person-owned.txt'), 'utf8')).toBe('keep me');
    expect(await readdir(destination)).toEqual(['person-owned.txt']);
    await expect(harness.createRuntime().copy(selection, destination)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('rejects a copy when its durable export catalog changes during staging', async () => {
    const harness = await importedHarness();
    const exported = await harness.createRuntime().create(exportRequest(harness));
    const artifact = exported.catalog.artifacts[0]!;
    const destinationParent = await realpath(path.dirname(harness.root));
    const destination = path.join(destinationParent, 'stale-catalog-copy');
    const catalogPath = path.join(exportsDirectory(harness.root, harness.project.id), 'catalog-v3.json');
    const racing = harness.createRuntime({
      onStep: async (step) => {
        if (step !== 'copy_stage_closed') return;
        const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as { revision: number };
        catalog.revision += 1;
        await writeFile(catalogPath, JSON.stringify(catalog), 'utf8');
      },
    });

    await expect(
      racing.copy(
        {
          projectId: harness.project.id,
          expectedCatalogRevision: exported.catalog.revision,
          artifactId: artifact.id,
        },
        destination
      )
    ).rejects.toMatchObject({ code: 'stale_export_catalog' });
    await expect(readdir(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed on an invalid copy intent or an intent whose hidden stage disappeared', async () => {
    const harness = await importedHarness();
    const exported = await harness.createRuntime().create(exportRequest(harness));
    const artifact = exported.catalog.artifacts[0]!;
    const destinationParent = await realpath(path.dirname(harness.root));
    const selection = {
      projectId: harness.project.id,
      expectedCatalogRevision: exported.catalog.revision,
      artifactId: artifact.id,
    };

    for (const failure of [
      'invalid-utf8',
      'invalid-json',
      'invalid-shape',
      'noncanonical-intent',
      'wrong-intent',
      'missing-stage',
    ] as const) {
      const destination = path.join(destinationParent, failure);
      const crashing = harness.createRuntime({
        onStep: (step) => {
          if (step === 'copy_intent_committed') throw new Error(`crash:${step}`);
        },
      });
      await expect(crashing.copy(selection, destination)).rejects.toMatchObject({ code: 'storage_error' });
      const residues = await readdir(destinationParent);
      const intent = residues.find((name) => name.endsWith('.intent.json'))!;
      const stage = residues.find((name) => name.endsWith('.part'))!;
      if (failure === 'invalid-utf8') {
        await writeFile(path.join(destinationParent, intent), Buffer.from([0xff]));
      } else if (failure === 'invalid-json') {
        await writeFile(path.join(destinationParent, intent), '{', 'utf8');
      } else if (failure === 'invalid-shape') {
        await writeFile(path.join(destinationParent, intent), '{}', 'utf8');
      } else if (failure === 'noncanonical-intent') {
        const original = await readFile(path.join(destinationParent, intent));
        await writeFile(path.join(destinationParent, intent), Buffer.concat([original, Buffer.from(' ')]));
      } else if (failure === 'wrong-intent') {
        const original = JSON.parse(await readFile(path.join(destinationParent, intent), 'utf8')) as Record<
          string,
          unknown
        >;
        original.destinationName = 'different-destination';
        await writeFile(path.join(destinationParent, intent), JSON.stringify(original), 'utf8');
      } else {
        await rm(path.join(destinationParent, stage), { recursive: true });
      }
      await expect(harness.createRuntime().copy(selection, destination)).rejects.toMatchObject({
        code: 'storage_error',
      });
      await rm(path.join(destinationParent, intent), { force: true });
      await rm(path.join(destinationParent, stage), { recursive: true, force: true });
    }
  });

  it('keeps a complete atomic publication when its exact intent is replaced before cleanup', async () => {
    const harness = await importedHarness();
    const exported = await harness.createRuntime().create(exportRequest(harness));
    const artifact = exported.catalog.artifacts[0]!;
    const destinationParent = await realpath(path.dirname(harness.root));
    const destination = path.join(destinationParent, 'intent-replaced-after-publication');
    const selection = {
      projectId: harness.project.id,
      expectedCatalogRevision: exported.catalog.revision,
      artifactId: artifact.id,
    };
    const tampering = harness.createRuntime({
      onStep: async (step) => {
        if (step !== 'copy_intent_removed') return;
        const intent = (await readdir(destinationParent)).find((name) => name.endsWith('.intent.json'))!;
        await writeFile(path.join(destinationParent, intent), '{}', 'utf8');
      },
    });

    await expect(tampering.copy(selection, destination)).rejects.toMatchObject({ code: 'storage_error' });
    expect((await readdir(destination)).toSorted()).toEqual(['manifest.json', 'photo.png']);
  });

  it.each(['unexpected-entry', 'changed-photo'] as const)(
    'fails closed when a recovered hidden stage has an %s',
    async (failure) => {
      const harness = await importedHarness();
      const exported = await harness.createRuntime().create(exportRequest(harness));
      const artifact = exported.catalog.artifacts[0]!;
      const destinationParent = await realpath(path.dirname(harness.root));
      const destination = path.join(destinationParent, `invalid-stage-${failure}`);
      const selection = {
        projectId: harness.project.id,
        expectedCatalogRevision: exported.catalog.revision,
        artifactId: artifact.id,
      };
      const crashing = harness.createRuntime({
        onStep: (step) => {
          if (step === 'copy_stage_closed') throw new Error(`crash:${step}`);
        },
      });
      await expect(crashing.copy(selection, destination)).rejects.toMatchObject({ code: 'storage_error' });
      const stage = (await readdir(destinationParent)).find((name) => name.endsWith('.part'))!;
      if (failure === 'unexpected-entry') {
        await writeFile(path.join(destinationParent, stage, 'unexpected.txt'), 'not part of the export', 'utf8');
      } else {
        await writeFile(path.join(destinationParent, stage, 'photo.png'), 'not the frozen photo', 'utf8');
      }

      await expect(harness.createRuntime().copy(selection, destination)).rejects.toMatchObject({
        code: 'storage_error',
      });
    }
  );

  it('fails closed on existing, in-project, stale-catalog, and missing-artifact copy destinations', async () => {
    const harness = await importedHarness();
    const runtime = harness.createRuntime();
    const exported = await runtime.create(exportRequest(harness));
    const artifact = exported.catalog.artifacts[0]!;
    const destinationParent = await realpath(path.dirname(harness.root));
    const existing = path.join(destinationParent, 'existing-export');
    await writeFile(existing, 'owned by the person', 'utf8');
    const selection = {
      projectId: harness.project.id,
      expectedCatalogRevision: exported.catalog.revision,
      artifactId: artifact.id,
    };

    await expect(runtime.copy(selection, existing)).rejects.toMatchObject({ code: 'storage_error' });
    expect(await readFile(existing, 'utf8')).toBe('owned by the person');
    await expect(runtime.copy(selection, 'relative/export')).rejects.toMatchObject({ code: 'storage_error' });
    await expect(runtime.copy(selection, null as never)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(runtime.copy(selection, path.parse(destinationParent).root)).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(runtime.copy(selection, path.join(destinationParent, 'x'.repeat(300)))).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(
      runtime.copy(selection, `${destinationParent}${path.sep}nested${path.sep}..${path.sep}not-normalized`)
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(runtime.copy({ ...selection, outputPath: '/private/export' }, existing)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    const managedProject = await realpath(projectDirectory(harness.root, harness.project.id));
    await expect(runtime.copy(selection, managedProject)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(runtime.copy(selection, path.dirname(managedProject))).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(
      runtime.copy(selection, path.join(projectDirectory(harness.root, harness.project.id), 'not-allowed'))
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(
      runtime.copy(
        { ...selection, expectedCatalogRevision: exported.catalog.revision + 1 },
        path.join(destinationParent, 'stale-export')
      )
    ).rejects.toMatchObject({ code: 'stale_export_catalog' });
    await expect(
      runtime.copy({ ...selection, artifactId: 'export_missing' }, path.join(destinationParent, 'missing-export'))
    ).rejects.toMatchObject({ code: 'export_unavailable' });
    await expect(runtime.resolveRevealPath({ ...selection, artifactId: 'export_missing' })).rejects.toMatchObject({
      code: 'export_unavailable',
    });
    await expect(
      runtime.resolveRevealPath({ ...selection, expectedCatalogRevision: exported.catalog.revision + 1 })
    ).rejects.toMatchObject({ code: 'stale_export_catalog' });
  });

  it('exports exact frozen generated provenance and never invokes generation, quote, or spend hooks', async () => {
    const harness = await generatedHarness();
    const paidAuthorityBefore = structuredClone({
      authorizations: harness.project.spendAuthorizations,
      jobs: harness.project.jobs,
    });
    const providerSubmissionsBefore = harness.fixture.submit.mock.calls.length;
    const forbidden = { generate: vi.fn(), quote: vi.fn(), spend: vi.fn() };
    const runtime = harness.createRuntime(forbidden as Partial<StudioPieceExportRuntimeDepsV3>);
    const result = await runtime.create(exportRequest(harness));
    const projectAfter = await harness.store.loadProjectV3(harness.project.id);
    const artifact = result.catalog.artifacts[0]!;
    const manifest = await exportedManifest(harness, artifact.folderName);
    expect(manifest).toEqual(
      buildStudioPieceExportManifestV3(harness.project, {
        exportId: artifact.id,
        pieceId: harness.pieceId,
        relativePath: 'photo.png',
        exportedAt: artifact.createdAt,
      })
    );
    expect(manifest.provenance).toMatchObject({
      origin: 'generated',
      producerJobId: harness.fixture.jobId,
      authorizationId: harness.project.spendAuthorizations[0]!.id,
      receipt: { currency: 'USD', totalMinorUnits: 3 },
    });
    expect(forbidden.generate).not.toHaveBeenCalled();
    expect(forbidden.quote).not.toHaveBeenCalled();
    expect(forbidden.spend).not.toHaveBeenCalled();
    expect(harness.fixture.submit).toHaveBeenCalledTimes(providerSubmissionsBefore);
    expect({ authorizations: projectAfter.spendAuthorizations, jobs: projectAfter.jobs }).toEqual(paidAuthorityBefore);
  });

  it('refuses stale project/catalog authority and a source mutation before publication', async () => {
    const harness = await importedHarness();
    const runtime = harness.createRuntime();
    await expect(
      runtime.create({ ...exportRequest(harness), expectedRevision: harness.project.revision - 1 })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(runtime.create(exportRequest(harness, 9))).rejects.toMatchObject({ code: 'stale_export_catalog' });

    const changedBytes = await makePng(230);
    const mutating = harness.createRuntime({
      onStep: async (step) => {
        if (step === 'photo_staged') await writeFile(harness.sourcePath, changedBytes);
      },
    });
    await expect(mutating.create(exportRequest(harness))).rejects.toMatchObject({ code: 'invalid_media' });
    expect((await mutating.recover(harness.project.id)).artifacts).toEqual([]);
  });

  it.each([
    ['image/jpeg', 'jpg', 'jpeg'],
    ['image/webp', 'webp', 'webp'],
  ] as const)('exports exact %s bytes with the matching photo extension', async (mimeType, extension, format) => {
    const harness = await importedHarness({ format, fileName: `Imported lake.${extension}` });

    const result = await harness.createRuntime().create(exportRequest(harness));
    const artifact = result.catalog.artifacts[0]!;
    const photoPath = path.join(
      exportsDirectory(harness.root, harness.project.id),
      artifact.folderName,
      `photo.${extension}`
    );
    expect(await readFile(photoPath)).toEqual(harness.sourceBytes);
    expect((await exportedManifest(harness, artifact.folderName)).asset.mimeType).toBe(mimeType);
  });

  it('fails closed when the requested Piece does not exist', async () => {
    const harness = await importedHarness();
    const runtime = harness.createRuntime();
    await expect(runtime.create({ ...exportRequest(harness), pieceId: 'missing_piece' })).rejects.toMatchObject({
      code: 'export_unavailable',
    });
    await expect(runtime.recover('../unsafe-project')).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.media.verifyManagedAssetV3).not.toHaveBeenCalled();
  });

  it('rechecks project and asset authority after the media proof is collected', async () => {
    const stale = await importedHarness();
    const staleAsset = stale.project.assets[stale.project.pieces[stale.pieceId]!.currentAssetId!]!;
    const staleRuntime = stale.createRuntime({
      media: {
        verifyManagedAssetV3: vi.fn(async () => {
          await stale.store.updateProjectV3(
            stale.project.id,
            (candidate) => ({ ...candidate, brief: `${candidate.brief} Changed while proving media.` }),
            { kind: 'authoring', expectedRevision: stale.project.revision }
          );
          return { asset: structuredClone(staleAsset), absolutePath: stale.sourcePath };
        }),
      },
    });
    await expect(staleRuntime.create(exportRequest(stale))).rejects.toMatchObject({ code: 'stale_project' });

    const mismatched = await importedHarness();
    const mismatchedAsset = mismatched.project.assets[mismatched.project.pieces[mismatched.pieceId]!.currentAssetId!]!;
    const mismatchedRuntime = mismatched.createRuntime({
      media: {
        verifyManagedAssetV3: vi.fn(async () => ({
          asset: { ...mismatchedAsset, sha256: 'b'.repeat(64) },
          absolutePath: mismatched.sourcePath,
        })),
      },
    });
    await expect(mismatchedRuntime.create(exportRequest(mismatched))).rejects.toMatchObject({
      code: 'invalid_media',
    });
  });

  it('retries colliding export ids and rejects unsafe runtime authority values', async () => {
    const retrying = await importedHarness();
    const ids = [retrying.pieceId, 'export_after_collision'];
    const exported = await retrying
      .createRuntime({ createExportId: () => ids.shift()! })
      .create(exportRequest(retrying));
    expect(exported.catalog.artifacts[0]?.id).toBe('export_after_collision');

    const invalidNonce = await importedHarness();
    await expect(
      invalidNonce.createRuntime({ createNonce: () => '../unsafe' }).create(exportRequest(invalidNonce))
    ).rejects.toMatchObject({ code: 'storage_error' });

    const nonStringNonce = await importedHarness();
    await expect(
      nonStringNonce.createRuntime({ createNonce: () => 7 as never }).create(exportRequest(nonStringNonce))
    ).rejects.toMatchObject({ code: 'storage_error' });

    const invalidTime = await importedHarness();
    await expect(
      invalidTime.createRuntime({ now: () => 'not-a-timestamp' }).create(exportRequest(invalidTime))
    ).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('retains the five newest exports per Piece and no more than 480 across 96 Pieces', async () => {
    const harness = await importedHarness();
    const runtime = harness.createRuntime();
    let catalogRevision = 1;
    for (let index = 0; index < 6; index += 1) {
      // Catalog CAS makes each export depend on the prior committed revision.
      // eslint-disable-next-line no-await-in-loop
      const result = await runtime.create(exportRequest(harness, catalogRevision));
      catalogRevision = result.catalog.revision;
    }
    const listed = await runtime.list(harness.project.id);
    expect(listed.artifacts.map((artifact) => artifact.id)).toEqual([
      'export_2',
      'export_3',
      'export_4',
      'export_5',
      'export_6',
    ]);
    const activeFolders = (
      await readdir(exportsDirectory(harness.root, harness.project.id), { withFileTypes: true })
    ).filter((entry) => entry.isDirectory() && entry.name.startsWith('piece-'));
    expect(activeFolders).toHaveLength(5);

    const durableCatalog = JSON.parse(
      await readFile(path.join(exportsDirectory(harness.root, harness.project.id), 'catalog-v3.json'), 'utf8')
    ) as { artifacts: StudioPieceExportArtifactV3[] };
    const realArtifact = durableCatalog.artifacts[0]!;
    // Retention is a pure boundary calculation. Derive its large matrix from one artifact written by the
    // public export runtime rather than inventing a second durable artifact shape in this integration test.
    const synthetic: StudioPieceExportArtifactV3[] = Array.from({ length: 96 }, (_pieceEntry, piece) =>
      Array.from(
        { length: 6 },
        (_versionEntry, version): StudioPieceExportArtifactV3 => ({
          ...structuredClone(realArtifact),
          id: `export_${piece}_${version}`,
          pieceId: `piece_${piece}`,
          handleAtExport: `piece_${piece}`,
          managedExport: { collection: 'exports', fileName: `piece-export_${piece}_${version}` },
          createdAt: new Date(Date.parse(EXPORT_TIME) + version).toISOString(),
        })
      )
    ).flat();
    const retained = retainStudioPieceExportArtifactsV3(synthetic);
    expect(retained).toHaveLength(480);
    expect(new Set(retained.map((artifact) => artifact.pieceId))).toHaveLength(96);
    expect(
      Math.max(
        ...[...new Set(retained.map((artifact) => artifact.pieceId))].map(
          (pieceId) => retained.filter((artifact) => artifact.pieceId === pieceId).length
        )
      )
    ).toBe(5);
  });

  it('quarantines a malformed catalog, rebuilds valid artifacts, and leaves the project healthy', async () => {
    const harness = await importedHarness();
    const runtime = harness.createRuntime();
    const created = await runtime.create(exportRequest(harness));
    const catalogPath = path.join(exportsDirectory(harness.root, harness.project.id), 'catalog-v3.json');
    await writeFile(catalogPath, '{"schemaVersion":3,"oops":true}', 'utf8');

    const recovered = await runtime.recover(harness.project.id);
    expect(recovered.artifacts).toEqual(created.catalog.artifacts);
    expect((await harness.store.loadProjectV3(harness.project.id)).revision).toBe(harness.project.revision);
    const quarantined = await readdir(path.join(exportsDirectory(harness.root, harness.project.id), 'quarantine'));
    expect(quarantined.some((entry) => entry.startsWith('quarantine-'))).toBe(true);
    const next = await runtime.create(exportRequest(harness, recovered.revision));
    expect(next.catalog.artifacts).toHaveLength(2);
  });

  it('quarantines a corrupted managed artifact before reveal or native copy', async () => {
    const harness = await importedHarness();
    const runtime = harness.createRuntime();
    const created = await runtime.create(exportRequest(harness));
    const artifact = created.catalog.artifacts[0]!;
    const managedFolder = path.join(exportsDirectory(harness.root, harness.project.id), artifact.folderName);
    await writeFile(path.join(managedFolder, 'manifest.json'), '{"corrupt":true}', 'utf8');
    const selection = {
      projectId: harness.project.id,
      expectedCatalogRevision: created.catalog.revision,
      artifactId: artifact.id,
    };

    await expect(runtime.resolveRevealPath(selection)).rejects.toMatchObject({ code: 'stale_export_catalog' });
    const recovered = await runtime.list(harness.project.id);
    expect(recovered.artifacts).toEqual([]);
    expect((await harness.store.loadProjectV3(harness.project.id)).revision).toBe(harness.project.revision);
    const quarantined = await readdir(path.join(exportsDirectory(harness.root, harness.project.id), 'quarantine'));
    expect(quarantined.some((entry) => entry.startsWith('quarantine-'))).toBe(true);
  });

  it.each([
    ['photo_staged', 0],
    ['manifest_staged', 0],
    ['intent_committed', 1],
    ['artifact_published', 1],
    ['catalog_committed', 1],
  ] as const)('recovers the %s crash boundary deterministically', async (crashStep, expectedArtifacts) => {
    const harness = await importedHarness();
    const crashing = harness.createRuntime({
      onStep: (step: StudioPieceExportRuntimeStepV3) => {
        if (step === crashStep) throw new Error(`crash:${step}`);
      },
    });
    await expect(crashing.create(exportRequest(harness))).rejects.toMatchObject({ code: 'storage_error' });
    const restarted = harness.createRuntime();
    const recovered = await restarted.recover(harness.project.id);
    expect(recovered.artifacts).toHaveLength(expectedArtifacts);
    expect(await restarted.list(harness.project.id)).toEqual(recovered);
  });

  it('leaves export-4 publication names untouched during export-3 recovery', async () => {
    const harness = await importedHarness();
    const runtime = harness.createRuntime();
    const created = await runtime.create(exportRequest(harness));
    const exportsRoot = exportsDirectory(harness.root, harness.project.id);
    const foreignNames = ['v4-piece-export_1', '.v4-stage-export_1-foreign_nonce'];
    await Promise.all(foreignNames.map((name) => mkdir(path.join(exportsRoot, name))));
    const foreignMarker = '.v4-pending-export_1.json';
    await writeFile(path.join(exportsRoot, foreignMarker), '{}', 'utf8');

    await expect(runtime.recover(harness.project.id)).resolves.toEqual(created.catalog);
    const remaining = await readdir(exportsRoot);
    expect(remaining).toEqual(expect.arrayContaining([...foreignNames, foreignMarker]));
  });
});

const schemaSevenHarness = async (
  configure: (project: StudioProjectV4) => void = () => undefined
): Promise<{
  project: StudioProjectV4;
  projectDir: string;
  sourceBytes: Buffer;
  sourcePath: string;
  media: StudioPieceExportRuntimeDepsV4['media'];
  createRuntime(
    overrides?: Partial<StudioPieceExportRuntimeDepsV4>
  ): ReturnType<typeof createStudioPieceExportRuntimeV4>;
}> => {
  const root = await mkdtemp(path.join(tmpdir(), 'weprompt-schema-7-export-'));
  temporaryRoots.push(root);
  const projectDirPath = path.join(root, 'project');
  await mkdir(projectDirPath);
  const projectDir = await realpath(projectDirPath);
  const sourceBytes = await makePng(70);
  const sourcePath = path.join(root, 'source.png');
  await writeFile(sourcePath, sourceBytes);

  const project = makePhase6Project();
  const asset = project.assets.asset_photo_1!;
  asset.sha256 = createHash('sha256').update(sourceBytes).digest('hex');
  asset.byteSize = sourceBytes.byteLength;
  asset.width = 32;
  asset.height = 24;
  configure(project);
  expect(validateStudioProjectV4(project)).toBe(true);

  const store: StudioPieceExportProjectStoreV4 = {
    async loadProjectV4(projectId) {
      if (projectId !== project.id) throw new Error('not found');
      return structuredClone(project);
    },
    async withProjectAuthorityV4(projectId, operation) {
      if (projectId !== project.id) throw new Error('not found');
      return operation({
        project: structuredClone(project),
        projectDir,
        assertCurrent: async () => undefined,
      });
    },
  };
  const media = {
    verifyManagedAssetV4: vi.fn(async () => ({ asset: structuredClone(asset), absolutePath: sourcePath })),
  };
  let nonce = 0;
  const createRuntime = (overrides: Partial<StudioPieceExportRuntimeDepsV4> = {}) =>
    createStudioPieceExportRuntimeV4({
      store,
      media,
      now: () => PHASE_6_EXPORT_TIME,
      createExportId: () => 'export_schema_7',
      createNonce: () => `schema7_nonce_${++nonce}`,
      ...overrides,
    });
  return { project, projectDir, sourceBytes, sourcePath, media, createRuntime };
};

describe('schema-7 standalone Piece export-4 runtime', () => {
  it('rejects a binned Piece before media verification or export publication', async () => {
    const harness = await schemaSevenHarness((project) => {
      project.assemblyOrder = [];
      project.assemblies = {};
      project.bin = [
        {
          id: 'bin_piece_photo_1',
          subject: { kind: 'piece', pieceId: 'piece_photo_1' },
          reason: 'lifted',
          liftedAt: PHASE_6_CURRENT_AT,
        },
      ];
    });
    const onStep = vi.fn();
    const createExportId = vi.fn(() => 'export_must_not_be_minted');
    const runtime = harness.createRuntime({ onStep, createExportId });
    const request = {
      projectId: harness.project.id,
      pieceId: 'piece_photo_1',
      expectedRevision: harness.project.revision,
    };

    await expect(runtime.describe(request)).rejects.toMatchObject({ code: 'export_unavailable' });
    await expect(runtime.create({ ...request, expectedCatalogRevision: 1 })).rejects.toMatchObject({
      code: 'export_unavailable',
    });

    expect(harness.media.verifyManagedAssetV4).not.toHaveBeenCalled();
    expect(createExportId).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalled();
    await expect(readdir(path.join(harness.projectDir, 'exports'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses the exact schema-7 reader and rejects every occupied canvas identity before publishing', async () => {
    const harness = await schemaSevenHarness((project) => {
      project.bin = [
        {
          id: 'bin_entry_1',
          subject: { kind: 'assembly', assemblyId: 'assembly_1' },
          reason: 'lifted',
          liftedAt: PHASE_6_CURRENT_AT,
        },
      ];
    });
    const { project, projectDir, media } = harness;
    const candidates = [project.id, 'board_1', 'beat_1', 'shot_1', 'assembly_1', 'bin_entry_1', 'export_schema_7'];
    const createExportId = vi.fn(() => candidates.shift() ?? 'export_fallback');
    const runtime = harness.createRuntime({
      createExportId,
    });

    const result = await runtime.create({
      projectId: project.id,
      pieceId: 'piece_photo_1',
      expectedRevision: project.revision,
      expectedCatalogRevision: 1,
    });
    expect(result).toMatchObject({
      status: 'exported',
      catalog: { revision: 2, artifacts: [{ id: 'export_schema_7', pieceId: 'piece_photo_1' }] },
    });
    expect(createExportId).toHaveBeenCalledTimes(7);
    expect(media.verifyManagedAssetV4).toHaveBeenCalledOnce();

    const manifest = parseStudioPieceExportManifestV4(
      await readFile(path.join(projectDir, 'exports', 'v4-piece-export_schema_7', 'manifest.json'))
    );
    expect(manifest).toMatchObject({
      schemaVersion: 4,
      projectId: project.id,
      sourceRevision: project.revision,
      piece: { id: 'piece_photo_1', handleAtExport: 'harbour_morning' },
      provenance: { origin: 'imported' },
    });
    expect(project.spendAuthorizations).toEqual([]);
    expect(project.jobs).toEqual({});
    expect(JSON.parse(await readFile(path.join(projectDir, 'exports', 'catalog-v4.json'), 'utf8'))).toMatchObject({
      schemaVersion: 4,
      projectId: project.id,
      revision: 2,
    });
    await expect(readFile(path.join(projectDir, 'exports', 'catalog-v3.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('persists export-4 recovery markers and recovers them only into catalog-v4', async () => {
    const harness = await schemaSevenHarness();
    const request = {
      projectId: harness.project.id,
      pieceId: 'piece_photo_1',
      expectedRevision: harness.project.revision,
      expectedCatalogRevision: 1,
    };
    const crashing = harness.createRuntime({
      onStep: (step) => {
        if (step === 'intent_committed') throw new Error('crash:intent_committed');
      },
    });
    await expect(crashing.create(request)).rejects.toMatchObject({ code: 'storage_error' });

    const exportsRoot = path.join(harness.projectDir, 'exports');
    const markerName = (await readdir(exportsRoot)).find((name) => name.startsWith('.v4-pending-'));
    expect(markerName).toBeDefined();
    expect(JSON.parse(await readFile(path.join(exportsRoot, markerName!), 'utf8'))).toMatchObject({
      schemaVersion: 4,
      projectId: harness.project.id,
      exportId: 'export_schema_7',
    });

    const recovered = await harness.createRuntime().recover(harness.project.id);
    expect(recovered).toMatchObject({ revision: 2, artifacts: [{ id: 'export_schema_7' }] });
    expect(JSON.parse(await readFile(path.join(exportsRoot, 'catalog-v4.json'), 'utf8'))).toMatchObject({
      schemaVersion: 4,
      artifacts: [{ schemaVersion: 4, id: 'export_schema_7' }],
    });
    await expect(readFile(path.join(exportsRoot, 'catalog-v3.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persists export-4 copy intents and resumes exact native publication after interruption', async () => {
    const harness = await schemaSevenHarness();
    const runtime = harness.createRuntime();
    const created = await runtime.create({
      projectId: harness.project.id,
      pieceId: 'piece_photo_1',
      expectedRevision: harness.project.revision,
      expectedCatalogRevision: 1,
    });
    const artifact = created.catalog.artifacts[0]!;
    const selection = {
      projectId: harness.project.id,
      expectedCatalogRevision: created.catalog.revision,
      artifactId: artifact.id,
    };
    const destinationParent = path.dirname(harness.projectDir);
    const destination = path.join(destinationParent, 'schema-7-delivery');
    const crashing = harness.createRuntime({
      onStep: (step) => {
        if (step === 'copy_intent_committed') throw new Error('crash:copy_intent_committed');
      },
    });
    await expect(crashing.copy(selection, destination)).rejects.toMatchObject({ code: 'storage_error' });

    const intentName = (await readdir(destinationParent)).find((name) => name.endsWith('.intent.json'));
    expect(intentName).toBeDefined();
    expect(JSON.parse(await readFile(path.join(destinationParent, intentName!), 'utf8'))).toMatchObject({
      schemaVersion: 4,
      projectId: harness.project.id,
      artifactId: artifact.id,
      catalogRevision: created.catalog.revision,
    });

    await expect(harness.createRuntime().copy(selection, destination)).resolves.toEqual({ status: 'copied' });
    expect(parseStudioPieceExportManifestV4(await readFile(path.join(destination, 'manifest.json')))).toMatchObject({
      schemaVersion: 4,
      projectId: harness.project.id,
    });
    await expect(readFile(path.join(destinationParent, intentName!))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an export-3 catalog presented at the export-4 path and rebuilds only from export-4 artifacts', async () => {
    const harness = await schemaSevenHarness();
    const runtime = harness.createRuntime();
    await runtime.create({
      projectId: harness.project.id,
      pieceId: 'piece_photo_1',
      expectedRevision: harness.project.revision,
      expectedCatalogRevision: 1,
    });
    const exportsRoot = path.join(harness.projectDir, 'exports');
    const catalogPath = path.join(exportsRoot, 'catalog-v4.json');
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as Record<string, unknown>;
    await writeFile(catalogPath, JSON.stringify({ ...catalog, schemaVersion: 3 }), 'utf8');

    const recovered = await runtime.recover(harness.project.id);
    expect(recovered).toMatchObject({ revision: 1, artifacts: [{ id: 'export_schema_7' }] });
    expect(JSON.parse(await readFile(catalogPath, 'utf8'))).toMatchObject({
      schemaVersion: 4,
      artifacts: [{ schemaVersion: 4 }],
    });
    const quarantine = await readdir(path.join(exportsRoot, 'quarantine'));
    expect(quarantine.some((name) => name.startsWith('quarantine-'))).toBe(true);
  });

  it('keeps the export-3 recovery family isolated when both protocols use the same export id', async () => {
    const harness = await schemaSevenHarness();
    const runtime = harness.createRuntime();
    const created = await runtime.create({
      projectId: harness.project.id,
      pieceId: 'piece_photo_1',
      expectedRevision: harness.project.revision,
      expectedCatalogRevision: 1,
    });
    const exportsRoot = path.join(harness.projectDir, 'exports');
    const foreignNames = ['piece-export_schema_7', '.stage-export_schema_7-foreign_nonce'];
    await Promise.all(foreignNames.map((name) => mkdir(path.join(exportsRoot, name))));
    const foreignMarker = '.pending-export_schema_7.json';
    await writeFile(path.join(exportsRoot, foreignMarker), '{}', 'utf8');

    await expect(runtime.recover(harness.project.id)).resolves.toEqual(created.catalog);
    const remaining = await readdir(exportsRoot);
    expect(remaining).toEqual(expect.arrayContaining([...foreignNames, foreignMarker]));
    expect(remaining).toContain('v4-piece-export_schema_7');
  });

  it('quarantines malformed names owned by export-4 without rejecting arbitrary source basenames', async () => {
    const harness = await schemaSevenHarness();
    const runtime = harness.createRuntime();
    await runtime.create({
      projectId: harness.project.id,
      pieceId: 'piece_photo_1',
      expectedRevision: harness.project.revision,
      expectedCatalogRevision: 1,
    });
    const exportsRoot = path.join(harness.projectDir, 'exports');
    const malformed = '.v4-pending-bad:name.json';
    await writeFile(path.join(exportsRoot, malformed), '{}', 'utf8');

    await expect(runtime.recover(harness.project.id)).resolves.toMatchObject({
      artifacts: [{ id: 'export_schema_7' }],
    });
    expect(await readdir(exportsRoot)).not.toContain(malformed);
    expect(await readdir(path.join(exportsRoot, 'quarantine'))).toContainEqual(expect.stringMatching(/^quarantine-/));
  });

  it.each([
    ['invalid_payload', 'invalid_payload'],
    ['not_found', 'not_found'],
    ['stale_project', 'stale_project'],
    ['unsupported', 'unsupported_project'],
    ['quarantined', 'project_quarantined'],
    ['already_exists', 'storage_error'],
    ['busy', 'busy'],
    ['storage_error', 'storage_error'],
  ] as const)('normalizes schema-7 store %s as %s', async (storeCode, serviceCode) => {
    const harness = await schemaSevenHarness();
    const runtime = harness.createRuntime({
      store: {
        async loadProjectV4() {
          throw new CreativeStudioPilotStoreErrorV4(storeCode);
        },
        async withProjectAuthorityV4() {
          throw new CreativeStudioPilotStoreErrorV4(storeCode);
        },
      },
    });

    await expect(
      runtime.describe({
        projectId: harness.project.id,
        pieceId: 'piece_photo_1',
        expectedRevision: harness.project.revision,
      })
    ).rejects.toMatchObject({ code: serviceCode });
  });
});
