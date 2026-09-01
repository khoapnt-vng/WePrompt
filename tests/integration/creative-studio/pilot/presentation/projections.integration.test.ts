/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Public-runtime projection evidence for the isolated schema-6 Pilot.
 *
 * @vitest-environment node
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_PIECES_V3,
  type StudioPieceJobV3,
  type StudioProjectV3,
  type StudioRendererPreparedPhotoQuoteV3,
} from '@/common/types/project/creativeStudioTypes';
import {
  toStudioProjectSummaryV3,
  toStudioRendererCanvasInventoryV3,
  toStudioRendererCapabilityActivityV3,
  toStudioRendererPieceCurrentProvenanceV3,
} from '@/process/services/creative-studio/service/pilot/projections';
import { validateStudioProjectV3 } from '@/process/services/creative-studio/service/schema2/validation';
import { createPilotPhotoFixtureV3, type PilotPhotoFixtureV3 } from './realFixture';

const fixtures: PilotPhotoFixtureV3[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

const fixture = async (
  origin: 'generated' | 'imported',
  generatedOutcome: 'succeeded' | 'failed' = 'succeeded'
): Promise<PilotPhotoFixtureV3> => {
  const created = await createPilotPhotoFixtureV3({
    origin,
    generatedOutcome,
    name: origin === 'generated' ? 'Light on Water' : 'Imported',
    brief: origin === 'generated' ? 'One quiet photograph.' : '',
    words: 'Moonlight reflected on calm water.',
    suggestedHandle: 'light_on_water',
    referencePieceIds: [],
    format: origin === 'imported' ? 'jpeg' : 'png',
    fileName: origin === 'imported' ? 'عکس‌های شب.jpg' : undefined,
  });
  fixtures.push(created);
  return created;
};

const loadProject = (value: PilotPhotoFixtureV3): Promise<StudioProjectV3> =>
  value.runtime.store.loadProjectV3(value.project.id);

const prepareCreateQuote = async (value: PilotPhotoFixtureV3): Promise<StudioRendererPreparedPhotoQuoteV3> => {
  const project = await loadProject(value);
  const prepared = await value.runtime.entryPoint.preparePhotoV3({
    mode: 'create',
    projectId: project.id,
    expectedAuthoringRevision: project.authoringRevision,
    words: 'A silver lake at night.',
    settings: { aspectRatio: '16:9', resolution: '1080p' },
    suggestedHandle: 'silver_lake',
    referencePieceIds: [],
  });
  return prepared.quote;
};

const prepareRetryQuote = async (value: PilotPhotoFixtureV3): Promise<StudioRendererPreparedPhotoQuoteV3> => {
  const project = await loadProject(value);
  const jobId = value.jobId;
  if (jobId === null) throw new Error('retry fixture has no Job');
  const prepared = await value.runtime.entryPoint.preparePhotoV3({
    mode: 'retry',
    projectId: project.id,
    expectedAuthoringRevision: project.authoringRevision,
    pieceId: value.pieceId,
    sourceJobId: jobId,
  });
  return prepared.quote;
};

const alterQuote = (
  quote: StudioRendererPreparedPhotoQuoteV3,
  overrides: Partial<StudioRendererPreparedPhotoQuoteV3>
): StudioRendererPreparedPhotoQuoteV3 => ({ ...structuredClone(quote), ...overrides });

const explicitProjectTransform = (
  project: StudioProjectV3,
  transform: (draft: StudioProjectV3) => void,
  label = 'explicit projection-boundary transform'
): StudioProjectV3 => {
  const candidate = structuredClone(project);
  transform(candidate);
  expect(validateStudioProjectV3(candidate), label).toBe(true);
  return candidate;
};

const jobOf = (project: StudioProjectV3, jobId: string | null): StudioPieceJobV3 => {
  if (jobId === null || project.jobs[jobId] === undefined) throw new Error('fixture Job is missing');
  return project.jobs[jobId];
};

describe('CS4 Pilot renderer-safe projections', () => {
  it('projects summary, ordered canvas, and exact generated provenance from a public completed Job', async () => {
    const real = await fixture('generated');
    const project = await loadProject(real);
    const piece = project.pieces[real.pieceId]!;
    const asset = project.assets[piece.currentAssetId!]!;
    const job = jobOf(project, real.jobId);
    const receipt = job.spendReceipt!;

    expect(toStudioProjectSummaryV3(project)).toEqual({
      id: project.id,
      name: 'Light on Water',
      pieceCount: 1,
      currentPieceCount: 1,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
    expect(toStudioRendererCanvasInventoryV3(project)).toEqual({
      projectId: project.id,
      revision: project.revision,
      authoringRevision: project.authoringRevision,
      pieces: [
        {
          id: piece.id,
          kind: 'photograph',
          handle: 'light_on_water',
          priorHandles: [],
          state: 'current',
          currentAsset: {
            id: asset.id,
            mediaKind: 'image',
            mimeType: 'image/png',
            width: 32,
            height: 24,
            byteSize: asset.byteSize,
            provenance: {
              origin: 'generated',
              createdAt: asset.createdAt,
              producerJobId: job.id,
              model: 'image-model-v1',
              instructionProfile: 'weprompt-image-v1.piece-image.v2',
              conditioningPieceIds: [],
              recordedSpend: { currency: receipt.currency, totalMinorUnits: receipt.totalMinorUnits },
            },
          },
        },
      ],
    });
    expect(toStudioRendererPieceCurrentProvenanceV3(project, piece.id)).toEqual({
      origin: 'generated',
      createdAt: asset.createdAt,
      producerJobId: job.id,
      model: 'image-model-v1',
      instructionProfile: 'weprompt-image-v1.piece-image.v2',
      conditioningPieceIds: [],
      recordedSpend: { currency: receipt.currency, totalMinorUnits: receipt.totalMinorUnits },
    });
  });

  it('distinguishes a native-picker import without leaking its managed path or digest', async () => {
    const real = await fixture('imported');
    const project = await loadProject(real);
    const asset = project.assets[real.assetId!]!;
    const canvas = toStudioRendererCanvasInventoryV3(project);

    expect(canvas.pieces[0]).toMatchObject({
      handle: 'عکس‌های_شب',
      state: 'current',
      currentAsset: { provenance: { origin: 'imported', createdAt: asset.createdAt } },
    });
    expect(toStudioRendererPieceCurrentProvenanceV3(project, real.pieceId)).toEqual({
      origin: 'imported',
      createdAt: asset.createdAt,
    });
    expect(JSON.stringify(canvas)).not.toContain('imports');
    expect(JSON.stringify(canvas)).not.toContain(asset.sha256);
  });

  it('derives cancellation/retry capabilities and suppresses a predecessor after a real retry child exists', async () => {
    const real = await fixture('generated', 'failed');
    const failed = await loadProject(real);
    const sourceJob = jobOf(failed, real.jobId);
    const sourceAuthorization = failed.spendAuthorizations.find(
      (authorization) => authorization.id === sourceJob.authorizationId
    )!;
    const failedActivity = toStudioRendererCapabilityActivityV3(failed, []);
    expect(failedActivity.jobs).toEqual([
      {
        jobId: sourceJob.id,
        pieceId: real.pieceId,
        status: 'failed',
        createdAt: sourceJob.createdAt,
        updatedAt: sourceJob.updatedAt,
        progress: null,
        error: sourceJob.error,
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        authorization: {
          confirmedAt: sourceAuthorization.confirmedAt,
        },
        canCancel: false,
        canRetry: true,
        canRetryDownload: false,
        canResume: false,
        recordedSpend: null,
      },
    ]);

    const prepared = await real.runtime.entryPoint.preparePhotoV3({
      mode: 'retry',
      projectId: failed.id,
      expectedAuthoringRevision: failed.authoringRevision,
      pieceId: real.pieceId,
      sourceJobId: sourceJob.id,
    });
    const confirmed = await real.runtime.entryPoint.confirmPreparedPhotoV3({
      reservationId: prepared.quote.reservationId,
      quoteId: prepared.quote.quoteId,
      quoteRevision: prepared.quote.quoteRevision,
      explicitHumanConfirmation: prepared.quote.requiresExplicitHumanAction,
      duplicateChargeAcknowledged: false,
    });
    await real.runtime.jobs.waitForIdleV3();
    const failedRetry = await loadProject(real);
    // Projection-state matrix boundary: change only the real retry Job's terminal state.
    const withCancelledChild = explicitProjectTransform(failedRetry, (draft) => {
      const child = draft.jobs[confirmed.jobId]!;
      child.status = 'cancelled';
      child.error = null;
    });
    const childActivity = toStudioRendererCapabilityActivityV3(withCancelledChild, []);
    expect(childActivity.jobs.map(({ jobId, canRetry }) => ({ jobId, canRetry }))).toEqual([
      { jobId: sourceJob.id, canRetry: false },
      { jobId: confirmed.jobId, canRetry: true },
    ]);
    expect(childActivity.jobs[1]).toMatchObject({
      retryOfJobId: sourceJob.id,
      retryReason: 'provider_failure',
      duplicateChargeAcknowledged: false,
      authorization: {
        confirmedAt: failedRetry.spendAuthorizations.find(
          (authorization) => authorization.id === failedRetry.jobs[confirmed.jobId]!.authorizationId
        )!.confirmedAt,
      },
    });

    // Projection-state matrix boundary: queued_local is a pre-submit form of the same public Job.
    const queued = explicitProjectTransform(failed, (draft) => {
      Object.assign(draft.jobs[sourceJob.id]!, {
        status: 'queued_local',
        error: null,
        progress: null,
        providerSubmissionKind: null,
        providerJobId: null,
        remoteStartedAt: null,
      });
    });
    expect(toStudioRendererCapabilityActivityV3(queued, []).jobs[0]).toMatchObject({
      status: 'queued_local',
      canCancel: true,
      canRetry: false,
    });
  });

  it('offers only the matching same-Job recovery and never offers cancellation while submitting', async () => {
    const real = await fixture('generated');
    const succeeded = await loadProject(real);
    const jobId = real.jobId!;

    // Recovery boundary: publication is removed while the paid provider identity and receipt remain exact.
    const downloadFailed = explicitProjectTransform(succeeded, (draft) => {
      draft.pieces[real.pieceId]!.currentAssetId = null;
      draft.assets = {};
      Object.assign(draft.jobs[jobId]!, {
        status: 'failed',
        outputAssetId: null,
        error: { code: 'download_failed', messageKey: 'creativeStudio.jobs.downloadFailed' },
      });
    });
    expect(toStudioRendererCapabilityActivityV3(downloadFailed, []).jobs[0]).toMatchObject({
      canCancel: false,
      canRetry: false,
      canRetryDownload: true,
      canResume: false,
    });
    expect(toStudioRendererCapabilityActivityV3(downloadFailed, [], new Set([jobId])).jobs[0]).toMatchObject({
      canRetryDownload: true,
      canResume: false,
    });

    const pollDeadline = explicitProjectTransform(downloadFailed, (draft) => {
      Object.assign(draft.jobs[jobId]!, {
        status: 'needs_attention',
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_recovery',
        remoteStartedAt: draft.jobs[jobId]!.createdAt,
        error: { code: 'poll_deadline', messageKey: 'creativeStudio.jobs.pollDeadline' },
      });
    });
    expect(toStudioRendererCapabilityActivityV3(pollDeadline, []).jobs[0]).toMatchObject({
      canCancel: false,
      canRetry: false,
      canRetryDownload: false,
      canResume: true,
    });
    expect(toStudioRendererCapabilityActivityV3(pollDeadline, [], new Set([jobId])).jobs[0]).toMatchObject({
      canRetryDownload: false,
      canResume: false,
    });

    const failedReal = await fixture('generated', 'failed');
    const failed = await loadProject(failedReal);
    const submitting = explicitProjectTransform(failed, (draft) => {
      Object.assign(draft.jobs[failedReal.jobId!]!, {
        status: 'submitting',
        providerSubmissionKind: null,
        providerJobId: null,
        remoteStartedAt: null,
        progress: null,
        error: null,
      });
    });
    expect(toStudioRendererCapabilityActivityV3(submitting, []).jobs[0]).toMatchObject({
      status: 'submitting',
      canCancel: false,
      canRetry: false,
      canRetryDownload: false,
      canResume: false,
    });
  });

  it('preserves authoring authority while runtime revision/progress advance', async () => {
    const real = await fixture('generated');
    const succeeded = await loadProject(real);
    const jobId = real.jobId!;
    const running = explicitProjectTransform(succeeded, (draft) => {
      draft.pieces[real.pieceId]!.currentAssetId = null;
      draft.assets = {};
      Object.assign(draft.jobs[jobId]!, {
        status: 'running',
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_progress',
        remoteStartedAt: draft.jobs[jobId]!.createdAt,
        outputAssetId: null,
        error: null,
        progress: 40,
      });
    });
    const beforeCanvas = toStudioRendererCanvasInventoryV3(running);
    const beforeActivity = toStudioRendererCapabilityActivityV3(running, []);

    const advanced = explicitProjectTransform(running, (draft) => {
      draft.revision += 1;
      draft.updatedAt = new Date(Date.parse(draft.updatedAt) + 1).toISOString();
      draft.jobs[jobId]!.updatedAt = draft.updatedAt;
      draft.jobs[jobId]!.progress = 70;
    });
    const afterCanvas = toStudioRendererCanvasInventoryV3(advanced);
    const afterActivity = toStudioRendererCapabilityActivityV3(advanced, []);

    expect(afterCanvas.authoringRevision).toBe(beforeCanvas.authoringRevision);
    expect(afterCanvas.revision).toBe(beforeCanvas.revision + 1);
    expect(afterCanvas.pieces).toEqual(beforeCanvas.pieces);
    expect(afterActivity.jobs[0]!.progress).toBe(70);
    expect(beforeActivity.jobs[0]!.progress).toBe(40);
  });

  it('snapshots and deterministically orders public prepared quotes', async () => {
    const real = await fixture('generated');
    const project = await loadProject(real);
    const first = await prepareCreateQuote(real);
    const second = await prepareCreateQuote(real);
    const activity = toStudioRendererCapabilityActivityV3(project, [second, first]);
    const expectedOrder = [first, second]
      .toSorted(
        (left, right) =>
          left.expiresAt.localeCompare(right.expiresAt) ||
          left.reservationId.localeCompare(right.reservationId) ||
          left.quoteId.localeCompare(right.quoteId)
      )
      .map((quote) => quote.reservationId);
    expect(activity.preparedPhotoQuotes.map((quote) => quote.reservationId)).toEqual(expectedOrder);
    expect(activity.preparedPhotoQuotes.find((quote) => quote.quoteId === first.quoteId)).not.toBe(first);
    expect(activity.preparedPhotoQuotes.find((quote) => quote.quoteId === first.quoteId)!.settings).not.toBe(
      first.settings
    );

    const failedReal = await fixture('generated', 'failed');
    const failedProject = await loadProject(failedReal);
    const retry = await prepareRetryQuote(failedReal);
    expect(toStudioRendererCapabilityActivityV3(failedProject, [retry]).preparedPhotoQuotes).toEqual([retry]);

    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, first);
    expect(toStudioRendererCapabilityActivityV3(project, [nullPrototype]).preparedPhotoQuotes).toHaveLength(1);
  });

  it('projects every unpublished Job state and its exact cancellation capability', async () => {
    const real = await fixture('generated', 'failed');
    const base = await loadProject(real);
    const jobId = real.jobId!;
    const cases: Array<{
      status: StudioPieceJobV3['status'];
      cancellationPolicy: StudioPieceJobV3['cancellationPolicy'];
      providerJobId: string | null;
      error: StudioPieceJobV3['error'];
      expectedState: 'queued' | 'running' | 'needs_attention' | 'cancelled';
      canCancel: boolean;
    }> = [
      {
        status: 'queued_remote',
        cancellationPolicy: 'queued_only',
        providerJobId: 'provider_job_queued',
        error: null,
        expectedState: 'queued',
        canCancel: true,
      },
      {
        status: 'queued_remote',
        cancellationPolicy: 'none',
        providerJobId: 'provider_job_none',
        error: null,
        expectedState: 'queued',
        canCancel: false,
      },
      {
        status: 'running',
        cancellationPolicy: 'queued_and_running',
        providerJobId: 'provider_job_running',
        error: null,
        expectedState: 'running',
        canCancel: true,
      },
      {
        status: 'needs_attention',
        cancellationPolicy: 'queued_and_running',
        providerJobId: null,
        error: { code: 'submission_unknown', messageKey: 'creativeStudio.jobs.submissionUnknown' },
        expectedState: 'needs_attention',
        canCancel: false,
      },
      {
        status: 'cancelled',
        cancellationPolicy: 'queued_only',
        providerJobId: null,
        error: null,
        expectedState: 'cancelled',
        canCancel: false,
      },
    ];

    for (const sample of cases) {
      // Projection-state matrix boundary: mutate only runtime status fields on one public failed Job.
      const project = explicitProjectTransform(
        base,
        (draft) => {
          const job = draft.jobs[jobId]!;
          Object.assign(job, {
            status: sample.status,
            cancellationPolicy: sample.cancellationPolicy,
            providerSubmissionKind: sample.providerJobId === null ? null : 'remote',
            providerJobId: sample.providerJobId,
            remoteStartedAt: sample.providerJobId === null ? null : job.updatedAt,
            error: sample.error,
            progress: sample.status === 'running' ? 35 : null,
            spendReceipt: null,
          });
          draft.spendAuthorizations[0]!.cancellationPolicy = sample.cancellationPolicy;
        },
        sample.status
      );
      expect(toStudioRendererCanvasInventoryV3(project).pieces[0]?.state).toBe(sample.expectedState);
      expect(toStudioRendererCapabilityActivityV3(project, []).jobs[0]?.canCancel).toBe(sample.canCancel);
    }
  });

  it('strips every Main-only authority field from canvas and activity', async () => {
    const real = await fixture('generated');
    const project = await loadProject(real);
    const quote = await prepareCreateQuote(real);
    const job = jobOf(project, real.jobId);
    const asset = project.assets[real.assetId!]!;
    const authorization = project.spendAuthorizations[0]!;
    const rendered = JSON.stringify({
      canvas: toStudioRendererCanvasInventoryV3(project),
      activity: toStudioRendererCapabilityActivityV3(project, [quote]),
    });
    for (const forbidden of [
      job.provider.providerId,
      ...(job.providerJobId === null ? [] : [job.providerJobId]),
      authorization.id,
      job.idempotencyKey,
      'managedAsset',
      asset.managedAsset.fileName,
      'authoringFingerprint',
      'compositionDigest',
      'providerSubmissionKind',
      asset.sha256,
      '"adapterId"',
      '"providerId"',
    ]) {
      expect(rendered, forbidden).not.toContain(forbidden);
    }
  });

  it('fails closed on malformed projects, quotes, duplicate authority, accessors, and proxies', async () => {
    const real = await fixture('generated');
    const project = await loadProject(real);
    const validQuote = await prepareCreateQuote(real);
    expect(() => toStudioProjectSummaryV3({ ...project, shots: {} })).toThrow('invalid_schema_6_projection_input');
    expect(() =>
      toStudioRendererCapabilityActivityV3(project, [
        alterQuote(validQuote, { upperMinorUnits: validQuote.upperMinorUnits + 1 }),
      ])
    ).toThrow('invalid_schema_6_projection_input');
    expect(() => toStudioRendererCapabilityActivityV3(project, [validQuote, validQuote])).toThrow(
      'invalid_schema_6_projection_input'
    );

    let getterReads = 0;
    const quote = structuredClone(validQuote) as unknown as Record<string, unknown>;
    Object.defineProperty(quote, 'words', {
      enumerable: true,
      get: () => {
        getterReads += 1;
        return validQuote.words;
      },
    });
    expect(() => toStudioRendererCapabilityActivityV3(project, [quote])).toThrow('invalid_schema_6_projection_input');
    expect(getterReads).toBe(0);

    let proxyReads = 0;
    const proxiedQuote = new Proxy(validQuote, {
      get: (target, key, receiver) => {
        proxyReads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(() => toStudioRendererCapabilityActivityV3(project, [proxiedQuote])).toThrow(
      'invalid_schema_6_projection_input'
    );
    expect(proxyReads).toBe(0);

    expect(() => toStudioRendererPieceCurrentProvenanceV3(project, 'missing_piece')).toThrow(
      'invalid_schema_6_projection_input'
    );
    expect(() => toStudioRendererPieceCurrentProvenanceV3(project, '../unsafe')).toThrow(
      'invalid_schema_6_projection_input'
    );
    const failedReal = await fixture('generated', 'failed');
    expect(toStudioRendererPieceCurrentProvenanceV3(await loadProject(failedReal), failedReal.pieceId)).toBeNull();

    const proxiedArray = new Proxy([validQuote], {});
    const sparseQuotes: StudioRendererPreparedPhotoQuoteV3[] = [];
    sparseQuotes.length = 1;
    expect(() => toStudioRendererCapabilityActivityV3(project, null)).toThrow('invalid_schema_6_projection_input');
    expect(() => toStudioRendererCapabilityActivityV3(project, proxiedArray)).toThrow(
      'invalid_schema_6_projection_input'
    );
    expect(() => toStudioRendererCapabilityActivityV3(project, sparseQuotes)).toThrow(
      'invalid_schema_6_projection_input'
    );

    const malformedQuotes: unknown[] = [
      { ...validQuote, extra: true },
      alterQuote(validQuote, { reservationId: '../unsafe' }),
      alterQuote(validQuote, { projectId: 'another_project' }),
      alterQuote(validQuote, { quoteId: '' }),
      alterQuote(validQuote, { quoteRevision: 0 }),
      alterQuote(validQuote, { targetPieceId: '' }),
      alterQuote(validQuote, { words: '  not normalized  ' }),
      alterQuote(validQuote, { settings: { aspectRatio: '2:1', resolution: '1080p' } as never }),
      alterQuote(validQuote, { settings: { aspectRatio: '16:9', resolution: '4k' } as never }),
      alterQuote(validQuote, { currency: 'usd' }),
      alterQuote(validQuote, { lowerMinorUnits: 0 }),
      alterQuote(validQuote, { upperMinorUnits: validQuote.upperMinorUnits + 1 }),
      alterQuote(validQuote, { spendPolicyClassification: 'unknown' as never }),
      alterQuote(validQuote, { expiresAt: 'not-a-date' }),
      alterQuote(validQuote, { requiresExplicitHumanAction: 'yes' as never }),
      alterQuote(validQuote, { duplicateChargeAcknowledgementRequired: 'yes' as never }),
      alterQuote(validQuote, {
        duplicateChargeAcknowledgementRequired: true,
        requiresExplicitHumanAction: false,
      }),
      alterQuote(validQuote, { orderIndex: -1 }),
      alterQuote(validQuote, { orderIndex: STUDIO_MAX_PIECES_V3 }),
      alterQuote(validQuote, { mode: 'retry', proposedHandle: 'not-null', orderIndex: null } as never),
      alterQuote(validQuote, { mode: 'retry', proposedHandle: null, orderIndex: 0 } as never),
    ];
    for (const malformedQuote of malformedQuotes) {
      expect(() => toStudioRendererCapabilityActivityV3(project, [malformedQuote])).toThrow(
        'invalid_schema_6_projection_input'
      );
    }

    const duplicateQuoteId = alterQuote(validQuote, { reservationId: `${validQuote.reservationId}_other` });
    expect(() => toStudioRendererCapabilityActivityV3(project, [validQuote, duplicateQuoteId])).toThrow(
      'invalid_schema_6_projection_input'
    );
  });
});
