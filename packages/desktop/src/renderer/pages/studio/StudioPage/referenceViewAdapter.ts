/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { ipcBridge } from '@/common';
import {
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_REFERENCE_LABEL_LENGTH,
  STUDIO_MAX_REFERENCE_PROMPT_LENGTH,
  type StudioCommandResult,
  type StudioGenerationCapabilityItemV2,
  type StudioGenerationCapabilityV2,
  type StudioReferenceRequestV2,
  type StudioRendererAuthoringOperationV2,
  type StudioRendererJobV2,
  type StudioRendererProjectCommitResultV2,
  type StudioRendererProjectV2,
  type StudioRendererReferenceGenerationHandoffV2,
  type StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  type ReferencesViewActions,
  type TableReferenceBindingActions,
  type UseSpendGateResult,
} from '../components/Workspace';
import { generationBlockGroupsForItems } from '../components/Workspace/Gate/generationBlockers';
import { deriveReferenceRemovalBlockers } from '../components/Workspace/Views/References/referenceRemovalBlockers';
import type { StudioView } from '../studioPhaseRoute';

type MutableValueRef<Value> = { current: Value };

type StudioRunWorkspaceCommit = (
  invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererProjectCommitResultV2>>,
  onCommitted?: () => void
) => Promise<boolean>;

type StudioRunJobRecovery = (
  jobId: string,
  isAuthorized: (job: StudioRendererJobV2, project: StudioRendererProjectV2) => boolean,
  invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererJobV2>>,
  options?: { refreshBeforeInvoke?: boolean }
) => Promise<boolean>;

type StudioRunReferenceJobRecovery = (
  referenceId: string,
  jobId: string,
  isAuthorized: (job: StudioRendererJobV2) => boolean,
  invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererJobV2>>
) => Promise<boolean>;

export const referenceCapabilityItems = (referenceIds: readonly string[]): StudioGenerationCapabilityItemV2[] =>
  referenceIds.map((referenceId) => ({
    target: { kind: 'reference', referenceId },
    purpose: 'reference_image',
  }));

type StudioReferenceJobRecoveryInput = {
  projectRef: MutableValueRef<StudioRendererProjectV2 | null>;
  workspacePendingRef: MutableValueRef<boolean>;
  pendingReferenceId: string | null;
  setPendingReferenceId: Dispatch<SetStateAction<string | null>>;
  spendGateLocked: boolean;
  runJobRecovery: StudioRunJobRecovery;
  refetchReferences: () => Promise<void>;
};

export const useStudioReferenceJobRecovery = ({
  projectRef,
  workspacePendingRef,
  pendingReferenceId,
  setPendingReferenceId,
  spendGateLocked,
  runJobRecovery,
  refetchReferences,
}: StudioReferenceJobRecoveryInput): StudioRunReferenceJobRecovery => {
  const runReferenceJobRecovery = useCallback(
    async (
      referenceId: string,
      jobId: string,
      isAuthorized: (job: StudioRendererJobV2) => boolean,
      invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererJobV2>>
    ): Promise<boolean> => {
      const current = projectRef.current;
      const reference =
        current !== null && Object.hasOwn(current.references, referenceId)
          ? current.references[referenceId]
          : undefined;
      if (
        current === null ||
        reference?.id !== referenceId ||
        !reference.jobIds.includes(jobId) ||
        current.referenceOrder.filter((candidateId) => candidateId === referenceId).length !== 1 ||
        pendingReferenceId !== null ||
        workspacePendingRef.current ||
        spendGateLocked
      ) {
        return false;
      }
      setPendingReferenceId(referenceId);
      try {
        const recovered = await runJobRecovery(
          jobId,
          (job, authority) => {
            const exactReference = Object.hasOwn(authority.references, referenceId)
              ? authority.references[referenceId]
              : undefined;
            return (
              exactReference?.id === referenceId &&
              exactReference.jobIds.includes(job.id) &&
              authority.referenceOrder.filter((candidateId) => candidateId === referenceId).length === 1 &&
              job.target.kind === 'reference' &&
              job.target.referenceId === referenceId &&
              job.purpose === 'reference_image' &&
              isAuthorized(job)
            );
          },
          invoke
        );
        if (recovered) await refetchReferences();
        return recovered;
      } finally {
        setPendingReferenceId((pendingId) => (pendingId === referenceId ? null : pendingId));
      }
    },
    [pendingReferenceId, refetchReferences, runJobRecovery, spendGateLocked]
  );
  return runReferenceJobRecovery;
};

type StudioReferenceViewAdapterInput = {
  projectId: string;
  projectRef: MutableValueRef<StudioRendererProjectV2 | null>;
  workspacePendingRef: MutableValueRef<boolean>;
  pendingReferenceId: string | null;
  setPendingReferenceId: Dispatch<SetStateAction<string | null>>;
  setWorkspacePending: (pending: boolean) => void;
  setActionErrorMessageKey: (messageKey: string | null) => void;
  runWorkspaceCommit: StudioRunWorkspaceCommit;
  runJobRecovery: StudioRunJobRecovery;
  runReferenceJobRecovery: StudioRunReferenceJobRecovery;
  refetchProjectWorkspace: () => Promise<StudioRendererProjectV2 | null>;
  chooseStudioView: (view: StudioView) => void;
  currentGenerationCapability: StudioGenerationCapabilityV2 | null;
  routeCatalog: StudioRouteCatalogV2 | null;
  generationDraftsBlockReview: boolean;
  referenceRequests: readonly StudioReferenceRequestV2[];
  referenceGenerationHandoffs: readonly StudioRendererReferenceGenerationHandoffV2[];
  spendGateOpen: UseSpendGateResult['open'];
  spendGateLocked: boolean;
};

export const useStudioReferenceViewAdapter = ({
  projectId,
  projectRef,
  workspacePendingRef,
  pendingReferenceId,
  setPendingReferenceId,
  setWorkspacePending,
  setActionErrorMessageKey,
  runWorkspaceCommit,
  runJobRecovery,
  runReferenceJobRecovery,
  refetchProjectWorkspace,
  chooseStudioView,
  currentGenerationCapability,
  routeCatalog,
  generationDraftsBlockReview,
  referenceRequests,
  referenceGenerationHandoffs,
  spendGateOpen,
  spendGateLocked,
}: StudioReferenceViewAdapterInput): ReferencesViewActions & TableReferenceBindingActions => {
  const referenceActions = useMemo<ReferencesViewActions & TableReferenceBindingActions>(
    () => ({
      addBackground: async ({ label, prompt }): Promise<boolean> => {
        const current = projectRef.current;
        const trimmedLabel = label.trim();
        const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
        if (
          current === null ||
          current.referencePlanStatus !== 'planned' ||
          current.referenceOrder.length >= STUDIO_MAX_PROJECT_REFERENCES ||
          trimmedLabel.length === 0 ||
          trimmedLabel.length > STUDIO_MAX_REFERENCE_LABEL_LENGTH ||
          trimmedPrompt.length === 0 ||
          trimmedPrompt.length > STUDIO_MAX_REFERENCE_PROMPT_LENGTH ||
          current.referenceOrder.some((referenceId) => {
            const reference = Object.hasOwn(current.references, referenceId)
              ? current.references[referenceId]
              : undefined;
            return reference?.kind === 'background' && reference.label === trimmedLabel;
          }) ||
          workspacePendingRef.current ||
          spendGateLocked
        ) {
          return false;
        }
        const previousReferenceOrder = [...current.referenceOrder];
        const committed = await runWorkspaceCommit((latest) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: latest.id,
            expectedRevision: latest.revision,
            operations: [
              {
                kind: 'amend_reference_plan',
                additions: [{ kind: 'background', label: trimmedLabel, prompt: trimmedPrompt }],
              },
            ],
          })
        );
        if (!committed) return false;
        const refreshed = projectRef.current;
        const appendedReferenceId = refreshed?.referenceOrder[previousReferenceOrder.length];
        const appendedReference =
          refreshed !== null &&
          appendedReferenceId !== undefined &&
          Object.hasOwn(refreshed.references, appendedReferenceId)
            ? refreshed.references[appendedReferenceId]
            : undefined;
        if (
          refreshed === null ||
          refreshed.referenceOrder.length !== previousReferenceOrder.length + 1 ||
          previousReferenceOrder.some((referenceId, index) => refreshed.referenceOrder[index] !== referenceId) ||
          appendedReference?.kind !== 'background' ||
          appendedReference.label !== trimmedLabel ||
          appendedReference.prompt !== trimmedPrompt ||
          appendedReference.approvedAssetId !== null
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        return true;
      },
      updateDetails: async (referenceId, { label, prompt }): Promise<boolean> => {
        const current = projectRef.current;
        const reference =
          current !== null && Object.hasOwn(current.references, referenceId)
            ? current.references[referenceId]
            : undefined;
        const trimmedLabel = typeof label === 'string' ? label.trim() : '';
        const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
        if (
          current === null ||
          current.referencePlanStatus !== 'planned' ||
          reference?.id !== referenceId ||
          trimmedLabel.length === 0 ||
          trimmedLabel.length > STUDIO_MAX_REFERENCE_LABEL_LENGTH ||
          trimmedPrompt.length === 0 ||
          trimmedPrompt.length > STUDIO_MAX_REFERENCE_PROMPT_LENGTH ||
          current.referenceOrder.some((candidateId) => {
            const candidate = Object.hasOwn(current.references, candidateId)
              ? current.references[candidateId]
              : undefined;
            return (
              candidate?.id !== referenceId && candidate?.kind === reference.kind && candidate.label === trimmedLabel
            );
          }) ||
          workspacePendingRef.current ||
          pendingReferenceId !== null ||
          spendGateLocked
        ) {
          return false;
        }
        const operations: StudioRendererAuthoringOperationV2[] = [];
        if (trimmedLabel !== reference.label) {
          operations.push({ kind: 'set_reference_label', referenceId, label: trimmedLabel });
        }
        if (trimmedPrompt !== reference.prompt) {
          operations.push({ kind: 'set_reference_prompt', referenceId, prompt: trimmedPrompt });
        }
        if (operations.length === 0) return true;
        setPendingReferenceId(referenceId);
        try {
          const committed = await runWorkspaceCommit((latest) =>
            ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
              projectId: latest.id,
              expectedRevision: latest.revision,
              operations,
            })
          );
          if (!committed) return false;
          const refreshed = projectRef.current;
          const updated =
            refreshed !== null && Object.hasOwn(refreshed.references, referenceId)
              ? refreshed.references[referenceId]
              : undefined;
          return updated?.label === trimmedLabel && updated.prompt === trimmedPrompt;
        } finally {
          setPendingReferenceId(null);
        }
      },
      selectImage: async (referenceId, assetId): Promise<boolean> => {
        const current = projectRef.current;
        const reference =
          current !== null && Object.hasOwn(current.references, referenceId)
            ? current.references[referenceId]
            : undefined;
        if (
          current === null ||
          reference?.id !== referenceId ||
          reference.approvedAssetId === assetId ||
          !reference.supersededAssetIds.includes(assetId) ||
          workspacePendingRef.current ||
          pendingReferenceId !== null
        ) {
          return false;
        }
        setPendingReferenceId(referenceId);
        try {
          const committed = await runWorkspaceCommit((latest) =>
            ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
              projectId: latest.id,
              expectedRevision: latest.revision,
              operations: [{ kind: 'select_reference_image', referenceId, assetId }],
            })
          );
          if (!committed) return false;
          const refreshed = projectRef.current;
          return (
            refreshed !== null &&
            Object.hasOwn(refreshed.references, referenceId) &&
            refreshed.references[referenceId]?.approvedAssetId === assetId
          );
        } finally {
          setPendingReferenceId(null);
        }
      },
      removeImage: async (referenceId, assetId): Promise<boolean> => {
        const current = projectRef.current;
        const reference =
          current !== null && Object.hasOwn(current.references, referenceId)
            ? current.references[referenceId]
            : undefined;
        if (
          current === null ||
          reference?.id !== referenceId ||
          reference.approvedAssetId !== assetId ||
          workspacePendingRef.current ||
          pendingReferenceId !== null ||
          spendGateLocked
        ) {
          return false;
        }
        const visibleAssetIds = [...new Set([assetId, ...reference.supersededAssetIds])].toSorted((left, right) => {
          const leftAsset = Object.hasOwn(current.assets, left) ? current.assets[left] : undefined;
          const rightAsset = Object.hasOwn(current.assets, right) ? current.assets[right] : undefined;
          const byCreatedAt = (leftAsset?.createdAt ?? '').localeCompare(rightAsset?.createdAt ?? '');
          return byCreatedAt === 0 ? left.localeCompare(right) : byCreatedAt;
        });
        const removedIndex = visibleAssetIds.indexOf(assetId);
        if (removedIndex < 0) return false;
        const remainingAssetIds = visibleAssetIds.filter((candidateId) => candidateId !== assetId);
        const expectedApprovedAssetId =
          remainingAssetIds.length === 0
            ? null
            : remainingAssetIds[Math.min(Math.max(0, removedIndex - 1), remainingAssetIds.length - 1)]!;
        const expectedSupersededAssetIds =
          expectedApprovedAssetId === null
            ? []
            : remainingAssetIds.filter((candidateId) => candidateId !== expectedApprovedAssetId);
        const referenceJobIdsBefore = [...reference.jobIds];
        const referenceAssetsBefore = Object.fromEntries(
          Object.entries(current.assets).filter(([, candidate]) => candidate.projectReferenceId === referenceId)
        );
        const referenceJobsBefore = Object.fromEntries(
          reference.jobIds.flatMap((jobId) =>
            Object.hasOwn(current.jobs, jobId) ? ([[jobId, current.jobs[jobId]]] as const) : []
          )
        );
        const bindingsBefore = Object.fromEntries(
          Object.entries(current.shots).map(([shotId, shot]) => [shotId, shot.referenceBinding])
        );
        setPendingReferenceId(referenceId);
        try {
          const committed = await runWorkspaceCommit((latest) =>
            ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
              projectId: latest.id,
              expectedRevision: latest.revision,
              operations: [{ kind: 'remove_reference_image', referenceId, assetId }],
            })
          );
          if (!committed) return false;
          const refreshed = projectRef.current;
          if (refreshed === null || !Object.hasOwn(refreshed.references, referenceId)) return false;
          const updated = refreshed.references[referenceId];
          return (
            updated?.id === referenceId &&
            updated.approvedAssetId === expectedApprovedAssetId &&
            JSON.stringify(updated.supersededAssetIds) === JSON.stringify(expectedSupersededAssetIds) &&
            JSON.stringify(updated.jobIds) === JSON.stringify(referenceJobIdsBefore) &&
            JSON.stringify(
              Object.fromEntries(
                Object.entries(refreshed.assets).filter(([, candidate]) => candidate.projectReferenceId === referenceId)
              )
            ) === JSON.stringify(referenceAssetsBefore) &&
            JSON.stringify(
              Object.fromEntries(
                referenceJobIdsBefore.flatMap((jobId) =>
                  Object.hasOwn(refreshed.jobs, jobId) ? ([[jobId, refreshed.jobs[jobId]]] as const) : []
                )
              )
            ) === JSON.stringify(referenceJobsBefore) &&
            JSON.stringify(
              Object.fromEntries(
                Object.entries(refreshed.shots).map(([shotId, shot]) => [shotId, shot.referenceBinding])
              )
            ) === JSON.stringify(bindingsBefore)
          );
        } finally {
          setPendingReferenceId(null);
        }
      },
      importPhoto: async (referenceId): Promise<boolean> => {
        const current = projectRef.current;
        const reference =
          current !== null && Object.hasOwn(current.references, referenceId)
            ? current.references[referenceId]
            : undefined;
        if (
          current === null ||
          current.referencePlanStatus !== 'planned' ||
          reference?.id !== referenceId ||
          workspacePendingRef.current ||
          pendingReferenceId !== null ||
          spendGateLocked
        ) {
          return false;
        }
        const existingAssets = structuredClone(current.assets);
        const existingJobs = structuredClone(current.jobs);
        const bindingsBefore = Object.fromEntries(
          Object.entries(current.shots).map(([shotId, shot]) => [shotId, shot.referenceBinding])
        );
        const approvalsBefore = Object.fromEntries(
          current.referenceOrder.map((candidateId) => [
            candidateId,
            Object.hasOwn(current.references, candidateId)
              ? current.references[candidateId]?.approvedAssetId
              : undefined,
          ])
        );
        const referenceJobIdsBefore = [...reference.jobIds];
        const priorApprovedAssetId = reference.approvedAssetId;
        workspacePendingRef.current = true;
        setWorkspacePending(true);
        setPendingReferenceId(referenceId);
        setActionErrorMessageKey(null);
        try {
          const result = await ipcBridge.creativeStudio.importReferenceImage.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            referenceId,
          });
          if (result.ok === false) {
            setActionErrorMessageKey(result.error.messageKey);
            return false;
          }
          if (result.data.status === 'cancelled') return false;
          const refreshed = await refetchProjectWorkspace();
          const updatedReference =
            refreshed !== null && Object.hasOwn(refreshed.references, referenceId)
              ? refreshed.references[referenceId]
              : undefined;
          const importedAsset =
            refreshed !== null && Object.hasOwn(refreshed.assets, result.data.assetId)
              ? refreshed.assets[result.data.assetId]
              : undefined;
          const preservedAssets = Object.entries(existingAssets).every(
            ([assetId, asset]) =>
              refreshed !== null &&
              Object.hasOwn(refreshed.assets, assetId) &&
              JSON.stringify(refreshed.assets[assetId]) === JSON.stringify(asset)
          );
          const preservedApprovals = Object.entries(approvalsBefore).every(
            ([candidateId, approval]) =>
              candidateId === referenceId ||
              (refreshed !== null &&
                Object.hasOwn(refreshed.references, candidateId) &&
                refreshed.references[candidateId]?.approvedAssetId === approval)
          );
          if (
            refreshed === null ||
            refreshed.revision < result.data.projectRevision ||
            updatedReference?.approvedAssetId !== result.data.assetId ||
            (priorApprovedAssetId !== null && !updatedReference.supersededAssetIds.includes(priorApprovedAssetId)) ||
            JSON.stringify(updatedReference.jobIds) !== JSON.stringify(referenceJobIdsBefore) ||
            importedAsset?.projectReferenceId !== referenceId ||
            importedAsset.shotId !== null ||
            importedAsset.mediaKind !== 'image' ||
            importedAsset.managedAsset.collection !== 'imports' ||
            importedAsset.producerJobId !== null ||
            importedAsset.compositionDigest !== null ||
            !preservedAssets ||
            JSON.stringify(refreshed.jobs) !== JSON.stringify(existingJobs) ||
            JSON.stringify(
              Object.fromEntries(
                Object.entries(refreshed.shots).map(([shotId, shot]) => [shotId, shot.referenceBinding])
              )
            ) !== JSON.stringify(bindingsBefore) ||
            !preservedApprovals
          ) {
            setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
            return false;
          }
          projectRef.current = refreshed;
          return true;
        } catch {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        } finally {
          workspacePendingRef.current = false;
          setWorkspacePending(false);
          setPendingReferenceId(null);
        }
      },
      regenerate: async (referenceId, prompt): Promise<boolean> => {
        const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
        let current = projectRef.current;
        let reference =
          current !== null && Object.hasOwn(current.references, referenceId)
            ? current.references[referenceId]
            : undefined;
        if (
          current === null ||
          reference?.id !== referenceId ||
          trimmedPrompt.length === 0 ||
          trimmedPrompt.length > STUDIO_MAX_REFERENCE_PROMPT_LENGTH ||
          workspacePendingRef.current ||
          pendingReferenceId !== null ||
          spendGateLocked
        ) {
          return false;
        }
        if (reference.prompt !== trimmedPrompt) {
          setPendingReferenceId(referenceId);
          try {
            if (
              !(await runWorkspaceCommit((latest) =>
                ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
                  projectId: latest.id,
                  expectedRevision: latest.revision,
                  operations: [{ kind: 'set_reference_prompt', referenceId, prompt: trimmedPrompt }],
                })
              ))
            ) {
              return false;
            }
          } finally {
            setPendingReferenceId(null);
          }
          current = projectRef.current;
          reference =
            current !== null && Object.hasOwn(current.references, referenceId)
              ? current.references[referenceId]
              : undefined;
          if (current === null || reference?.prompt !== trimmedPrompt) return false;
        }
        const candidateJob =
          current === null || reference?.id !== referenceId
            ? undefined
            : [...reference.jobIds]
                .toReversed()
                .map((jobId) => (Object.hasOwn(current.jobs, jobId) ? current.jobs[jobId] : undefined))
                .find(
                  (job) =>
                    job?.target.kind === 'reference' &&
                    job.target.referenceId === referenceId &&
                    job.purpose === 'reference_image'
                );
        const generationAlreadyRequested =
          referenceRequests.some((request) => request.referenceIds.includes(referenceId)) ||
          referenceGenerationHandoffs.some(
            (handoff) => handoff.status === 'awaiting_spend' && handoff.referenceIds.includes(referenceId)
          );
        if (
          current === null ||
          reference?.id !== referenceId ||
          !current.referenceOrder.includes(referenceId) ||
          workspacePendingRef.current ||
          pendingReferenceId !== null ||
          candidateJob?.status === 'queued_local' ||
          candidateJob?.status === 'submitting' ||
          candidateJob?.status === 'queued_remote' ||
          candidateJob?.status === 'running' ||
          candidateJob?.status === 'needs_attention' ||
          candidateJob?.canRetryDownload === true
        ) {
          return false;
        }
        if (generationAlreadyRequested) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.gate.errors.pricing.inFlight');
          return false;
        }
        if (generationDraftsBlockReview) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
          return false;
        }
        if (routeCatalog === null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.routeCatalogRequired');
          return false;
        }
        if (
          currentGenerationCapability === null &&
          (current.imageRouteId === null || routeCatalog.image.status !== 'ready')
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
          return false;
        }
        if (
          reference.kind === 'background' &&
          current.referenceOrder.some((candidateId) => {
            const candidate = Object.hasOwn(current.references, candidateId)
              ? current.references[candidateId]
              : undefined;
            return candidate?.kind === 'character' && candidate.approvedAssetId === null;
          })
        ) {
          setActionErrorMessageKey(
            'conversation.creativeStudio.workspace.referenceWorkflow.backgrounds.charactersRequired'
          );
          return false;
        }
        const disclosureGroups = generationBlockGroupsForItems(
          currentGenerationCapability,
          referenceCapabilityItems([reference.id])
        );
        setActionErrorMessageKey(null);
        spendGateOpen(
          { projectId: current.id, expectedRevision: current.revision, referenceIds: [reference.id] },
          undefined,
          disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: true }
        );
        return true;
      },
      retryJob: async (referenceId, jobId, acknowledgePossibleDuplicateCharge): Promise<boolean> =>
        runReferenceJobRecovery(
          referenceId,
          jobId,
          (job) =>
            job.status === 'needs_attention' &&
            job.canRetry &&
            acknowledgePossibleDuplicateCharge === (job.error?.code === 'submission_unknown'),
          (current) =>
            ipcBridge.creativeStudio.retryJob.invoke({
              projectId: current.id,
              jobId,
              expectedRevision: current.revision,
              acknowledgePossibleDuplicateCharge,
            })
        ),
      retryDownload: async (referenceId, jobId): Promise<boolean> =>
        runReferenceJobRecovery(
          referenceId,
          jobId,
          (job) => job.status === 'failed' && job.error?.code === 'download_failed' && job.canRetryDownload,
          (current) =>
            ipcBridge.creativeStudio.retryDownload.invoke({
              projectId: current.id,
              jobId,
              expectedRevision: current.revision,
            })
        ),
      retryBlockingDownload: async (claim): Promise<boolean> => {
        const { referenceId, assetId, jobId } = claim;
        const current = projectRef.current;
        const reference =
          current !== null && Object.hasOwn(current.references, referenceId)
            ? current.references[referenceId]
            : undefined;
        if (
          claim.kind !== 'download_recovery' ||
          claim.recoveryAction !== 'retry_download' ||
          claim.status !== 'failed' ||
          referenceId.length === 0 ||
          assetId.length === 0 ||
          jobId.length === 0 ||
          current === null ||
          reference?.id !== referenceId ||
          reference.approvedAssetId !== assetId ||
          current.referenceOrder.filter((candidateId) => candidateId === referenceId).length !== 1 ||
          pendingReferenceId !== null ||
          workspacePendingRef.current ||
          spendGateLocked
        ) {
          return false;
        }
        setPendingReferenceId(referenceId);
        try {
          return await runJobRecovery(
            jobId,
            (job, authority) => {
              const exactReference = Object.hasOwn(authority.references, referenceId)
                ? authority.references[referenceId]
                : undefined;
              const exactAsset = Object.hasOwn(authority.assets, assetId) ? authority.assets[assetId] : undefined;
              const exactRetryBlocker = deriveReferenceRemovalBlockers(authority, referenceId).some(
                (blocker) =>
                  blocker.kind === 'download_recovery' &&
                  blocker.recoveryAction === 'retry_download' &&
                  blocker.jobId === job.id &&
                  blocker.createdAt === claim.createdAt &&
                  blocker.purpose === claim.purpose &&
                  blocker.shotId === claim.shotId
              );
              return (
                exactReference?.id === referenceId &&
                exactReference.approvedAssetId === assetId &&
                authority.referenceOrder.filter((candidateId) => candidateId === referenceId).length === 1 &&
                exactAsset?.id === assetId &&
                exactAsset.projectId === authority.id &&
                exactAsset.projectReferenceId === referenceId &&
                exactAsset.shotId === null &&
                exactAsset.mediaKind === 'image' &&
                job.createdAt === claim.createdAt &&
                job.purpose === claim.purpose &&
                exactRetryBlocker &&
                job.status === 'failed' &&
                job.error?.code === 'download_failed' &&
                job.canRetryDownload &&
                job.composition.inputs.referenceInputs.some(
                  (input) =>
                    input.referenceId === referenceId && input.assetId === assetId && input.sha256 === exactAsset.sha256
                )
              );
            },
            (latest) =>
              ipcBridge.creativeStudio.retryDownload.invoke({
                projectId: latest.id,
                jobId,
                expectedRevision: latest.revision,
              }),
            { refreshBeforeInvoke: true }
          );
        } finally {
          setPendingReferenceId((pendingId) => (pendingId === referenceId ? null : pendingId));
        }
      },
      reviewRetainedShot: async (claim): Promise<boolean> => {
        const exactReviewClaimExists = (authority: StudioRendererProjectV2): boolean => {
          const matches = deriveReferenceRemovalBlockers(authority, claim.referenceId).filter((blocker) => {
            if (
              blocker.kind !== 'download_recovery' ||
              blocker.recoveryAction !== 'restore_shot' ||
              blocker.referenceId !== claim.referenceId ||
              blocker.assetId !== claim.assetId ||
              blocker.jobId !== claim.jobId ||
              blocker.createdAt !== claim.createdAt ||
              blocker.purpose !== claim.purpose ||
              blocker.shotId !== claim.shotId ||
              blocker.retainedOwner.kind !== claim.retainedOwner.kind ||
              blocker.retainedOwner.beatId !== claim.retainedOwner.beatId ||
              blocker.retainedOwner.reason !== claim.retainedOwner.reason
            ) {
              return false;
            }
            return (
              blocker.retainedOwner.kind === 'beat' ||
              (claim.retainedOwner.kind === 'shot' && blocker.retainedOwner.shotId === claim.retainedOwner.shotId)
            );
          });
          return matches.length === 1;
        };
        const current = projectRef.current;
        if (
          claim.kind !== 'download_recovery' ||
          claim.recoveryAction !== 'restore_shot' ||
          claim.status !== 'failed' ||
          claim.referenceId.length === 0 ||
          claim.assetId.length === 0 ||
          claim.jobId.length === 0 ||
          claim.shotId === null ||
          current === null ||
          current.id !== projectId ||
          workspacePendingRef.current ||
          !exactReviewClaimExists(current)
        ) {
          return false;
        }
        workspacePendingRef.current = true;
        setWorkspacePending(true);
        setActionErrorMessageKey(null);
        try {
          const refreshed = await refetchProjectWorkspace();
          if (refreshed === null || refreshed.id !== current.id || refreshed.revision < current.revision) {
            setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
            return false;
          }
          projectRef.current = refreshed;
          if (!exactReviewClaimExists(refreshed)) return false;
          chooseStudioView('board');
          return true;
        } catch {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        } finally {
          workspacePendingRef.current = false;
          setWorkspacePending(false);
        }
      },
      cancelJob: async (referenceId, jobId): Promise<boolean> =>
        runReferenceJobRecovery(
          referenceId,
          jobId,
          (job) => job.canCancel,
          (current) =>
            ipcBridge.creativeStudio.cancelJob.invoke({
              projectId: current.id,
              jobId,
              expectedRevision: current.revision,
            })
        ),
      openBindings: (): void => {
        chooseStudioView('table');
      },
      saveBinding: async (shotId, characterReferenceIds, backgroundReferenceId): Promise<boolean> => {
        const current = projectRef.current;
        const shot = current !== null && Object.hasOwn(current.shots, shotId) ? current.shots[shotId] : undefined;
        if (
          current === null ||
          shot?.id !== shotId ||
          pendingReferenceId !== null ||
          spendGateLocked ||
          new Set(characterReferenceIds).size !== characterReferenceIds.length
        ) {
          return false;
        }
        setPendingReferenceId(shotId);
        try {
          return await runWorkspaceCommit((latest) =>
            ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
              projectId: latest.id,
              expectedRevision: latest.revision,
              operations: [
                {
                  kind: 'set_shot_reference_binding',
                  shotId,
                  characterReferenceIds: [...characterReferenceIds],
                  backgroundReferenceId,
                },
              ],
            })
          );
        } finally {
          setPendingReferenceId(null);
        }
      },
    }),
    [
      currentGenerationCapability,
      chooseStudioView,
      generationDraftsBlockReview,
      pendingReferenceId,
      projectId,
      referenceGenerationHandoffs,
      referenceRequests,
      refetchProjectWorkspace,
      routeCatalog,
      runJobRecovery,
      runReferenceJobRecovery,
      runWorkspaceCommit,
      setActionErrorMessageKey,
      spendGateOpen,
      spendGateLocked,
    ]
  );
  return referenceActions;
};
