/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { ipcBridge } from '@/common';
import {
  type StudioGenerationCapabilityItemV2,
  type StudioGenerationCapabilityV2,
  type StudioRendererProjectV2,
  type StudioRendererReferenceGenerationHandoffV2,
  type StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  boardPromotionGatePlan,
  continuityGateDraft,
  filmRenderBatchShotIds,
  handoffGateDraft,
  selectionGateDraft,
  spendGateDraftIdentity,
  spendGateRouteIssue,
  useSpendGate,
  type BeatPanelReviewGraph,
  type SpendGateBoardPromotion,
  type SpendGateDraft,
  type SpendGateRouteIssue,
  type UseSpendGateResult,
  type WorkspaceProjection,
} from '../components/Workspace';
import { generationBlockForItem, generationBlockGroupsForItems } from '../components/Workspace/Gate/generationBlockers';
import { referenceCapabilityItems } from './referenceViewAdapter';

type MutableValueRef<Value> = { current: Value };
type ReadonlyValueRef<Value> = { readonly current: Value };

type ReviewedActionOwner = { token: number };

export const shotCapabilityItemsForDraft = (draft: SpendGateDraft): StudioGenerationCapabilityItemV2[] =>
  'baseChoices' in draft
    ? [...draft.baseChoices, ...draft.cascadeChoices].flatMap((choice) =>
        choice.target.kind === 'shot'
          ? [
              {
                target: { kind: 'shot' as const, shotId: choice.target.shotId },
                purpose: choice.purpose,
              },
            ]
          : []
      )
    : [];

/** Mirrors Main's prospective continuity scope only to disclose capability blockers before review. */
const continuityCapabilityItemsForDraft = (
  project: StudioRendererProjectV2,
  draft: SpendGateDraft
): StudioGenerationCapabilityItemV2[] | null => {
  if (!('baseChoices' in draft) || draft.continuityChange === undefined) return null;
  const change = draft.continuityChange;
  const locations = project.beatOrder.flatMap((beatId) => {
    const beat = Object.hasOwn(project.beats, beatId) ? project.beats[beatId] : undefined;
    const shotIndex = beat?.id === beatId ? beat.shotOrder.indexOf(change.shotId) : -1;
    return beat?.id === beatId && shotIndex >= 0 ? [{ beat, shotIndex }] : [];
  });
  if (locations.length !== 1) return null;
  const { beat, shotIndex } = locations[0]!;
  const affectedShotIds: string[] = [];
  for (let index = shotIndex; index < beat.shotOrder.length; index += 1) {
    const affectedShotId = beat.shotOrder[index]!;
    const affectedShot = Object.hasOwn(project.shots, affectedShotId) ? project.shots[affectedShotId] : undefined;
    if (affectedShot?.id !== affectedShotId) return null;
    if (index > shotIndex && affectedShot.chainBreak === 'hard_cut') break;
    affectedShotIds.push(affectedShotId);
  }
  if (affectedShotIds.length === 0) return null;
  return [
    ...(change.requiresSeedGeneration
      ? [
          {
            target: { kind: 'shot' as const, shotId: change.shotId },
            purpose: 'seed_still' as const,
          },
        ]
      : []),
    ...affectedShotIds.map((shotId) => ({
      target: { kind: 'shot' as const, shotId },
      purpose: 'video_take' as const,
    })),
  ];
};

type StudioSpendOrchestrationInput = {
  project: StudioRendererProjectV2 | null;
  projection: WorkspaceProjection | null;
  routeCatalog: StudioRouteCatalogV2 | null;
  currentGenerationCapability: StudioGenerationCapabilityV2 | null;
  generationDraftsBlockReview: boolean;
  projectRef: MutableValueRef<StudioRendererProjectV2 | null>;
  workspacePendingRef: MutableValueRef<boolean>;
  setWorkspacePending: (pending: boolean) => void;
  setActionErrorMessageKey: (messageKey: string | null) => void;
  setBriefRouteFocusRole: Dispatch<SetStateAction<'image' | 'video' | null>>;
  setBriefDialogRequest: Dispatch<SetStateAction<number>>;
  refetchProjectWorkspace: () => Promise<StudioRendererProjectV2 | null>;
  refetchReferences: () => Promise<void>;
  refetchRoutes: () => Promise<boolean>;
};

export const useStudioSpendOrchestration = ({
  project,
  projection,
  routeCatalog,
  currentGenerationCapability,
  generationDraftsBlockReview,
  projectRef,
  workspacePendingRef,
  setWorkspacePending,
  setActionErrorMessageKey,
  setBriefRouteFocusRole,
  setBriefDialogRequest,
  refetchProjectWorkspace,
  refetchReferences,
  refetchRoutes,
}: StudioSpendOrchestrationInput) => {
  const afterPaidConfirm = useCallback(async (): Promise<void> => {
    const [refreshed] = await Promise.all([refetchProjectWorkspace(), refetchReferences()]);
    if (refreshed !== null) projectRef.current = refreshed;
  }, [refetchProjectWorkspace, refetchReferences]);
  const promoteBoardPanelOnly = useCallback(
    async (input: {
      projectId: string;
      expectedRevision: number;
      promotion: SpendGateBoardPromotion;
    }): Promise<boolean> => {
      const current = projectRef.current;
      if (
        current === null ||
        projection === null ||
        workspacePendingRef.current ||
        generationDraftsBlockReview ||
        current.id !== input.projectId ||
        current.revision !== input.expectedRevision ||
        projection.projectId !== current.id ||
        projection.projectRevision !== current.revision
      ) {
        return false;
      }
      const plan = boardPromotionGatePlan({
        project: current,
        projection,
        shotId: input.promotion.shotId,
        boardAssetId: input.promotion.boardAssetId,
      });
      const originalShot = Object.hasOwn(current.shots, input.promotion.shotId)
        ? current.shots[input.promotion.shotId]
        : undefined;
      if (
        plan === null ||
        originalShot?.id !== input.promotion.shotId ||
        plan.draft.projectId !== input.projectId ||
        plan.draft.expectedRevision !== input.expectedRevision ||
        plan.draft.boardPromotion?.shotId !== input.promotion.shotId ||
        plan.draft.boardPromotion.boardAssetId !== input.promotion.boardAssetId
      ) {
        return false;
      }
      const originalChainBreaks = new Map(
        Object.entries(current.shots).flatMap(([shotId, candidate]) =>
          candidate?.id === shotId ? [[shotId, candidate.chainBreak] as const] : []
        )
      );
      const originalCurrentTakes = new Map(
        plan.impact.currentTakeShotIds.flatMap((shotId) => {
          const candidate = Object.hasOwn(current.shots, shotId) ? current.shots[shotId] : undefined;
          return candidate?.id === shotId && candidate.videoAssetId !== null
            ? [[shotId, candidate.videoAssetId] as const]
            : [];
        })
      );
      if (originalCurrentTakes.size !== plan.impact.currentTakeShotIds.length) return false;

      workspacePendingRef.current = true;
      setWorkspacePending(true);
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
          projectId: current.id,
          expectedRevision: current.revision,
          operations: [
            {
              kind: 'promote_board_panel',
              shotId: input.promotion.shotId,
              boardAssetId: input.promotion.boardAssetId,
            },
          ],
        });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return false;
        }
        const refreshed = await refetchProjectWorkspace();
        const promotedShot =
          refreshed !== null && Object.hasOwn(refreshed.shots, input.promotion.shotId)
            ? refreshed.shots[input.promotion.shotId]
            : undefined;
        if (
          refreshed === null ||
          refreshed.id !== current.id ||
          refreshed.revision <= current.revision ||
          refreshed.revision !== result.data.projectRevision ||
          promotedShot?.id !== originalShot.id ||
          promotedShot.boardAssetId !== input.promotion.boardAssetId ||
          promotedShot.seedStillId !== input.promotion.boardAssetId ||
          promotedShot.chainBreak !== originalShot.chainBreak ||
          [...originalChainBreaks].some(([shotId, chainBreak]) => {
            const candidate = Object.hasOwn(refreshed.shots, shotId) ? refreshed.shots[shotId] : undefined;
            return candidate?.id !== shotId || candidate.chainBreak !== chainBreak;
          }) ||
          [...originalCurrentTakes].some(([shotId, assetId]) => {
            const candidate = Object.hasOwn(refreshed.shots, shotId) ? refreshed.shots[shotId] : undefined;
            return candidate?.id !== shotId || candidate.videoAssetId !== assetId;
          })
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
      }
    },
    [generationDraftsBlockReview, projection, refetchProjectWorkspace, setActionErrorMessageKey]
  );
  const spendGate = useSpendGate({
    onConfirmed: afterPaidConfirm,
    onPromoteOnly: promoteBoardPanelOnly,
  });
  const spendGateDisclosureRef = useRef(spendGate.state.generationDisclosure);
  spendGateDisclosureRef.current = spendGate.state.generationDisclosure;
  const spendGateIdentity = spendGate.state.draft === null ? null : spendGateDraftIdentity(spendGate.state.draft);
  useEffect(() => {
    if (spendGate.state.phase !== 'choices' || spendGateIdentity === null) return;
    void refetchRoutes();
  }, [refetchRoutes, spendGate.state.phase, spendGateIdentity]);
  useEffect(() => {
    if (spendGate.state.phase !== 'choices' || spendGateIdentity === null) return;
    const disclosure = spendGateDisclosureRef.current;
    if (disclosure === null) return;
    const items = disclosure.groups.flatMap((group) => group.items);
    const groups = generationBlockGroupsForItems(currentGenerationCapability, items);
    spendGate.updateGenerationDisclosure(
      groups.length === 0 ? undefined : { groups, blocksPrepare: disclosure.blocksPrepare }
    );
  }, [currentGenerationCapability, spendGate.state.phase, spendGate.updateGenerationDisclosure, spendGateIdentity]);
  const spendGateLocked =
    spendGate.state.phase === 'promoting' ||
    spendGate.state.phase === 'confirming' ||
    spendGate.state.phase === 'quote_in_use';
  const editSpendGateRoutes = useCallback(
    (issue: SpendGateRouteIssue): void => {
      setBriefRouteFocusRole(issue === 'image_and_video' ? null : issue);
      setBriefDialogRequest((request) => request + 1);
      void refetchRoutes();
    },
    [refetchRoutes]
  );
  /**
   * The bar's Render action. Submits the largest bounded film-order batch the chain permits. Each
   * selected frontier authorizes its exact downstream cascade, which advances unattended once the
   * segment seed is fixed; a later click is needed only for work outside the request cap or recovery.
   */
  const renderFilm = useCallback((): void => {
    const current = projectRef.current;
    if (current === null || projection === null || spendGateLocked) return;
    if (generationDraftsBlockReview) {
      setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
      return;
    }
    const candidateShotIds = filmRenderBatchShotIds({ project: current, projection });
    const blockedItems: StudioGenerationCapabilityItemV2[] = [];
    const shotIds = candidateShotIds.filter((shotId) => {
      const candidate = selectionGateDraft({ project: current, projection, orderedShotIds: [shotId] });
      if (candidate === null) return false;
      const groups = generationBlockGroupsForItems(currentGenerationCapability, shotCapabilityItemsForDraft(candidate));
      if (groups.length === 0) return true;
      blockedItems.push(...groups.flatMap((group) => group.items));
      return false;
    });
    const disclosureGroups = generationBlockGroupsForItems(currentGenerationCapability, blockedItems);
    if (shotIds.length === 0) {
      const blockedDraft = selectionGateDraft({
        project: current,
        projection,
        orderedShotIds: candidateShotIds,
      });
      if (blockedDraft !== null && disclosureGroups.length > 0) {
        setActionErrorMessageKey(null);
        spendGate.open(blockedDraft, undefined, { groups: disclosureGroups, blocksPrepare: true });
        return;
      }
      setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.renderFilmEmpty');
      return;
    }
    const draft = selectionGateDraft({ project: current, projection, orderedShotIds: shotIds });
    if (draft === null) {
      setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
      return;
    }
    setActionErrorMessageKey(null);
    spendGate.open(
      draft,
      undefined,
      disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: false }
    );
  }, [
    currentGenerationCapability,
    generationDraftsBlockReview,
    projection,
    setActionErrorMessageKey,
    spendGate.open,
    spendGateLocked,
  ]);
  const statusBlocksReview = projection === null || !projection.workspaceStatusReady || !projection.chainStatusReady;
  const beatPanelReviewBlockedMessageKey = generationDraftsBlockReview
    ? 'conversation.creativeStudio.workspace.controls.saveBeforeReview'
    : statusBlocksReview
      ? 'conversation.creativeStudio.workspace.controls.statusRequired'
      : routeCatalog === null
        ? 'conversation.creativeStudio.workspace.controls.routeCatalogRequired'
        : null;
  const handoffReviewBlockedMessageKey = generationDraftsBlockReview
    ? 'conversation.creativeStudio.workspace.controls.saveBeforeReview'
    : statusBlocksReview
      ? 'conversation.creativeStudio.workspace.controls.statusRequired'
      : routeCatalog === null
        ? 'conversation.creativeStudio.workspace.controls.routeCatalogRequired'
        : currentGenerationCapability === null && routeCatalog.image.status !== 'ready'
          ? 'conversation.creativeStudio.workspace.controls.imageRouteBlocked'
          : null;
  const beatPanelReviewGraphs = useMemo<BeatPanelReviewGraph[]>(() => {
    if (project === null || projection === null) return [];
    return projection.activeShotIds.flatMap((triggerShotId) => {
      const draft = selectionGateDraft({ project, projection, orderedShotIds: [triggerShotId] });
      if (draft === null) return [];
      const choices = [...draft.baseChoices, ...draft.cascadeChoices].flatMap(({ target, purpose }) =>
        target.kind === 'shot' && (purpose === 'seed_still' || purpose === 'video_take')
          ? [{ shotId: target.shotId, purpose }]
          : []
      );
      const [firstChoice, ...remainingChoices] = choices;
      if (firstChoice === undefined) return [];
      const block =
        choices.flatMap((item) => {
          const reason = generationBlockForItem(currentGenerationCapability, {
            target: { kind: 'shot', shotId: item.shotId },
            purpose: item.purpose,
          });
          return reason === null ? [] : [{ item, reason }];
        })[0] ?? null;
      return [
        {
          triggerShotId,
          choices: [firstChoice, ...remainingChoices],
          block,
        },
      ];
    });
  }, [currentGenerationCapability, project, projection]);

  const openBoardSpendGate = useCallback(
    (
      buildDraft: (current: StudioRendererProjectV2, exactProjection: WorkspaceProjection) => SpendGateDraft | null
    ): void => {
      const current = projectRef.current;
      if (
        current === null ||
        projection === null ||
        spendGateLocked ||
        workspacePendingRef.current ||
        current.id !== projection.projectId ||
        current.revision !== projection.projectRevision
      ) {
        return;
      }
      if (generationDraftsBlockReview) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
        return;
      }
      if (
        projection.boardPanels.length !== projection.activeShotIds.length ||
        projection.boardPanels.some(
          (panel) => panel.freshness === 'status_pending' || panel.activity === 'status_pending'
        )
      ) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.statusRequired');
        return;
      }
      if (routeCatalog === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.routeCatalogRequired');
        return;
      }
      if (
        currentGenerationCapability === null &&
        (current.imageRouteId === null || routeCatalog.image.status !== 'ready')
      ) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
        return;
      }
      const draft = buildDraft(current, projection);
      if (draft === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
        return;
      }
      const routeIssue = currentGenerationCapability === null ? spendGateRouteIssue(routeCatalog, draft) : null;
      if (routeIssue !== null) {
        setActionErrorMessageKey(
          routeIssue === 'image'
            ? 'conversation.creativeStudio.workspace.controls.imageRouteBlocked'
            : 'conversation.creativeStudio.workspace.gate.errors.routesUnavailable'
        );
        return;
      }
      const payableDraft =
        'baseChoices' in draft && draft.baseChoices.every((choice) => choice.purpose === 'board_still')
          ? {
              ...draft,
              baseChoices: draft.baseChoices.filter(
                (choice) =>
                  choice.target.kind === 'shot' &&
                  generationBlockForItem(currentGenerationCapability, {
                    target: { kind: 'shot', shotId: choice.target.shotId },
                    purpose: 'board_still',
                  }) === null
              ),
            }
          : draft;
      const disclosureGroups =
        'baseChoices' in draft && draft.baseChoices.every((choice) => choice.purpose === 'board_still')
          ? generationBlockGroupsForItems(currentGenerationCapability, shotCapabilityItemsForDraft(draft))
          : [];
      if (
        'baseChoices' in draft &&
        'baseChoices' in payableDraft &&
        draft.baseChoices.length > 0 &&
        payableDraft.baseChoices.length === 0
      ) {
        setActionErrorMessageKey(null);
        spendGate.open(draft, undefined, { groups: disclosureGroups, blocksPrepare: true });
        return;
      }
      setActionErrorMessageKey(null);
      spendGate.open(
        payableDraft,
        undefined,
        disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: false }
      );
    },
    [
      currentGenerationCapability,
      generationDraftsBlockReview,
      projection,
      routeCatalog,
      setActionErrorMessageKey,
      spendGate.open,
      spendGateLocked,
    ]
  );
  return {
    spendGate,
    spendGateLocked,
    editSpendGateRoutes,
    renderFilm,
    statusBlocksReview,
    beatPanelReviewBlockedMessageKey,
    handoffReviewBlockedMessageKey,
    beatPanelReviewGraphs,
    openBoardSpendGate,
  };
};

type StudioContinuitySpendReviewInput = {
  projectRef: MutableValueRef<StudioRendererProjectV2 | null>;
  projectionRef: MutableValueRef<WorkspaceProjection | null>;
  workspacePendingRef: MutableValueRef<boolean>;
  beatPanelReviewBlockedMessageKey: string | null;
  spendGateLocked: boolean;
  currentGenerationCapability: StudioGenerationCapabilityV2 | null;
  routeCatalog: StudioRouteCatalogV2 | null;
  setActionErrorMessageKey: (messageKey: string | null) => void;
  spendGateOpen: UseSpendGateResult['open'];
};

export const useStudioContinuitySpendReview = ({
  projectRef,
  projectionRef,
  workspacePendingRef,
  beatPanelReviewBlockedMessageKey,
  spendGateLocked,
  currentGenerationCapability,
  routeCatalog,
  setActionErrorMessageKey,
  spendGateOpen,
}: StudioContinuitySpendReviewInput) => {
  const openContinuityReview = useCallback(
    (shotId: string, hardCut: boolean): void => {
      const current = projectRef.current;
      const currentProjection = projectionRef.current;
      if (
        current === null ||
        currentProjection === null ||
        current.id !== currentProjection.projectId ||
        current.revision !== currentProjection.projectRevision ||
        beatPanelReviewBlockedMessageKey !== null ||
        spendGateLocked ||
        workspacePendingRef.current
      ) {
        if (beatPanelReviewBlockedMessageKey !== null) setActionErrorMessageKey(beatPanelReviewBlockedMessageKey);
        return;
      }
      const shotMatches = currentProjection.activeBeats.flatMap((beat) =>
        beat.shots.filter((shot) => shot.id === shotId)
      );
      if (shotMatches.length !== 1 || shotMatches[0]!.seedAuthorizationLock !== null) {
        setActionErrorMessageKey(
          shotMatches.length === 1
            ? 'conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked'
            : 'conversation.creativeStudio.workspace.controls.selectionNotPayable'
        );
        return;
      }
      const draft = continuityGateDraft({ project: current, projection: currentProjection, shotId, hardCut });
      if (draft === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
        return;
      }
      const routeIssue =
        currentGenerationCapability !== null || routeCatalog === null ? null : spendGateRouteIssue(routeCatalog, draft);
      if (routeIssue !== null) {
        setActionErrorMessageKey(
          routeIssue === 'image'
            ? 'conversation.creativeStudio.workspace.controls.imageRouteBlocked'
            : routeIssue === 'video'
              ? 'conversation.creativeStudio.workspace.controls.videoRouteBlocked'
              : 'conversation.creativeStudio.workspace.gate.errors.routesUnavailable'
        );
        return;
      }
      const capabilityItems = continuityCapabilityItemsForDraft(current, draft);
      if (capabilityItems === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
        return;
      }
      const disclosureGroups = generationBlockGroupsForItems(currentGenerationCapability, capabilityItems);
      setActionErrorMessageKey(null);
      spendGateOpen(
        draft,
        undefined,
        disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: true }
      );
    },
    [
      beatPanelReviewBlockedMessageKey,
      currentGenerationCapability,
      routeCatalog,
      setActionErrorMessageKey,
      spendGateOpen,
      spendGateLocked,
    ]
  );
  return openContinuityReview;
};

type StudioHandoffSpendReviewInput = {
  reviewedActionRef: ReadonlyValueRef<ReviewedActionOwner | null>;
  projectRef: MutableValueRef<StudioRendererProjectV2 | null>;
  generationDraftsBlockReview: boolean;
  statusBlocksReview: boolean;
  projection: WorkspaceProjection | null;
  routeCatalog: StudioRouteCatalogV2 | null;
  currentGenerationCapability: StudioGenerationCapabilityV2 | null;
  setActionErrorMessageKey: (messageKey: string | null) => void;
  spendGateOpen: UseSpendGateResult['open'];
};

export const useStudioHandoffSpendReview = ({
  reviewedActionRef,
  projectRef,
  generationDraftsBlockReview,
  statusBlocksReview,
  projection,
  routeCatalog,
  currentGenerationCapability,
  setActionErrorMessageKey,
  spendGateOpen,
}: StudioHandoffSpendReviewInput) => {
  const reviewHandoff = useCallback(
    (handoff: StudioRendererReferenceGenerationHandoffV2, ownedActionToken?: number): void => {
      const activeAction = reviewedActionRef.current;
      if (activeAction !== null && activeAction.token !== ownedActionToken) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDecisionBusy');
        return;
      }
      const current = projectRef.current;
      if (current === null) return;
      if (generationDraftsBlockReview) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
        return;
      }
      if (statusBlocksReview || projection === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.statusRequired');
        return;
      }
      if (routeCatalog === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.routeCatalogRequired');
        return;
      }
      if (currentGenerationCapability === null && routeCatalog.image.status !== 'ready') {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
        return;
      }
      const draft = handoffGateDraft(current, projection, handoff);
      if (draft === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
        return;
      }
      const disclosureGroups = generationBlockGroupsForItems(
        currentGenerationCapability,
        referenceCapabilityItems(draft.referenceIds)
      );
      spendGateOpen(
        draft,
        undefined,
        disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: true }
      );
    },
    [
      currentGenerationCapability,
      generationDraftsBlockReview,
      projection,
      routeCatalog,
      setActionErrorMessageKey,
      spendGateOpen,
      statusBlocksReview,
    ]
  );
  return reviewHandoff;
};

type StudioFailedReferenceSpendReviewInput = {
  projectRef: MutableValueRef<StudioRendererProjectV2 | null>;
  reviewedActionRef: ReadonlyValueRef<ReviewedActionOwner | null>;
  workspacePendingRef: MutableValueRef<boolean>;
  generationDraftsBlockReview: boolean;
  spendGateLocked: boolean;
  routeCatalog: StudioRouteCatalogV2 | null;
  currentGenerationCapability: StudioGenerationCapabilityV2 | null;
  setActionErrorMessageKey: (messageKey: string | null) => void;
  spendGateOpen: UseSpendGateResult['open'];
};

export const useStudioFailedReferenceSpendReview = ({
  projectRef,
  reviewedActionRef,
  workspacePendingRef,
  generationDraftsBlockReview,
  spendGateLocked,
  routeCatalog,
  currentGenerationCapability,
  setActionErrorMessageKey,
  spendGateOpen,
}: StudioFailedReferenceSpendReviewInput) => {
  const retryFailedReferences = useCallback(
    (handoff: StudioRendererReferenceGenerationHandoffV2): void => {
      const current = projectRef.current;
      if (
        current === null ||
        reviewedActionRef.current !== null ||
        (handoff.status !== 'partially_failed' && handoff.status !== 'failed') ||
        handoff.failedReferenceIds.length === 0 ||
        generationDraftsBlockReview ||
        workspacePendingRef.current ||
        spendGateLocked
      ) {
        if (generationDraftsBlockReview) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
        } else if (reviewedActionRef.current !== null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDecisionBusy');
        }
        return;
      }
      if (routeCatalog === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.routeCatalogRequired');
        return;
      }
      if (
        currentGenerationCapability === null &&
        (current.imageRouteId === null || routeCatalog.image.status !== 'ready')
      ) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
        return;
      }
      const retryIds = handoff.failedReferenceIds.filter((referenceId) => {
        const reference = Object.hasOwn(current.references, referenceId) ? current.references[referenceId] : undefined;
        const job =
          reference?.id !== referenceId
            ? undefined
            : [...reference.jobIds]
                .toReversed()
                .map((jobId) => (Object.hasOwn(current.jobs, jobId) ? current.jobs[jobId] : undefined))
                .find(
                  (candidate) =>
                    candidate?.target.kind === 'reference' &&
                    candidate.target.referenceId === referenceId &&
                    candidate.purpose === 'reference_image'
                );
        const paidRetryableStatus =
          job?.status === 'cancelled' ||
          (job?.status === 'failed' &&
            job.error !== null &&
            job.error.code !== 'download_failed' &&
            job.error.code !== 'dependency_failed');
        const hasExactRetryAuthority =
          reference?.id === referenceId &&
          job !== undefined &&
          reference.jobIds.includes(job.id) &&
          current.referenceOrder.filter((candidateId) => candidateId === referenceId).length === 1 &&
          job.projectId === current.id &&
          job.target.kind === 'reference' &&
          job.target.referenceId === referenceId &&
          job.purpose === 'reference_image' &&
          paidRetryableStatus;
        return hasExactRetryAuthority;
      });
      if (retryIds.length !== handoff.failedReferenceIds.length) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
        return;
      }
      const disclosureGroups = generationBlockGroupsForItems(
        currentGenerationCapability,
        referenceCapabilityItems(retryIds)
      );
      setActionErrorMessageKey(null);
      spendGateOpen(
        { projectId: current.id, expectedRevision: current.revision, referenceIds: retryIds },
        undefined,
        disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: true }
      );
    },
    [
      currentGenerationCapability,
      generationDraftsBlockReview,
      routeCatalog,
      setActionErrorMessageKey,
      spendGateOpen,
      spendGateLocked,
    ]
  );
  return retryFailedReferences;
};
