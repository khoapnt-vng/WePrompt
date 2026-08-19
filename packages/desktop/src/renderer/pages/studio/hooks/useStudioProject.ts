/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  StudioProposalV2,
  StudioProjectLoadResultV2,
  StudioReferenceRequestV2,
  StudioRendererProjectV2,
  StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import { useCallback, useEffect, useRef, useState } from 'react';

export type StudioProjectLoadState = 'idle' | 'loading' | 'supported' | 'unsupported' | 'not_found' | 'error';

export type UseStudioProjectResult = {
  project: StudioRendererProjectV2 | null;
  proposals: StudioProposalV2[];
  referenceRequests: StudioReferenceRequestV2[];
  referenceGenerationHandoffs: StudioRendererReferenceGenerationHandoffV2[];
  loadState: StudioProjectLoadState;
  errorMessageKey: string | null;
  proposalErrorMessageKey: string | null;
  referenceErrorMessageKey: string | null;
  refetchProject: () => Promise<StudioRendererProjectV2 | null>;
  refetchProposals: () => Promise<void>;
  refetchReferences: () => Promise<void>;
};

const openUniqueHandoffs = (
  handoffs: StudioRendererReferenceGenerationHandoffV2[]
): StudioRendererReferenceGenerationHandoffV2[] => {
  const unique = new Map<string, StudioRendererReferenceGenerationHandoffV2>();
  for (const handoff of handoffs) {
    if (handoff.status === 'open' && !unique.has(handoff.handoffId)) unique.set(handoff.handoffId, handoff);
  }
  return [...unique.values()].toSorted(
    (left, right) =>
      left.decidedAt.localeCompare(right.decidedAt) ||
      left.requestId.localeCompare(right.requestId) ||
      left.handoffId.localeCompare(right.handoffId)
  );
};

/** Owns the schema-2 renderer snapshots and subscribes before every initial list. */
export const useStudioProject = (projectId: string | undefined): UseStudioProjectResult => {
  const [project, setProject] = useState<StudioRendererProjectV2 | null>(null);
  const [proposals, setProposals] = useState<StudioProposalV2[]>([]);
  const [referenceRequests, setReferenceRequests] = useState<StudioReferenceRequestV2[]>([]);
  const [referenceGenerationHandoffs, setReferenceGenerationHandoffs] = useState<
    StudioRendererReferenceGenerationHandoffV2[]
  >([]);
  const [loadState, setLoadState] = useState<StudioProjectLoadState>(projectId ? 'loading' : 'idle');
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [proposalErrorMessageKey, setProposalErrorMessageKey] = useState<string | null>(null);
  const [referenceErrorMessageKey, setReferenceErrorMessageKey] = useState<string | null>(null);
  const generationRef = useRef(0);
  const projectRequestRef = useRef(0);
  const proposalRequestRef = useRef(0);
  const referenceRequestRef = useRef(0);
  const handoffRequestRef = useRef(0);
  const projectRef = useRef<StudioRendererProjectV2 | null>(null);

  const loadProject = useCallback(
    async (
      requestedProjectId: string,
      generation: number,
      initial: boolean
    ): Promise<StudioRendererProjectV2 | null> => {
      const request = ++projectRequestRef.current;
      if (initial) {
        projectRef.current = null;
        setProject(null);
        setLoadState('loading');
      }
      setErrorMessageKey(null);

      try {
        const result = await ipcBridge.creativeStudio.getProject.invoke({ projectId: requestedProjectId });
        if (generationRef.current !== generation || projectRequestRef.current !== request) return null;
        if (result.ok === false) {
          setLoadState('error');
          setErrorMessageKey(result.error.messageKey);
          return null;
        }

        const loaded = result.data as StudioProjectLoadResultV2;
        if (loaded.status === 'unsupported_prototype_schema') {
          projectRef.current = null;
          setProject(null);
          setLoadState('unsupported');
          return null;
        }
        if (loaded.status === 'not_found') {
          projectRef.current = null;
          setProject(null);
          setLoadState('not_found');
          return null;
        }

        const current = projectRef.current;
        const canonical =
          current?.id === loaded.project.id && current.revision > loaded.project.revision ? current : loaded.project;
        projectRef.current = canonical;
        setProject(canonical);
        setLoadState('supported');
        return canonical;
      } catch {
        if (generationRef.current === generation && projectRequestRef.current === request) {
          setLoadState('error');
          setErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        }
        return null;
      }
    },
    []
  );

  const loadProposals = useCallback(async (requestedProjectId: string, generation: number): Promise<void> => {
    const request = ++proposalRequestRef.current;
    try {
      const result = await ipcBridge.creativeStudio.listProposals.invoke({ projectId: requestedProjectId });
      if (generationRef.current !== generation || proposalRequestRef.current !== request) return;
      if (result.ok === false) {
        setProposalErrorMessageKey(result.error.messageKey);
        return;
      }
      setProposals((result.data as StudioProposalV2[]).filter((candidate) => candidate.status === 'pending'));
      setProposalErrorMessageKey(null);
    } catch {
      if (generationRef.current === generation && proposalRequestRef.current === request) {
        setProposalErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      }
    }
  }, []);

  const loadReferenceRequests = useCallback(async (requestedProjectId: string, generation: number): Promise<void> => {
    const request = ++referenceRequestRef.current;
    try {
      const result = await ipcBridge.creativeStudio.listReferenceRequests.invoke({ projectId: requestedProjectId });
      if (generationRef.current !== generation || referenceRequestRef.current !== request) return;
      if (result.ok === false) {
        setReferenceErrorMessageKey(result.error.messageKey);
        return;
      }
      setReferenceRequests(result.data as StudioReferenceRequestV2[]);
      setReferenceErrorMessageKey(null);
    } catch {
      if (generationRef.current === generation && referenceRequestRef.current === request) {
        setReferenceErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      }
    }
  }, []);

  const loadReferenceHandoffs = useCallback(async (requestedProjectId: string, generation: number): Promise<void> => {
    const request = ++handoffRequestRef.current;
    try {
      const result = await ipcBridge.creativeStudio.listReferenceGenerationHandoffs.invoke({
        projectId: requestedProjectId,
      });
      if (generationRef.current !== generation || handoffRequestRef.current !== request) return;
      if (result.ok === false) {
        setReferenceErrorMessageKey(result.error.messageKey);
        return;
      }
      setReferenceGenerationHandoffs(openUniqueHandoffs(result.data as StudioRendererReferenceGenerationHandoffV2[]));
      setReferenceErrorMessageKey(null);
    } catch {
      if (generationRef.current === generation && handoffRequestRef.current === request) {
        setReferenceErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      }
    }
  }, []);

  const loadReferences = useCallback(
    async (requestedProjectId: string, generation: number): Promise<void> => {
      await Promise.all([
        loadReferenceRequests(requestedProjectId, generation),
        loadReferenceHandoffs(requestedProjectId, generation),
      ]);
    },
    [loadReferenceHandoffs, loadReferenceRequests]
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    if (!projectId) {
      projectRef.current = null;
      setProject(null);
      setProposals([]);
      setReferenceRequests([]);
      setReferenceGenerationHandoffs([]);
      setLoadState('idle');
      setErrorMessageKey(null);
      setProposalErrorMessageKey(null);
      setReferenceErrorMessageKey(null);
      return;
    }

    setProposals([]);
    setReferenceRequests([]);
    setReferenceGenerationHandoffs([]);
    setProposalErrorMessageKey(null);
    setReferenceErrorMessageKey(null);

    const unsubscribeProject = ipcBridge.creativeStudio.projectUpdated.on(({ projectId: updatedProjectId }) => {
      if (updatedProjectId === projectId) void loadProject(projectId, generation, false);
    });
    const unsubscribeProposal = ipcBridge.creativeStudio.proposalUpdated.on(({ projectId: updatedProjectId }) => {
      if (updatedProjectId === projectId) void loadProposals(projectId, generation);
    });
    const unsubscribeReference = ipcBridge.creativeStudio.referenceUpdated.on(({ projectId: updatedProjectId }) => {
      if (updatedProjectId === projectId) void loadReferences(projectId, generation);
    });

    void loadProject(projectId, generation, true);
    void loadProposals(projectId, generation);
    void loadReferences(projectId, generation);

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      unsubscribeProject();
      unsubscribeProposal();
      unsubscribeReference();
    };
  }, [loadProject, loadProposals, loadReferences, projectId]);

  const refetchProject = useCallback(async (): Promise<StudioRendererProjectV2 | null> => {
    if (!projectId) return null;
    return loadProject(projectId, generationRef.current, false);
  }, [loadProject, projectId]);

  const refetchProposals = useCallback(async (): Promise<void> => {
    if (projectId) await loadProposals(projectId, generationRef.current);
  }, [loadProposals, projectId]);

  const refetchReferences = useCallback(async (): Promise<void> => {
    if (projectId) await loadReferences(projectId, generationRef.current);
  }, [loadReferences, projectId]);

  return {
    project,
    proposals,
    referenceRequests,
    referenceGenerationHandoffs,
    loadState,
    errorMessageKey,
    proposalErrorMessageKey,
    referenceErrorMessageKey,
    refetchProject,
    refetchProposals,
    refetchReferences,
  };
};
