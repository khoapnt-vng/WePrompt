/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { StudioPieceJobV3 } from '@/common/types/project/creativeStudioTypes';
import type { StudioGenerationRouteCatalog } from '@/process/services/creative-studio/providerResolver';
import {
  CreativeStudioPilotContractErrorV3,
  CreativeStudioPilotServiceErrorV3,
  createCreativeStudioPilotEntryPointV3,
  normalizeCreativeStudioPilotErrorV3,
  StudioPieceRouteResolutionErrorV3,
  type StudioPilotIdentityKindV3,
} from '@/process/services/creative-studio/service/pilot';
import { StudioDeletionClaimErrorV3 } from '@/process/services/creative-studio/service/schema2/mutations/deletionClaimsV3';
import { StudioPreparedPhotoCacheErrorV3 } from '@/process/services/creative-studio/service/schema2/pricing/preparedSubmissionCache';
import {
  createCreativeStudioPilotStoreV3,
  CreativeStudioPilotStoreErrorV3,
} from '@/process/services/creative-studio/store/pilotStore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPilotPhotoFixtureV3, type PilotPhotoFixtureV3 } from './presentation/realFixture';

const roots: string[] = [];
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const schema5ProjectCapture = path.join(
  process.cwd(),
  'tests/fixtures/creative-studio/schema5-baseline/healthy/storage/project_capture'
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const installSchema5ProjectCapture = (root: string, projectId = 'project_capture'): Promise<void> =>
  cp(schema5ProjectCapture, path.join(root, projectId), { recursive: true });

type HarnessOptions = {
  now?: () => number;
  mintIdentity?: (kind: StudioPilotIdentityKindV3 | 'mutation') => string;
  useDefaultNow?: boolean;
};

const createHarness = async (options: HarnessOptions = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-entry-'));
  roots.push(root);
  const timestamp = '2026-08-31T10:00:00.000Z';
  const epoch = Date.parse(timestamp);
  let temporarySequence = 0;
  let identitySequence = 0;
  let projectSequence = 0;
  const store = createCreativeStudioPilotStoreV3({
    rootDir: root,
    now: () => timestamp,
    createProjectId: () => `project_${++projectSequence}`,
    createTemporaryId: () => `temporary_${String(++temporarySequence).padStart(8, '0')}`,
    deletionClaimOptions: {
      now: () => epoch,
      createToken: (() => {
        let sequence = 0;
        return () => `studio-delete-v3_${String(++sequence).padStart(32, 'a')}`;
      })(),
    },
  });
  const route: StudioGenerationRouteCatalog['routes'][number] = {
    choiceId: 'route_image',
    providerId: 'provider_image',
    providerName: 'Image provider',
    adapterId: 'weprompt-image-v1',
    model: 'image-model',
    health: 'available',
    kind: 'image',
    constraints: {
      aspectRatios: ['16:9'],
      resolutions: ['1080p'],
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      supportsFirstFrame: false,
      maxConditioningImages: 0,
      silentOutput: true,
    },
    cancellationPolicy: 'queued_only',
  };
  const order: string[] = [];
  const jobs = {
    dispatchCommittedJobV3: vi.fn(async () => undefined),
    activeJobIdsV3: vi.fn((): ReadonlySet<string> => new Set()),
    cancelJobV3: vi.fn(async () => ({
      status: 'cancelled' as const,
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_cancel',
      revision: 7,
    })),
    resumeJobV3: vi.fn(async () => ({
      status: 'recovering' as const,
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_resume',
      revision: 8,
    })),
    retryDownloadV3: vi.fn(async () => ({
      status: 'recovering' as const,
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_download',
      revision: 9,
    })),
    resumePendingJobsV3: vi.fn(async () => {
      order.push('jobs');
    }),
    waitForIdleV3: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const media = {
    importPhotoV3: vi.fn(async () => ({ status: 'cancelled' as const })),
    recoverAllMediaV3: vi.fn(async () => {
      order.push('media');
    }),
  };
  const exports = {
    exportPieceV3: vi.fn(async () => ({
      status: 'exported' as const,
      catalog: { revision: 1, artifacts: [] },
    })),
    listPieceExportsV3: vi.fn(async () => ({ revision: 0, artifacts: [] })),
    recoverAllExportsV3: vi.fn(async () => {
      order.push('exports');
    }),
  };
  const entry = createCreativeStudioPilotEntryPointV3({
    store,
    providerResolver: {
      listGenerationRoutes: async () => ({ routes: [route], diagnostics: [], generationCatalogVersion: 'catalog_1' }),
    },
    jobs,
    media,
    exports,
    now: options.useDefaultNow ? undefined : (options.now ?? (() => epoch)),
    mintIdentity:
      options.mintIdentity ?? ((kind: StudioPilotIdentityKindV3 | 'mutation') => `${kind}_${++identitySequence}`),
  });
  return { root, store, entry, jobs, media, exports, order, timestamp };
};

const captureServiceError = (error: unknown): CreativeStudioPilotServiceErrorV3 => {
  try {
    normalizeCreativeStudioPilotErrorV3(error);
  } catch (normalized) {
    if (normalized instanceof CreativeStudioPilotServiceErrorV3) return normalized;
    throw normalized;
  }
  throw new Error('normalizer unexpectedly returned');
};

const setFixtureJobStatus = async (
  fixture: PilotPhotoFixtureV3,
  status: Exclude<StudioPieceJobV3['status'], 'succeeded' | 'failed'>
) => {
  const current = await fixture.runtime.store.loadProjectV3(fixture.project.id);
  if (fixture.jobId === null) throw new Error('generated fixture has no Job');
  const remote = status === 'queued_remote' || status === 'running';
  return fixture.runtime.store.updateProjectV3(
    current.id,
    (project) => {
      const job = project.jobs[fixture.jobId!];
      if (job === undefined) throw new Error('generated fixture Job is missing');
      Object.assign(job, {
        status,
        providerSubmissionKind: remote ? ('remote' as const) : null,
        providerJobId: remote ? `provider_job_${status}` : null,
        remoteStartedAt: remote ? job.createdAt : null,
        outputAssetId: null,
        error:
          status === 'needs_attention'
            ? { code: 'submission_unknown' as const, messageKey: 'creativeStudio.jobs.submissionUnknown' }
            : null,
        progress: status === 'running' ? 35 : null,
        spendReceipt: null,
      });
      return project;
    },
    { kind: 'runtime', expectedRevision: current.revision }
  );
};

describe('schema-6 Pilot service error boundary', () => {
  it('preserves an already normalized failure without replacing its identity', () => {
    const source = new CreativeStudioPilotServiceErrorV3('busy');

    expect(captureServiceError(source)).toBe(source);
  });

  it.each([
    [new CreativeStudioPilotContractErrorV3(), 'invalid_payload'],
    [new StudioPieceRouteResolutionErrorV3('route_incompatible'), 'route_incompatible'],
    [new StudioPieceRouteResolutionErrorV3('route_catalog_unavailable'), 'route_catalog_unavailable'],
    [new StudioPreparedPhotoCacheErrorV3('quote_in_use'), 'quote_in_use'],
    [new StudioPreparedPhotoCacheErrorV3('quote_not_found'), 'quote_not_found'],
    [new StudioPreparedPhotoCacheErrorV3('quote_cache_full'), 'busy'],
    [new StudioPreparedPhotoCacheErrorV3('quote_too_large'), 'invalid_payload'],
    [new StudioDeletionClaimErrorV3('claim_not_found'), 'deletion_claim_not_found'],
    [new StudioDeletionClaimErrorV3('claim_expired'), 'deletion_claim_expired'],
    [new StudioDeletionClaimErrorV3('claim_mismatch'), 'deletion_claim_mismatch'],
    [new StudioDeletionClaimErrorV3('claim_capacity'), 'deletion_claim_capacity'],
    [new Error('private dependency detail'), 'storage_error'],
  ] as const)('maps a process-internal failure to renderer-safe code %s', (source, expectedCode) => {
    expect(captureServiceError(source).code).toBe(expectedCode);
  });

  it.each([
    ['invalid_payload', 'invalid_payload'],
    ['not_found', 'not_found'],
    ['stale_project', 'stale_project'],
    ['unsupported', 'unsupported_project'],
    ['quarantined', 'project_quarantined'],
    ['already_exists', 'storage_error'],
    ['storage_error', 'storage_error'],
  ] as const)('maps store code %s to renderer-safe code %s', (sourceCode, expectedCode) => {
    expect(captureServiceError(new CreativeStudioPilotStoreErrorV3(sourceCode)).code).toBe(expectedCode);
  });
});

describe('isolated schema-6 typed entry point', () => {
  it('uses the process clock when no test clock is supplied', async () => {
    const harness = await createHarness({ useDefaultNow: true });

    const created = await harness.entry.createProjectV3({ name: 'Clock default', brief: '' });

    expect(Date.parse(created.summary.updatedAt)).toBeGreaterThan(0);
  });

  it('creates, lists, loads, prepares, and reports transient quote updates without a production bridge', async () => {
    const harness = await createHarness();
    const updates: unknown[] = [];
    harness.entry.watchProjectUpdatesV3((update) => updates.push(update));

    const created = await harness.entry.createProjectV3({ name: 'Canvas pilot', brief: 'A quiet blue room.' });
    const listed = await harness.entry.listProjectsV3();
    const loaded = await harness.entry.loadProjectV3(created.summary.id);
    const exports = await harness.entry.listPieceExportsV3(created.summary.id);
    const prepared = await harness.entry.preparePhotoV3({
      mode: 'create',
      projectId: created.summary.id,
      expectedAuthoringRevision: 1,
      words: 'Blue room at dawn',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
    });
    const reloaded = await harness.entry.loadProjectV3(created.summary.id);

    expect(created).toMatchObject({ status: 'created', summary: { pieceCount: 0, currentPieceCount: 0 } });
    expect(listed.entries).toEqual([{ status: 'supported', summary: created.summary }]);
    expect(loaded).toMatchObject({
      status: 'supported',
      canvas: { pieces: [] },
      activity: { jobs: [] },
      spendPolicy: null,
      lastUndo: null,
    });
    expect(exports).toEqual({ revision: 0, artifacts: [] });
    expect(harness.exports.listPieceExportsV3).toHaveBeenCalledWith(created.summary.id);
    expect(prepared.status).toBe('prepared');
    expect(reloaded).toMatchObject({
      status: 'supported',
      activity: { preparedPhotoQuotes: [expect.objectContaining({ reservationId: prepared.quote.reservationId })] },
    });
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'durable' }),
        { source: 'prepared', projectId: created.summary.id },
      ])
    );
  });

  it('discards a provisional quote without durable records and emits the bounded activity update', async () => {
    const harness = await createHarness();
    const updates: unknown[] = [];
    harness.entry.watchProjectUpdatesV3((update) => updates.push(update));
    const created = await harness.entry.createProjectV3({ name: 'Declined photo', brief: 'No durable photo yet.' });
    const before = await harness.store.loadProjectV3(created.summary.id);
    const prepared = await harness.entry.preparePhotoV3({
      mode: 'create',
      projectId: created.summary.id,
      expectedAuthoringRevision: before.authoringRevision,
      words: 'A quote the person declines.',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: 'declined_photo',
    });

    await expect(
      harness.entry.discardPreparedPhotoV3({
        reservationId: prepared.quote.reservationId,
        quoteId: prepared.quote.quoteId,
        quoteRevision: prepared.quote.quoteRevision,
      })
    ).resolves.toEqual({ status: 'discarded', projectId: created.summary.id });

    const after = await harness.store.loadProjectV3(created.summary.id);
    const loaded = await harness.entry.loadProjectV3(created.summary.id);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ pieces: {}, jobs: {}, spendAuthorizations: [] });
    expect(loaded).toMatchObject({
      status: 'supported',
      canvas: { pieces: [] },
      activity: { jobs: [], preparedPhotoQuotes: [] },
    });
    expect(harness.jobs.dispatchCommittedJobV3).not.toHaveBeenCalled();
    expect(updates.filter((update) => (update as { source?: string }).source === 'prepared')).toEqual([
      { source: 'prepared', projectId: created.summary.id },
      { source: 'prepared', projectId: created.summary.id },
    ]);

    await expect(
      harness.entry.discardPreparedPhotoV3({
        reservationId: prepared.quote.reservationId,
        quoteId: prepared.quote.quoteId,
        quoteRevision: prepared.quote.quoteRevision,
      })
    ).rejects.toMatchObject({ code: 'quote_not_found' });
  });

  it('invalidates prepared activity only after successful authoring and import changes', async () => {
    const harness = await createHarness();
    const created = await harness.entry.createProjectV3({ name: 'Quote invalidation', brief: 'Original brief.' });
    const prepare = async (words: string) => {
      const project = await harness.store.loadProjectV3(created.summary.id);
      return harness.entry.preparePhotoV3({
        mode: 'create',
        projectId: project.id,
        expectedAuthoringRevision: project.authoringRevision,
        words,
        settings: { aspectRatio: '16:9', resolution: '1080p' },
        suggestedHandle: null,
      });
    };
    const preparedBeforeMutation = await prepare('Quote before authoring.');

    await expect(
      harness.entry.applyMutationBatchV3({
        schemaVersion: 6,
        projectId: created.summary.id,
        expectedAuthoringRevision: 1,
        operations: [{ kind: 'set_brief', brief: 'Original brief.' }],
      })
    ).rejects.toMatchObject({ code: 'no_change' });
    await expect(harness.entry.loadProjectV3(created.summary.id)).resolves.toMatchObject({
      status: 'supported',
      activity: {
        preparedPhotoQuotes: [expect.objectContaining({ reservationId: preparedBeforeMutation.quote.reservationId })],
      },
    });

    await expect(
      harness.entry.applyMutationBatchV3({
        schemaVersion: 6,
        projectId: created.summary.id,
        expectedAuthoringRevision: 1,
        operations: [{ kind: 'set_brief', brief: 'Changed brief.' }],
      })
    ).resolves.toMatchObject({ authoringRevision: 2 });
    await expect(harness.entry.loadProjectV3(created.summary.id)).resolves.toMatchObject({
      status: 'supported',
      activity: { preparedPhotoQuotes: [] },
    });

    const preparedBeforeImport = await prepare('Quote before import.');
    await expect(harness.entry.importPhotoV3({ projectId: created.summary.id })).resolves.toEqual({
      status: 'cancelled',
    });
    await expect(harness.entry.loadProjectV3(created.summary.id)).resolves.toMatchObject({
      status: 'supported',
      activity: {
        preparedPhotoQuotes: [expect.objectContaining({ reservationId: preparedBeforeImport.quote.reservationId })],
      },
    });

    harness.media.importPhotoV3.mockResolvedValueOnce({
      status: 'imported',
      projectId: created.summary.id,
      pieceId: 'piece_imported',
      assetId: 'asset_imported',
      revision: 3,
      authoringRevision: 3,
    } as never);
    await expect(harness.entry.importPhotoV3({ projectId: created.summary.id })).resolves.toMatchObject({
      status: 'imported',
      projectId: created.summary.id,
    });
    await expect(harness.entry.loadProjectV3(created.summary.id)).resolves.toMatchObject({
      status: 'supported',
      activity: { preparedPhotoQuotes: [] },
    });
  });

  it('retains a quote prepared from the new authoring revision while import completion invalidates the old one', async () => {
    const harness = await createHarness();
    const created = await harness.entry.createProjectV3({ name: 'Import race', brief: 'Before import.' });
    const before = await harness.store.loadProjectV3(created.summary.id);
    const stale = await harness.entry.preparePhotoV3({
      mode: 'create',
      projectId: before.id,
      expectedAuthoringRevision: before.authoringRevision,
      words: 'Prepared before the import commit.',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
    });
    const importCommitted = deferred<Awaited<ReturnType<typeof harness.store.loadProjectV3>>>();
    const releaseImportResult = deferred<void>();
    harness.media.importPhotoV3.mockImplementationOnce(async () => {
      const current = await harness.store.loadProjectV3(before.id);
      const committed = await harness.store.updateProjectV3(
        current.id,
        (draft) => ({ ...draft, brief: 'Import committed authored meaning.' }),
        { kind: 'authoring', expectedRevision: current.revision }
      );
      importCommitted.resolve(committed);
      await releaseImportResult.promise;
      return {
        status: 'imported',
        projectId: committed.id,
        pieceId: 'piece_imported',
        assetId: 'asset_imported',
        revision: committed.revision,
        authoringRevision: committed.authoringRevision,
      } as never;
    });

    const importing = harness.entry.importPhotoV3({
      projectId: before.id,
      expectedAuthoringRevision: before.authoringRevision,
    });
    const committed = await importCommitted.promise;
    const current = await harness.entry.preparePhotoV3({
      mode: 'create',
      projectId: committed.id,
      expectedAuthoringRevision: committed.authoringRevision,
      words: 'Prepared after the import commit.',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
    });
    releaseImportResult.resolve();
    await expect(importing).resolves.toMatchObject({ status: 'imported' });

    await expect(harness.entry.loadProjectV3(committed.id)).resolves.toMatchObject({
      status: 'supported',
      activity: {
        preparedPhotoQuotes: [expect.objectContaining({ reservationId: current.quote.reservationId })],
      },
    });
    await expect(
      harness.entry.confirmPreparedPhotoV3({
        reservationId: stale.quote.reservationId,
        quoteId: stale.quote.quoteId,
        quoteRevision: stale.quote.quoteRevision,
        explicitHumanConfirmation: true,
        duplicateChargeAcknowledged: false,
      })
    ).rejects.toMatchObject({ code: 'quote_not_found' });
  });

  it('isolates a failed healthy reload so one raced project cannot poison the catalogue', async () => {
    const harness = await createHarness();
    await harness.entry.createProjectV3({ name: 'Raced project', brief: '' });
    const reload = vi.spyOn(harness.store, 'loadProjectV3').mockRejectedValueOnce(new Error('removed after scan'));

    await expect(harness.entry.listProjectsV3()).resolves.toEqual({ entries: [] });
    reload.mockRestore();
  });

  it('rejects malformed project identities without consulting storage', async () => {
    const harness = await createHarness();
    const lookup = vi.spyOn(harness.store, 'getProjectV3');

    await expect(harness.entry.loadProjectV3('../private')).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('applies rename and undo through the shared schema-6 authoring reducer', async () => {
    const fixture = await createPilotPhotoFixtureV3({ origin: 'imported', fileName: 'First photo.png' });
    try {
      const renamed = await fixture.runtime.entryPoint.applyMutationBatchV3({
        schemaVersion: 6,
        projectId: fixture.project.id,
        expectedAuthoringRevision: fixture.project.authoringRevision,
        operations: [{ kind: 'rename_piece', pieceId: fixture.pieceId, handle: 'new_name' }],
      });
      let loaded = await fixture.runtime.entryPoint.loadProjectV3(fixture.project.id);
      if (loaded.status !== 'supported') throw new Error('renamed fixture became unreadable');
      expect(loaded.canvas.pieces[0]).toMatchObject({ handle: 'new_name', priorHandles: ['first_photo'] });
      expect(renamed.undoEntryId).toMatch(/^mutation_/u);
      if (renamed.undoEntryId === null) throw new Error('rename did not return its committed undo authority');
      expect(loaded.lastUndo).toEqual({ entryId: renamed.undoEntryId, label: 'rename_piece' });

      const undone = await fixture.runtime.entryPoint.applyMutationBatchV3({
        schemaVersion: 6,
        projectId: fixture.project.id,
        expectedAuthoringRevision: renamed.authoringRevision,
        operations: [{ kind: 'undo_last', entryId: renamed.undoEntryId }],
      });
      loaded = await fixture.runtime.entryPoint.loadProjectV3(fixture.project.id);
      if (loaded.status !== 'supported') throw new Error('undone fixture became unreadable');
      expect(loaded.canvas.pieces[0]).toMatchObject({ handle: 'first_photo', priorHandles: [] });
      expect(loaded.lastUndo).toBeNull();
      expect(undone.undoEntryId).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });

  it('returns no undo authority for an authoring batch that does not rename a Piece', async () => {
    const harness = await createHarness();
    const created = await harness.entry.createProjectV3({ name: 'No undo', brief: '' });

    const policy = { currency: 'USD', maxPerBatchMinorUnits: 25 };
    const edited = await harness.entry.applyMutationBatchV3({
      schemaVersion: 6,
      projectId: created.summary.id,
      expectedAuthoringRevision: 1,
      operations: [{ kind: 'set_spend_policy', policy }],
    });

    expect(edited).toMatchObject({ authoringRevision: 2, undoEntryId: null });
    await expect(harness.entry.loadProjectV3(created.summary.id)).resolves.toMatchObject({ spendPolicy: policy });
  });

  it('reserves a proposed handle for import and rename only at its matching authoring revision', async () => {
    const fixture = await createPilotPhotoFixtureV3({ origin: 'imported', fileName: 'Existing.png' });
    try {
      const prepared = await fixture.runtime.entryPoint.preparePhotoV3({
        mode: 'create',
        projectId: fixture.project.id,
        expectedAuthoringRevision: fixture.project.authoringRevision,
        words: 'A reserved second photograph',
        settings: { aspectRatio: '16:9', resolution: '1080p' },
        suggestedHandle: 'existing_2',
      });

      await expect(
        fixture.runtime.entryPoint.applyMutationBatchV3({
          schemaVersion: 6,
          projectId: fixture.project.id,
          expectedAuthoringRevision: fixture.project.authoringRevision,
          operations: [{ kind: 'rename_piece', pieceId: fixture.pieceId, handle: prepared.quote.proposedHandle }],
        })
      ).rejects.toMatchObject({ code: 'handle_collision' });
      const whileCurrent = await fixture.runtime.entryPoint.importPhotoV3({
        projectId: fixture.project.id,
        expectedAuthoringRevision: fixture.project.authoringRevision,
      });
      if (whileCurrent.status !== 'imported') throw new Error('fixture import was cancelled');
      const afterCurrent = await fixture.runtime.store.loadProjectV3(fixture.project.id);
      expect(afterCurrent.pieces[whileCurrent.pieceId]?.handle).toBe('existing_3');

      const afterStale = await fixture.runtime.entryPoint.importPhotoV3({
        projectId: fixture.project.id,
        expectedAuthoringRevision: afterCurrent.authoringRevision,
      });
      if (afterStale.status !== 'imported') throw new Error('fixture import was cancelled');
      const project = await fixture.runtime.store.loadProjectV3(fixture.project.id);
      expect(project.pieces[afterStale.pieceId]?.handle).toBe('existing_2');
      expect(project.pieces[fixture.pieceId]?.handle).toBe('existing');
    } finally {
      await fixture.cleanup();
    }
  });

  it('classifies stale, missing, and invalid authoring mutations without committing', async () => {
    const fixture = await createPilotPhotoFixtureV3({ origin: 'imported', fileName: 'First photo.png' });
    try {
      const installed = fixture.project;
      const batch = (expectedAuthoringRevision: number, pieceId: string, handle: string) => ({
        schemaVersion: 6,
        projectId: installed.id,
        expectedAuthoringRevision,
        operations: [{ kind: 'rename_piece' as const, pieceId, handle }],
      });

      await expect(
        fixture.runtime.entryPoint.applyMutationBatchV3(
          batch(installed.authoringRevision + 1, fixture.pieceId, 'future_name')
        )
      ).rejects.toMatchObject({ code: 'stale_authoring' });
      await expect(
        fixture.runtime.entryPoint.applyMutationBatchV3(
          batch(installed.authoringRevision, 'piece_missing', 'missing_name')
        )
      ).rejects.toMatchObject({ code: 'not_found' });
      await expect(
        fixture.runtime.entryPoint.applyMutationBatchV3(
          batch(installed.authoringRevision, fixture.pieceId, 'first_photo')
        )
      ).rejects.toMatchObject({ code: 'no_change' });
      await expect(fixture.runtime.store.loadProjectV3(installed.id)).resolves.toMatchObject({
        revision: installed.revision,
        authoringRevision: installed.authoringRevision,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('preserves renderer-actionable rename and undo refusal reasons', async () => {
    const fixture = await createPilotPhotoFixtureV3({ origin: 'imported', fileName: 'Named photo.png' });
    try {
      await expect(
        fixture.runtime.entryPoint.applyMutationBatchV3({
          schemaVersion: 6,
          projectId: fixture.project.id,
          expectedAuthoringRevision: fixture.project.authoringRevision,
          operations: [{ kind: 'rename_piece', pieceId: fixture.pieceId, handle: 'unsafe\u200dname' }],
        })
      ).rejects.toMatchObject({ code: 'invalid_handle' });
      await expect(
        fixture.runtime.entryPoint.applyMutationBatchV3({
          schemaVersion: 6,
          projectId: fixture.project.id,
          expectedAuthoringRevision: fixture.project.authoringRevision,
          operations: [{ kind: 'undo_last', entryId: 'mutation_missing' }],
        })
      ).rejects.toMatchObject({ code: 'undo_conflict' });
    } finally {
      await fixture.cleanup();
    }
  });

  it('refuses authoring when the process clock or mutation identity cannot be persisted safely', async () => {
    const invalidClock = await createHarness({ now: () => -1 });
    const invalidClockProject = await invalidClock.entry.createProjectV3({ name: 'Invalid clock', brief: '' });
    const invalidIdentity = await createHarness({ mintIdentity: () => '../unsafe' });
    const invalidIdentityProject = await invalidIdentity.entry.createProjectV3({ name: 'Invalid identity', brief: '' });
    const edit = (projectId: string) => ({
      schemaVersion: 6,
      projectId,
      expectedAuthoringRevision: 1,
      operations: [{ kind: 'set_brief' as const, brief: 'Changed' }],
    });

    await expect(invalidClock.entry.applyMutationBatchV3(edit(invalidClockProject.summary.id))).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(
      invalidIdentity.entry.applyMutationBatchV3(edit(invalidIdentityProject.summary.id))
    ).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('delegates bounded same-Job recovery without minting renderer authority', async () => {
    const harness = await createHarness();
    const resume = { projectId: 'project_1', pieceId: 'piece_1', jobId: 'job_resume', expectedRevision: 7 };
    const retryDownload = { ...resume, jobId: 'job_download' };

    await expect(harness.entry.resumeJobV3(resume)).resolves.toMatchObject({
      status: 'recovering',
      jobId: 'job_resume',
      revision: 8,
    });
    await expect(harness.entry.retryDownloadV3(retryDownload)).resolves.toMatchObject({
      status: 'recovering',
      jobId: 'job_download',
      revision: 9,
    });
    expect(harness.jobs.resumeJobV3).toHaveBeenCalledWith(resume);
    expect(harness.jobs.retryDownloadV3).toHaveBeenCalledWith(retryDownload);
  });

  it('delegates import, cancellation, and export through their typed Main-owned services', async () => {
    const harness = await createHarness();
    const cancel = { projectId: 'project_1', pieceId: 'piece_1', jobId: 'job_cancel', expectedRevision: 6 };
    const exportRequest = {
      projectId: 'project_1',
      pieceId: 'piece_1',
      expectedRevision: 6,
      expectedCatalogRevision: 0,
    };

    await expect(harness.entry.importPhotoV3({ projectId: 'project_1' })).resolves.toEqual({ status: 'cancelled' });
    await expect(harness.entry.cancelJobV3(cancel)).resolves.toMatchObject({ status: 'cancelled', revision: 7 });
    await expect(harness.entry.exportPieceV3(exportRequest)).resolves.toMatchObject({
      status: 'exported',
      catalog: { revision: 1 },
    });
    expect(harness.media.importPhotoV3).toHaveBeenCalledWith({ projectId: 'project_1' });
    expect(harness.jobs.cancelJobV3).toHaveBeenCalledWith(cancel);
    expect(harness.exports.exportPieceV3).toHaveBeenCalledWith(exportRequest);
  });

  it('loads each catalogue classification with only the authority appropriate to that state', async () => {
    const harness = await createHarness();
    await mkdir(path.join(harness.root, 'legacy_project'), { recursive: true });
    await writeFile(path.join(harness.root, 'legacy_project', 'project.json'), '{"schemaVersion":5}\n');
    await mkdir(path.join(harness.root, 'broken_project'), { recursive: true });
    await writeFile(path.join(harness.root, 'broken_project', 'project.json'), '{"schemaVersion":6}\n');

    await expect(harness.entry.loadProjectV3('missing_project')).resolves.toEqual({
      status: 'not_found',
      projectId: 'missing_project',
    });
    await expect(harness.entry.loadProjectV3('legacy_project')).resolves.toMatchObject({
      status: 'unsupported',
      projectId: 'legacy_project',
      deletionClaim: expect.stringMatching(/^studio-delete-v3_/),
    });
    await expect(harness.entry.loadProjectV3('broken_project')).resolves.toMatchObject({
      status: 'quarantined',
      projectId: 'broken_project',
      deletionClaim: expect.stringMatching(/^studio-delete-v3_/),
    });
  });

  it('surfaces unsupported and quarantined inventory with revalidated deletion claims', async () => {
    const harness = await createHarness();
    const projects = harness.root;
    await installSchema5ProjectCapture(projects);
    await mkdir(path.join(projects, 'broken_project'), { recursive: true });
    await writeFile(path.join(projects, 'broken_project', 'project.json'), '{"schemaVersion":6}\n');

    const list = await harness.entry.listProjectsV3();
    const legacy = list.entries.find(
      (entry) => entry.status === 'unsupported' && entry.projectId === 'project_capture'
    );
    const broken = list.entries.find((entry) => entry.status === 'quarantined' && entry.projectId === 'broken_project');
    expect(legacy).toBeDefined();
    expect(broken).toBeDefined();
    if (legacy?.status !== 'unsupported' || broken?.status !== 'quarantined') throw new Error('missing claims');
    await expect(harness.entry.loadProjectV3(legacy.projectId)).resolves.toMatchObject({
      status: 'unsupported',
      projectId: 'project_capture',
      deletionClaim: expect.stringMatching(/^studio-delete-v3_/),
    });

    await expect(
      harness.entry.deleteProjectV3({
        mode: 'unreadable',
        projectId: legacy.projectId,
        deletionClaim: legacy.deletionClaim,
      })
    ).resolves.toEqual({ status: 'deleted', projectId: 'project_capture' });
    await expect(
      harness.entry.deleteProjectV3({
        mode: 'unreadable',
        projectId: broken.projectId,
        deletionClaim: broken.deletionClaim,
      })
    ).resolves.toEqual({ status: 'deleted', projectId: 'broken_project' });
  });

  it.each(['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention'] as const)(
    'refuses physical deletion while a healthy schema-6 project has a %s Job',
    async (status) => {
      const fixture = await createPilotPhotoFixtureV3({ origin: 'generated', generatedOutcome: 'failed' });
      try {
        const project = await setFixtureJobStatus(fixture, status);

        await expect(
          fixture.runtime.entryPoint.deleteProjectV3({
            mode: 'healthy',
            projectId: project.id,
            expectedRevision: project.revision,
          })
        ).rejects.toMatchObject({ name: 'CreativeStudioPilotServiceErrorV3', code: 'busy' });
        await expect(fixture.runtime.store.loadProjectV3(project.id)).resolves.toMatchObject({
          id: project.id,
          revision: project.revision,
          jobs: { [fixture.jobId!]: { status } },
        });
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it.each([
    ['succeeded', undefined],
    ['failed', 'failed'],
    ['cancelled', 'failed'],
  ] as const)('deletes a healthy schema-6 project whose Jobs are terminal at %s', async (status, generatedOutcome) => {
    const fixture = await createPilotPhotoFixtureV3({ origin: 'generated', generatedOutcome });
    try {
      const project =
        status === 'cancelled'
          ? await setFixtureJobStatus(fixture, status)
          : await fixture.runtime.store.loadProjectV3(fixture.project.id);

      await expect(
        fixture.runtime.entryPoint.deleteProjectV3({
          mode: 'healthy',
          projectId: project.id,
          expectedRevision: project.revision,
        })
      ).resolves.toEqual({ status: 'deleted', projectId: project.id });
      await expect(fixture.runtime.store.getProjectV3(project.id)).resolves.toEqual({
        status: 'not_found',
        catalogueId: project.id,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('requires revision authority for healthy deletion and reports an absent target without side effects', async () => {
    const harness = await createHarness();
    const created = await harness.entry.createProjectV3({ name: 'Disposable project', brief: '' });
    const project = await harness.store.loadProjectV3(created.summary.id);

    await expect(
      harness.entry.deleteProjectV3({
        mode: 'healthy',
        projectId: created.summary.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ status: 'deleted', projectId: created.summary.id });
    await expect(
      harness.entry.deleteProjectV3({ mode: 'healthy', projectId: 'missing_project', expectedRevision: 1 })
    ).resolves.toEqual({ status: 'not_found', projectId: 'missing_project' });
  });

  it('contains observer failures and rejects non-callable observers', async () => {
    const harness = await createHarness();
    const survivingObserver = vi.fn();
    harness.entry.watchProjectUpdatesV3(() => {
      throw new Error('observer failure');
    });
    harness.entry.watchProjectUpdatesV3(survivingObserver);

    await harness.entry.createProjectV3({ name: 'Observable project', brief: '' });

    expect(survivingObserver).toHaveBeenCalledWith(expect.objectContaining({ source: 'durable' }));
    expect(() => harness.entry.watchProjectUpdatesV3(null as never)).toThrowError(
      expect.objectContaining({ code: 'invalid_payload' })
    );
  });

  it('starts recovery in store → media → export → Job order and disposes owned transient authority', async () => {
    const harness = await createHarness();
    await harness.entry.createProjectV3({ name: 'Recovery pilot', brief: '' });

    await harness.entry.startV3();
    await harness.entry.startV3();
    expect(harness.order).toEqual(['media', 'exports', 'jobs']);
    expect(harness.media.recoverAllMediaV3).toHaveBeenCalledOnce();
    expect(harness.exports.recoverAllExportsV3).toHaveBeenCalledOnce();
    expect(harness.jobs.resumePendingJobsV3).toHaveBeenCalledOnce();

    await harness.entry.dispose();
    await harness.entry.dispose();
    expect(harness.jobs.dispose).toHaveBeenCalledOnce();
    await expect(harness.entry.listProjectsV3()).rejects.toMatchObject({ code: 'runtime_inactive' });
  });

  it('retries startup recovery after a transient failure instead of caching the rejection', async () => {
    const harness = await createHarness();
    harness.media.recoverAllMediaV3.mockRejectedValueOnce(new Error('temporary media scan failure'));

    await expect(harness.entry.startV3()).rejects.toThrow('temporary media scan failure');
    await expect(harness.entry.startV3()).resolves.toBeUndefined();

    expect(harness.media.recoverAllMediaV3).toHaveBeenCalledTimes(2);
    expect(harness.exports.recoverAllExportsV3).toHaveBeenCalledOnce();
    expect(harness.jobs.resumePendingJobsV3).toHaveBeenCalledOnce();
  });
});
