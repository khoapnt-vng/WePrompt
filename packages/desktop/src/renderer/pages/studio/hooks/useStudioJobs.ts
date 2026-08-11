/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  StudioCommandErrorCode,
  StudioCommandResult,
  StudioJobErrorCode,
  StudioReferenceRequest,
  StudioRendererJob,
  StudioRendererProject,
  StudioSubmitScenesRequest,
} from '@/common/types/project/creativeStudioTypes';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const STORAGE_ERROR_MESSAGE_KEY = 'conversation.creativeStudio.errors.storage';

const COMMAND_MESSAGE_KEYS: Record<StudioCommandErrorCode, string> = {
  feature_disabled: 'conversation.creativeStudio.errors.featureDisabled',
  invalid_payload: 'conversation.creativeStudio.errors.invalidPayload',
  not_found: 'conversation.creativeStudio.errors.projectNotFound',
  storyboard_exists: 'conversation.creativeStudio.errors.storyboardExists',
  stale_project: 'conversation.creativeStudio.errors.staleProject',
  planning_unavailable: 'conversation.creativeStudio.errors.planningUnavailable',
  invalid_route: 'conversation.creativeStudio.errors.invalidRoute',
  cancellation_refused: 'conversation.creativeStudio.errors.cancellationRefused',
  duplicate_charge_acknowledgement_required:
    'conversation.creativeStudio.errors.duplicateChargeAcknowledgementRequired',
  unsupported: 'conversation.creativeStudio.jobs.errors.unsupported',
  busy: 'conversation.creativeStudio.errors.busy',
  ffmpeg_unavailable: 'conversation.creativeStudio.phase.review.render.errors.ffmpegUnavailable',
  render_failed: 'conversation.creativeStudio.phase.review.render.errors.failed',
  no_renderable_scenes: 'conversation.creativeStudio.phase.review.render.errors.noRenderableScenes',
  cancelled: 'conversation.creativeStudio.phase.review.render.errors.cancelled',
  provider_error: 'conversation.creativeStudio.errors.provider',
  storage_error: STORAGE_ERROR_MESSAGE_KEY,
};

const JOB_MESSAGE_KEYS: Record<StudioJobErrorCode, string> = {
  invalid_request: 'conversation.creativeStudio.jobs.errors.invalidRequest',
  auth: 'conversation.creativeStudio.jobs.errors.auth',
  quota: 'conversation.creativeStudio.jobs.errors.quota',
  rate_limited: 'conversation.creativeStudio.jobs.errors.rateLimited',
  provider_unavailable: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
  timeout: 'conversation.creativeStudio.jobs.errors.timeout',
  poll_deadline: 'conversation.creativeStudio.jobs.errors.pollDeadline',
  no_output: 'conversation.creativeStudio.jobs.errors.noOutput',
  submission_unknown: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
  download_failed: 'conversation.creativeStudio.jobs.errors.downloadFailed',
  unsupported: 'conversation.creativeStudio.jobs.errors.unsupported',
  unknown: 'conversation.creativeStudio.jobs.errors.unknown',
};

const COMMAND_ERROR_CODES = new Set<StudioCommandErrorCode>(
  Object.keys(COMMAND_MESSAGE_KEYS) as StudioCommandErrorCode[]
);
const JOB_ERROR_CODES = new Set<StudioJobErrorCode>(Object.keys(JOB_MESSAGE_KEYS) as StudioJobErrorCode[]);

export type StudioJobOperation = 'refresh' | 'submit_scenes' | 'cancel_job' | 'retry_job' | 'retry_download';

export type StudioJobIssue = {
  operation: StudioJobOperation;
  code: StudioCommandErrorCode;
  messageKey: string;
  jobId?: string;
};

export type StudioSubmitIntent = Pick<
  StudioSubmitScenesRequest,
  'mode' | 'sceneIds' | 'routes' | 'catalogVersion' | 'expectedRevision' | 'outputRole' | 'referencePrompt'
>;

export type StudioStaleIntent =
  | ({ operation: 'submit_scenes' } & StudioSubmitIntent)
  | { operation: 'cancel_job'; jobId: string }
  | { operation: 'retry_job'; jobId: string; acknowledgePossibleDuplicateCharge: boolean }
  | { operation: 'retry_download'; jobId: string };

export type UseStudioJobsOptions = {
  project: StudioRendererProject | null;
  refetch: () => Promise<StudioRendererProject | null>;
  /** Close the initial snapshot-to-subscription handoff with one post-subscribe reconciliation. */
  reconcileOnSubscribe?: boolean;
};

export type UseStudioJobsResult = {
  project: StudioRendererProject | null;
  jobs: StudioRendererJob[];
  referenceRequests: StudioReferenceRequest[];
  mutationPending: boolean;
  issue: StudioJobIssue | null;
  staleIntent: StudioStaleIntent | null;
  clearIssue: () => void;
  clearStaleIntent: () => void;
  submitScenes: (input: StudioSubmitIntent) => Promise<boolean>;
  cancelJob: (jobId: string) => Promise<boolean>;
  retryJob: (jobId: string, acknowledgePossibleDuplicateCharge?: boolean) => Promise<boolean>;
  retryDownload: (jobId: string) => Promise<boolean>;
  dismissReferenceRequests: (requestIds: string[]) => Promise<boolean>;
};

type StudioMutationIntent = StudioStaleIntent;

type QueuedStudioMutation = {
  projectId: string;
  session: number;
  intent: StudioMutationIntent;
};

type StudioMutationResult = StudioCommandResult<StudioRendererJob | StudioRendererJob[]>;

const isCommandErrorCode = (value: unknown): value is StudioCommandErrorCode =>
  typeof value === 'string' && COMMAND_ERROR_CODES.has(value as StudioCommandErrorCode);

const isJobErrorCode = (value: unknown): value is StudioJobErrorCode =>
  typeof value === 'string' && JOB_ERROR_CODES.has(value as StudioJobErrorCode);

const safeMessageKey = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.startsWith('conversation.creativeStudio.') ? value : fallback;

const sanitizeJob = (candidate: StudioRendererJob): StudioRendererJob => {
  const errorCode = candidate.error !== null && isJobErrorCode(candidate.error.code) ? candidate.error.code : 'unknown';
  const sanitized: StudioRendererJob = {
    id: candidate.id,
    projectId: candidate.projectId,
    sceneId: candidate.sceneId,
    status: candidate.status,
    provider: {
      choiceId: candidate.provider.choiceId,
      providerId: candidate.provider.providerId,
      model: candidate.provider.model,
    },
    outputAssetIds: [...candidate.outputAssetIds],
    canRetryDownload: candidate.canRetryDownload === true,
    canCancel: candidate.canCancel === true,
    error:
      candidate.error === null
        ? null
        : {
            code: errorCode,
            messageKey: safeMessageKey(candidate.error.messageKey, JOB_MESSAGE_KEYS[errorCode]),
          },
    retryOfJobId: candidate.retryOfJobId,
    retryReason: candidate.retryReason,
    duplicateChargeAcknowledged: candidate.duplicateChargeAcknowledged,
    duplicateChargeAcknowledgedAt: candidate.duplicateChargeAcknowledgedAt,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
  if (candidate.progress !== undefined) sanitized.progress = candidate.progress;
  return sanitized;
};

const sanitizeProject = (candidate: StudioRendererProject): StudioRendererProject => {
  const jobs = Object.fromEntries(
    Object.entries(candidate.jobs).flatMap(([jobId, candidateJob]) =>
      candidateJob.id === jobId && candidateJob.projectId === candidate.id
        ? ([[jobId, sanitizeJob(candidateJob)]] satisfies [string, StudioRendererJob][])
        : []
    )
  );
  return { ...candidate, jobs };
};

const cloneSubmitIntent = (
  input: StudioSubmitIntent
): Extract<StudioMutationIntent, { operation: 'submit_scenes' }> => ({
  operation: 'submit_scenes',
  mode: input.mode,
  sceneIds: [...input.sceneIds],
  routes: input.routes.map((route) => ({ ...route })),
  catalogVersion: input.catalogVersion,
  expectedRevision: input.expectedRevision,
  ...(input.outputRole === undefined ? {} : { outputRole: input.outputRole }),
  ...(input.referencePrompt === undefined ? {} : { referencePrompt: input.referencePrompt }),
});

const toIssue = (
  operation: StudioJobOperation,
  error: { code?: unknown; messageKey?: unknown },
  jobId?: string
): StudioJobIssue => {
  const code = isCommandErrorCode(error.code) ? error.code : 'storage_error';
  return {
    operation,
    code,
    messageKey: safeMessageKey(error.messageKey, COMMAND_MESSAGE_KEYS[code]),
    ...(jobId === undefined ? {} : { jobId }),
  };
};

const localIssue = (operation: StudioJobOperation, code: StudioCommandErrorCode, jobId?: string): StudioJobIssue => ({
  operation,
  code,
  messageKey: COMMAND_MESSAGE_KEYS[code],
  ...(jobId === undefined ? {} : { jobId }),
});

const mutationOperation = (intent: StudioMutationIntent): StudioJobOperation => intent.operation;

const mutationJobId = (intent: StudioMutationIntent): string | undefined =>
  intent.operation === 'submit_scenes' ? undefined : intent.jobId;

const mutationKey = (intent: StudioMutationIntent): string =>
  intent.operation === 'submit_scenes' ? 'submit_scenes' : `job:${intent.jobId}`;

const validSubmitIntent = (
  current: StudioRendererProject,
  intent: Extract<StudioMutationIntent, { operation: 'submit_scenes' }>
): boolean => {
  if (!Number.isSafeInteger(intent.expectedRevision) || intent.expectedRevision < 1) return false;
  if (intent.mode !== 'single' && intent.mode !== 'batch') return false;
  if (intent.sceneIds.length === 0 || new Set(intent.sceneIds).size !== intent.sceneIds.length) return false;
  if (intent.routes.length !== intent.sceneIds.length) return false;
  const selectedSceneIds = new Set(intent.sceneIds);
  const routeSceneIds = new Set(intent.routes.map(({ sceneId }) => sceneId));
  return (
    routeSceneIds.size === intent.routes.length &&
    intent.sceneIds.every((sceneId) => Object.hasOwn(current.scenes, sceneId) && routeSceneIds.has(sceneId)) &&
    intent.routes.every(({ sceneId }) => selectedSceneIds.has(sceneId))
  );
};

/**
 * Owns renderer-side Studio job synchronization and bounded user commands.
 *
 * Durable execution remains in the main process. This hook subscribes only to
 * invalidation events, then adopts matching canonical project snapshots.
 */
export const useStudioJobs = ({
  project: parentProject,
  refetch,
  reconcileOnSubscribe = false,
}: UseStudioJobsOptions): UseStudioJobsResult => {
  const [project, setProject] = useState<StudioRendererProject | null>(() =>
    parentProject === null ? null : sanitizeProject(parentProject)
  );
  const [mutationCount, setMutationCount] = useState(0);
  const [issue, setIssue] = useState<StudioJobIssue | null>(null);
  const [staleIntent, setStaleIntent] = useState<StudioStaleIntent | null>(null);
  const [referenceRequests, setReferenceRequests] = useState<StudioReferenceRequest[]>([]);

  const mountedRef = useRef(true);
  const projectRef = useRef<StudioRendererProject | null>(project);
  const refetchRef = useRef(refetch);
  const projectSessionRef = useRef(0);
  const refetchEpochRef = useRef(0);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingMutationKeysRef = useRef(new Map<string, symbol>());
  const referenceRequestEpochRef = useRef(0);

  refetchRef.current = refetch;

  const publishIssue = useCallback((nextIssue: StudioJobIssue) => {
    if (mountedRef.current) setIssue(nextIssue);
  }, []);

  const adoptCanonical = useCallback(
    (
      candidate: StudioRendererProject,
      expectedProjectId: string,
      expectedSession: number
    ): StudioRendererProject | null => {
      if (
        !mountedRef.current ||
        projectSessionRef.current !== expectedSession ||
        candidate.id !== expectedProjectId ||
        projectRef.current?.id !== expectedProjectId
      ) {
        return null;
      }

      const current = projectRef.current;
      if (current.revision >= candidate.revision) return current;
      const sanitized = sanitizeProject(candidate);
      projectRef.current = sanitized;
      setProject(sanitized);
      return sanitized;
    },
    []
  );

  const refetchCanonical = useCallback(
    async (expectedProjectId: string, expectedSession: number): Promise<StudioRendererProject | null> => {
      const epoch = refetchEpochRef.current;
      const candidate = await refetchRef.current();
      if (
        !mountedRef.current ||
        refetchEpochRef.current !== epoch ||
        projectSessionRef.current !== expectedSession ||
        projectRef.current?.id !== expectedProjectId ||
        candidate === null ||
        candidate.id !== expectedProjectId
      ) {
        return null;
      }
      return adoptCanonical(candidate, expectedProjectId, expectedSession);
    },
    [adoptCanonical]
  );

  const beginProjectSession = useCallback((candidate: StudioRendererProject | null) => {
    projectSessionRef.current += 1;
    refetchEpochRef.current += 1;
    mutationQueueRef.current = Promise.resolve();
    pendingMutationKeysRef.current.clear();
    referenceRequestEpochRef.current += 1;
    projectRef.current = candidate;
    if (mountedRef.current) {
      setProject(candidate);
      setMutationCount(0);
      setIssue(null);
      setStaleIntent(null);
      setReferenceRequests([]);
    }
  }, []);

  useLayoutEffect(() => {
    const candidate = parentProject === null ? null : sanitizeProject(parentProject);
    const current = projectRef.current;
    if (candidate === null) {
      if (current !== null) beginProjectSession(null);
      return;
    }
    if (current === null || current.id !== candidate.id) {
      beginProjectSession(candidate);
      return;
    }
    if (candidate.revision > current.revision) {
      projectRef.current = candidate;
      setProject(candidate);
    }
  }, [beginProjectSession, parentProject]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      projectSessionRef.current += 1;
      refetchEpochRef.current += 1;
      pendingMutationKeysRef.current.clear();
      referenceRequestEpochRef.current += 1;
    };
  }, []);

  const activeProjectId = parentProject?.id;
  useEffect(() => {
    if (activeProjectId === undefined) return;
    const session = projectSessionRef.current;
    const loadReferenceRequests = async (): Promise<void> => {
      const epoch = ++referenceRequestEpochRef.current;
      try {
        const result = await ipcBridge.creativeStudio.listPendingReferenceRequests.invoke({
          projectId: activeProjectId,
        });
        if (
          !mountedRef.current ||
          projectSessionRef.current !== session ||
          projectRef.current?.id !== activeProjectId ||
          referenceRequestEpochRef.current !== epoch
        ) {
          return;
        }
        if (result.ok === false) {
          publishIssue(toIssue('refresh', result.error));
          return;
        }
        setReferenceRequests(result.data);
      } catch {
        if (
          mountedRef.current &&
          projectSessionRef.current === session &&
          projectRef.current?.id === activeProjectId &&
          referenceRequestEpochRef.current === epoch
        ) {
          publishIssue(localIssue('refresh', 'storage_error'));
        }
      }
    };
    const reconcile = (): void => {
      void refetchCanonical(activeProjectId, session).catch(() => {
        if (mountedRef.current && projectSessionRef.current === session && projectRef.current?.id === activeProjectId) {
          publishIssue(localIssue('refresh', 'storage_error'));
        }
      });
    };
    const unsubscribe = ipcBridge.creativeStudio.projectUpdated.on(({ projectId: updatedProjectId }) => {
      if (
        !mountedRef.current ||
        updatedProjectId !== activeProjectId ||
        projectSessionRef.current !== session ||
        projectRef.current?.id !== activeProjectId
      ) {
        return;
      }
      reconcile();
    });
    const unsubscribeReferenceRequests = ipcBridge.creativeStudio.proposalUpdated.on(
      ({ projectId: updatedProjectId }) => {
        if (updatedProjectId === activeProjectId) void loadReferenceRequests();
      }
    );
    void loadReferenceRequests();
    if (reconcileOnSubscribe) reconcile();
    return () => {
      unsubscribe();
      unsubscribeReferenceRequests();
    };
  }, [activeProjectId, publishIssue, reconcileOnSubscribe, refetchCanonical]);

  const invokeMutation = useCallback(
    (current: StudioRendererProject, intent: StudioMutationIntent): Promise<StudioMutationResult> => {
      switch (intent.operation) {
        case 'submit_scenes':
          return ipcBridge.creativeStudio.submitScenes.invoke({
            projectId: current.id,
            mode: intent.mode,
            sceneIds: [...intent.sceneIds],
            expectedRevision: intent.expectedRevision,
            routes: intent.routes.map((route) => ({ ...route })),
            catalogVersion: intent.catalogVersion,
            ...(intent.outputRole === undefined ? {} : { outputRole: intent.outputRole }),
            ...(intent.referencePrompt === undefined ? {} : { referencePrompt: intent.referencePrompt }),
          });
        case 'cancel_job':
          return ipcBridge.creativeStudio.cancelJob.invoke({
            projectId: current.id,
            jobId: intent.jobId,
            expectedRevision: current.revision,
          });
        case 'retry_job': {
          const request = {
            projectId: current.id,
            jobId: intent.jobId,
            expectedRevision: current.revision,
          };
          return intent.acknowledgePossibleDuplicateCharge
            ? ipcBridge.creativeStudio.retryJob.invoke({
                ...request,
                acknowledgePossibleDuplicateCharge: true,
              })
            : ipcBridge.creativeStudio.retryJob.invoke(request);
        }
        case 'retry_download':
          return ipcBridge.creativeStudio.retryDownload.invoke({
            projectId: current.id,
            jobId: intent.jobId,
            expectedRevision: current.revision,
          });
      }
    },
    []
  );

  const executeMutation = useCallback(
    async ({ projectId, session, intent }: QueuedStudioMutation): Promise<boolean> => {
      const current = projectRef.current;
      if (
        !mountedRef.current ||
        current === null ||
        current.id !== projectId ||
        projectSessionRef.current !== session
      ) {
        return false;
      }

      const operation = mutationOperation(intent);
      const jobId = mutationJobId(intent);
      if (intent.operation === 'submit_scenes') {
        if (!validSubmitIntent(current, intent)) {
          publishIssue(localIssue(operation, 'invalid_payload'));
          return false;
        }
        if (current.revision !== intent.expectedRevision) {
          publishIssue(localIssue(operation, 'stale_project'));
          if (mountedRef.current) setStaleIntent(intent);
          try {
            await refetchCanonical(projectId, session);
          } catch {
            // The reviewed intent stays paused even when refresh is temporarily unavailable.
          }
          return false;
        }
      } else {
        const currentJob = current.jobs[intent.jobId];
        if (currentJob === undefined || currentJob.projectId !== current.id) {
          publishIssue(localIssue(operation, 'invalid_payload', intent.jobId));
          return false;
        }
        if (intent.operation === 'cancel_job' && currentJob.canCancel !== true) {
          publishIssue(localIssue(operation, 'cancellation_refused', intent.jobId));
          return false;
        }
        if (intent.operation === 'retry_job') {
          if (
            (currentJob.status !== 'failed' && currentJob.status !== 'needs_attention') ||
            currentJob.error?.code === 'download_failed'
          ) {
            publishIssue(localIssue(operation, 'invalid_payload', intent.jobId));
            return false;
          }
          if (currentJob.error?.code === 'submission_unknown' && intent.acknowledgePossibleDuplicateCharge !== true) {
            publishIssue(localIssue(operation, 'duplicate_charge_acknowledgement_required', intent.jobId));
            return false;
          }
        }
        if (
          intent.operation === 'retry_download' &&
          (currentJob.status !== 'failed' ||
            currentJob.error?.code !== 'download_failed' ||
            !currentJob.canRetryDownload)
        ) {
          publishIssue(localIssue(operation, 'invalid_payload', intent.jobId));
          return false;
        }
      }

      if (mountedRef.current) setIssue(null);
      try {
        const result = await invokeMutation(current, intent);
        if (!mountedRef.current || projectSessionRef.current !== session || projectRef.current?.id !== projectId) {
          return false;
        }

        if (result.ok === false) {
          const nextIssue = toIssue(operation, result.error, jobId);
          publishIssue(nextIssue);
          if (nextIssue.code !== 'stale_project') return false;

          if (mountedRef.current) setStaleIntent(intent);
          try {
            await refetchCanonical(projectId, session);
          } catch {
            // Preserve the explicit stale intent even when canonical refresh is temporarily unavailable.
          }
          return false;
        }

        const returnedJobs = Array.isArray(result.data) ? result.data : [result.data];
        const responseMatchesProject = returnedJobs.every((returnedJob) => returnedJob.projectId === projectId);
        try {
          await refetchCanonical(projectId, session);
        } catch {
          if (mountedRef.current && projectSessionRef.current === session) {
            publishIssue(localIssue(operation, 'storage_error', jobId));
          }
          return responseMatchesProject;
        }
        if (!responseMatchesProject) {
          publishIssue(localIssue(operation, 'storage_error', jobId));
          return false;
        }
        if (mountedRef.current && projectSessionRef.current === session) {
          setIssue(null);
          setStaleIntent(null);
        }
        return true;
      } catch {
        if (mountedRef.current && projectSessionRef.current === session && projectRef.current?.id === projectId) {
          publishIssue(localIssue(operation, 'storage_error', jobId));
        }
        return false;
      }
    },
    [invokeMutation, publishIssue, refetchCanonical]
  );

  const enqueueMutation = useCallback(
    (intent: StudioMutationIntent): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || !mountedRef.current) return Promise.resolve(false);
      const key = mutationKey(intent);
      if (pendingMutationKeysRef.current.has(key)) return Promise.resolve(false);
      const token = Symbol(key);
      pendingMutationKeysRef.current.set(key, token);
      const queued: QueuedStudioMutation = {
        projectId: current.id,
        session: projectSessionRef.current,
        intent,
      };
      if (mountedRef.current) setMutationCount((count) => count + 1);

      const execution = mutationQueueRef.current.catch((): void => {}).then(() => executeMutation(queued));
      mutationQueueRef.current = execution.then(
        (): void => {},
        (): void => {}
      );
      return execution.finally(() => {
        if (pendingMutationKeysRef.current.get(key) === token) {
          pendingMutationKeysRef.current.delete(key);
        }
        if (mountedRef.current && projectSessionRef.current === queued.session) {
          setMutationCount((count) => Math.max(0, count - 1));
        }
      });
    },
    [executeMutation]
  );

  const submitScenes = useCallback(
    (input: StudioSubmitIntent): Promise<boolean> => enqueueMutation(cloneSubmitIntent(input)),
    [enqueueMutation]
  );

  const cancelJob = useCallback(
    (jobId: string): Promise<boolean> => enqueueMutation({ operation: 'cancel_job', jobId }),
    [enqueueMutation]
  );

  const retryJob = useCallback(
    (jobId: string, acknowledgePossibleDuplicateCharge = false): Promise<boolean> =>
      enqueueMutation({
        operation: 'retry_job',
        jobId,
        acknowledgePossibleDuplicateCharge,
      }),
    [enqueueMutation]
  );

  const retryDownload = useCallback(
    (jobId: string): Promise<boolean> => enqueueMutation({ operation: 'retry_download', jobId }),
    [enqueueMutation]
  );

  const dismissReferenceRequests = useCallback(
    async (requestIds: string[]): Promise<boolean> => {
      referenceRequestEpochRef.current += 1;
      const current = projectRef.current;
      if (current === null || requestIds.length === 0 || !mountedRef.current) return false;
      const session = projectSessionRef.current;
      setMutationCount((count) => count + 1);
      try {
        const result = await ipcBridge.creativeStudio.dismissReferenceRequests.invoke({
          projectId: current.id,
          requestIds: [...requestIds],
        });
        if (!mountedRef.current || projectSessionRef.current !== session || projectRef.current?.id !== current.id) {
          return false;
        }
        if (result.ok === false) {
          publishIssue(toIssue('refresh', result.error));
          return false;
        }
        const dismissedIds = new Set(requestIds);
        setReferenceRequests((requests) => requests.filter((request) => !dismissedIds.has(request.id)));
        return true;
      } catch {
        if (mountedRef.current && projectSessionRef.current === session && projectRef.current?.id === current.id) {
          publishIssue(localIssue('refresh', 'storage_error'));
        }
        return false;
      } finally {
        if (mountedRef.current && projectSessionRef.current === session) {
          setMutationCount((count) => Math.max(0, count - 1));
        }
      }
    },
    [publishIssue]
  );

  const clearIssue = useCallback(() => setIssue(null), []);
  const clearStaleIntent = useCallback(() => setStaleIntent(null), []);
  const jobs = useMemo(() => (project === null ? [] : Object.values(project.jobs)), [project]);

  return {
    project,
    jobs,
    referenceRequests,
    mutationPending: mutationCount > 0,
    issue,
    staleIntent,
    clearIssue,
    clearStaleIntent,
    submitScenes,
    cancelJob,
    retryJob,
    retryDownload,
    dismissReferenceRequests,
  };
};
