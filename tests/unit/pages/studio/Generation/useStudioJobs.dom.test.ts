/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandErrorCode,
  StudioCommandResult,
  StudioRendererJob,
  StudioRendererProject,
  StudioReferenceRequest,
  StudioScene,
  StudioSceneGenerationChoice,
} from '@/common/types/project/creativeStudioTypes';
import { useStudioJobs } from '@renderer/pages/studio/hooks/useStudioJobs';

const bridge = vi.hoisted(() => ({
  projectUpdated: { on: vi.fn() },
  proposalUpdated: { on: vi.fn() },
  listPendingReferenceRequests: { invoke: vi.fn() },
  dismissReferenceRequests: { invoke: vi.fn() },
  submitScenes: { invoke: vi.fn() },
  cancelJob: { invoke: vi.fn() },
  retryJob: { invoke: vi.fn() },
  retryDownload: { invoke: vi.fn() },
}));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: bridge } }));

const ok = <T>(data: T): StudioCommandResult<T> => ({ ok: true, data });

const failed = <T>(code: StudioCommandErrorCode, messageKey: string): StudioCommandResult<T> => ({
  ok: false,
  error: { code, messageKey },
});

const scene = (id: string, jobIds: string[] = []): StudioScene => ({
  id,
  title: `Scene ${id}`,
  purpose: 'Move the story forward',
  visualPrompt: 'A cinematic wide shot',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds,
  reviewState: jobIds.length > 0 ? 'generating' : 'ready',
});

const job = (id: string, overrides: Partial<StudioRendererJob> = {}): StudioRendererJob => ({
  id,
  projectId: 'project-1',
  sceneId: 'scene-1',
  status: 'queued_local',
  provider: {
    choiceId: 'choice_video',
    providerId: 'provider-1',
    model: 'seedance-1-0-pro',
  },
  outputAssetIds: [],
  error: null,
  canCancel: true,
  canRetryDownload: false,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const project = (
  revision = 2,
  jobs: Record<string, StudioRendererJob> = {},
  overrides: Partial<StudioRendererProject> = {}
): StudioRendererProject => ({
  schemaVersion: 1,
  revision,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch video',
  aspectRatio: '16:9',
  targetDurationSeconds: 5,
  resolution: '720p',
  sceneOrder: ['scene-1'],
  scenes: {
    'scene-1': scene(
      'scene-1',
      Object.values(jobs)
        .filter(({ projectId, sceneId }) => projectId === 'project-1' && sceneId === 'scene-1')
        .map(({ id }) => id)
    ),
  },
  assets: {},
  jobs,
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const route: StudioSceneGenerationChoice = {
  sceneId: 'scene-1',
  choiceId: 'choice_video',
  kind: 'video',
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

let projectUpdatedListener: ((event: { projectId: string }) => void) | null;
let proposalUpdatedListener: ((event: { projectId: string }) => void) | null;
let unsubscribe: ReturnType<typeof vi.fn>;

const emitProjectUpdated = (projectId: string): void => {
  if (projectUpdatedListener === null) throw new Error('Studio project listener was not registered');
  act(() => projectUpdatedListener?.({ projectId }));
};

const emitProposalUpdated = (projectId: string): void => {
  if (proposalUpdatedListener === null) throw new Error('Studio proposal listener was not registered');
  act(() => proposalUpdatedListener?.({ projectId }));
};

describe('useStudioJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectUpdatedListener = null;
    proposalUpdatedListener = null;
    unsubscribe = vi.fn();
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      projectUpdatedListener = listener;
      return unsubscribe;
    });
    bridge.proposalUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      proposalUpdatedListener = listener;
      return vi.fn();
    });
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(ok([]));
    bridge.dismissReferenceRequests.invoke.mockResolvedValue(ok(true));
    bridge.submitScenes.invoke.mockResolvedValue(ok([]));
    bridge.cancelJob.invoke.mockImplementation(async ({ jobId }: { jobId: string }) => ok(job(jobId)));
    bridge.retryJob.invoke.mockImplementation(async ({ jobId }: { jobId: string }) => ok(job(`${jobId}-retry`)));
    bridge.retryDownload.invoke.mockImplementation(async ({ jobId }: { jobId: string }) => ok(job(jobId)));
  });

  it('refetches matching events and ignores unrelated, stale, and out-of-order snapshots', async () => {
    const older = deferred<StudioRendererProject | null>();
    const newer = deferred<StudioRendererProject | null>();
    const refetch = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result, rerender } = renderHook(({ value }) => useStudioJobs({ project: value, refetch }), {
      initialProps: { value: project() },
    });

    emitProjectUpdated('project-other');
    expect(refetch).not.toHaveBeenCalled();

    emitProjectUpdated('project-1');
    emitProjectUpdated('project-1');
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(2));

    await act(async () => {
      newer.resolve(project(6));
      await newer.promise;
    });
    await waitFor(() => expect(result.current.project?.revision).toBe(6));

    await act(async () => {
      older.resolve(project(4));
      await older.promise;
    });
    expect(result.current.project?.revision).toBe(6);

    rerender({ value: project(5) });
    expect(result.current.project?.revision).toBe(6);
  });

  it('subscribes before one immediate canonical reconciliation when requested', async () => {
    const refetch = vi.fn(async () => project(3));
    const { result } = renderHook(() =>
      useStudioJobs({
        project: project(2),
        refetch,
        reconcileOnSubscribe: true,
      })
    );

    await waitFor(() => expect(result.current.project?.revision).toBe(3));
    expect(bridge.projectUpdated.on).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(bridge.projectUpdated.on.mock.invocationCallOrder[0]).toBeLessThan(refetch.mock.invocationCallOrder[0]!);
  });

  it('unsubscribes on unmount without cancelling durable work or refetching afterward', async () => {
    const submission = deferred<StudioCommandResult<StudioRendererJob[]>>();
    bridge.submitScenes.invoke.mockReturnValueOnce(submission.promise);
    const refetch = vi.fn(async () => project(3));
    const { result, unmount } = renderHook(() => useStudioJobs({ project: project(), refetch }));

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.submitScenes({
        mode: 'single',
        sceneIds: ['scene-1'],
        routes: [route],
        catalogVersion: 'catalog-1',
        expectedRevision: 2,
      });
    });
    await waitFor(() => expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(1));

    const listenerAfterUnmount = projectUpdatedListener;
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(bridge.cancelJob.invoke).not.toHaveBeenCalled();
    listenerAfterUnmount?.({ projectId: 'project-1' });
    expect(refetch).not.toHaveBeenCalled();

    await act(async () => {
      submission.resolve(ok([job('job-1')]));
      expect(await pending).toBe(false);
    });
    expect(bridge.cancelJob.invoke).not.toHaveBeenCalled();
  });

  it('uses the latest adopted revision for serialized successful mutations', async () => {
    const queued = job('job-1');
    const cancelled = job('job-1', { status: 'cancelled' });
    const afterSubmit = project(3, { 'job-1': queued });
    const afterCancel = project(4, { 'job-1': cancelled });
    const refetch = vi.fn().mockResolvedValueOnce(afterSubmit).mockResolvedValueOnce(afterCancel);
    bridge.submitScenes.invoke.mockResolvedValueOnce(ok([queued]));
    bridge.cancelJob.invoke.mockResolvedValueOnce(ok(cancelled));
    const { result } = renderHook(() => useStudioJobs({ project: project(), refetch }));

    await act(async () => {
      expect(
        await result.current.submitScenes({
          mode: 'single',
          sceneIds: ['scene-1'],
          routes: [route],
          catalogVersion: 'catalog-1',
          expectedRevision: 2,
        })
      ).toBe(true);
    });
    expect(bridge.submitScenes.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      mode: 'single',
      sceneIds: ['scene-1'],
      expectedRevision: 2,
      routes: [route],
      catalogVersion: 'catalog-1',
    });
    expect(result.current.project?.revision).toBe(3);

    await act(async () => {
      expect(await result.current.cancelJob('job-1')).toBe(true);
    });
    expect(bridge.cancelJob.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      jobId: 'job-1',
      expectedRevision: 3,
    });
    expect(result.current.project?.revision).toBe(4);
  });

  it('carries a reviewed reference role and prompt through the renderer IPC boundary', async () => {
    const refetch = vi.fn(async () => project(3));
    const { result } = renderHook(() => useStudioJobs({ project: project(), refetch }));

    await act(async () => {
      expect(
        await result.current.submitScenes({
          mode: 'single',
          sceneIds: ['scene-1'],
          routes: [{ ...route, kind: 'image', choiceId: 'choice_image' }],
          catalogVersion: 'catalog-1',
          expectedRevision: 2,
          outputRole: 'reference',
          referencePrompts: [{ sceneId: 'scene-1', prompt: 'Edited first-frame prompt' }],
        })
      ).toBe(true);
    });

    expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project-1',
      mode: 'single',
      sceneIds: ['scene-1'],
      expectedRevision: 2,
      routes: [{ ...route, kind: 'image', choiceId: 'choice_image' }],
      catalogVersion: 'catalog-1',
      outputRole: 'reference',
      referencePrompts: [{ sceneId: 'scene-1', prompt: 'Edited first-frame prompt' }],
    });
  });

  it('does not resurrect dismissed reference requests from an in-flight load', async () => {
    const request: StudioReferenceRequest = {
      schemaVersion: 1,
      id: 'reference-request-1',
      projectId: 'project-1',
      sceneId: 'scene-1',
      status: 'pending',
      createdAt: '2026-08-11T00:00:00.000Z',
    };
    const staleLoad = deferred<StudioCommandResult<StudioReferenceRequest[]>>();
    bridge.listPendingReferenceRequests.invoke
      .mockResolvedValueOnce(ok([request]))
      .mockReturnValueOnce(staleLoad.promise);
    const { result } = renderHook(() => useStudioJobs({ project: project(), refetch: vi.fn(async () => project()) }));
    await waitFor(() => expect(result.current.referenceRequests).toEqual([request]));

    emitProposalUpdated('project-1');
    await waitFor(() => expect(bridge.listPendingReferenceRequests.invoke).toHaveBeenCalledTimes(2));
    await act(async () => {
      expect(await result.current.dismissReferenceRequests([request.id])).toBe(true);
    });
    expect(result.current.referenceRequests).toEqual([]);

    await act(async () => staleLoad.resolve(ok([request])));
    expect(result.current.referenceRequests).toEqual([]);
  });

  it('omits reference-only fields from an ordinary take submission', async () => {
    const refetch = vi.fn(async () => project(3));
    const { result } = renderHook(() => useStudioJobs({ project: project(), refetch }));

    await act(async () => {
      expect(
        await result.current.submitScenes({
          mode: 'single',
          sceneIds: ['scene-1'],
          routes: [route],
          catalogVersion: 'catalog-1',
          expectedRevision: 2,
        })
      ).toBe(true);
    });

    const payload = bridge.submitScenes.invoke.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty('outputRole');
    expect(payload).not.toHaveProperty('referencePrompts');
  });

  it('serializes concurrently requested mutations before reading each canonical revision', async () => {
    const firstResult = deferred<StudioCommandResult<StudioRendererJob>>();
    const firstQueued = job('job-first');
    const secondQueued = job('job-second');
    const firstCancelled = job('job-first', { status: 'cancelled' });
    const secondCancelled = job('job-second', { status: 'cancelled' });
    bridge.cancelJob.invoke.mockReturnValueOnce(firstResult.promise).mockResolvedValueOnce(ok(secondCancelled));
    const refetch = vi
      .fn()
      .mockResolvedValueOnce(project(4, { 'job-first': firstCancelled, 'job-second': secondQueued }))
      .mockResolvedValueOnce(project(5, { 'job-first': firstCancelled, 'job-second': secondCancelled }));
    const { result } = renderHook(() =>
      useStudioJobs({
        project: project(3, { 'job-first': firstQueued, 'job-second': secondQueued }),
        refetch,
      })
    );

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.cancelJob('job-first');
      second = result.current.cancelJob('job-second');
    });
    await waitFor(() => expect(bridge.cancelJob.invoke).toHaveBeenCalledTimes(1));
    expect(result.current.mutationPending).toBe(true);

    act(() => firstResult.resolve(ok(firstCancelled)));
    await waitFor(() => expect(bridge.cancelJob.invoke).toHaveBeenCalledTimes(2));
    expect(bridge.cancelJob.invoke.mock.calls[1]?.[0]).toEqual({
      projectId: 'project-1',
      jobId: 'job-second',
      expectedRevision: 4,
    });

    await act(async () => {
      expect(await first).toBe(true);
      expect(await second).toBe(true);
    });
    expect(result.current.project?.revision).toBe(5);
    expect(result.current.mutationPending).toBe(false);
  });

  it('deduplicates an in-flight paid submission before React publishes the pending state', async () => {
    const submission = deferred<StudioCommandResult<StudioRendererJob[]>>();
    bridge.submitScenes.invoke.mockReturnValueOnce(submission.promise);
    const refetch = vi.fn(async () => project(3));
    const { result } = renderHook(() => useStudioJobs({ project: project(), refetch }));
    const input = {
      mode: 'single' as const,
      sceneIds: ['scene-1'],
      routes: [route],
      catalogVersion: 'catalog-1',
      expectedRevision: 2,
    };

    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      first = result.current.submitScenes(input);
      duplicate = result.current.submitScenes(input);
    });

    await expect(duplicate).resolves.toBe(false);
    expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      submission.resolve(ok([job('job-1')]));
      expect(await first).toBe(true);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not let an old project completion clear the new project submission lock', async () => {
    const oldSubmission = deferred<StudioCommandResult<StudioRendererJob[]>>();
    const newSubmission = deferred<StudioCommandResult<StudioRendererJob[]>>();
    bridge.submitScenes.invoke.mockReturnValueOnce(oldSubmission.promise).mockReturnValueOnce(newSubmission.promise);
    const nextProject = project(2, {}, { id: 'project-2' });
    const refetch = vi.fn(async () => project(3, {}, { id: 'project-2' }));
    const { result, rerender } = renderHook(({ value }) => useStudioJobs({ project: value, refetch }), {
      initialProps: { value: project() },
    });
    const input = {
      mode: 'single' as const,
      sceneIds: ['scene-1'],
      routes: [route],
      catalogVersion: 'catalog-1',
      expectedRevision: 2,
    };

    let oldPending!: Promise<boolean>;
    act(() => {
      oldPending = result.current.submitScenes(input);
    });
    await waitFor(() => expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(1));

    rerender({ value: nextProject });
    let newPending!: Promise<boolean>;
    act(() => {
      newPending = result.current.submitScenes(input);
    });
    await waitFor(() => expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(2));

    await act(async () => {
      oldSubmission.resolve(ok([job('job-old')]));
      expect(await oldPending).toBe(false);
    });
    await expect(result.current.submitScenes(input)).resolves.toBe(false);
    expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(2);

    await act(async () => {
      newSubmission.resolve(ok([job('job-new', { projectId: 'project-2' })]));
      expect(await newPending).toBe(true);
    });
  });

  it('refuses a paid intent when the canonical revision changed after review without invoking IPC', async () => {
    const refetch = vi.fn(async () => project(3));
    const { result } = renderHook(() => useStudioJobs({ project: project(3), refetch }));

    await act(async () => {
      expect(
        await result.current.submitScenes({
          mode: 'single',
          sceneIds: ['scene-1'],
          routes: [route],
          catalogVersion: 'catalog-1',
          expectedRevision: 2,
        })
      ).toBe(false);
    });

    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
    expect(result.current.issue).toEqual({
      operation: 'submit_scenes',
      code: 'stale_project',
      messageKey: 'conversation.creativeStudio.errors.staleProject',
    });
    expect(result.current.staleIntent).toMatchObject({
      operation: 'submit_scenes',
      expectedRevision: 2,
    });
  });

  it('refetches a stale submit and preserves its sanitized review intent without replaying it', async () => {
    const refetch = vi.fn(async () => project(8));
    bridge.submitScenes.invoke.mockResolvedValueOnce(
      failed('stale_project', 'conversation.creativeStudio.errors.staleProject')
    );
    const { result } = renderHook(() => useStudioJobs({ project: project(), refetch }));

    await act(async () => {
      expect(
        await result.current.submitScenes({
          mode: 'batch',
          sceneIds: ['scene-1'],
          routes: [route],
          catalogVersion: 'catalog-1',
          expectedRevision: 2,
        })
      ).toBe(false);
    });

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(result.current.project?.revision).toBe(8);
    expect(result.current.staleIntent).toEqual({
      operation: 'submit_scenes',
      mode: 'batch',
      sceneIds: ['scene-1'],
      routes: [route],
      catalogVersion: 'catalog-1',
      expectedRevision: 2,
    });
    expect(result.current.issue).toEqual({
      operation: 'submit_scenes',
      code: 'stale_project',
      messageKey: 'conversation.creativeStudio.errors.staleProject',
    });
    expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(1);

    act(() => result.current.clearStaleIntent());
    expect(result.current.staleIntent).toBeNull();
  });

  it('performs a normal confirmed-failure retry without a duplicate-charge acknowledgement', async () => {
    const failedJob = job('job-failed', {
      status: 'failed',
      error: {
        code: 'provider_unavailable',
        messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
      },
    });
    const retry = job('job-retry', {
      status: 'queued_local',
      retryOfJobId: 'job-failed',
      retryReason: 'provider_failure',
    });
    const refetch = vi.fn(async () => project(5, { 'job-failed': failedJob, 'job-retry': retry }));
    bridge.retryJob.invoke.mockResolvedValueOnce(ok(retry));
    const { result } = renderHook(() => useStudioJobs({ project: project(4, { 'job-failed': failedJob }), refetch }));

    await act(async () => {
      expect(await result.current.retryJob('job-failed')).toBe(true);
    });

    expect(bridge.retryJob.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      jobId: 'job-failed',
      expectedRevision: 4,
    });
    expect(result.current.jobs.map(({ id }) => id)).toEqual(['job-failed', 'job-retry']);
  });

  it('requires an explicit second acknowledgement before retrying an unknown submission', async () => {
    const unknown = job('job-unknown', {
      status: 'needs_attention',
      error: {
        code: 'submission_unknown',
        messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
      },
    });
    const retry = job('job-retry', {
      retryOfJobId: 'job-unknown',
      retryReason: 'submission_unknown',
      duplicateChargeAcknowledged: true,
      duplicateChargeAcknowledgedAt: '2026-07-30T00:01:00.000Z',
    });
    const refetch = vi.fn(async () => project(5, { 'job-unknown': unknown, 'job-retry': retry }));
    bridge.retryJob.invoke.mockResolvedValueOnce(ok(retry));
    const { result } = renderHook(() => useStudioJobs({ project: project(4, { 'job-unknown': unknown }), refetch }));

    await act(async () => {
      expect(await result.current.retryJob('job-unknown')).toBe(false);
    });
    expect(bridge.retryJob.invoke).not.toHaveBeenCalled();
    expect(result.current.issue).toEqual({
      operation: 'retry_job',
      jobId: 'job-unknown',
      code: 'duplicate_charge_acknowledgement_required',
      messageKey: 'conversation.creativeStudio.errors.duplicateChargeAcknowledgementRequired',
    });

    await act(async () => {
      expect(await result.current.retryJob('job-unknown', true)).toBe(true);
    });
    expect(bridge.retryJob.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      jobId: 'job-unknown',
      expectedRevision: 4,
      acknowledgePossibleDuplicateCharge: true,
    });
  });

  it('routes download failures only through retryDownload', async () => {
    const downloadFailed = job('job-download', {
      status: 'failed',
      canRetryDownload: true,
      error: {
        code: 'download_failed',
        messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
      },
    });
    const retrying = job('job-download', { status: 'running' });
    const refetch = vi.fn(async () => project(7, { 'job-download': retrying }));
    bridge.retryDownload.invoke.mockResolvedValueOnce(ok(retrying));
    const { result } = renderHook(() =>
      useStudioJobs({ project: project(6, { 'job-download': downloadFailed }), refetch })
    );

    await act(async () => {
      expect(await result.current.retryJob('job-download')).toBe(false);
      expect(await result.current.retryDownload('job-download')).toBe(true);
    });

    expect(bridge.retryJob.invoke).not.toHaveBeenCalled();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
    expect(bridge.retryDownload.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      jobId: 'job-download',
      expectedRevision: 6,
    });
  });

  it('does not invoke a download retry when the sanitized job says recovery is impossible', async () => {
    const downloadFailed = job('job-download', {
      status: 'failed',
      canRetryDownload: false,
      error: {
        code: 'download_failed',
        messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
      },
    });
    const { result } = renderHook(() =>
      useStudioJobs({
        project: project(6, { 'job-download': downloadFailed }),
        refetch: vi.fn(async () => project(6, { 'job-download': downloadFailed })),
      })
    );

    await act(async () => {
      expect(await result.current.retryDownload('job-download')).toBe(false);
    });

    expect(bridge.retryDownload.invoke).not.toHaveBeenCalled();
    expect(result.current.issue).toEqual({
      operation: 'retry_download',
      jobId: 'job-download',
      code: 'invalid_payload',
      messageKey: 'conversation.creativeStudio.errors.invalidPayload',
    });
  });

  it('trusts main-derived canCancel instead of inferring authority from job status', async () => {
    const queued = job('job-queued', { status: 'queued_remote', canCancel: false });
    const running = job('job-running', { status: 'running', sceneId: 'scene-1', canCancel: true });
    const cancelled = job('job-running', { status: 'cancelled', canCancel: false });
    const afterCancel = project(4, { 'job-queued': queued, 'job-running': cancelled });
    bridge.cancelJob.invoke.mockResolvedValueOnce(ok(cancelled));
    const { result } = renderHook(() =>
      useStudioJobs({
        project: project(3, { 'job-queued': queued, 'job-running': running }),
        refetch: vi.fn(async () => afterCancel),
      })
    );

    await act(async () => {
      expect(await result.current.cancelJob('job-running')).toBe(true);
      expect(await result.current.cancelJob('job-queued')).toBe(false);
    });

    expect(bridge.cancelJob.invoke).toHaveBeenCalledTimes(1);
    expect(result.current.issue).toEqual({
      operation: 'cancel_job',
      jobId: 'job-queued',
      code: 'cancellation_refused',
      messageKey: 'conversation.creativeStudio.errors.cancellationRefused',
    });
  });

  it('filters foreign jobs and exposes only allowlisted job and command error fields', async () => {
    const unsafeLocal = {
      ...job('job-local'),
      providerJobId: 'provider-secret-task',
      remoteStartedAt: '2026-07-30T00:00:00.000Z',
      cancellationPolicy: 'queued_and_running',
      rawProviderMessage: 'API key sk-secret',
      error: {
        code: 'poll_deadline',
        messageKey: 'Provider leaked credential sk-secret',
        rawMessage: 'credential-bearing provider response',
      },
    } as StudioRendererJob;
    const foreign = job('job-foreign', { projectId: 'project-other' });
    const refetch = vi.fn(async () => project());
    bridge.cancelJob.invoke.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'cancellation_refused',
        messageKey: 'Provider leaked credential sk-secret',
        rawProviderMessage: 'credential-bearing provider response',
      },
    });
    const { result } = renderHook(() =>
      useStudioJobs({
        project: project(3, { 'job-local': unsafeLocal, 'job-foreign': foreign }),
        refetch,
      })
    );

    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0]).toEqual(
      expect.objectContaining({
        id: 'job-local',
        canRetryDownload: false,
        canCancel: true,
        error: {
          code: 'poll_deadline',
          messageKey: 'conversation.creativeStudio.jobs.errors.pollDeadline',
        },
      })
    );
    expect(result.current.jobs[0]).not.toHaveProperty('providerJobId');
    expect(result.current.jobs[0]).not.toHaveProperty('remoteStartedAt');
    expect(result.current.jobs[0]).not.toHaveProperty('cancellationPolicy');
    expect(result.current.jobs[0]).not.toHaveProperty('rawProviderMessage');
    expect(result.current.jobs[0]?.error).not.toHaveProperty('rawMessage');

    await act(async () => {
      expect(await result.current.cancelJob('job-foreign')).toBe(false);
      expect(await result.current.cancelJob('job-local')).toBe(false);
    });
    expect(bridge.cancelJob.invoke).toHaveBeenCalledTimes(1);
    expect(result.current.issue).toEqual({
      operation: 'cancel_job',
      jobId: 'job-local',
      code: 'cancellation_refused',
      messageKey: 'conversation.creativeStudio.errors.cancellationRefused',
    });
    expect(result.current.issue).not.toHaveProperty('rawProviderMessage');
  });

  it('preserves a safe job identity when a non-submit mutation becomes stale', async () => {
    const failedJob = job('job-failed', {
      status: 'failed',
      error: {
        code: 'timeout',
        messageKey: 'conversation.creativeStudio.jobs.errors.timeout',
      },
    });
    bridge.retryJob.invoke.mockResolvedValueOnce(
      failed('stale_project', 'conversation.creativeStudio.errors.staleProject')
    );
    const refetch = vi.fn(async () => project(9, { 'job-failed': failedJob }));
    const { result } = renderHook(() => useStudioJobs({ project: project(4, { 'job-failed': failedJob }), refetch }));

    await act(async () => {
      expect(await result.current.retryJob('job-failed')).toBe(false);
    });

    expect(result.current.project?.revision).toBe(9);
    expect(result.current.staleIntent).toEqual({
      operation: 'retry_job',
      jobId: 'job-failed',
      acknowledgePossibleDuplicateCharge: false,
    });
    expect(bridge.retryJob.invoke).toHaveBeenCalledTimes(1);
  });

  it('maps thrown provider details to the localized storage error contract', async () => {
    const queued = job('job-queued');
    bridge.cancelJob.invoke.mockRejectedValueOnce(new Error('raw provider response with key sk-secret'));
    const { result } = renderHook(() =>
      useStudioJobs({
        project: project(3, { 'job-queued': queued }),
        refetch: vi.fn(async () => project(3, { 'job-queued': queued })),
      })
    );

    await act(async () => {
      expect(await result.current.cancelJob('job-queued')).toBe(false);
    });

    expect(result.current.issue).toEqual({
      operation: 'cancel_job',
      jobId: 'job-queued',
      code: 'storage_error',
      messageKey: 'conversation.creativeStudio.errors.storage',
    });
  });
});
