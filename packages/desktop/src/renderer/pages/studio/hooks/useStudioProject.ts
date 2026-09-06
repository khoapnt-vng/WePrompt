/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT,
  STUDIO_MAX_EXPORTS_PER_SHAPE,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_EXPORT_SHAPES,
} from '@/common/types/project/creativeStudioTypes';
import type {
  StudioRendererProposalV2,
  StudioRendererProposalCatalogV2,
  StudioProjectWorkspaceLoadResultV2,
  StudioReferenceRequestV2,
  StudioRendererChainStatusV2,
  StudioRendererExportCatalogV2,
  StudioRendererProjectV2,
  StudioRendererReferenceGenerationHandoffV2,
  StudioRendererWorkspaceStatusV2,
  StudioGenerationCapabilityV2,
  StudioFilmExportCapabilityV2,
  StudioGenerationCapabilityItemV2,
  StudioProjectStatusV2,
  StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type StudioProjectLoadState = 'idle' | 'loading' | 'supported' | 'unsupported' | 'not_found' | 'error';

type StudioProposalDecisionReconciliation = Readonly<{
  markCommitted: (projectRevision: number | null) => void;
  finish: () => void;
}>;

export type UseStudioProjectResult = {
  project: StudioRendererProjectV2 | null;
  proposals: StudioRendererProposalV2[];
  proposalCatalog: StudioRendererProposalCatalogV2 | null;
  proposalRefreshing: boolean;
  referenceRequests: StudioReferenceRequestV2[];
  referenceGenerationHandoffs: StudioRendererReferenceGenerationHandoffV2[];
  workspaceStatus: StudioRendererWorkspaceStatusV2 | null;
  chainStatus: StudioRendererChainStatusV2 | null;
  projectStatus: StudioProjectStatusV2 | null;
  projectStatusPending: boolean;
  routeCatalog: StudioRouteCatalogV2 | null;
  generationCapability: StudioGenerationCapabilityV2 | null;
  filmExportCapability: StudioFilmExportCapabilityV2 | null;
  exportCatalog: StudioRendererExportCatalogV2 | null;
  loadState: StudioProjectLoadState;
  errorMessageKey: string | null;
  proposalErrorMessageKey: string | null;
  referenceErrorMessageKey: string | null;
  workspaceErrorMessageKey: string | null;
  routeErrorMessageKey: string | null;
  exportErrorMessageKey: string | null;
  refetchProjectWorkspace: () => Promise<StudioRendererProjectV2 | null>;
  reconcileProjectWorkspace: () => Promise<StudioRendererProjectV2 | null>;
  refetchProposals: () => Promise<StudioRendererProposalCatalogV2 | null>;
  beginProposalDecisionReconciliation: (
    proposalId: string,
    expectedProjectRevision: number | null
  ) => StudioProposalDecisionReconciliation;
  refetchReferences: () => Promise<void>;
  refetchRoutes: () => Promise<boolean>;
  refetchExports: () => Promise<boolean>;
  installExportCatalog: (catalog: StudioRendererExportCatalogV2) => boolean;
  refetchAll: () => Promise<void>;
};

type InstalledStudioProjectWorkspace = {
  project: StudioRendererProjectV2 | null;
  workspaceStatus: StudioRendererWorkspaceStatusV2 | null;
  chainStatus: StudioRendererChainStatusV2 | null;
};

type StudioProjectBinding = Readonly<{
  projectId: string | undefined;
  epoch: symbol;
}>;

type StudioProposalDecisionAttempt = {
  binding: StudioProjectBinding;
  expectedProjectRevision: number | null;
};

type StudioProjectWorkspaceFlight = {
  binding: StudioProjectBinding;
  generation: number;
  reportFailure: boolean;
  promise: Promise<StudioRendererProjectV2 | null>;
  canceled: boolean;
  cancel: () => void;
  trailing: {
    promise: Promise<StudioRendererProjectV2 | null>;
    resolve: (project: StudioRendererProjectV2 | null) => void;
    reportFailure: boolean;
  } | null;
};

const uniqueHandoffs = (
  handoffs: StudioRendererReferenceGenerationHandoffV2[]
): StudioRendererReferenceGenerationHandoffV2[] => {
  const unique = new Map<string, StudioRendererReferenceGenerationHandoffV2>();
  for (const handoff of handoffs) {
    unique.set(handoff.handoffId, handoff);
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

const generationCapabilityItems = (project: StudioRendererProjectV2): StudioGenerationCapabilityItemV2[] => [
  ...project.beatOrder.flatMap((beatId) => {
    const beat = Object.hasOwn(project.beats, beatId) ? project.beats[beatId] : undefined;
    return beat?.id === beatId
      ? beat.shotOrder.flatMap((shotId) => [
          { target: { kind: 'shot' as const, shotId }, purpose: 'seed_still' as const },
          { target: { kind: 'shot' as const, shotId }, purpose: 'board_still' as const },
          { target: { kind: 'shot' as const, shotId }, purpose: 'video_take' as const },
        ])
      : [];
  }),
  ...project.referenceOrder.map((referenceId) => ({
    target: { kind: 'reference' as const, referenceId },
    purpose: 'reference_image' as const,
  })),
];

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;

const hasExactKeys = (value: object, expected: readonly string[]): boolean => {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.length !== expected.length || actual.some((key) => typeof key !== 'string' || !expected.includes(key))) {
    return false;
  }
  return actual.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
  });
};

const isCanonicalStudioTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const hasValidProposalLifecycle = (proposal: StudioRendererProposalV2): boolean => {
  if (!isCanonicalStudioTimestamp(proposal.createdAt)) return false;
  if (proposal.status === 'pending') return proposal.decidedAt === null;
  return (
    (proposal.status === 'accepted' || proposal.status === 'rejected' || proposal.status === 'expired') &&
    isCanonicalStudioTimestamp(proposal.decidedAt) &&
    Date.parse(proposal.decidedAt) >= Date.parse(proposal.createdAt)
  );
};

const sanitizeExportCatalog = (
  value: unknown,
  currentProjectRevision: number
): StudioRendererExportCatalogV2 | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const catalog = value as Record<string, unknown>;
  if (!hasExactKeys(catalog, ['artifacts', 'revision']) || !Number.isSafeInteger(catalog.revision)) return null;
  if (
    (catalog.revision as number) < 1 ||
    !Array.isArray(catalog.artifacts) ||
    Reflect.ownKeys(catalog.artifacts).length !== catalog.artifacts.length + 1 ||
    catalog.artifacts.length > STUDIO_MAX_EXPORTS_PER_SHAPE * STUDIO_EXPORT_SHAPES.length
  ) {
    return null;
  }

  const ids = new Set<string>();
  const shapeCounts = new Map<'editor_folder' | 'still' | 'script' | 'film', number>();
  const artifacts: StudioRendererExportCatalogV2['artifacts'] = [];
  let previous: { createdAt: string; id: string } | null = null;
  for (let index = 0; index < catalog.artifacts.length; index += 1) {
    if (!Object.hasOwn(catalog.artifacts, index)) return null;
    const candidate = catalog.artifacts[index];
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return null;
    const artifact = candidate as Record<string, unknown>;
    if (
      !hasExactKeys(
        artifact,
        artifact.shape === 'film'
          ? ['byteSize', 'createdAt', 'payloadFileCount', 'folderName', 'id', 'shape', 'sourceRevision', 'film']
          : ['byteSize', 'createdAt', 'payloadFileCount', 'folderName', 'id', 'shape', 'sourceRevision']
      ) ||
      typeof artifact.id !== 'string' ||
      !SAFE_STUDIO_ID.test(artifact.id) ||
      ids.has(artifact.id) ||
      !Number.isSafeInteger(artifact.sourceRevision) ||
      (artifact.sourceRevision as number) < 1 ||
      (artifact.sourceRevision as number) > currentProjectRevision ||
      (artifact.shape !== 'editor_folder' &&
        artifact.shape !== 'still' &&
        artifact.shape !== 'script' &&
        artifact.shape !== 'film') ||
      typeof artifact.folderName !== 'string' ||
      !SAFE_STUDIO_ID.test(artifact.folderName) ||
      !Number.isSafeInteger(artifact.byteSize) ||
      (artifact.byteSize as number) < 0 ||
      !Number.isSafeInteger(artifact.payloadFileCount) ||
      (artifact.payloadFileCount as number) < 1 ||
      (artifact.payloadFileCount as number) > STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT ||
      (artifact.shape !== 'editor_folder' && artifact.payloadFileCount !== 1) ||
      typeof artifact.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(artifact.createdAt)) ||
      new Date(artifact.createdAt).toISOString() !== artifact.createdAt ||
      (previous !== null &&
        (previous.createdAt > artifact.createdAt ||
          (previous.createdAt === artifact.createdAt && previous.id >= artifact.id)))
    ) {
      return null;
    }
    ids.add(artifact.id);
    const shapeCount = (shapeCounts.get(artifact.shape) ?? 0) + 1;
    if (shapeCount > STUDIO_MAX_EXPORTS_PER_SHAPE) return null;
    shapeCounts.set(artifact.shape, shapeCount);
    previous = { createdAt: artifact.createdAt, id: artifact.id };
    const projected = {
      id: artifact.id,
      sourceRevision: artifact.sourceRevision as number,
      shape: artifact.shape,
      folderName: artifact.folderName,
      byteSize: artifact.byteSize as number,
      payloadFileCount: artifact.payloadFileCount as number,
      createdAt: artifact.createdAt,
    };
    if (artifact.shape === 'film') {
      if (typeof artifact.film !== 'object' || artifact.film === null || Array.isArray(artifact.film)) return null;
      const film = artifact.film as Record<string, unknown>;
      if (
        !hasExactKeys(film, [
          'nominalDurationSeconds',
          'renderedDurationSeconds',
          'transition',
          'trimTails',
          'trimmedShotCount',
        ]) ||
        typeof film.nominalDurationSeconds !== 'number' ||
        !Number.isFinite(film.nominalDurationSeconds) ||
        film.nominalDurationSeconds <= 0 ||
        typeof film.renderedDurationSeconds !== 'number' ||
        !Number.isFinite(film.renderedDurationSeconds) ||
        film.renderedDurationSeconds <= 0 ||
        film.renderedDurationSeconds > film.nominalDurationSeconds ||
        typeof film.trimTails !== 'boolean' ||
        !Number.isSafeInteger(film.trimmedShotCount) ||
        (film.trimmedShotCount as number) < 0 ||
        (film.trimmedShotCount as number) > STUDIO_MAX_SHOTS_PER_PROJECT ||
        (artifact.byteSize as number) < 1 ||
        typeof film.transition !== 'object' ||
        film.transition === null ||
        Array.isArray(film.transition)
      ) {
        return null;
      }
      const transition = film.transition as Record<string, unknown>;
      if (
        !hasExactKeys(transition, transition.kind === 'cut' ? ['kind'] : ['kind', 'requestedSeconds', 'seconds']) ||
        (transition.kind !== 'cut' &&
          (transition.kind !== 'dissolve' ||
            typeof transition.requestedSeconds !== 'number' ||
            !Number.isFinite(transition.requestedSeconds) ||
            transition.requestedSeconds < 1 / 24 ||
            transition.requestedSeconds > 1 ||
            typeof transition.seconds !== 'number' ||
            !Number.isFinite(transition.seconds) ||
            transition.seconds < 1 / 24 ||
            transition.seconds > transition.requestedSeconds ||
            transition.requestedSeconds - transition.seconds >= 1 / 24 + Number.EPSILON ||
            Math.abs(transition.seconds * 24 - Math.round(transition.seconds * 24)) > 0.000_001))
      ) {
        return null;
      }
      artifacts.push({
        ...projected,
        shape: 'film',
        film: {
          nominalDurationSeconds: film.nominalDurationSeconds,
          renderedDurationSeconds: film.renderedDurationSeconds,
          transition:
            transition.kind === 'cut'
              ? { kind: 'cut' }
              : {
                  kind: 'dissolve',
                  requestedSeconds: transition.requestedSeconds as number,
                  seconds: transition.seconds as number,
                },
          trimTails: film.trimTails,
          trimmedShotCount: film.trimmedShotCount as number,
        },
      });
    } else {
      artifacts.push({ ...projected, shape: artifact.shape });
    }
  }
  return { revision: catalog.revision as number, artifacts };
};

/** Owns the current-schema composite renderer snapshot and subscribes before every initial read. */
export const useStudioProject = (projectId: string | undefined): UseStudioProjectResult => {
  const binding = useMemo<StudioProjectBinding>(
    () => Object.freeze({ projectId, epoch: Symbol('studio-project-binding') }),
    [projectId]
  );
  const activeBindingRef = useRef<StudioProjectBinding | null>(null);
  const [projectWorkspace, setProjectWorkspace] = useState<InstalledStudioProjectWorkspace>({
    project: null,
    workspaceStatus: null,
    chainStatus: null,
  });
  const { project, workspaceStatus, chainStatus } = projectWorkspace;
  const [projectStatus, setProjectStatus] = useState<StudioProjectStatusV2 | null>(null);
  const [projectStatusPending, setProjectStatusPending] = useState(projectId !== undefined);
  const [proposals, setProposals] = useState<StudioRendererProposalV2[]>([]);
  const [proposalCatalog, setProposalCatalog] = useState<StudioRendererProposalCatalogV2 | null>(null);
  const [proposalRefreshing, setProposalRefreshing] = useState(false);
  const [referenceRequests, setReferenceRequests] = useState<StudioReferenceRequestV2[]>([]);
  const [referenceGenerationHandoffs, setReferenceGenerationHandoffs] = useState<
    StudioRendererReferenceGenerationHandoffV2[]
  >([]);
  const [routeCatalog, setRouteCatalog] = useState<StudioRouteCatalogV2 | null>(null);
  const [generationCapability, setGenerationCapability] = useState<StudioGenerationCapabilityV2 | null>(null);
  const [filmExportCapability, setFilmExportCapability] = useState<StudioFilmExportCapabilityV2 | null>(null);
  const [exportCatalog, setExportCatalog] = useState<StudioRendererExportCatalogV2 | null>(null);
  const [loadState, setLoadState] = useState<StudioProjectLoadState>(projectId ? 'loading' : 'idle');
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [proposalErrorMessageKey, setProposalErrorMessageKey] = useState<string | null>(null);
  const [referenceErrorMessageKey, setReferenceErrorMessageKey] = useState<string | null>(null);
  const [workspaceErrorMessageKey, setWorkspaceErrorMessageKey] = useState<string | null>(null);
  const [routeErrorMessageKey, setRouteErrorMessageKey] = useState<string | null>(null);
  const [exportErrorMessageKey, setExportErrorMessageKey] = useState<string | null>(null);
  const generationRef = useRef(0);
  const projectWorkspaceFlightRef = useRef<StudioProjectWorkspaceFlight | null>(null);
  const proposalCatalogRef = useRef<StudioRendererProposalCatalogV2 | null>(null);
  const proposalReadRef = useRef<{
    binding: StudioProjectBinding;
    generation: number;
    reportFailure: boolean;
    request: number;
  } | null>(null);
  const unreconciledProposalDecisionIdsRef = useRef(new Set<string>());
  const pendingProposalDecisionEventIdsRef = useRef(new Set<string>());
  const proposalDecisionProjectRevisionsRef = useRef(new Set<number>());
  const activeProposalDecisionAttemptsRef = useRef(new Map<string, StudioProposalDecisionAttempt>());
  const proposalRequestRef = useRef(0);
  const referenceRequestRef = useRef(0);
  const handoffRequestRef = useRef(0);
  const referencePairRequestRef = useRef(0);
  const referencePairReadRef = useRef<{
    binding: StudioProjectBinding;
    generation: number;
    reportFailure: boolean;
    request: number;
  } | null>(null);
  const routeRequestRef = useRef(0);
  const routeReadReportFailureRef = useRef(false);
  const capabilityRequestRef = useRef(0);
  const capabilityReadRef = useRef<{ reportFailure: boolean; request: number } | null>(null);
  const filmCapabilityRequestRef = useRef(0);
  const routeRefreshActiveRef = useRef<number | null>(null);
  const capabilityRefreshPendingRef = useRef(false);
  const capabilityRefreshReportFailureRef = useRef(false);
  const exportRequestRef = useRef(0);
  const projectStatusRequestRef = useRef(0);
  const beginProposalDecisionReconciliation = useCallback(
    (proposalId: string, expectedProjectRevision: number | null): StudioProposalDecisionReconciliation => {
      const attempt: StudioProposalDecisionAttempt = {
        binding,
        expectedProjectRevision,
      };
      activeProposalDecisionAttemptsRef.current.set(proposalId, attempt);
      let active = true;
      let committed = false;
      return {
        markCommitted: (projectRevision) => {
          if (!active || committed || activeBindingRef.current !== binding) return;
          committed = true;
          const catalogProposal = proposalCatalogRef.current?.proposals.find(
            (candidate) => candidate.id === proposalId
          );
          if (proposalCatalogRef.current === null || catalogProposal?.status === 'pending') {
            unreconciledProposalDecisionIdsRef.current.add(proposalId);
          }
          pendingProposalDecisionEventIdsRef.current.add(proposalId);
          if (projectRevision !== null) {
            proposalDecisionProjectRevisionsRef.current.add(projectRevision);
          }
        },
        finish: () => {
          if (!active) return;
          active = false;
          if (activeProposalDecisionAttemptsRef.current.get(proposalId) === attempt) {
            activeProposalDecisionAttemptsRef.current.delete(proposalId);
          }
        },
      };
    },
    [binding]
  );
  const projectRef = useRef<StudioRendererProjectV2 | null>(null);
  const projectStatusRef = useRef<StudioProjectStatusV2 | null>(null);
  const routeCatalogRef = useRef<StudioRouteCatalogV2 | null>(null);
  const exportCatalogRef = useRef<StudioRendererExportCatalogV2 | null>(null);

  useLayoutEffect(() => {
    activeBindingRef.current = binding;
    return () => {
      if (activeBindingRef.current === binding) activeBindingRef.current = null;
      const flight = projectWorkspaceFlightRef.current;
      if (flight?.binding === binding) {
        flight.cancel();
        if (projectWorkspaceFlightRef.current === flight) projectWorkspaceFlightRef.current = null;
      }
    };
  }, [binding]);

  const loadProjectWorkspace = useCallback(
    (
      requestedBinding: StudioProjectBinding,
      generation: number,
      initial: boolean,
      reportFailure = true,
      supersedeSilentFlight = false
    ): Promise<StudioRendererProjectV2 | null> => {
      const requestedProjectId = requestedBinding.projectId;
      if (
        requestedProjectId === undefined ||
        activeBindingRef.current !== requestedBinding ||
        generationRef.current !== generation
      ) {
        return Promise.resolve(null);
      }

      const existingFlight = projectWorkspaceFlightRef.current;
      if (existingFlight?.binding === requestedBinding && existingFlight.generation === generation) {
        if (!existingFlight.reportFailure && (reportFailure || supersedeSilentFlight)) {
          existingFlight.cancel();
          if (projectWorkspaceFlightRef.current === existingFlight) projectWorkspaceFlightRef.current = null;
        } else {
          if (existingFlight.trailing === null) {
            let resolveTrailing!: (project: StudioRendererProjectV2 | null) => void;
            const promise = new Promise<StudioRendererProjectV2 | null>((resolve) => {
              resolveTrailing = resolve;
            });
            existingFlight.trailing = { promise, resolve: resolveTrailing, reportFailure };
          } else {
            existingFlight.trailing.reportFailure ||= reportFailure;
          }
          return existingFlight.trailing.promise;
        }
      }
      const supersededFlight = projectWorkspaceFlightRef.current;
      if (supersededFlight !== null) {
        supersededFlight.cancel();
        if (projectWorkspaceFlightRef.current === supersededFlight) projectWorkspaceFlightRef.current = null;
      }

      if (initial) {
        projectRef.current = null;
        setProjectWorkspace({ project: null, workspaceStatus: null, chainStatus: null });
        projectStatusRequestRef.current += 1;
        projectStatusRef.current = null;
        setProjectStatus(null);
        setProjectStatusPending(true);
        setLoadState('loading');
      }
      if (reportFailure) setErrorMessageKey(null);

      const readAndInstall = async (
        reportReadFailure: boolean,
        isCanceled: () => boolean
      ): Promise<StudioRendererProjectV2 | null> => {
        type ReadOutcome =
          | { kind: 'loaded'; loaded: StudioProjectWorkspaceLoadResultV2 }
          | { kind: 'error'; messageKey: string };
        const invoke = async (): Promise<ReadOutcome> => {
          if (isCanceled() || activeBindingRef.current !== requestedBinding || generationRef.current !== generation) {
            return { kind: 'error', messageKey: 'conversation.creativeStudio.workspace.errors.storage' };
          }
          try {
            const result = await ipcBridge.creativeStudio.getProjectWorkspace.invoke({
              projectId: requestedProjectId,
            });
            if (result.ok === false) return { kind: 'error', messageKey: result.error.messageKey };
            const loaded = result.data as StudioProjectWorkspaceLoadResultV2;
            if (loaded.status === 'supported') {
              const {
                project: snapshotProject,
                workspaceStatus: snapshotWorkspaceStatus,
                chainStatus: snapshotChainStatus,
              } = loaded.snapshot;
              if (
                snapshotProject.id !== requestedProjectId ||
                snapshotWorkspaceStatus.projectId !== requestedProjectId ||
                snapshotChainStatus.projectId !== requestedProjectId ||
                snapshotWorkspaceStatus.projectRevision !== snapshotProject.revision ||
                snapshotChainStatus.projectRevision !== snapshotProject.revision
              ) {
                return {
                  kind: 'error',
                  messageKey: 'conversation.creativeStudio.workspace.errors.storage',
                };
              }
            } else if (loaded.projectId !== requestedProjectId) {
              return { kind: 'error', messageKey: 'conversation.creativeStudio.workspace.errors.storage' };
            }
            return { kind: 'loaded', loaded };
          } catch {
            return { kind: 'error', messageKey: 'conversation.creativeStudio.workspace.errors.storage' };
          }
        };

        const first = await invoke();
        if (isCanceled() || activeBindingRef.current !== requestedBinding || generationRef.current !== generation) {
          return null;
        }
        const outcome = first.kind === 'error' ? await invoke() : first;
        if (isCanceled() || activeBindingRef.current !== requestedBinding || generationRef.current !== generation) {
          return null;
        }

        if (outcome.kind === 'error') {
          if (!reportReadFailure) return null;
          const current = projectRef.current?.id === requestedProjectId ? projectRef.current : null;
          setProjectWorkspace({ project: current, workspaceStatus: null, chainStatus: null });
          projectStatusRequestRef.current += 1;
          projectStatusRef.current = null;
          setProjectStatus(null);
          setProjectStatusPending(false);
          routeRequestRef.current += 1;
          capabilityRequestRef.current += 1;
          exportRequestRef.current += 1;
          routeCatalogRef.current = null;
          setRouteCatalog(null);
          setGenerationCapability(null);
          exportCatalogRef.current = null;
          setExportCatalog(null);
          setRouteErrorMessageKey(null);
          setExportErrorMessageKey(null);
          setWorkspaceErrorMessageKey(outcome.messageKey);
          if (current === null) {
            setLoadState('error');
            setErrorMessageKey(outcome.messageKey);
          } else {
            setLoadState('supported');
            setErrorMessageKey(null);
          }
          return null;
        }

        const { loaded } = outcome;
        if (loaded.status !== 'supported') {
          if (!reportReadFailure) return null;
          projectRef.current = null;
          setProjectWorkspace({ project: null, workspaceStatus: null, chainStatus: null });
          projectStatusRequestRef.current += 1;
          projectStatusRef.current = null;
          setProjectStatus(null);
          setProjectStatusPending(false);
          routeRequestRef.current += 1;
          capabilityRequestRef.current += 1;
          exportRequestRef.current += 1;
          routeCatalogRef.current = null;
          setRouteCatalog(null);
          setGenerationCapability(null);
          exportCatalogRef.current = null;
          setExportCatalog(null);
          setRouteErrorMessageKey(null);
          setExportErrorMessageKey(null);
          setWorkspaceErrorMessageKey(null);
          setErrorMessageKey(null);
          setLoadState(loaded.status === 'not_found' ? 'not_found' : 'unsupported');
          return null;
        }

        const current = projectRef.current;
        if (current?.id === loaded.snapshot.project.id && current.revision > loaded.snapshot.project.revision) {
          return current;
        }
        if (current !== null && routeRelevantSignature(current) !== routeRelevantSignature(loaded.snapshot.project)) {
          routeRequestRef.current += 1;
          capabilityRequestRef.current += 1;
          routeCatalogRef.current = null;
          setRouteCatalog(null);
          setGenerationCapability(null);
          setRouteErrorMessageKey(null);
        }
        projectRef.current = loaded.snapshot.project;
        for (const decisionRevision of proposalDecisionProjectRevisionsRef.current) {
          if (decisionRevision <= loaded.snapshot.project.revision) {
            proposalDecisionProjectRevisionsRef.current.delete(decisionRevision);
          }
        }
        if (
          projectStatusRef.current?.projectId !== loaded.snapshot.project.id ||
          projectStatusRef.current.projectRevision !== loaded.snapshot.project.revision
        ) {
          projectStatusRequestRef.current += 1;
          projectStatusRef.current = null;
          setProjectStatus(null);
          setProjectStatusPending(true);
        }
        setProjectWorkspace(loaded.snapshot);
        setLoadState('supported');
        setErrorMessageKey(null);
        setWorkspaceErrorMessageKey(null);
        return loaded.snapshot.project;
      };

      const startFlight = (reportReadFailure: boolean): Promise<StudioRendererProjectV2 | null> => {
        if (activeBindingRef.current !== requestedBinding || generationRef.current !== generation) {
          return Promise.resolve(null);
        }
        let resolveCancellation!: (project: StudioRendererProjectV2 | null) => void;
        const cancellation = new Promise<StudioRendererProjectV2 | null>((resolve) => {
          resolveCancellation = resolve;
        });
        let flight!: StudioProjectWorkspaceFlight;
        const read = Promise.resolve().then(() => readAndInstall(reportReadFailure, () => flight.canceled));
        flight = {
          binding: requestedBinding,
          generation,
          reportFailure: reportReadFailure,
          promise: Promise.race([read, cancellation]),
          canceled: false,
          cancel: () => {
            if (flight.canceled) return;
            flight.canceled = true;
            resolveCancellation(null);
            flight.trailing?.resolve(null);
            flight.trailing = null;
          },
          trailing: null,
        };
        projectWorkspaceFlightRef.current = flight;
        const settle = (): void => {
          if (flight.canceled) {
            if (projectWorkspaceFlightRef.current === flight) projectWorkspaceFlightRef.current = null;
            return;
          }
          const trailing = flight.trailing;
          if (projectWorkspaceFlightRef.current !== flight) {
            trailing?.resolve(null);
            return;
          }
          projectWorkspaceFlightRef.current = null;
          if (trailing === null) return;
          if (activeBindingRef.current !== requestedBinding || generationRef.current !== generation) {
            trailing.resolve(null);
            return;
          }
          void startFlight(trailing.reportFailure).then(trailing.resolve, () => trailing.resolve(null));
        };
        void flight.promise.then(settle, settle);
        return flight.promise;
      };
      return startFlight(reportFailure);
    },
    []
  );

  const loadProjectStatus = useCallback(
    async (requestedBinding: StudioProjectBinding, generation: number): Promise<StudioProjectStatusV2 | null> => {
      const requestedProjectId = requestedBinding.projectId;
      if (
        requestedProjectId === undefined ||
        activeBindingRef.current !== requestedBinding ||
        generationRef.current !== generation
      ) {
        return null;
      }
      const boundProject = projectRef.current;
      if (boundProject?.id !== requestedProjectId) return null;
      const request = ++projectStatusRequestRef.current;
      projectStatusRef.current = null;
      setProjectStatus(null);
      setProjectStatusPending(true);
      try {
        const result = await ipcBridge.creativeStudio.getProjectStatus.invoke({
          projectId: requestedProjectId,
          detail: true,
        });
        if (
          activeBindingRef.current !== requestedBinding ||
          generationRef.current !== generation ||
          projectStatusRequestRef.current !== request
        ) {
          return null;
        }
        const current = projectRef.current;
        if (current?.id !== requestedProjectId || current.revision !== boundProject.revision) return null;
        const currentCatalogVersion = routeCatalogRef.current?.catalogVersion ?? null;
        if (
          result.ok === false ||
          result.data.projectId !== requestedProjectId ||
          result.data.projectRevision !== boundProject.revision ||
          result.data.detail === null
        ) {
          projectStatusRef.current = null;
          setProjectStatus(null);
          setProjectStatusPending(false);
          return null;
        }
        if (result.data.catalogVersion !== currentCatalogVersion) {
          routeRequestRef.current += 1;
          capabilityRequestRef.current += 1;
          routeCatalogRef.current = null;
          setRouteCatalog(null);
          setGenerationCapability(null);
          projectStatusRef.current = null;
          setProjectStatus(null);
          setProjectStatusPending(false);
          return null;
        }
        const installed = structuredClone(result.data) as StudioProjectStatusV2;
        projectStatusRef.current = installed;
        setProjectStatus(installed);
        setProjectStatusPending(false);
        return installed;
      } catch {
        if (
          activeBindingRef.current === requestedBinding &&
          generationRef.current === generation &&
          projectStatusRequestRef.current === request
        ) {
          projectStatusRef.current = null;
          setProjectStatus(null);
          setProjectStatusPending(false);
        }
        return null;
      }
    },
    []
  );

  const loadProposals = useCallback(
    async (
      requestedBinding: StudioProjectBinding,
      generation: number,
      reportFailure = true
    ): Promise<StudioRendererProposalCatalogV2 | null> => {
      const requestedProjectId = requestedBinding.projectId;
      if (
        requestedProjectId === undefined ||
        activeBindingRef.current !== requestedBinding ||
        generationRef.current !== generation
      ) {
        return null;
      }
      const activeRead = proposalReadRef.current;
      if (
        !reportFailure &&
        activeRead?.binding === requestedBinding &&
        activeRead.generation === generation &&
        activeRead.reportFailure
      ) {
        return null;
      }
      const request = ++proposalRequestRef.current;
      const read = { binding: requestedBinding, generation, reportFailure, request };
      proposalReadRef.current = read;
      if (reportFailure) setProposalRefreshing(true);
      try {
        const result = await ipcBridge.creativeStudio.listProposals.invoke({ projectId: requestedProjectId });
        if (
          activeBindingRef.current !== requestedBinding ||
          generationRef.current !== generation ||
          proposalRequestRef.current !== request
        ) {
          return null;
        }
        if (result.ok === false) {
          if (reportFailure) setProposalErrorMessageKey(result.error.messageKey);
          return null;
        }
        const catalog = result.data;
        const currentProject = projectRef.current;
        const validCatalog =
          catalog.projectId === requestedProjectId &&
          currentProject?.id === requestedProjectId &&
          currentProject.revision === catalog.projectRevision &&
          Number.isSafeInteger(catalog.projectRevision) &&
          catalog.projectRevision >= 1 &&
          Array.isArray(catalog.proposals) &&
          new Set(catalog.proposals.map((candidate) => candidate.id)).size === catalog.proposals.length &&
          catalog.proposals.every(
            (candidate) =>
              candidate.projectId === requestedProjectId &&
              hasValidProposalLifecycle(candidate) &&
              (candidate.status !== 'accepted' || candidate.baseRevision < catalog.projectRevision) &&
              (candidate.review.status === 'stale'
                ? candidate.review.currentRevision === catalog.projectRevision &&
                  candidate.review.baseRevision === candidate.baseRevision &&
                  candidate.baseRevision !== catalog.projectRevision
                : candidate.baseRevision === catalog.projectRevision)
          );
        if (!validCatalog) {
          if (reportFailure) {
            setProposalErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          }
          return null;
        }
        const installed = structuredClone(catalog) as StudioRendererProposalCatalogV2;
        for (const proposalId of unreconciledProposalDecisionIdsRef.current) {
          const candidate = installed.proposals.find((proposal) => proposal.id === proposalId);
          if (candidate === undefined || candidate.status !== 'pending') {
            unreconciledProposalDecisionIdsRef.current.delete(proposalId);
          }
        }
        proposalCatalogRef.current = installed;
        setProposalCatalog(installed);
        setProposals(installed.proposals.filter((candidate) => candidate.status === 'pending'));
        setProposalErrorMessageKey(null);
        return installed;
      } catch {
        if (
          activeBindingRef.current === requestedBinding &&
          generationRef.current === generation &&
          proposalRequestRef.current === request
        ) {
          if (reportFailure) {
            setProposalErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          }
        }
        return null;
      } finally {
        if (proposalReadRef.current === read) proposalReadRef.current = null;
        if (
          reportFailure &&
          activeBindingRef.current === requestedBinding &&
          generationRef.current === generation &&
          proposalRequestRef.current === request
        ) {
          setProposalRefreshing(false);
        }
      }
    },
    []
  );

  const loadReferenceRequests = useCallback(
    async (requestedBinding: StudioProjectBinding, generation: number): Promise<string | null> => {
      const requestedProjectId = requestedBinding.projectId;
      if (
        requestedProjectId === undefined ||
        activeBindingRef.current !== requestedBinding ||
        generationRef.current !== generation
      ) {
        return null;
      }
      const request = ++referenceRequestRef.current;
      try {
        const result = await ipcBridge.creativeStudio.listReferenceRequests.invoke({ projectId: requestedProjectId });
        if (
          activeBindingRef.current !== requestedBinding ||
          generationRef.current !== generation ||
          referenceRequestRef.current !== request
        ) {
          return null;
        }
        if (result.ok === false) {
          return result.error.messageKey;
        }
        setReferenceRequests(result.data as StudioReferenceRequestV2[]);
        return null;
      } catch {
        if (
          activeBindingRef.current === requestedBinding &&
          generationRef.current === generation &&
          referenceRequestRef.current === request
        ) {
          return 'conversation.creativeStudio.workspace.errors.storage';
        }
        return null;
      }
    },
    []
  );

  const loadReferenceHandoffs = useCallback(
    async (requestedBinding: StudioProjectBinding, generation: number): Promise<string | null> => {
      const requestedProjectId = requestedBinding.projectId;
      if (
        requestedProjectId === undefined ||
        activeBindingRef.current !== requestedBinding ||
        generationRef.current !== generation
      ) {
        return null;
      }
      const request = ++handoffRequestRef.current;
      try {
        const result = await ipcBridge.creativeStudio.listReferenceGenerationHandoffs.invoke({
          projectId: requestedProjectId,
        });
        if (
          activeBindingRef.current !== requestedBinding ||
          generationRef.current !== generation ||
          handoffRequestRef.current !== request
        ) {
          return null;
        }
        if (result.ok === false) {
          return result.error.messageKey;
        }
        setReferenceGenerationHandoffs(uniqueHandoffs(result.data as StudioRendererReferenceGenerationHandoffV2[]));
        return null;
      } catch {
        if (
          activeBindingRef.current === requestedBinding &&
          generationRef.current === generation &&
          handoffRequestRef.current === request
        ) {
          return 'conversation.creativeStudio.workspace.errors.storage';
        }
        return null;
      }
    },
    []
  );

  const loadReferences = useCallback(
    async (requestedBinding: StudioProjectBinding, generation: number, reportFailure = true): Promise<void> => {
      if (
        requestedBinding.projectId === undefined ||
        activeBindingRef.current !== requestedBinding ||
        generationRef.current !== generation
      ) {
        return;
      }
      const activeRead = referencePairReadRef.current;
      if (
        !reportFailure &&
        activeRead?.binding === requestedBinding &&
        activeRead.generation === generation &&
        activeRead.reportFailure
      ) {
        return;
      }
      const pairRequest = ++referencePairRequestRef.current;
      const read = { binding: requestedBinding, generation, reportFailure, request: pairRequest };
      referencePairReadRef.current = read;
      const [requestError, handoffError] = await Promise.all([
        loadReferenceRequests(requestedBinding, generation),
        loadReferenceHandoffs(requestedBinding, generation),
      ]);
      if (
        activeBindingRef.current === requestedBinding &&
        generationRef.current === generation &&
        referencePairRequestRef.current === pairRequest
      ) {
        const error = requestError ?? handoffError;
        if (error === null || reportFailure) setReferenceErrorMessageKey(error);
      }
      if (referencePairReadRef.current === read) referencePairReadRef.current = null;
    },
    [loadReferenceHandoffs, loadReferenceRequests]
  );

  const loadGenerationCapability = useCallback(
    async (requestedBinding: StudioProjectBinding, generation: number, reportFailure = true): Promise<boolean> => {
      const requestedProjectId = requestedBinding.projectId;
      if (
        requestedProjectId === undefined ||
        activeBindingRef.current !== requestedBinding ||
        generationRef.current !== generation
      ) {
        return false;
      }
      const boundProject = projectRef.current;
      const boundCatalog = routeCatalogRef.current;
      if (boundProject?.id !== requestedProjectId || boundCatalog === null) return false;
      if (routeRefreshActiveRef.current !== null) {
        if (reportFailure && !routeReadReportFailureRef.current) {
          routeRequestRef.current += 1;
          routeRefreshActiveRef.current = null;
          routeReadReportFailureRef.current = false;
          capabilityRefreshPendingRef.current = false;
          capabilityRefreshReportFailureRef.current = false;
        } else {
          capabilityRefreshReportFailureRef.current ||= reportFailure;
          capabilityRefreshPendingRef.current = true;
          return false;
        }
      }
      const activeRead = capabilityReadRef.current;
      if (!reportFailure && activeRead?.reportFailure) return false;
      const request = ++capabilityRequestRef.current;
      const read = { reportFailure, request };
      capabilityReadRef.current = read;
      try {
        const capabilityResult = await ipcBridge.creativeStudio.getGenerationCapability.invoke({
          projectId: requestedProjectId,
          expectedRevision: boundProject.revision,
          items: generationCapabilityItems(boundProject),
        });
        if (
          activeBindingRef.current !== requestedBinding ||
          generationRef.current !== generation ||
          capabilityRequestRef.current !== request
        ) {
          return false;
        }
        const current = projectRef.current;
        if (current?.id !== requestedProjectId || current.revision !== boundProject.revision) return false;
        if (
          capabilityResult.ok === false ||
          capabilityResult.data.projectId !== requestedProjectId ||
          capabilityResult.data.projectRevision !== boundProject.revision ||
          capabilityResult.data.catalogVersion !== boundCatalog.catalogVersion
        ) {
          routeCatalogRef.current = null;
          setRouteCatalog(null);
          setGenerationCapability(null);
          if (reportFailure) {
            setRouteErrorMessageKey(
              capabilityResult.ok === false
                ? capabilityResult.error.messageKey
                : 'conversation.creativeStudio.workspace.errors.storage'
            );
          }
          return false;
        }
        setGenerationCapability(capabilityResult.data as StudioGenerationCapabilityV2);
        setRouteErrorMessageKey(null);
        return true;
      } catch {
        if (
          activeBindingRef.current === requestedBinding &&
          generationRef.current === generation &&
          capabilityRequestRef.current === request
        ) {
          routeCatalogRef.current = null;
          setRouteCatalog(null);
          setGenerationCapability(null);
          if (reportFailure) setRouteErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        }
        return false;
      } finally {
        if (capabilityReadRef.current === read) capabilityReadRef.current = null;
      }
    },
    []
  );

  const loadRoutes = useCallback(
    async (requestedBinding: StudioProjectBinding, generation: number, reportFailure = true): Promise<boolean> => {
      const requestedProjectId = requestedBinding.projectId;
      if (
        requestedProjectId === undefined ||
        activeBindingRef.current !== requestedBinding ||
        generationRef.current !== generation
      ) {
        return false;
      }
      const boundProject = projectRef.current;
      if (boundProject?.id !== requestedProjectId) return false;
      if (!reportFailure && routeRefreshActiveRef.current !== null && routeReadReportFailureRef.current) return false;
      const boundSignature = routeRelevantSignature(boundProject);
      const request = ++routeRequestRef.current;
      routeRefreshActiveRef.current = request;
      routeReadReportFailureRef.current = reportFailure;
      capabilityRequestRef.current += 1;
      capabilityReadRef.current = null;
      projectStatusRequestRef.current += 1;
      projectStatusRef.current = null;
      setProjectStatus(null);
      setProjectStatusPending(true);
      try {
        const result = await ipcBridge.creativeStudio.listRoutes.invoke({ projectId: requestedProjectId });
        if (
          activeBindingRef.current !== requestedBinding ||
          generationRef.current !== generation ||
          routeRequestRef.current !== request
        ) {
          return false;
        }
        const current = projectRef.current;
        if (current?.id !== requestedProjectId || routeRelevantSignature(current) !== boundSignature) {
          return false;
        }
        if (result.ok === false) {
          routeCatalogRef.current = null;
          setRouteCatalog(null);
          setGenerationCapability(null);
          if (reportFailure) setRouteErrorMessageKey(result.error.messageKey);
          return false;
        }
        const capabilityResult = await ipcBridge.creativeStudio.getGenerationCapability.invoke({
          projectId: requestedProjectId,
          expectedRevision: current.revision,
          items: generationCapabilityItems(current),
        });
        if (
          activeBindingRef.current !== requestedBinding ||
          generationRef.current !== generation ||
          routeRequestRef.current !== request
        ) {
          return false;
        }
        const latestProject = projectRef.current;
        if (latestProject?.id !== requestedProjectId || routeRelevantSignature(latestProject) !== boundSignature) {
          return false;
        }
        if (latestProject.revision !== current.revision) {
          // The provider snapshot is still valid for an unchanged route signature. Install it, then
          // let the queued capability read derive against the newest project revision.
          routeCatalogRef.current = result.data as StudioRouteCatalogV2;
          setRouteCatalog(result.data as StudioRouteCatalogV2);
          setGenerationCapability(null);
          setRouteErrorMessageKey(null);
          capabilityRefreshReportFailureRef.current ||= reportFailure;
          capabilityRefreshPendingRef.current = true;
          return false;
        }
        if (
          capabilityResult.ok === false ||
          capabilityResult.data.projectId !== requestedProjectId ||
          capabilityResult.data.projectRevision !== current.revision ||
          capabilityResult.data.catalogVersion !== result.data.catalogVersion
        ) {
          routeCatalogRef.current = null;
          setRouteCatalog(null);
          setGenerationCapability(null);
          if (reportFailure) {
            setRouteErrorMessageKey(
              capabilityResult.ok === false
                ? capabilityResult.error.messageKey
                : 'conversation.creativeStudio.workspace.errors.storage'
            );
          }
          return false;
        }
        routeCatalogRef.current = result.data as StudioRouteCatalogV2;
        setRouteCatalog(result.data as StudioRouteCatalogV2);
        setGenerationCapability(capabilityResult.data as StudioGenerationCapabilityV2);
        setRouteErrorMessageKey(null);
        return true;
      } catch {
        if (
          activeBindingRef.current === requestedBinding &&
          generationRef.current === generation &&
          routeRequestRef.current === request
        ) {
          routeCatalogRef.current = null;
          setRouteCatalog(null);
          setGenerationCapability(null);
          if (reportFailure) setRouteErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        }
        return false;
      } finally {
        if (routeRefreshActiveRef.current === request) {
          routeRefreshActiveRef.current = null;
          routeReadReportFailureRef.current = false;
          if (capabilityRefreshPendingRef.current) {
            const pendingReportFailure = capabilityRefreshReportFailureRef.current;
            capabilityRefreshPendingRef.current = false;
            capabilityRefreshReportFailureRef.current = false;
            void loadGenerationCapability(requestedBinding, generation, pendingReportFailure);
          }
        }
      }
    },
    [loadGenerationCapability]
  );

  const applyExportCatalog = useCallback((requestedBinding: StudioProjectBinding, value: unknown): boolean => {
    if (activeBindingRef.current !== requestedBinding) return false;
    const currentProject = projectRef.current;
    if (requestedBinding.projectId === undefined || currentProject?.id !== requestedBinding.projectId) return false;
    const sanitized = currentProject === null ? null : sanitizeExportCatalog(value, currentProject.revision);
    if (sanitized === null) {
      exportCatalogRef.current = null;
      setExportCatalog(null);
      setExportErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      return false;
    }
    const current = exportCatalogRef.current;
    if (current !== null && sanitized.revision < current.revision) return false;
    if (
      current !== null &&
      sanitized.revision === current.revision &&
      JSON.stringify(sanitized) !== JSON.stringify(current)
    ) {
      exportCatalogRef.current = null;
      setExportCatalog(null);
      setExportErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      return false;
    }
    exportCatalogRef.current = sanitized;
    setExportCatalog(sanitized);
    setExportErrorMessageKey(null);
    return true;
  }, []);

  const loadExports = useCallback(
    async (requestedBinding: StudioProjectBinding, generation: number): Promise<boolean> => {
      const requestedProjectId = requestedBinding.projectId;
      if (
        requestedProjectId === undefined ||
        activeBindingRef.current !== requestedBinding ||
        generationRef.current !== generation
      ) {
        return false;
      }
      const request = ++exportRequestRef.current;
      try {
        const result = await ipcBridge.creativeStudio.listExports.invoke({ projectId: requestedProjectId });
        if (
          activeBindingRef.current !== requestedBinding ||
          generationRef.current !== generation ||
          exportRequestRef.current !== request
        ) {
          return false;
        }
        if (result.ok === false) {
          exportCatalogRef.current = null;
          setExportCatalog(null);
          setExportErrorMessageKey(result.error.messageKey);
          return false;
        }
        return applyExportCatalog(requestedBinding, result.data);
      } catch {
        if (
          activeBindingRef.current === requestedBinding &&
          generationRef.current === generation &&
          exportRequestRef.current === request
        ) {
          exportCatalogRef.current = null;
          setExportCatalog(null);
          setExportErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        }
        return false;
      }
    },
    [applyExportCatalog]
  );

  const loadFilmExportCapability = useCallback(
    async (requestedBinding: StudioProjectBinding, generation: number): Promise<void> => {
      const requestedProjectId = requestedBinding.projectId;
      if (
        requestedProjectId === undefined ||
        activeBindingRef.current !== requestedBinding ||
        generationRef.current !== generation
      ) {
        return;
      }
      const request = ++filmCapabilityRequestRef.current;
      try {
        const result = await ipcBridge.creativeStudio.getFilmExportCapability.invoke({ projectId: requestedProjectId });
        if (
          activeBindingRef.current !== requestedBinding ||
          generationRef.current !== generation ||
          filmCapabilityRequestRef.current !== request
        ) {
          return;
        }
        if (result.ok === false) {
          setFilmExportCapability(null);
          return;
        }
        setFilmExportCapability(result.data);
      } catch {
        if (
          activeBindingRef.current === requestedBinding &&
          generationRef.current === generation &&
          filmCapabilityRequestRef.current === request
        ) {
          setFilmExportCapability(null);
        }
      }
    },
    []
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    unreconciledProposalDecisionIdsRef.current.clear();
    pendingProposalDecisionEventIdsRef.current.clear();
    proposalDecisionProjectRevisionsRef.current.clear();
    activeProposalDecisionAttemptsRef.current.clear();
    routeRequestRef.current += 1;
    capabilityRequestRef.current += 1;
    filmCapabilityRequestRef.current += 1;
    projectStatusRequestRef.current += 1;
    routeRefreshActiveRef.current = null;
    routeReadReportFailureRef.current = false;
    capabilityRefreshPendingRef.current = false;
    capabilityRefreshReportFailureRef.current = false;
    capabilityReadRef.current = null;
    referencePairReadRef.current = null;
    const boundProjectId = binding.projectId;

    if (!boundProjectId) {
      projectRef.current = null;
      setProjectWorkspace({ project: null, workspaceStatus: null, chainStatus: null });
      projectStatusRef.current = null;
      setProjectStatus(null);
      setProjectStatusPending(false);
      setProposals([]);
      proposalCatalogRef.current = null;
      setProposalCatalog(null);
      setProposalRefreshing(false);
      setReferenceRequests([]);
      setReferenceGenerationHandoffs([]);
      routeCatalogRef.current = null;
      setRouteCatalog(null);
      setGenerationCapability(null);
      setFilmExportCapability(null);
      exportCatalogRef.current = null;
      setExportCatalog(null);
      setLoadState('idle');
      setErrorMessageKey(null);
      setProposalErrorMessageKey(null);
      setReferenceErrorMessageKey(null);
      setWorkspaceErrorMessageKey(null);
      setRouteErrorMessageKey(null);
      setExportErrorMessageKey(null);
      return;
    }

    setProposals([]);
    proposalCatalogRef.current = null;
    setProposalCatalog(null);
    setProposalRefreshing(false);
    setReferenceRequests([]);
    setReferenceGenerationHandoffs([]);
    setProposalErrorMessageKey(null);
    setReferenceErrorMessageKey(null);
    projectRef.current = null;
    setProjectWorkspace({ project: null, workspaceStatus: null, chainStatus: null });
    projectStatusRef.current = null;
    setProjectStatus(null);
    setProjectStatusPending(true);
    routeCatalogRef.current = null;
    setRouteCatalog(null);
    setGenerationCapability(null);
    setFilmExportCapability(null);
    exportCatalogRef.current = null;
    setExportCatalog(null);
    setWorkspaceErrorMessageKey(null);
    setRouteErrorMessageKey(null);
    setExportErrorMessageKey(null);

    const unsubscribeProject = ipcBridge.creativeStudio.projectUpdated.on(
      ({ projectId: updatedProjectId, projectRevision: updatedProjectRevision }) => {
        if (updatedProjectId === boundProjectId && activeBindingRef.current === binding) {
          const revisionTagged =
            typeof updatedProjectRevision === 'number' &&
            Number.isSafeInteger(updatedProjectRevision) &&
            updatedProjectRevision >= 1;
          const activeDecisionEvent =
            revisionTagged &&
            [...activeProposalDecisionAttemptsRef.current.values()].some(
              (attempt) => attempt.binding === binding && attempt.expectedProjectRevision === updatedProjectRevision
            );
          const currentRevision = projectRef.current?.revision ?? null;
          const alreadyInstalledEvent =
            revisionTagged && currentRevision !== null && updatedProjectRevision <= currentRevision;
          const expectedDecisionEvent =
            revisionTagged && proposalDecisionProjectRevisionsRef.current.has(updatedProjectRevision);
          const reportFailure = !activeDecisionEvent && !alreadyInstalledEvent && !expectedDecisionEvent;
          void (async () => {
            if ((await loadProjectWorkspace(binding, generation, false, reportFailure)) !== null) {
              await Promise.all([
                loadProposals(binding, generation, reportFailure),
                (async () => {
                  await (routeCatalogRef.current === null
                    ? loadRoutes(binding, generation, reportFailure)
                    : loadGenerationCapability(binding, generation, reportFailure));
                  await loadProjectStatus(binding, generation);
                })(),
              ]);
            }
          })();
          // Reference handoff progress is projected from project-owned job state. Job transitions emit
          // projectUpdated, not a reference-sidecar event, so refresh both authorities from this signal.
          void loadReferences(binding, generation, reportFailure);
        }
      }
    );
    const unsubscribeProposal = ipcBridge.creativeStudio.proposalUpdated.on(
      ({ projectId: updatedProjectId, proposalId: updatedProposalId }) => {
        if (updatedProjectId === boundProjectId && activeBindingRef.current === binding) {
          const activeAttempt = activeProposalDecisionAttemptsRef.current.get(updatedProposalId);
          const expectedDecisionEvent = pendingProposalDecisionEventIdsRef.current.delete(updatedProposalId);
          const reportFailure =
            activeAttempt?.binding !== binding &&
            !unreconciledProposalDecisionIdsRef.current.has(updatedProposalId) &&
            !expectedDecisionEvent;
          void loadProposals(binding, generation, reportFailure);
        }
      }
    );
    const unsubscribeReference = ipcBridge.creativeStudio.referenceUpdated.on(({ projectId: updatedProjectId }) => {
      if (updatedProjectId === boundProjectId && activeBindingRef.current === binding) {
        void loadReferences(binding, generation);
      }
    });

    void (async () => {
      if ((await loadProjectWorkspace(binding, generation, true)) !== null) {
        await Promise.all([
          loadProposals(binding, generation),
          (async () => {
            await loadRoutes(binding, generation);
            await loadProjectStatus(binding, generation);
          })(),
          loadExports(binding, generation),
          loadFilmExportCapability(binding, generation),
        ]);
      }
    })();
    void loadReferences(binding, generation);

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      unsubscribeProject();
      unsubscribeProposal();
      unsubscribeReference();
    };
  }, [
    binding,
    loadExports,
    loadFilmExportCapability,
    loadGenerationCapability,
    loadProjectWorkspace,
    loadProjectStatus,
    loadProposals,
    loadReferences,
    loadRoutes,
  ]);

  const refetchProjectWorkspace = useCallback(async (): Promise<StudioRendererProjectV2 | null> => {
    if (binding.projectId === undefined || activeBindingRef.current !== binding) return null;
    const generation = generationRef.current;
    const refreshed = await loadProjectWorkspace(binding, generation, false);
    if (refreshed !== null) {
      void (async () => {
        if (routeCatalogRef.current !== null) await loadGenerationCapability(binding, generation);
        await loadProjectStatus(binding, generation);
      })();
    }
    return refreshed;
  }, [binding, loadGenerationCapability, loadProjectStatus, loadProjectWorkspace]);

  const reconcileProjectWorkspace = useCallback(async (): Promise<StudioRendererProjectV2 | null> => {
    if (binding.projectId === undefined || activeBindingRef.current !== binding) return null;
    const generation = generationRef.current;
    const refreshed = await loadProjectWorkspace(binding, generation, false, false, true);
    if (refreshed !== null) {
      void Promise.all([
        loadProposals(binding, generation, false),
        (async () => {
          await (routeCatalogRef.current === null
            ? loadRoutes(binding, generation, false)
            : loadGenerationCapability(binding, generation, false));
          await loadProjectStatus(binding, generation);
        })(),
      ]);
    }
    return refreshed;
  }, [binding, loadGenerationCapability, loadProjectStatus, loadProjectWorkspace, loadProposals, loadRoutes]);

  const refetchProposals = useCallback(async (): Promise<StudioRendererProposalCatalogV2 | null> => {
    if (binding.projectId === undefined || activeBindingRef.current !== binding) return null;
    const generation = generationRef.current;
    return loadProposals(binding, generation);
  }, [binding, loadProposals]);

  const refetchReferences = useCallback(async (): Promise<void> => {
    if (binding.projectId === undefined || activeBindingRef.current !== binding) return;
    const generation = generationRef.current;
    await loadReferences(binding, generation);
  }, [binding, loadReferences]);

  const refetchRoutes = useCallback(async (): Promise<boolean> => {
    if (binding.projectId === undefined || activeBindingRef.current !== binding) return false;
    const generation = generationRef.current;
    const refreshed = await loadRoutes(binding, generation);
    await loadProjectStatus(binding, generation);
    return refreshed;
  }, [binding, loadProjectStatus, loadRoutes]);

  const refetchExports = useCallback(async (): Promise<boolean> => {
    if (binding.projectId === undefined || activeBindingRef.current !== binding) return false;
    const generation = generationRef.current;
    return loadExports(binding, generation);
  }, [binding, loadExports]);

  const installExportCatalog = useCallback(
    (catalog: StudioRendererExportCatalogV2): boolean => {
      if (
        binding.projectId === undefined ||
        activeBindingRef.current !== binding ||
        projectRef.current?.id !== binding.projectId
      ) {
        return false;
      }
      exportRequestRef.current += 1;
      return applyExportCatalog(binding, catalog);
    },
    [applyExportCatalog, binding]
  );

  const refetchAll = useCallback(async (): Promise<void> => {
    if (binding.projectId === undefined || activeBindingRef.current !== binding) return;
    const generation = generationRef.current;
    const refreshed = await loadProjectWorkspace(binding, generation, false);
    if (refreshed !== null) {
      await Promise.all([
        loadProposals(binding, generation),
        loadReferences(binding, generation),
        (async () => {
          await loadRoutes(binding, generation);
          await loadProjectStatus(binding, generation);
        })(),
        loadExports(binding, generation),
      ]);
    }
  }, [binding, loadExports, loadProjectStatus, loadProjectWorkspace, loadProposals, loadReferences, loadRoutes]);

  return {
    project,
    proposals,
    proposalCatalog,
    proposalRefreshing,
    referenceRequests,
    referenceGenerationHandoffs,
    workspaceStatus,
    chainStatus,
    projectStatus,
    projectStatusPending,
    routeCatalog,
    generationCapability,
    filmExportCapability,
    exportCatalog,
    loadState,
    errorMessageKey,
    proposalErrorMessageKey,
    referenceErrorMessageKey,
    workspaceErrorMessageKey,
    routeErrorMessageKey,
    exportErrorMessageKey,
    beginProposalDecisionReconciliation,
    refetchProjectWorkspace,
    reconcileProjectWorkspace,
    refetchProposals,
    refetchReferences,
    refetchRoutes,
    refetchExports,
    installExportCatalog,
    refetchAll,
  };
};
