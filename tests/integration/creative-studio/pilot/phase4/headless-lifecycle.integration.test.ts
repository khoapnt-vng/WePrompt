/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STUDIO_PREPARED_QUOTE_TTL_SECONDS } from '@/common/types/project/creativeStudioTypes';
import { afterEach, describe, expect, it } from 'vitest';
import { createPhase4Harness, phase4ExportPayloadFiles, type Phase4Harness } from './harness';

const harnesses: Phase4Harness[] = [];

const harness = async (): Promise<Phase4Harness> => {
  const created = await createPhase4Harness();
  harnesses.push(created);
  return created;
};

const onlyProviderJobId = (value: Phase4Harness): string => {
  const ids = [...value.remoteState.tasks.keys()];
  if (ids.length !== 1) throw new Error(`Expected one provider Job, received ${ids.length}`);
  return ids[0]!;
};

const assertNoFilmCollections = (value: Record<string, unknown>): void => {
  expect(Object.hasOwn(value, 'beats')).toBe(false);
  expect(Object.hasOwn(value, 'beatOrder')).toBe(false);
  expect(Object.hasOwn(value, 'shots')).toBe(false);
  expect(Object.hasOwn(value, 'shotOrder')).toBe(false);
  expect(Object.hasOwn(value, 'references')).toBe(false);
  expect(Object.hasOwn(value, 'referenceOrder')).toBe(false);
};

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((value) => value.cleanup()));
});

describe('schema-6 Pilot Phase 4 headless lifecycle', { timeout: 120_000 }, () => {
  it('runs generated create through cap, progress, rename, undo, reload, and a verified export', async () => {
    const value = await harness();
    value.enqueueTaskScript({
      pollSteps: [
        { kind: 'hold', status: 'queued' },
        { kind: 'hold', status: 'running', progress: 50 },
        { kind: 'succeeded', output: { kind: 'managed_file' } },
      ],
    });
    const created = await value.createProject({
      name: 'Light on Water',
      brief: 'One quiet photograph of reflected light.',
    });
    expect(created.summary).toMatchObject({
      id: 'project_00000001',
      createdAt: '2026-08-31T12:00:00.000Z',
    });
    const policy = await value.setSpendPolicy(created.summary.id, {
      currency: 'USD',
      maxPerBatchMinorUnits: 3,
    });
    const prepared = await value.prepareCreate(created.summary.id, {
      expectedAuthoringRevision: policy.authoringRevision,
      words: 'A single pool of moonlight resting on dark water.',
      suggestedHandle: 'moonlit_water',
    });

    expect(prepared.quote).toMatchObject({
      mode: 'create',
      proposedHandle: 'moonlit_water',
      currency: 'USD',
      lowerMinorUnits: 3,
      upperMinorUnits: 3,
      spendPolicyClassification: 'within_cap',
      requiresExplicitHumanAction: false,
    });
    expect(value.fake.getProviderCallCounts().submit).toBe(0);

    const confirmed = await value.confirm(prepared, { explicitHumanConfirmation: false });
    expect(confirmed).toMatchObject({
      pieceId: 'piece_00000001',
      jobId: 'job_00000001',
    });
    await value.waitForJob(created.summary.id, confirmed.jobId, 'queued_remote');
    const providerJobId = onlyProviderJobId(value);
    expect(value.releaseTaskHold(providerJobId)).toBe(true);
    await value.waitForJob(
      created.summary.id,
      confirmed.jobId,
      (job) => job.status === 'running' && job.progress === 50
    );
    expect(value.releaseTaskHold(providerJobId)).toBe(true);
    await value.waitForJob(created.summary.id, confirmed.jobId, 'succeeded');

    const generated = await value.loadSupported(created.summary.id);
    expect(generated.canvas.pieces).toEqual([
      expect.objectContaining({
        id: confirmed.pieceId,
        handle: 'moonlit_water',
        priorHandles: [],
        state: 'current',
        currentAsset: expect.objectContaining({
          mediaKind: 'image',
          mimeType: 'image/png',
          provenance: expect.objectContaining({
            origin: 'generated',
            producerJobId: confirmed.jobId,
            recordedSpend: { currency: 'USD', totalMinorUnits: 3 },
          }),
        }),
      }),
    ]);
    expect(generated.activity.jobs).toEqual([
      expect.objectContaining({
        jobId: confirmed.jobId,
        status: 'succeeded',
        recordedSpend: { currency: 'USD', totalMinorUnits: 3 },
      }),
    ]);

    const renamed = await value.renamePiece(created.summary.id, confirmed.pieceId, 'silver_water');
    expect(renamed.undoEntryId).toMatch(/^mutation_/u);
    if (renamed.undoEntryId === null) throw new Error('Rename did not return public undo authority');
    await expect(value.loadSupported(created.summary.id)).resolves.toMatchObject({
      canvas: { pieces: [{ handle: 'silver_water', priorHandles: ['moonlit_water'] }] },
    });

    await value.undo(created.summary.id, renamed.undoEntryId, renamed.authoringRevision);
    await expect(value.loadSupported(created.summary.id)).resolves.toMatchObject({
      canvas: { pieces: [{ handle: 'moonlit_water', priorHandles: [] }] },
    });
    const renamedAgain = await value.renamePiece(created.summary.id, confirmed.pieceId, 'final_reflection');

    await value.restart();
    const reloaded = await value.loadSupported(created.summary.id);
    expect(reloaded.canvas).toMatchObject({
      authoringRevision: renamedAgain.authoringRevision,
      pieces: [{ id: confirmed.pieceId, handle: 'final_reflection', state: 'current' }],
    });
    const exported = await value.exportPiece(created.summary.id, confirmed.pieceId);
    const artifact = exported.catalog.artifacts.at(-1);
    if (artifact === undefined) throw new Error('Phase 4 export did not publish an artifact');
    const artifactDirectory = value.exportArtifactPath(created.summary.id, artifact.folderName);
    const payloadFiles = await phase4ExportPayloadFiles(artifactDirectory);
    expect(payloadFiles).toHaveLength(1);
    expect(await readFile(payloadFiles[0]!)).toEqual(value.sourceBytes);
    const exportManifest = JSON.parse(await readFile(path.join(artifactDirectory, 'manifest.json'), 'utf8')) as {
      schemaVersion: number;
      projectId: string;
      sourceRevision: number;
      provenance: { origin: string; producerJobId?: string; receipt?: { totalMinorUnits: number } };
    };
    expect(exportManifest).toMatchObject({
      schemaVersion: 3,
      projectId: created.summary.id,
      sourceRevision: reloaded.canvas.revision,
      provenance: {
        origin: 'generated',
        producerJobId: confirmed.jobId,
        receipt: { totalMinorUnits: 3 },
      },
    });
    const persisted = (await value.readProjectManifest(created.summary.id)) as unknown as Record<string, unknown>;
    assertNoFilmCollections(persisted);
    expect(value.fake.getProviderCallCounts().submit).toBe(1);
    expect(value.fake.getProviderRequestLog().requests).toEqual([
      expect.objectContaining({
        ordinal: 1,
        mediaKind: 'image',
        model: 'weprompt-e2e-image',
        conditioningAssetIds: [],
        firstFrameAssetId: null,
      }),
    ]);
  });

  it.each([
    { name: 'no policy', policy: null, classification: 'no_policy' },
    {
      name: 'over cap',
      policy: { currency: 'USD', maxPerBatchMinorUnits: 2 },
      classification: 'over_cap',
    },
    {
      name: 'currency mismatch',
      policy: { currency: 'EUR', maxPerBatchMinorUnits: 100 },
      classification: 'currency_mismatch',
    },
  ] as const)(
    'requires an explicit bounded confirmation for $name before provider work',
    async ({ policy, classification }) => {
      const value = await harness();
      const created = await value.createProject(`Explicit ${classification}`);
      if (policy !== null) await value.setSpendPolicy(created.summary.id, policy);
      const before = value.fake.getProviderCallCounts();
      const prepared = await value.prepareCreate(created.summary.id, { words: `A ${classification} photograph.` });

      expect(prepared.quote).toMatchObject({
        spendPolicyClassification: classification,
        requiresExplicitHumanAction: true,
        currency: 'USD',
        lowerMinorUnits: 3,
        upperMinorUnits: 3,
      });
      expect(value.fake.getProviderCallCounts().submit).toBe(before.submit);
      await expect(value.confirm(prepared, { explicitHumanConfirmation: false })).rejects.toMatchObject({
        code: 'confirmation_required',
      });
      expect(value.fake.getProviderCallCounts().submit).toBe(before.submit);

      const confirmed = await value.confirm(prepared, { explicitHumanConfirmation: true });
      await value.waitForJob(created.summary.id, confirmed.jobId, 'succeeded');
      expect(value.fake.getProviderCallCounts().submit).toBe(before.submit + 1);
    }
  );

  it('imports, renames, reloads, and exports without quote, authorization, Job, provider work, or spend', async () => {
    const value = await harness();
    const created = await value.createProject({ name: 'Imported Pilot', brief: 'Use one existing photograph.' });
    await value.enqueueImport({ fileName: 'عکس‌های آب.png' });
    const imported = await value.importPhoto(created.summary.id);
    if (imported.status !== 'imported') throw new Error('The queued native import was cancelled');
    const renamed = await value.renamePiece(created.summary.id, imported.pieceId, 'آب_آرام');

    await value.restart();
    const reloaded = await value.loadSupported(created.summary.id);
    expect(reloaded).toMatchObject({
      summary: { pieceCount: 1, currentPieceCount: 1 },
      canvas: {
        authoringRevision: renamed.authoringRevision,
        pieces: [
          {
            id: imported.pieceId,
            handle: 'آب_آرام',
            state: 'current',
            currentAsset: { id: imported.assetId, provenance: { origin: 'imported' } },
          },
        ],
      },
      activity: { preparedPhotoQuotes: [], jobs: [] },
    });
    const evidenceBeforeExport = await value.evidenceCounts(created.summary.id);
    expect(evidenceBeforeExport).toMatchObject({
      providerCalls: { validateConnection: 0, submit: 0, poll: 0, cancel: 0 },
      preparedQuotes: 0,
      authorizations: 0,
      persistedQuotes: 0,
      jobs: 0,
      spendReceipts: 0,
      totalRecordedSpendMinorUnits: 0,
    });

    const exported = await value.exportPiece(created.summary.id, imported.pieceId);
    const artifact = exported.catalog.artifacts.at(-1);
    if (artifact === undefined) throw new Error('Imported Piece export did not publish an artifact');
    const payloads = await phase4ExportPayloadFiles(value.exportArtifactPath(created.summary.id, artifact.folderName));
    expect(payloads).toHaveLength(1);
    expect(await readFile(payloads[0]!)).toEqual(value.sourceBytes);
    const persisted = (await value.readProjectManifest(created.summary.id)) as unknown as Record<string, unknown>;
    assertNoFilmCollections(persisted);
    expect(persisted).toMatchObject({ spendAuthorizations: [], jobs: {} });
    expect(await readFile(value.manifestPath(created.summary.id), 'utf8')).not.toContain(value.sourcePath);
    expect(value.fake.getProviderCallCounts()).toEqual({ validateConnection: 0, submit: 0, poll: 0, cancel: 0 });
  });

  it('rejects stale, expired, and duplicate confirmations while admitting runtime-only revision movement', async () => {
    const value = await harness();

    const staleProject = await value.createProject('Stale confirmation');
    const stale = await value.prepareCreate(staleProject.summary.id, { words: 'Stale words.' });
    const staleBeforeEdit = await value.loadSupported(staleProject.summary.id);
    await value.entryPoint.applyMutationBatchV3({
      schemaVersion: 6,
      projectId: staleProject.summary.id,
      expectedAuthoringRevision: staleBeforeEdit.canvas.authoringRevision,
      operations: [{ kind: 'set_brief', brief: 'Authoring moved after the quote.' }],
    });
    expect((await value.loadSupported(staleProject.summary.id)).activity.preparedPhotoQuotes).toEqual([]);
    await expect(value.confirm(stale, { explicitHumanConfirmation: true })).rejects.toMatchObject({
      code: 'quote_not_found',
    });

    const expiredProject = await value.createProject('Expired confirmation');
    const expired = await value.prepareCreate(expiredProject.summary.id, { words: 'Expired words.' });
    value.clock.advance(STUDIO_PREPARED_QUOTE_TTL_SECONDS * 1_000 + 1);
    await expect(value.confirm(expired, { explicitHumanConfirmation: true })).rejects.toMatchObject({
      code: 'quote_not_found',
    });

    const duplicateProject = await value.createProject('Duplicate confirmation');
    value.enqueueTaskScript({
      pollSteps: [
        { kind: 'hold', status: 'queued' },
        { kind: 'succeeded', output: { kind: 'managed_file' } },
      ],
    });
    const duplicate = await value.prepareCreate(duplicateProject.summary.id, { words: 'One confirmation only.' });
    const accepted = await value.confirm(duplicate, { explicitHumanConfirmation: true });
    await value.waitForJob(duplicateProject.summary.id, accepted.jobId, 'queued_remote');
    await expect(value.confirm(duplicate, { explicitHumanConfirmation: true })).rejects.toMatchObject({
      code: 'quote_not_found',
    });
    expect(value.fake.getProviderCallCounts().submit).toBe(1);
    expect(value.releaseTaskHold(onlyProviderJobId(value))).toBe(true);
    await value.waitForJob(duplicateProject.summary.id, accepted.jobId, 'succeeded');

    const runtimeProject = await value.createProject('Runtime-only revision');
    await value.setSpendPolicy(runtimeProject.summary.id, { currency: 'USD', maxPerBatchMinorUnits: 3 });
    value.enqueueTaskScript({
      pollSteps: [
        { kind: 'hold', status: 'queued' },
        { kind: 'succeeded', output: { kind: 'managed_file' } },
      ],
    });
    const firstPrepared = await value.prepareCreate(runtimeProject.summary.id, { words: 'First held photo.' });
    const first = await value.confirm(firstPrepared, { explicitHumanConfirmation: false });
    await value.waitForJob(runtimeProject.summary.id, first.jobId, 'queued_remote');
    const secondPrepared = await value.prepareCreate(runtimeProject.summary.id, { words: 'Second quoted photo.' });
    const beforeRuntimeMovement = await value.loadSupported(runtimeProject.summary.id);
    const runtimeProviderJobId = [...value.remoteState.tasks.keys()].at(-1);
    if (runtimeProviderJobId === undefined) throw new Error('Runtime-only test did not create a provider Job');
    expect(value.releaseTaskHold(runtimeProviderJobId)).toBe(true);
    await value.waitForJob(runtimeProject.summary.id, first.jobId, 'succeeded');
    const afterRuntimeMovement = await value.loadSupported(runtimeProject.summary.id);
    expect(afterRuntimeMovement.canvas.authoringRevision).toBe(beforeRuntimeMovement.canvas.authoringRevision);
    expect(afterRuntimeMovement.canvas.revision).toBeGreaterThan(beforeRuntimeMovement.canvas.revision);

    const second = await value.confirm(secondPrepared, { explicitHumanConfirmation: false });
    await value.waitForJob(runtimeProject.summary.id, second.jobId, 'succeeded');
    expect((await value.loadSupported(runtimeProject.summary.id)).canvas.pieces).toHaveLength(2);
    expect(value.fake.getProviderCallCounts().submit).toBe(3);
  });
});
