/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import type {
  StudioCommandResult,
  StudioRendererJobV2,
  StudioRendererProjectCommitResultV2,
  StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';

type MutableValueRef<Value> = { current: Value };

type StudioProjectCommitInvoke = (
  current: StudioRendererProjectV2
) => Promise<StudioCommandResult<StudioRendererProjectCommitResultV2>>;

type StudioJobRecoveryInvoke = (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererJobV2>>;

type StudioProjectCommandRunnersInput = {
  projectRef: MutableValueRef<StudioRendererProjectV2 | null>;
  workspacePendingRef: MutableValueRef<boolean>;
  setWorkspacePending: (pending: boolean) => void;
  setActionErrorMessageKey: (messageKey: string | null) => void;
  refetchProjectWorkspace: () => Promise<StudioRendererProjectV2 | null>;
};

export const useStudioProjectCommandRunners = ({
  projectRef,
  workspacePendingRef,
  setWorkspacePending,
  setActionErrorMessageKey,
  refetchProjectWorkspace,
}: StudioProjectCommandRunnersInput) => {
  const runWorkspaceCommitAtRevision = useCallback(
    async (
      expectedRevision: number,
      invoke: StudioProjectCommitInvoke,
      onCommitted?: () => void
    ): Promise<number | null> => {
      const current = projectRef.current;
      if (current === null || current.revision !== expectedRevision || workspacePendingRef.current) return null;
      workspacePendingRef.current = true;
      setWorkspacePending(true);
      setActionErrorMessageKey(null);
      try {
        const result = await invoke(current);
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return null;
        }
        onCommitted?.();
        const refreshed = await refetchProjectWorkspace();
        if (refreshed === null || refreshed.revision !== result.data.projectRevision) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return null;
        }
        projectRef.current = refreshed;
        if (projectRef.current?.revision !== result.data.projectRevision) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return null;
        }
        return result.data.projectRevision;
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        return null;
      } finally {
        workspacePendingRef.current = false;
        setWorkspacePending(false);
      }
    },
    [refetchProjectWorkspace, setActionErrorMessageKey]
  );

  const runWorkspaceCommit = useCallback(
    async (invoke: StudioProjectCommitInvoke, onCommitted?: () => void): Promise<boolean> => {
      const expectedRevision = projectRef.current?.revision;
      return (
        expectedRevision !== undefined &&
        (await runWorkspaceCommitAtRevision(expectedRevision, invoke, onCommitted)) !== null
      );
    },
    [runWorkspaceCommitAtRevision]
  );

  const runJobRecovery = useCallback(
    async (
      jobId: string,
      isAuthorized: (job: StudioRendererJobV2, project: StudioRendererProjectV2) => boolean,
      invoke: StudioJobRecoveryInvoke,
      options: { refreshBeforeInvoke?: boolean } = {}
    ): Promise<boolean> => {
      const authorizedJob = (authority: StudioRendererProjectV2): StudioRendererJobV2 | null => {
        if (!Object.hasOwn(authority.jobs, jobId)) return null;
        const candidate = authority.jobs[jobId];
        const ownerHasJob =
          candidate?.target.kind === 'shot'
            ? Object.hasOwn(authority.shots, candidate.target.shotId) &&
              authority.shots[candidate.target.shotId]?.jobIds.includes(candidate.id)
            : candidate?.target.kind === 'reference'
              ? Object.hasOwn(authority.references, candidate.target.referenceId) &&
                authority.references[candidate.target.referenceId]?.jobIds.includes(candidate.id)
              : false;
        return candidate?.id === jobId &&
          candidate.projectId === authority.id &&
          ownerHasJob &&
          isAuthorized(candidate, authority)
          ? candidate
          : null;
      };
      let current = projectRef.current;
      let job = current === null ? null : authorizedJob(current);
      if (current === null || job === null || workspacePendingRef.current) return false;
      workspacePendingRef.current = true;
      setWorkspacePending(true);
      setActionErrorMessageKey(null);
      try {
        if (options.refreshBeforeInvoke === true) {
          const refreshedAuthority = await refetchProjectWorkspace();
          if (
            refreshedAuthority === null ||
            refreshedAuthority.id !== current.id ||
            refreshedAuthority.revision < current.revision
          ) {
            setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
            return false;
          }
          projectRef.current = refreshedAuthority;
          const refreshedJob = authorizedJob(refreshedAuthority);
          if (refreshedJob === null) return false;
          current = refreshedAuthority;
          job = refreshedJob;
        }
        const result = await invoke(current);
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return false;
        }
        if (
          result.data.id !== job.id ||
          result.data.projectId !== current.id ||
          JSON.stringify(result.data.target) !== JSON.stringify(job.target)
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        const refreshed = await refetchProjectWorkspace();
        if (refreshed === null || refreshed.id !== current.id || refreshed.revision <= current.revision) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        const refreshedJob = Object.hasOwn(refreshed.jobs, job.id) ? refreshed.jobs[job.id] : undefined;
        if (
          refreshedJob === undefined ||
          refreshedJob.id !== result.data.id ||
          refreshedJob.projectId !== current.id ||
          JSON.stringify(refreshedJob.target) !== JSON.stringify(job.target)
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        projectRef.current = refreshed;
        if (projectRef.current?.id !== refreshed.id || projectRef.current.revision !== refreshed.revision) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        return true;
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        return false;
      } finally {
        workspacePendingRef.current = false;
        setWorkspacePending(false);
      }
    },
    [refetchProjectWorkspace, setActionErrorMessageKey]
  );

  return { runJobRecovery, runWorkspaceCommit, runWorkspaceCommitAtRevision };
};

type StudioWorkspaceExclusiveCommandInput = {
  workspacePendingRef: MutableValueRef<boolean>;
  setWorkspacePending: (pending: boolean) => void;
  setActionErrorMessageKey: (messageKey: string | null) => void;
};

export const useStudioWorkspaceExclusiveCommand = ({
  workspacePendingRef,
  setWorkspacePending,
  setActionErrorMessageKey,
}: StudioWorkspaceExclusiveCommandInput) =>
  useCallback(
    async <Result>(action: () => Promise<Result>): Promise<Result | null> => {
      if (workspacePendingRef.current) return null;
      workspacePendingRef.current = true;
      setWorkspacePending(true);
      setActionErrorMessageKey(null);
      try {
        return await action();
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        return null;
      } finally {
        workspacePendingRef.current = false;
        setWorkspacePending(false);
      }
    },
    [setActionErrorMessageKey]
  );
