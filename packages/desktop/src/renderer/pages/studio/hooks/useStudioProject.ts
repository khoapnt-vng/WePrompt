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
  StudioRendererChainStatusV2,
  StudioRendererProjectV2,
  StudioRendererReferenceGenerationHandoffV2,
  StudioRendererWorkspaceStatusV2,
  StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import { useCallback, useEffect, useRef, useState } from 'react';

export type StudioProjectLoadState = 'idle' | 'loading' | 'supported' | 'unsupported' | 'not_found' | 'error';

export type UseStudioProjectResult = {
  project: StudioRendererProjectV2 | null;
  proposals: StudioProposalV2[];
  referenceRequests: StudioReferenceRequestV2[];
  referenceGenerationHandoffs: StudioRendererReferenceGenerationHandoffV2[];
  workspaceStatus: StudioRendererWorkspaceStatusV2 | null;
  chainStatus: StudioRendererChainStatusV2 | null;
  routeCatalog: StudioRouteCatalogV2 | null;
  loadState: StudioProjectLoadState;
  errorMessageKey: string | null;
  proposalErrorMessageKey: string | null;
  referenceErrorMessageKey: string | null;
  workspaceErrorMessageKey: string | null;
  routeErrorMessageKey: string | null;
  refetchProject: () => Promise<StudioRendererProjectV2 | null>;
  refetchProposals: () => Promise<void>;
  refetchReferences: () => Promise<void>;
  refetchWorkspace: () => Promise<void>;
  refetchRoutes: () => Promise<boolean>;
  refetchAll: () => Promise<void>;
};

const uniqueHandoffs = (
  handoffs: StudioRendererReferenceGenerationHandoffV2[]
): StudioRendererReferenceGenerationHandoffV2[] => {
  const unique = new Map<string, StudioRendererReferenceGenerationHandoffV2>();
  for (const handoff of handoffs) {
    const current = unique.get(handoff.handoffId);
    if (current === undefined || (current.status === 'open' && handoff.status !== 'open')) {
      unique.set(handoff.handoffId, handoff);
    }
  }
  return [...unique.values()].toSorted(
    (left, right) =>
      left.decidedAt.localeCompare(right.decidedAt) ||
      left.requestId.localeCompare(right.requestId) ||
      left.handoffId.localeCompare(right.handoffId)
  );
};

const routeRelevantSignature = (project: StudioRendererProjectV2): string =>
  JSON.stringify([project.imageRouteId, project.videoRouteId, project.aspectRatio, project.resolution]);

/** Owns the schema-2 renderer snapshots and subscribes before every initial list. */
export const useStudioProject = (projectId: string | undefined): UseStudioProjectResult => {
  const [project, setProject] = useState<StudioRendererProjectV2 | null>(null);
  const [proposals, setProposals] = useState<StudioProposalV2[]>([]);
  const [referenceRequests, setReferenceRequests] = useState<StudioReferenceRequestV2[]>([]);
  const [referenceGenerationHandoffs, setReferenceGenerationHandoffs] = useState<
    StudioRendererReferenceGenerationHandoffV2[]
  >([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<StudioRendererWorkspaceStatusV2 | null>(null);
  const [chainStatus, setChainStatus] = useState<StudioRendererChainStatusV2 | null>(null);
  const [routeCatalog, setRouteCatalog] = useState<StudioRouteCatalogV2 | null>(null);
  const [loadState, setLoadState] = useState<StudioProjectLoadState>(projectId ? 'loading' : 'idle');
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [proposalErrorMessageKey, setProposalErrorMessageKey] = useState<string | null>(null);
  const [referenceErrorMessageKey, setReferenceErrorMessageKey] = useState<string | null>(null);
  const [workspaceErrorMessageKey, setWorkspaceErrorMessageKey] = useState<string | null>(null);
  const [routeErrorMessageKey, setRouteErrorMessageKey] = useState<string | null>(null);
  const generationRef = useRef(0);
  const projectRequestRef = useRef(0);
  const proposalRequestRef = useRef(0);
  const referenceRequestRef = useRef(0);
  const handoffRequestRef = useRef(0);
  const referencePairRequestRef = useRef(0);
  const workspaceRequestRef = useRef(0);
  const chainRequestRef = useRef(0);
  const routeRequestRef = useRef(0);
  const projectRef = useRef<StudioRendererProjectV2 | null>(null);

  const loadProject = useCallback(
    async (
      requestedProjectId: string,
      generation: number,
      initial: boolean
    ): Promise<StudioRendererProjectV2 | null> => {
      const request = ++projectRequestRef.current;
      const invalidatePaidFreshness = (): void => {
        workspaceRequestRef.current += 1;
        chainRequestRef.current += 1;
        routeRequestRef.current += 1;
        setWorkspaceStatus(null);
        setChainStatus(null);
        setRouteCatalog(null);
      };
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
          invalidatePaidFreshness();
          setLoadState('error');
          setErrorMessageKey(result.error.messageKey);
          return null;
        }

        const loaded = result.data as StudioProjectLoadResultV2;
        if (loaded.status === 'unsupported_prototype_schema') {
          invalidatePaidFreshness();
          projectRef.current = null;
          setProject(null);
          setLoadState('unsupported');
          return null;
        }
        if (loaded.status === 'not_found') {
          invalidatePaidFreshness();
          projectRef.current = null;
          setProject(null);
          setLoadState('not_found');
          return null;
        }

        const current = projectRef.current;
        const canonical =
          current?.id === loaded.project.id && current.revision > loaded.project.revision ? current : loaded.project;
        if (current !== null && routeRelevantSignature(current) !== routeRelevantSignature(canonical)) {
          routeRequestRef.current += 1;
          setRouteCatalog(null);
          setRouteErrorMessageKey(null);
        }
        projectRef.current = canonical;
        setProject(canonical);
        setLoadState('supported');
        return canonical;
      } catch {
        if (generationRef.current === generation && projectRequestRef.current === request) {
          invalidatePaidFreshness();
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

  const loadReferenceRequests = useCallback(
    async (requestedProjectId: string, generation: number): Promise<string | null> => {
      const request = ++referenceRequestRef.current;
      try {
        const result = await ipcBridge.creativeStudio.listReferenceRequests.invoke({ projectId: requestedProjectId });
        if (generationRef.current !== generation || referenceRequestRef.current !== request) return null;
        if (result.ok === false) {
          return result.error.messageKey;
        }
        setReferenceRequests(result.data as StudioReferenceRequestV2[]);
        return null;
      } catch {
        if (generationRef.current === generation && referenceRequestRef.current === request) {
          return 'conversation.creativeStudio.workspace.errors.storage';
        }
        return null;
      }
    },
    []
  );

  const loadReferenceHandoffs = useCallback(
    async (requestedProjectId: string, generation: number): Promise<string | null> => {
      const request = ++handoffRequestRef.current;
      try {
        const result = await ipcBridge.creativeStudio.listReferenceGenerationHandoffs.invoke({
          projectId: requestedProjectId,
        });
        if (generationRef.current !== generation || handoffRequestRef.current !== request) return null;
        if (result.ok === false) {
          return result.error.messageKey;
        }
        setReferenceGenerationHandoffs(uniqueHandoffs(result.data as StudioRendererReferenceGenerationHandoffV2[]));
        return null;
      } catch {
        if (generationRef.current === generation && handoffRequestRef.current === request) {
          return 'conversation.creativeStudio.workspace.errors.storage';
        }
        return null;
      }
    },
    []
  );

  const loadReferences = useCallback(
    async (requestedProjectId: string, generation: number): Promise<void> => {
      const pairRequest = ++referencePairRequestRef.current;
      const [requestError, handoffError] = await Promise.all([
        loadReferenceRequests(requestedProjectId, generation),
        loadReferenceHandoffs(requestedProjectId, generation),
      ]);
      if (generationRef.current === generation && referencePairRequestRef.current === pairRequest) {
        setReferenceErrorMessageKey(requestError ?? handoffError);
      }
    },
    [loadReferenceHandoffs, loadReferenceRequests]
  );

  const loadWorkspace = useCallback(async (requestedProjectId: string, generation: number): Promise<void> => {
    const workspaceRequest = ++workspaceRequestRef.current;
    const chainRequest = ++chainRequestRef.current;
    const [workspaceResult, chainResult] = await Promise.allSettled([
      ipcBridge.creativeStudio.getWorkspaceStatus.invoke({ projectId: requestedProjectId }),
      ipcBridge.creativeStudio.getChainStatus.invoke({ projectId: requestedProjectId }),
    ]);
    if (
      generationRef.current !== generation ||
      workspaceRequestRef.current !== workspaceRequest ||
      chainRequestRef.current !== chainRequest
    ) {
      return;
    }
    let messageKey: string | null = null;
    if (workspaceResult.status === 'rejected') {
      setWorkspaceStatus(null);
      messageKey = 'conversation.creativeStudio.workspace.errors.storage';
    } else if (workspaceResult.value.ok === false) {
      setWorkspaceStatus(null);
      messageKey = workspaceResult.value.error.messageKey;
    } else {
      setWorkspaceStatus(workspaceResult.value.data as StudioRendererWorkspaceStatusV2);
    }
    if (chainResult.status === 'rejected') {
      setChainStatus(null);
      messageKey ??= 'conversation.creativeStudio.workspace.errors.storage';
    } else if (chainResult.value.ok === false) {
      setChainStatus(null);
      messageKey ??= chainResult.value.error.messageKey;
    } else {
      setChainStatus(chainResult.value.data as StudioRendererChainStatusV2);
    }
    setWorkspaceErrorMessageKey(messageKey);
  }, []);

  const loadRoutes = useCallback(async (requestedProjectId: string, generation: number): Promise<boolean> => {
    const boundProject = projectRef.current;
    if (boundProject?.id !== requestedProjectId) return false;
    const boundSignature = routeRelevantSignature(boundProject);
    const request = ++routeRequestRef.current;
    try {
      const result = await ipcBridge.creativeStudio.listRoutes.invoke({ projectId: requestedProjectId });
      if (generationRef.current !== generation || routeRequestRef.current !== request) return false;
      const current = projectRef.current;
      if (current?.id !== requestedProjectId || routeRelevantSignature(current) !== boundSignature) return false;
      if (result.ok === false) {
        setRouteCatalog(null);
        setRouteErrorMessageKey(result.error.messageKey);
        return false;
      }
      setRouteCatalog(result.data as StudioRouteCatalogV2);
      setRouteErrorMessageKey(null);
      return true;
    } catch {
      if (generationRef.current === generation && routeRequestRef.current === request) {
        setRouteCatalog(null);
        setRouteErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      }
      return false;
    }
  }, []);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    if (!projectId) {
      projectRef.current = null;
      setProject(null);
      setProposals([]);
      setReferenceRequests([]);
      setReferenceGenerationHandoffs([]);
      setWorkspaceStatus(null);
      setChainStatus(null);
      setRouteCatalog(null);
      setLoadState('idle');
      setErrorMessageKey(null);
      setProposalErrorMessageKey(null);
      setReferenceErrorMessageKey(null);
      setWorkspaceErrorMessageKey(null);
      setRouteErrorMessageKey(null);
      return;
    }

    setProposals([]);
    setReferenceRequests([]);
    setReferenceGenerationHandoffs([]);
    setProposalErrorMessageKey(null);
    setReferenceErrorMessageKey(null);
    setWorkspaceStatus(null);
    setChainStatus(null);
    setRouteCatalog(null);
    setWorkspaceErrorMessageKey(null);
    setRouteErrorMessageKey(null);

    const unsubscribeProject = ipcBridge.creativeStudio.projectUpdated.on(({ projectId: updatedProjectId }) => {
      if (updatedProjectId === projectId) {
        void Promise.all([loadProject(projectId, generation, false), loadWorkspace(projectId, generation)]);
      }
    });
    const unsubscribeProposal = ipcBridge.creativeStudio.proposalUpdated.on(({ projectId: updatedProjectId }) => {
      if (updatedProjectId === projectId) void loadProposals(projectId, generation);
    });
    const unsubscribeReference = ipcBridge.creativeStudio.referenceUpdated.on(({ projectId: updatedProjectId }) => {
      if (updatedProjectId === projectId) void loadReferences(projectId, generation);
    });

    void (async () => {
      if ((await loadProject(projectId, generation, true)) !== null) {
        await loadRoutes(projectId, generation);
      }
    })();
    void loadProposals(projectId, generation);
    void loadReferences(projectId, generation);
    void loadWorkspace(projectId, generation);

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      unsubscribeProject();
      unsubscribeProposal();
      unsubscribeReference();
    };
  }, [loadProject, loadProposals, loadReferences, loadRoutes, loadWorkspace, projectId]);

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

  const refetchWorkspace = useCallback(async (): Promise<void> => {
    if (projectId) await loadWorkspace(projectId, generationRef.current);
  }, [loadWorkspace, projectId]);

  const refetchRoutes = useCallback(async (): Promise<boolean> => {
    if (!projectId) return false;
    return loadRoutes(projectId, generationRef.current);
  }, [loadRoutes, projectId]);

  const refetchAll = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    await Promise.all([
      loadProject(projectId, generationRef.current, false),
      loadProposals(projectId, generationRef.current),
      loadReferences(projectId, generationRef.current),
      loadWorkspace(projectId, generationRef.current),
    ]);
  }, [loadProject, loadProposals, loadReferences, loadWorkspace, projectId]);

  return {
    project,
    proposals,
    referenceRequests,
    referenceGenerationHandoffs,
    workspaceStatus,
    chainStatus,
    routeCatalog,
    loadState,
    errorMessageKey,
    proposalErrorMessageKey,
    referenceErrorMessageKey,
    workspaceErrorMessageKey,
    routeErrorMessageKey,
    refetchProject,
    refetchProposals,
    refetchReferences,
    refetchWorkspace,
    refetchRoutes,
    refetchAll,
  };
};
