/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { StudioProposal, StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { normaliseStudioProposalDiff } from '@/common/types/project/creativeStudioProposalDiff';
import { useCallback, useEffect, useRef, useState } from 'react';

export type UseStudioProjectResult = {
  project: StudioRendererProject | null;
  proposals: StudioProposal[];
  loading: boolean;
  notFound: boolean;
  errorMessageKey: string | null;
  proposalErrorMessageKey: string | null;
  refetch: () => Promise<StudioRendererProject | null>;
};

export type UseStudioProjectOptions = {
  /** Let a higher-level owner subscribe to project mutations when it coordinates job refreshes. */
  subscribeToUpdates?: boolean;
};

/** Resolves one durable Studio project and keeps it current through the native event stream. */
export const useStudioProject = (
  projectId: string | undefined,
  { subscribeToUpdates = true }: UseStudioProjectOptions = {}
): UseStudioProjectResult => {
  const [project, setProject] = useState<StudioRendererProject | null>(null);
  const [proposals, setProposals] = useState<StudioProposal[]>([]);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [notFound, setNotFound] = useState(false);
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [proposalErrorMessageKey, setProposalErrorMessageKey] = useState<string | null>(null);
  const [resolvedProjectId, setResolvedProjectId] = useState<string | undefined>();
  const generationRef = useRef(0);
  const latestRequestRef = useRef(0);
  const authoritativeAbsenceRequestRef = useRef(0);
  const authoritativePresenceRequestRef = useRef(0);
  const latestProposalRequestRef = useRef(0);
  const projectRef = useRef<StudioRendererProject | null>(null);

  const loadProject = useCallback(
    async (requestedProjectId: string, generation: number, initial: boolean): Promise<StudioRendererProject | null> => {
      const request = ++latestRequestRef.current;

      if (initial) {
        setLoading(true);
        projectRef.current = null;
        setProject(null);
        setNotFound(false);
        setResolvedProjectId(undefined);
      }
      setErrorMessageKey(null);

      try {
        const result = await ipcBridge.creativeStudio.getProject.invoke({ projectId: requestedProjectId });
        if (generationRef.current !== generation) return null;
        const latestRequest = latestRequestRef.current === request;

        if (result.ok === false) {
          if (latestRequest) setErrorMessageKey(result.error.messageKey);
          return null;
        }
        if (result.data === null) {
          if (request < authoritativeAbsenceRequestRef.current || request < authoritativePresenceRequestRef.current)
            return null;
          authoritativeAbsenceRequestRef.current = request;
          projectRef.current = null;
          setProject(null);
          setNotFound(true);
          setErrorMessageKey(null);
          return null;
        }
        if (request < authoritativeAbsenceRequestRef.current) return null;
        authoritativePresenceRequestRef.current = Math.max(authoritativePresenceRequestRef.current, request);

        const current = projectRef.current;
        const canonical =
          current?.id === result.data.id && current.revision > result.data.revision ? current : result.data;
        const advanced = current === null || current.id !== canonical.id || canonical.revision > current.revision;
        projectRef.current = canonical;
        setProject(canonical);
        setNotFound(false);
        if (advanced || latestRequest) setErrorMessageKey(null);
        return canonical;
      } catch {
        if (generationRef.current === generation && latestRequestRef.current === request) {
          setErrorMessageKey('conversation.creativeStudio.errors.storage');
        }
        return null;
      } finally {
        if (generationRef.current === generation && latestRequestRef.current === request) {
          setResolvedProjectId(requestedProjectId);
          setLoading(false);
        }
      }
    },
    []
  );

  const loadProposals = useCallback(async (requestedProjectId: string, generation: number): Promise<void> => {
    const request = ++latestProposalRequestRef.current;
    try {
      const result = await ipcBridge.creativeStudio.listProposals.invoke({ projectId: requestedProjectId });
      if (generationRef.current !== generation || latestProposalRequestRef.current !== request) return;
      if (result.ok === false) {
        setProposalErrorMessageKey(result.error.messageKey);
        return;
      }
      // A proposal recorded before main computed diffs carries none, so the field is optional on the wire.
      setProposals(result.data.map((proposal) => ({ ...proposal, diff: normaliseStudioProposalDiff(proposal.diff) })));
      setProposalErrorMessageKey(null);
    } catch {
      if (generationRef.current === generation && latestProposalRequestRef.current === request) {
        setProposalErrorMessageKey('conversation.creativeStudio.errors.storage');
      }
    }
  }, []);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    if (!projectId) {
      projectRef.current = null;
      setProject(null);
      setProposals([]);
      setLoading(false);
      setNotFound(false);
      setErrorMessageKey(null);
      setProposalErrorMessageKey(null);
      setResolvedProjectId(undefined);
      return;
    }

    setProposals([]);
    setProposalErrorMessageKey(null);

    const unsubscribe = subscribeToUpdates
      ? ipcBridge.creativeStudio.projectUpdated.on(({ projectId: updatedProjectId }) => {
          if (updatedProjectId === projectId) void loadProject(projectId, generation, false);
        })
      : () => {};
    const unsubscribeProposals = ipcBridge.creativeStudio.proposalUpdated.on(({ projectId: updatedProjectId }) => {
      if (updatedProjectId === projectId) void loadProposals(projectId, generation);
    });
    const unsubscribeTurnCompleted = ipcBridge.conversation.turnCompleted.on(({ session_id: conversationId }) => {
      if (projectRef.current?.briefConversationId === conversationId) {
        void loadProposals(projectId, generation);
      }
    });
    void loadProject(projectId, generation, true);
    void loadProposals(projectId, generation);

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      unsubscribe();
      unsubscribeProposals();
      unsubscribeTurnCompleted();
    };
  }, [loadProject, loadProposals, projectId, subscribeToUpdates]);

  const refetch = useCallback(async (): Promise<StudioRendererProject | null> => {
    if (!projectId) return null;
    const generation = generationRef.current;
    const [refetchedProject] = await Promise.all([
      loadProject(projectId, generation, false),
      loadProposals(projectId, generation),
    ]);
    return refetchedProject;
  }, [loadProject, loadProposals, projectId]);

  const resolvedForCurrentProject = resolvedProjectId === projectId;
  const currentProject = project?.id === projectId ? project : null;

  return {
    project: currentProject,
    proposals,
    loading: Boolean(projectId) && (loading || !resolvedForCurrentProject),
    notFound: resolvedForCurrentProject && notFound,
    errorMessageKey,
    proposalErrorMessageKey,
    refetch,
  };
};
