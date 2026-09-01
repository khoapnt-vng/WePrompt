/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Phase 4 public-runtime boundary scenarios 6–8.
 *
 * @vitest-environment node
 */

import { cp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  StudioImportPhotoResultV3,
  StudioProjectLibraryEntryV3,
} from '@/common/types/project/creativeStudioTypes';
import { afterEach, describe, expect, it } from 'vitest';
import { createPhase4Harness, type Phase4Harness } from './harness';

const harnesses: Phase4Harness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.cleanup()));
});

const createHarness = async (): Promise<Phase4Harness> => {
  const harness = await createPhase4Harness();
  harnesses.push(harness);
  return harness;
};

const requireImported = (
  result: StudioImportPhotoResultV3
): Extract<StudioImportPhotoResultV3, { status: 'imported' }> => {
  if (result.status !== 'imported') throw new Error('Phase 4 import was unexpectedly cancelled');
  return result;
};

const requireUnreadable = (
  entries: readonly StudioProjectLibraryEntryV3[],
  projectId: string
): Extract<StudioProjectLibraryEntryV3, { status: 'unsupported' | 'quarantined' }> => {
  const entry = entries.find((candidate) => candidate.status !== 'supported' && candidate.projectId === projectId);
  if (entry === undefined || entry.status === 'supported') {
    throw new Error(`Expected unreadable public library entry for ${projectId}`);
  }
  return entry;
};

describe('schema-6 Phase 4 headless boundary gate', { timeout: 120_000 }, () => {
  it('isolates one corrupt export catalog, rebuilds it, and keeps both public projects operable', async () => {
    const harness = await createHarness();
    const projectA = await harness.createProject({ name: 'Project A', brief: 'First isolated export.' });
    const projectB = await harness.createProject({ name: 'Project B', brief: 'Second isolated export.' });
    await harness.enqueueImport({ fileName: 'Project A source.png' });
    const importedA = requireImported(await harness.importPhoto(projectA.summary.id));
    await harness.enqueueImport({ fileName: 'Project B source.png' });
    const importedB = requireImported(await harness.importPhoto(projectB.summary.id));
    const exportedA = await harness.exportPiece(projectA.summary.id, importedA.pieceId);
    const exportedB = await harness.exportPiece(projectB.summary.id, importedB.pieceId);
    const projectBCatalogBefore = await readFile(harness.exportCatalogPath(projectB.summary.id));

    await harness.stop();
    const corruptProjectACatalog = Buffer.from('{"schemaVersion":3,"corrupt":true}\n', 'utf8');
    await writeFile(harness.exportCatalogPath(projectA.summary.id), corruptProjectACatalog);
    await harness.start();

    const startupCatalogA = JSON.parse(await readFile(harness.exportCatalogPath(projectA.summary.id), 'utf8')) as {
      artifacts?: Array<{ id?: unknown }>;
    };
    expect(startupCatalogA.artifacts?.map((artifact) => artifact.id)).toEqual(
      exportedA.catalog.artifacts.map((artifact) => artifact.id)
    );
    const quarantinedCatalogs = await readdir(path.join(harness.exportsPath(projectA.summary.id), 'quarantine'));
    expect(quarantinedCatalogs).toHaveLength(1);
    expect(quarantinedCatalogs[0]).toMatch(/^quarantine-/);
    expect(
      await readFile(path.join(harness.exportsPath(projectA.summary.id), 'quarantine', quarantinedCatalogs[0]!))
    ).toEqual(corruptProjectACatalog);

    const library = await harness.listProjects();
    expect(
      library.entries
        .filter((entry) => entry.status === 'supported')
        .map((entry) => entry.summary.id)
        .toSorted()
    ).toEqual([projectA.summary.id, projectB.summary.id].toSorted());
    await expect(harness.loadSupported(projectA.summary.id)).resolves.toMatchObject({ status: 'supported' });
    await expect(harness.loadSupported(projectB.summary.id)).resolves.toMatchObject({ status: 'supported' });

    const rebuiltA = await harness.entryPoint.listPieceExportsV3(projectA.summary.id);
    expect(rebuiltA.artifacts).toEqual(exportedA.catalog.artifacts);
    expect(
      await readFile(
        path.join(harness.exportArtifactPath(projectA.summary.id, rebuiltA.artifacts[0]!.folderName), 'photo.png')
      )
    ).toEqual(harness.sourceBytes);
    expect(await readFile(harness.exportCatalogPath(projectB.summary.id))).toEqual(projectBCatalogBefore);

    const projectBBeforeRename = await harness.loadSupported(projectB.summary.id);
    await harness.renamePiece(
      projectB.summary.id,
      importedB.pieceId,
      'project_b_after_recovery',
      projectBBeforeRename.canvas.authoringRevision
    );
    const projectBAfterRename = await harness.loadSupported(projectB.summary.id);
    expect(projectBAfterRename.canvas.pieces[0]?.handle).toBe('project_b_after_recovery');
    const exportedBAgain = await harness.exportPiece(projectB.summary.id, importedB.pieceId);
    expect(exportedBAgain.catalog.artifacts).toHaveLength(exportedB.catalog.artifacts.length + 1);
    expect(
      await readFile(
        path.join(
          harness.exportArtifactPath(projectB.summary.id, exportedBAgain.catalog.artifacts.at(-1)!.folderName),
          'photo.png'
        )
      )
    ).toEqual(harness.sourceBytes);
  });

  it('admits the concurrent 96th import and refuses the queued 97th create before quote or spend authority', async () => {
    const harness = await createHarness();
    const created = await harness.createProject({ name: 'Capacity race', brief: 'Ninety-six photographs.' });
    let authoringRevision = (await harness.loadSupported(created.summary.id)).canvas.authoringRevision;

    for (let index = 0; index < 95; index += 1) {
      // Every iteration enters through the native-picker-backed public import operation.
      // eslint-disable-next-line no-await-in-loop -- authoring CAS requires the prior committed revision.
      await harness.enqueueImport({ fileName: `Capacity photo ${index + 1}.png` });
      // eslint-disable-next-line no-await-in-loop -- the public result owns the next revision authority.
      const imported = requireImported(await harness.importPhoto(created.summary.id, authoringRevision));
      authoringRevision = imported.authoringRevision;
    }

    const evidenceBeforeRace = await harness.evidenceCounts(created.summary.id);
    const barrier = harness.pauseMediaStepOnce('media:stage_durable');
    await harness.enqueueImport({ fileName: 'Capacity photo 96.png' });
    const import96Promise = harness.importPhoto(created.summary.id, authoringRevision);
    await expect(barrier.reached).resolves.toEqual({
      step: 'media:stage_durable',
      projectId: created.summary.id,
    });
    const create97Refusal = harness
      .prepareCreate(created.summary.id, {
        // This request is queued behind the in-flight import and names the revision that import will commit.
        expectedAuthoringRevision: authoringRevision + 1,
        words: 'A photograph that must not reserve a ninety-seventh Piece.',
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    await Promise.resolve();
    barrier.release();

    const imported96 = requireImported(await import96Promise);
    expect(imported96.authoringRevision).toBe(authoringRevision + 1);
    await expect(create97Refusal).resolves.toMatchObject({ code: 'project_piece_capacity_reached' });

    const project = await harness.loadSupported(created.summary.id);
    const manifest = await harness.readProjectManifest(created.summary.id);
    const evidenceAfterRace = await harness.evidenceCounts(created.summary.id);
    expect(project.canvas.pieces).toHaveLength(96);
    expect(manifest.pieceOrder).toHaveLength(96);
    expect(Object.keys(manifest.assets)).toHaveLength(96);
    expect(evidenceAfterRace).toEqual(evidenceBeforeRace);
    expect(evidenceAfterRace).toMatchObject({
      resolverRouteCalls: 0,
      providerLookups: 0,
      preparedQuotes: 0,
      authorizations: 0,
      persistedQuotes: 0,
      jobs: 0,
      spendReceipts: 0,
      totalRecordedSpendMinorUnits: 0,
      providerCalls: { validateConnection: 0, submit: 0, poll: 0, cancel: 0 },
    });
  }, 120_000);

  it('classifies and deletes the exact schema-5 capture and a one-field-corrupt public schema-6 project', async () => {
    const harness = await createHarness();
    const malformed = await harness.createProject({
      name: 'Malformed revision fixture',
      brief: 'Created through the public schema-6 entry point.',
    });
    const schema5Fixture = path.resolve(
      process.cwd(),
      'tests/fixtures/creative-studio/schema5-baseline/healthy/storage/project_capture'
    );

    await harness.stop();
    await cp(schema5Fixture, harness.projectPath('project_capture'), { recursive: true, errorOnExist: true });
    expect(await readFile(harness.manifestPath('project_capture'))).toEqual(
      await readFile(path.join(schema5Fixture, 'project.json'))
    );
    const manifestBefore = await readFile(harness.manifestPath(malformed.summary.id), 'utf8');
    const manifestAfter = manifestBefore.replace(/^(\s*"revision"\s*:\s*)1(,\s*)$/mu, '$1"malformed_revision"$2');
    if (manifestAfter === manifestBefore) throw new Error('Fresh schema-6 fixture did not contain root revision 1');
    const decodedBefore = JSON.parse(manifestBefore) as Record<string, unknown>;
    const decodedAfter = JSON.parse(manifestAfter) as Record<string, unknown>;
    expect(decodedAfter).toEqual({ ...decodedBefore, revision: 'malformed_revision' });
    expect(decodedAfter.schemaVersion).toBe(6);
    await writeFile(harness.manifestPath(malformed.summary.id), manifestAfter, 'utf8');
    await harness.start();

    const listed = await harness.listProjects();
    const unsupported = requireUnreadable(listed.entries, 'project_capture');
    const quarantined = requireUnreadable(listed.entries, malformed.summary.id);
    expect(unsupported.status).toBe('unsupported');
    expect(quarantined.status).toBe('quarantined');

    const unsupportedLoad = await harness.loadResult('project_capture');
    const quarantinedLoad = await harness.loadResult(malformed.summary.id);
    if (unsupportedLoad.status !== 'unsupported' || quarantinedLoad.status !== 'quarantined') {
      throw new Error('Unreadable projects did not return public deletion claims');
    }
    await expect(
      harness.deleteProject({
        mode: 'unreadable',
        projectId: 'project_capture',
        deletionClaim: unsupportedLoad.deletionClaim,
      })
    ).resolves.toEqual({ status: 'deleted', projectId: 'project_capture' });
    await expect(
      harness.deleteProject({
        mode: 'unreadable',
        projectId: malformed.summary.id,
        deletionClaim: quarantinedLoad.deletionClaim,
      })
    ).resolves.toEqual({ status: 'deleted', projectId: malformed.summary.id });
    await expect(stat(harness.projectPath('project_capture'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(harness.projectPath(malformed.summary.id))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(harness.listProjects()).resolves.toEqual({ entries: [] });
  });
});
