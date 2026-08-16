/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Modal, Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { ipcBridge } from '@/common';
import type { StudioBriefRuleDraft } from '@/common/types/project/creativeStudioRules';
import {
  STUDIO_REFERENCE_PROMPT_MAX_LENGTH,
  type StudioBriefReferenceRole,
  type StudioRendererProject,
  type StudioReferenceRequest,
  type StudioLatestRender,
  type StudioMediaKind,
  type StudioRouteCatalog,
  type StudioRouteCatalogEntry,
  type StudioScene,
  type StudioSceneGenerationChoice,
  type StudioSelectVariationRequest,
} from '@/common/types/project/creativeStudioTypes';
import { requestedMediaKind } from '@/common/types/project/creativeStudioOutputRole';
import {
  getStudioReferencePlateFreshness,
  resolveActiveStudioBriefReferences,
  STUDIO_MAX_ACTIVE_BRIEF_REFERENCES,
  type StudioReferencePlateFreshness,
} from '@/common/types/project/creativeStudioManagedAssetCollections';
import {
  buildFirstFramePrompt,
  hasFirstFramePromptSubject,
  stripFirstFramePromptPrefix,
} from '@/common/types/project/creativeStudioReferencePrompt';
import {
  evaluateStudioRules,
  resolveEffectiveStudioRules,
  type StudioRuleBreach,
} from '@/common/types/project/creativeStudioRules';

import {
  collectReferencePrompts,
  collectSubmittableRoutes,
  buildReferenceConditioningSnapshot,
  describeSceneRenderBlockMessage,
  GenerationReviewModal,
  routeSupportsScene,
  submitExactGenerationReview,
  type GenerationBatchReviewRequest,
  type GenerationReviewExcludedScene,
  type GenerationReviewModalProps,
  type GenerationReviewConfirmation,
  type GenerationReviewScene,
  type GenerationReviewRouteSnapshot,
  type GenerationReferenceConditioningSnapshot,
  type GenerationSingleReviewRequest,
  StoryboardDraftModal,
  StudioBriefDrawer,
  StudioExportModal,
  StudioLibrary,
  StudioPhaseShell,
  StudioRulesDrawer,
  type StudioPhaseControllers,
} from './components';
import { BriefConversationProvider, useBriefConversationContext } from './components/Shell/BriefConversationContext';
import { DirectorPane } from './components/Shell/DirectorPane';
import {
  describeRuleBreachInstruction,
  DirectorProposals,
  pendingDirectorProposals,
  sendDirectorInstruction,
  type StudioRuleBreachReport,
} from './components/Shell/DirectorProposals';
import { StudioShell } from './components/Shell/StudioShell';
import { useStoryboardEditor, useStudioJobs, useStudioModels, useStudioProject, useStudioRender } from './hooks';
import styles from './StudioPage.module.css';
import { resolveShotEngine } from './studioRouteConstraints';
import {
  parseStudioView,
  rememberStudioView,
  resolveStudioEntryView,
  studioViewPath,
  type StudioView,
  type StudioViewTransition,
  type StudioWriteFocusIntent,
} from './studioPhaseRoute';
import { canOpenSingleSceneReview, deriveStudioReadiness } from './studioReadiness';
import type { StudioReadinessSummary, StudioSceneStatus } from './studioReadiness';

type GenerationReviewState = {
  mode: 'single' | 'batch';
  scenes: GenerationReviewScene[];
  excludedScenes?: GenerationReviewExcludedScene[];
  catalogVersion: string | null;
  availableRoutes: StudioRouteCatalogEntry[];
  projectId: string;
  projectRevision: number;
  outputRole?: GenerationSingleReviewRequest['outputRole'];
  referenceRequestIds?: string[];
  referenceRequests?: Array<Pick<StudioReferenceRequest, 'id' | 'sceneId'>>;
  /** Active Brief inputs require human authorization; Cancel leaves these queued on disk. */
  referenceRequestsRequireConfirmation?: true;
};

type ReferenceNotice =
  | { kind: 'excluded'; scenes: GenerationReviewExcludedScene[]; requestIds: string[] }
  | { kind: 'dismiss_failed' };

type DeferredReferenceReview = {
  requests: Array<Pick<StudioReferenceRequest, 'id' | 'sceneId'>>;
  sceneIds: string[];
};

const routeIdentity = (
  route: Pick<StudioRouteCatalogEntry | GenerationReviewRouteSnapshot, 'choiceId' | 'kind'>
): string => `${route.choiceId}\u0000${route.kind}`;

const catalogMatchesProjectImageRoute = (project: StudioRendererProject, catalog: StudioRouteCatalog): boolean => {
  const selected = resolveShotEngine(project, { mediaKind: 'image' });
  const catalogSelection = catalog.image.selected;
  const route = catalog.image.selectedRoute;
  return (
    selected !== null &&
    catalog.image.status === 'ready' &&
    catalogSelection !== null &&
    route !== null &&
    route.kind === 'image' &&
    catalogSelection.choiceId === selected.choiceId &&
    catalogSelection.providerId === selected.providerId &&
    catalogSelection.model === selected.model &&
    route.choiceId === selected.choiceId &&
    route.providerId === selected.providerId &&
    route.model === selected.model
  );
};

const toReviewScene = (
  project: StudioRendererProject,
  scene: StudioScene,
  route: GenerationReviewRouteSnapshot | null,
  availableRoutes: readonly StudioRouteCatalogEntry[],
  routeStatus?: 'valid' | 'invalid' | 'missing',
  outputRole: GenerationReviewScene['outputRole'] = 'take',
  referencePrompt?: string,
  conditioning?: GenerationReferenceConditioningSnapshot | null,
  conditioningIssue?: 'malformed'
): GenerationReviewScene => {
  const mediaKind = requestedMediaKind(scene.mediaKind, outputRole);
  const catalogRoute =
    route === null ? undefined : availableRoutes.find((candidate) => routeIdentity(candidate) === routeIdentity(route));
  return {
    id: scene.id,
    title: scene.title,
    mediaKind,
    outputRole,
    durationSeconds: scene.durationSeconds,
    promptText:
      outputRole === 'reference'
        ? stripFirstFramePromptPrefix((referencePrompt ?? '').trim(), project.aspectRatio)
        : scene.visualPrompt.trim(),
    ...(outputRole === 'reference' && referencePrompt !== undefined ? { referencePrompt } : {}),
    route:
      route === null
        ? { status: 'missing', snapshot: null, providerName: null }
        : {
            status:
              routeStatus === 'invalid' ||
              conditioning === null ||
              catalogRoute === undefined ||
              !routeSupportsScene(catalogRoute, {
                kind: mediaKind,
                sceneId: scene.id,
                routeSceneId: route.sceneId,
                aspectRatio: project.aspectRatio,
                resolution: project.resolution,
                durationSeconds: outputRole === 'reference' ? undefined : scene.durationSeconds,
                hasReference: scene.referenceAssetId !== null,
                ...(conditioning === undefined ? {} : { conditioningReferenceCount: conditioning.inputs.length }),
              })
                ? 'invalid'
                : 'valid',
            snapshot: route,
            providerName: catalogRoute?.providerName ?? null,
            integrationLabelKey: catalogRoute?.integrationLabelKey ?? null,
            silentOutput: catalogRoute?.constraints.silentOutput ?? null,
          },
    ...(conditioning === undefined || conditioning === null ? {} : { conditioning }),
    ...(conditioning === null || conditioningIssue === 'malformed' ? { conditioningIssue: 'malformed' as const } : {}),
    ...(outputRole === 'take' ? { referencePlateFreshness: selectedReferencePlateFreshness(project, scene) } : {}),
  };
};

const selectedReferencePlateFreshness = (
  project: StudioRendererProject,
  scene: StudioScene
): StudioReferencePlateFreshness => {
  if (scene.referenceAssetId === null) return 'unknown';
  const plate = project.assets[scene.referenceAssetId];
  const active = resolveActiveStudioBriefReferences(project.assets);
  if (plate === undefined || plate.managedAsset.collection !== 'references' || active === null) return 'unknown';
  return getStudioReferencePlateFreshness(plate, {
    // Task 6 will persist the admitted prompt baseline. Until then, compare the durable prompt to
    // itself so a manual reference prompt is never invented as stale against scene.visualPrompt.
    visualPrompt: plate.sourceVisualPrompt ?? '',
    referenceAssetIds: active.map(({ id }) => id),
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
  });
};

const catalogEntries = (catalog: StudioRouteCatalog): StudioRouteCatalogEntry[] => [
  ...catalog.image.options,
  ...catalog.video.options,
];

const projectRouteSnapshot = (
  project: StudioRendererProject,
  scene: Pick<StudioScene, 'id' | 'mediaKind'>,
  outputRole: GenerationReviewScene['outputRole'] = 'take'
): GenerationReviewRouteSnapshot | null => {
  const mediaKind = requestedMediaKind(scene.mediaKind, outputRole);
  const selected = resolveShotEngine(project, { mediaKind });
  return selected === null
    ? null
    : {
        sceneId: scene.id,
        choiceId: selected.choiceId,
        providerId: selected.providerId,
        model: selected.model,
        kind: mediaKind,
      };
};

const referenceExclusionReason = (
  status: StudioSceneStatus | undefined
): GenerationReviewExcludedScene['reasonMessageKey'] => {
  switch (status) {
    case 'needs_title':
    case 'needs_prompt':
    case 'generating':
    case 'needs_selection':
    case 'generated':
    case 'needs_attention':
      return `conversation.creativeStudio.scene.status.${status}`;
    case 'ready':
    case undefined:
      return 'conversation.creativeStudio.reference.excludedUnavailable';
  }
};

const batchReviewExcludedScenes = (
  project: StudioRendererProject,
  request: GenerationBatchReviewRequest
): GenerationReviewExcludedScene[] =>
  request.exclusions.flatMap((exclusion) => {
    const message = describeSceneRenderBlockMessage(exclusion.block);
    return exclusion.sceneIds.map((sceneId) => ({
      id: sceneId,
      title: project.scenes[sceneId]?.title ?? sceneId,
      reasonMessageKey:
        exclusion.block.code === 'first_frame'
          ? ('conversation.creativeStudio.review.excludedFirstFrame' as const)
          : message.key,
      ...(message.values === undefined ? {} : { reasonValues: message.values }),
    }));
  });

/**
 * The first-frame prompt a Director-queued request should paint for this scene, or `null` when the
 * scene's own visual prompt cannot produce a usable one.
 *
 * A scene can be `ready` - which only asks for a non-empty visual prompt - and still fail here:
 * `visualPrompt` is allowed to be twice as long as a reference prompt may be. Main refuses such a
 * submission outright, so the caller excludes the scene where the user can see it rather than
 * sending a request that is destroyed on arrival.
 */
const queuedReferencePrompt = (project: StudioRendererProject, scene: StudioScene): string | null => {
  const prompt = buildFirstFramePrompt(scene.visualPrompt, project.aspectRatio);
  return hasFirstFramePromptSubject(prompt, project.aspectRatio) && prompt.length <= STUDIO_REFERENCE_PROMPT_MAX_LENGTH
    ? prompt
    : null;
};

const buildQueuedReferenceReview = (
  project: StudioRendererProject,
  readiness: StudioReadinessSummary,
  requests: ReadonlyArray<Pick<StudioReferenceRequest, 'id' | 'sceneId'>>,
  availableRoutes: readonly StudioRouteCatalogEntry[]
): {
  scenes: GenerationReviewScene[];
  excludedScenes: GenerationReviewExcludedScene[];
  excludedReferenceRequestIds: string[];
  referenceRequestIds: string[];
} => {
  const readySceneIds = new Set(readiness.readySceneIds);
  const requestedSceneIds = new Set(requests.map(({ sceneId }) => sceneId));
  const promptUnusableSceneIds = new Set<string>();
  const scenes = project.sceneOrder.flatMap((sceneId) => {
    const scene = project.scenes[sceneId];
    if (scene === undefined || !requestedSceneIds.has(sceneId) || !readySceneIds.has(sceneId)) return [];
    const referencePrompt = queuedReferencePrompt(project, scene);
    if (referencePrompt === null) {
      promptUnusableSceneIds.add(sceneId);
      return [];
    }
    const route = projectRouteSnapshot(project, scene, 'reference');
    const catalogRoute =
      route === null
        ? undefined
        : availableRoutes.find((candidate) => routeIdentity(candidate) === routeIdentity(route));
    const conditioning =
      catalogRoute === undefined ? undefined : buildReferenceConditioningSnapshot(project, catalogRoute);
    return [
      toReviewScene(project, scene, route, availableRoutes, undefined, 'reference', referencePrompt, conditioning),
    ];
  });
  const includedSceneIds = new Set(scenes.map(({ id }) => id));
  const excludedRequests = requests.filter(({ sceneId }) => !includedSceneIds.has(sceneId));
  const excludedSceneIds = new Set<string>();
  return {
    scenes,
    excludedScenes: excludedRequests.flatMap(({ sceneId }) => {
      if (excludedSceneIds.has(sceneId)) return [];
      excludedSceneIds.add(sceneId);
      const scene = project.scenes[sceneId];
      return [
        {
          id: sceneId,
          title: scene?.title ?? sceneId,
          // A scene the readiness summary calls ready, but whose visual prompt cannot describe a
          // first frame, is excluded for that reason - not for its status, which says nothing
          // about it and would read as "no longer available".
          reasonMessageKey: promptUnusableSceneIds.has(sceneId)
            ? 'conversation.creativeStudio.reference.excludedPromptUnusable'
            : referenceExclusionReason(readiness.sceneStatuses[sceneId]),
        },
      ];
    }),
    excludedReferenceRequestIds: excludedRequests.map(({ id }) => id),
    referenceRequestIds: requests.flatMap(({ id, sceneId }) => (includedSceneIds.has(sceneId) ? [id] : [])),
  };
};

const newestProject = (...candidates: Array<StudioRendererProject | null>): StudioRendererProject | null =>
  candidates.reduce<StudioRendererProject | null>(
    (newest, candidate) =>
      candidate !== null && (newest === null || candidate.revision > newest.revision) ? candidate : newest,
    null
  );

const reviewSceneAuthorityMatches = (
  reviewed: readonly GenerationReviewScene[],
  current: readonly GenerationReviewScene[]
): boolean =>
  reviewed.length === current.length &&
  reviewed.every((scene, index) => {
    const candidate = current[index];
    if (candidate === undefined || candidate.id !== scene.id || candidate.route.status !== scene.route.status) {
      return false;
    }
    const routeMatches =
      scene.route.snapshot === null
        ? candidate.route.snapshot === null
        : candidate.route.snapshot !== null &&
          candidate.route.snapshot.sceneId === scene.route.snapshot.sceneId &&
          candidate.route.snapshot.choiceId === scene.route.snapshot.choiceId &&
          candidate.route.snapshot.providerId === scene.route.snapshot.providerId &&
          candidate.route.snapshot.model === scene.route.snapshot.model &&
          candidate.route.snapshot.kind === scene.route.snapshot.kind &&
          candidate.route.status !== 'missing' &&
          scene.route.status !== 'missing' &&
          candidate.route.integrationLabelKey === scene.route.integrationLabelKey;
    if (!routeMatches) return false;
    const reviewedConditioning = scene.conditioning;
    const currentConditioning = candidate.conditioning;
    return reviewedConditioning === undefined
      ? currentConditioning === undefined
      : currentConditioning !== undefined &&
          currentConditioning.maximum === reviewedConditioning.maximum &&
          currentConditioning.integrationLabelKey === reviewedConditioning.integrationLabelKey &&
          currentConditioning.inputs.length === reviewedConditioning.inputs.length &&
          currentConditioning.inputs.every((input, inputIndex) => {
            const reviewedInput = reviewedConditioning.inputs[inputIndex];
            return (
              reviewedInput !== undefined &&
              input.assetId === reviewedInput.assetId &&
              input.label === reviewedInput.label &&
              input.role === reviewedInput.role
            );
          });
  });

const parseWriteFocusIntent = (state: unknown): StudioWriteFocusIntent | null => {
  if (typeof state !== 'object' || state === null || !Object.hasOwn(state, 'writeFocus')) return null;
  const writeFocus = (state as { writeFocus?: unknown }).writeFocus;
  if (typeof writeFocus !== 'object' || writeFocus === null) return null;
  const candidate = writeFocus as { sceneId?: unknown; field?: unknown };
  return typeof candidate.sceneId === 'string' &&
    candidate.sceneId.length > 0 &&
    (candidate.field === 'visualPrompt' || candidate.field === 'duration')
    ? { sceneId: candidate.sceneId, field: candidate.field }
    : null;
};

const parseBriefOpenIntent = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && Object.hasOwn(state, 'openBrief')
    ? (state as { openBrief?: unknown }).openBrief === true
    : false;

/**
 * The generation review, plus the one thing it needs from the Director conversation.
 *
 * `BriefConversationProvider` owns the single `useBriefConversation` instance, and the page renders
 * that provider, so the page cannot read the context it supplies. This component sits inside the
 * provider and reads it, which is why the modal moved inside too. Everything else the send needs
 * arrives as `reports`.
 *
 * `onAskDirector` is left undefined when there is nothing to report, so the modal hides the
 * affordance rather than offering a button that does nothing.
 */
const StudioGenerationReview: React.FC<
  GenerationReviewModalProps & { reports: readonly StudioRuleBreachReport[]; onAsked: () => void }
> = ({ reports, onAsked, ...modalProps }) => {
  const briefConversation = useBriefConversationContext();
  const askDirector = useCallback((): void => {
    if (briefConversation.state.kind !== 'ready' || reports.length === 0) return;
    void sendDirectorInstruction({
      conversation: briefConversation.state.conversation,
      instruction: describeRuleBreachInstruction(reports),
    });
    onAsked();
  }, [briefConversation.state, onAsked, reports]);

  return <GenerationReviewModal {...modalProps} onAskDirector={reports.length === 0 ? undefined : askDirector} />;
};

const StudioProjectShell: React.FC<{ routeView: StudioView | null }> = ({ routeView }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeProjectId } = useParams<{ id: string }>();
  const {
    project: loadedProject,
    proposals,
    loading,
    notFound,
    errorMessageKey,
    refetch,
  } = useStudioProject(routeProjectId, {
    subscribeToUpdates: false,
  });
  const editor = useStoryboardEditor({ project: loadedProject, refetch });
  const studioJobs = useStudioJobs({
    project: editor.project ?? loadedProject,
    refetch,
    reconcileOnSubscribe: true,
  });
  const project = newestProject(studioJobs.project, editor.project, loadedProject);
  // Project scope, not view scope: a cut render outlives the Cut view that starts it, and
  // must stay observable while the user works elsewhere in the document. Keyed on the route id
  // rather than the loaded project so the stream is not re-subscribed once the project arrives.
  const studioRender = useStudioRender(routeProjectId);

  useEffect(() => {
    if (project === null) return;
    if (routeView !== null) {
      rememberStudioView(project.id, routeView);
      return;
    }
    navigate(studioViewPath(project.id, resolveStudioEntryView(project.id)), {
      replace: true,
    });
  }, [navigate, project, routeView]);
  const studioModels = useStudioModels({
    project,
    refetch,
    beforeMutation: async () => {
      if (editor.mutationPending) return false;
      if (!(await editor.flushProjectDraft())) return false;
      const result = await editor.flushAllSceneDrafts();
      return result.failed.length === 0 && result.dirtied.length === 0;
    },
  });
  const [draftModalVisible, setDraftModalVisible] = useState(false);
  const [briefOpen, setBriefOpen] = useState(() => parseBriefOpenIntent(location.state));
  const [pendingEngineFocusRole, setPendingEngineFocusRole] = useState<StudioMediaKind | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesPending, setRulesPending] = useState(false);
  const [rulesErrorMessageKey, setRulesErrorMessageKey] = useState<string | null>(null);
  const [generationReview, setGenerationReview] = useState<GenerationReviewState | null>(null);
  const effectiveRules = useMemo(() => (project === null ? [] : resolveEffectiveStudioRules(project.rules)), [project]);
  const ruleBreachesBySceneId = useMemo(() => {
    if (generationReview === null) return {};
    const breaches: Record<string, StudioRuleBreach[]> = {};
    for (const scene of generationReview.scenes) {
      const verdict = evaluateStudioRules(effectiveRules, scene.promptText);
      if (verdict.breaches.length > 0) breaches[scene.id] = verdict.breaches;
    }
    return breaches;
  }, [effectiveRules, generationReview]);
  const breachReports = useMemo<StudioRuleBreachReport[]>(() => {
    if (generationReview === null) return [];
    return generationReview.scenes.flatMap((scene) =>
      (ruleBreachesBySceneId[scene.id] ?? []).map((breach) => ({
        sceneTitle: scene.title,
        ruleText: breach.ruleText,
        matchedTerm: breach.matchedTerm,
      }))
    );
  }, [generationReview, ruleBreachesBySceneId]);
  const [generationReviewIssueMessageKey, setGenerationReviewIssueMessageKey] = useState<string | null>(null);
  const [generationReviewRefreshing, setGenerationReviewRefreshing] = useState(false);
  const [referenceNotice, setReferenceNotice] = useState<ReferenceNotice | null>(null);
  const [duplicateChargeJobId, setDuplicateChargeJobId] = useState<string | null>(null);
  const [variationPending, setVariationPending] = useState(false);
  const [variationIssueMessageKey, setVariationIssueMessageKey] = useState<string | null>(null);
  const [referenceImportSceneId, setReferenceImportSceneId] = useState<string | null>(null);
  const [referenceImportIssue, setReferenceImportIssue] = useState<{
    sceneId: string;
    messageKey: string;
  } | null>(null);
  const [briefReferenceMutationPending, setBriefReferenceMutationPending] = useState(false);
  const [briefReferenceIssueMessageKey, setBriefReferenceIssueMessageKey] = useState<string | null>(null);
  const [exportVisible, setExportVisible] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [exportIncludeReferences, setExportIncludeReferences] = useState(false);
  const [exportedFolderName, setExportedFolderName] = useState<string | null>(null);
  const [exportMissingSceneIds, setExportMissingSceneIds] = useState<string[]>([]);
  const [exportIssueMessageKey, setExportIssueMessageKey] = useState<string | null>(null);
  const [exportLatestRender, setExportLatestRender] = useState<StudioLatestRender | null>(null);
  const [exportLatestRenderReady, setExportLatestRenderReady] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<StudioViewTransition | null>(null);
  const [transitionReady, setTransitionReady] = useState(false);
  const [transitionIssueMessageKey, setTransitionIssueMessageKey] = useState<string | null>(null);
  const [postModalTransition, setPostModalTransition] = useState<StudioViewTransition | null>(null);
  const generationReviewRefreshingRef = useRef(false);
  const suppressedReferenceRequestIdsRef = useRef(new Set<string>());
  const deferredReferenceReviewsRef = useRef<DeferredReferenceReview[]>([]);
  const notifiedExcludedReferenceRequestsRef = useRef<string | null>(null);
  /**
   * Reference requests this mount has already taken down the paid path, or tried to.
   *
   * The effect below re-runs whenever `studioJobs` changes, which includes every job poll, so
   * without this guard a queued request could be submitted repeatedly — and this is a paid path
   * with no spend ceiling behind it. Ids are added *before* the first await and are never removed,
   * including on failure: one attempt spends nothing, but retrying on every poll could.
   *
   * It filters the pending requests rather than vetoing the batch they appear in. A request whose
   * dismissal failed is still queued and so reappears in every later batch; vetoing on that would
   * take the requests queued after it down with it for the rest of the mount. Recovery is the
   * review the effect opens on failure, not a silent retry.
   */
  const autoSubmittedReferenceRequestIdsRef = useRef(new Set<string>());
  const variationPendingRef = useRef(false);
  const referenceImportSceneIdRef = useRef<string | null>(null);
  const briefReferenceMutationPendingRef = useRef(false);
  const pendingTransitionRef = useRef<StudioViewTransition | null>(null);
  const editorRef = useRef(editor);
  const canonicalProjectRef = useRef<StudioRendererProject | null>(project);
  canonicalProjectRef.current = project;
  editorRef.current = editor;
  const writeFocusIntent = useMemo(() => parseWriteFocusIntent(location.state), [location.state]);

  useEffect(() => {
    if (!parseBriefOpenIntent(location.state)) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);
  const draftConflict = editor.conflict?.operation === 'draft_storyboard' ? editor.conflict : null;
  const draftErrorMessageKey =
    editor.error?.operation === 'draft_storyboard'
      ? editor.error.messageKey
      : draftConflict
        ? draftConflict.messageKey
        : studioModels.errorMessageKey;
  const readiness = useMemo(() => (project === null ? null : deriveStudioReadiness(project)), [project]);
  const selectedScene =
    project !== null && editor.selectedSceneId !== null ? (project.scenes[editor.selectedSceneId] ?? null) : null;
  const selectedAsset =
    project !== null && selectedScene?.selectedAssetId ? (project.assets[selectedScene.selectedAssetId] ?? null) : null;
  const selectedReferenceAsset =
    project !== null && selectedScene?.referenceAssetId
      ? (project.assets[selectedScene.referenceAssetId] ?? null)
      : null;
  const posterAsset = useMemo(() => {
    if (
      project === null ||
      selectedScene === null ||
      selectedScene.mediaKind !== 'video' ||
      selectedScene.selectedAssetId === null
    ) {
      return null;
    }
    const producingJobs = selectedScene.jobIds
      .map((jobId) => project.jobs[jobId])
      .filter(
        (job) =>
          job?.status === 'succeeded' &&
          job.sceneId === selectedScene.id &&
          job.outputAssetIds[0] === selectedScene.selectedAssetId
      );
    if (producingJobs.length !== 1) return null;
    const producingJob = producingJobs[0]!;
    const posters = producingJob.outputAssetIds
      .slice(1)
      .map((assetId) => project.assets[assetId])
      .filter(
        (asset) =>
          asset?.projectId === project.id &&
          asset.sceneId === selectedScene.id &&
          asset.mediaKind === 'image' &&
          asset.managedAsset.collection === 'thumbnails' &&
          selectedScene.assetIds.includes(asset.id)
      );
    return posters.length === 1 ? posters[0]! : null;
  }, [project, selectedScene]);
  const canonicalMutationPending =
    editor.mutationPending || studioModels.pendingRole !== null || studioJobs.mutationPending || variationPending;
  const generationBlocked =
    project === null ||
    editor.hasUnsavedProjectDraft ||
    editor.hasUnsavedSceneDrafts ||
    editor.conflict !== null ||
    editor.drafting ||
    canonicalMutationPending ||
    referenceImportSceneId !== null;
  const exportBlocked = generationBlocked;
  const transitionBlocked = generationReview !== null || duplicateChargeJobId !== null || exportVisible;

  useEffect(() => {
    suppressedReferenceRequestIdsRef.current.clear();
    deferredReferenceReviewsRef.current = [];
    notifiedExcludedReferenceRequestsRef.current = null;
    setReferenceNotice(null);
  }, [project?.id]);

  useEffect(() => {
    if (
      briefReferenceMutationPendingRef.current ||
      briefReferenceMutationPending ||
      generationReview !== null ||
      generationBlocked ||
      project === null ||
      readiness === null ||
      studioModels.catalog === null
    ) {
      return;
    }
    const availableRoutes = catalogEntries(studioModels.catalog);
    const pendingRequestById = new Map(studioJobs.referenceRequests.map((request) => [request.id, request]));
    const retainedDeferredReviews: DeferredReferenceReview[] = [];
    for (const deferred of deferredReferenceReviewsRef.current) {
      const exactPendingRequests: DeferredReferenceReview['requests'] = [];
      const remappedRequests: DeferredReferenceReview['requests'] = [];
      deferred.requests.forEach((request) => {
        const pending = pendingRequestById.get(request.id);
        if (pending === undefined) return;
        (pending.sceneId === request.sceneId ? exactPendingRequests : remappedRequests).push(request);
      });
      const retain = (requests: DeferredReferenceReview['requests']): void => {
        if (requests.length === 0) return;
        const requestedSceneIds = new Set(requests.map(({ sceneId }) => sceneId));
        retainedDeferredReviews.push({
          requests,
          sceneIds: deferred.sceneIds.filter((sceneId) => requestedSceneIds.has(sceneId)),
        });
      };

      // A reused id no longer carries the frozen scene authority. Keep only that id deferred;
      // exact siblings can still proceed, while an id that disappeared from the queue is gone.
      retain(remappedRequests);
      if (exactPendingRequests.length === 0) continue;

      const review = buildQueuedReferenceReview(project, readiness, exactPendingRequests, availableRoutes);
      const includedRequestIds = new Set(review.referenceRequestIds);
      const excludedRequestIds = new Set(review.excludedReferenceRequestIds);
      const includedRequests = exactPendingRequests.filter(({ id }) => includedRequestIds.has(id));
      const excludedRequests = exactPendingRequests.filter(({ id }) => excludedRequestIds.has(id));
      const accountedExactly =
        review.referenceRequestIds.length + review.excludedReferenceRequestIds.length === exactPendingRequests.length &&
        review.referenceRequestIds.every((requestId, index) => requestId === includedRequests[index]?.id) &&
        review.excludedReferenceRequestIds.every((requestId, index) => requestId === excludedRequests[index]?.id) &&
        exactPendingRequests.every(({ id }) => includedRequestIds.has(id) !== excludedRequestIds.has(id));
      if (!accountedExactly) {
        retain(exactPendingRequests);
        continue;
      }

      // Excluded ids leave the defer and re-enter the existing unpaid exclusion/notice path.
      // Included ids require the same frozen scene membership and full route/prompt authority as
      // before. The canonical project owns submission order, so a reorder alone cannot deadlock
      // the deferred request; retain only ids whose paid-path predicates are not satisfied.
      const includedSceneIds = new Set(includedRequests.map(({ sceneId }) => sceneId));
      const expectedSceneIds = new Set(deferred.sceneIds.filter((sceneId) => includedSceneIds.has(sceneId)));
      const currentSceneIds = new Set(review.scenes.map(({ id }) => id));
      const submission = collectSubmittableRoutes(review.scenes);
      const prompts = submission === null ? null : collectReferencePrompts(review.scenes, submission.sceneIds);
      const sceneMembershipMatches =
        currentSceneIds.size === review.scenes.length &&
        currentSceneIds.size === expectedSceneIds.size &&
        [...currentSceneIds].every((sceneId) => expectedSceneIds.has(sceneId));
      if (
        !catalogMatchesProjectImageRoute(project, studioModels.catalog) ||
        !sceneMembershipMatches ||
        submission === null ||
        prompts === null
      ) {
        retain(includedRequests);
      }
    }
    deferredReferenceReviewsRef.current = retainedDeferredReviews;
    const deferredRequestIds = new Set(retainedDeferredReviews.flatMap(({ requests }) => requests.map(({ id }) => id)));

    // Requests this mount has already acted on are dropped here rather than checked as a whole
    // batch further down. The batch is rebuilt from every pending request on each run, so an id
    // that has been through the paid path must not be able to take the requests queued alongside
    // it with it — filtering leaves the untouched ones free to be submitted on their own.
    const requests = studioJobs.referenceRequests.filter(
      ({ id }) =>
        !suppressedReferenceRequestIdsRef.current.has(id) &&
        !autoSubmittedReferenceRequestIdsRef.current.has(id) &&
        !deferredRequestIds.has(id)
    );
    if (requests.length === 0) return;
    const review = buildQueuedReferenceReview(project, readiness, requests, availableRoutes);
    if (review.scenes.length === 0) {
      const signature = review.excludedScenes
        .map(({ id, reasonMessageKey }) => `${id}:${reasonMessageKey}`)
        .join('\u0000');
      if (notifiedExcludedReferenceRequestsRef.current === signature) return;
      notifiedExcludedReferenceRequestsRef.current = signature;
      setReferenceNotice({
        kind: 'excluded',
        scenes: review.excludedScenes,
        requestIds: review.excludedReferenceRequestIds,
      });
      return;
    }
    notifiedExcludedReferenceRequestsRef.current = null;
    setReferenceNotice((current) => (current?.kind === 'excluded' ? null : current));
    studioJobs.clearIssue();
    setGenerationReviewIssueMessageKey(null);

    const catalogVersion = studioModels.catalog.catalogVersion;
    const projectId = project.id;
    const projectRevision = project.revision;
    const requestIds = review.referenceRequestIds;
    const openQueuedReferenceReview = (requiresConfirmation = false, requestsAlreadyConsumed = false): void =>
      setGenerationReview({
        mode: 'batch',
        scenes: review.scenes,
        excludedScenes: review.excludedScenes,
        catalogVersion,
        availableRoutes,
        projectId,
        projectRevision,
        outputRole: 'reference',
        referenceRequestIds: requestsAlreadyConsumed ? [] : requestIds,
        referenceRequests: requests.map(({ id, sceneId }) => ({ id, sceneId })),
        ...(requiresConfirmation ? { referenceRequestsRequireConfirmation: true as const } : {}),
      });

    const activeBriefReferences = resolveActiveStudioBriefReferences(project.assets);
    if (activeBriefReferences === null || activeBriefReferences.length > 0) {
      // The accepted Director proposal may authorize a zero-input plate, but adding cast/look
      // changes what the paid call will run. Keep every included request queued until the exact
      // labels, roles, route and capacity have been reviewed by a human.
      openQueuedReferenceReview(true);
      return;
    }

    // The Director decides when to make an image, so a request it queued no longer waits for a
    // confirmation step. Routes are still resolved by the modal's own rule via
    // collectSubmittableRoutes, which returns null unless *every* scene has a valid matching
    // route — so a partial or unroutable batch falls back to the modal rather than spending on a
    // subset the modal itself would have refused.
    const submission = collectSubmittableRoutes(review.scenes);
    if (submission === null) {
      openQueuedReferenceReview();
      return;
    }
    // The Director's queued reference requests are the one paid path with no human confirm, so the
    // rule check happens here too. Main refuses this batch anyway; going through the modal instead
    // means the user sees WHICH rule blocked WHICH shot rather than a bare refusal, and the queued
    // requests survive to be answered.
    const breached = review.scenes.some(
      (scene) => evaluateStudioRules(resolveEffectiveStudioRules(project.rules), scene.promptText).breaches.length > 0
    );
    if (breached) {
      // Say WHY the batch stopped. Redirecting the user into a review they did not ask for, with no
      // statement that a rule caused it, is exactly the "say the consequence before it runs" failure
      // this phase exists to fix. The modal's own error slot is the surface: both
      // `studioJobs.clearIssue()` and `setGenerationReviewIssueMessageKey(null)` ran earlier in this
      // effect, and the modal falls back to `generationReviewIssueMessageKey` whenever
      // `studioJobs.issue` is not a `submit_scenes` issue, so this key is what renders.
      setGenerationReviewIssueMessageKey('conversation.creativeStudio.rules.autoSubmitBlocked');
      openQueuedReferenceReview();
      return;
    }
    // buildQueuedReferenceReview excludes any scene it could not describe, so this should hold for
    // every scene it did include. It is checked anyway because the alternative is dismissing the
    // requests and then having main refuse the batch - which destroys them.
    const referencePrompts = collectReferencePrompts(review.scenes, submission.sceneIds);
    if (referencePrompts === null) {
      openQueuedReferenceReview();
      return;
    }

    // Marked before the first await: the effect re-runs whenever `studioJobs` changes, which
    // includes every job poll, and this is a paid path with no spend ceiling behind it.
    requestIds.forEach((requestId) => autoSubmittedReferenceRequestIdsRef.current.add(requestId));

    void (async () => {
      // Consume the queued request *before* paying for it. Both de-dup sets are refs inside a
      // shell React remounts per project, so the pending request on disk is the only record that
      // survives leaving the project or quitting the app: dismissing after the submit leaves a
      // window where the plate is charged and the request is still queued, and the next mount
      // charges for it again with no human in the loop. Dismissing first can only lose an unpaid
      // request, which the user can simply ask the Director for again.
      const consumed = requestIds.length === 0 || (await studioJobs.dismissReferenceRequests(requestIds));
      if (!consumed) {
        // Nothing has been spent, and the request is still queued for a later mount to pick up.
        setReferenceNotice({ kind: 'dismiss_failed' });
        return;
      }
      requestIds.forEach((requestId) => suppressedReferenceRequestIdsRef.current.add(requestId));
      const submitted = await studioJobs.submitScenes({
        mode: 'batch',
        sceneIds: submission.sceneIds,
        routes: submission.routes,
        catalogVersion,
        expectedRevision: projectRevision,
        outputRole: 'reference',
        referencePrompts,
      });
      if (submitted) return;
      // A refused submit spends nothing and nothing retries it, so with no surface here the
      // request is simply gone: no error, no modal, nothing to act on. The review this path
      // replaced is that surface — it shows the failure, its Confirm retries under a human click,
      // and its Cancel discards the request.
      openQueuedReferenceReview(false, true);
    })();
  }, [
    briefReferenceMutationPending,
    generationBlocked,
    generationReview,
    project,
    readiness,
    studioJobs,
    studioModels.catalog,
  ]);

  /**
   * ⚠️ Currently unreachable, deliberately.
   *
   * D10 deleted Write's writing assistant, which held the only "Draft storyboard" button, and with
   * it the only path to `openDraftReview` → `StoryboardDraftModal` → this. The capability itself is
   * not lost: the Director drafts a storyboard through the Studio MCP server's `propose_storyboard`
   * and the user accepts it from the proposal cards in the pane. That is a *different* mechanism —
   * the Director authors the scenes with its own conversation model and queues them for review,
   * where this calls the model-routed `storyboardPlanner` and writes scenes straight in.
   *
   * The modal, `editor.proposeStoryboard` and the planner path are kept rather than deleted, so
   * treat everything they reach as dormant, not live: nothing renders it today.
   */
  const handleDraftStoryboard = useCallback(
    async (replaceExisting: boolean): Promise<void> => {
      if (await editor.proposeStoryboard(replaceExisting)) setDraftModalVisible(false);
    },
    [editor]
  );

  const openSingleReview = useCallback(
    (request: GenerationSingleReviewRequest): void => {
      if (project === null || generationBlocked || request.catalogVersion === null) return;
      const scene = project.scenes[request.sceneId];
      if (
        scene === undefined ||
        (request.outputRole !== 'reference' &&
          !canOpenSingleSceneReview(readiness?.sceneStatuses[scene.id], scene.visualPrompt))
      ) {
        return;
      }
      studioJobs.clearIssue();
      setGenerationReviewIssueMessageKey(null);
      setGenerationReview({
        mode: 'single',
        scenes: [
          toReviewScene(
            project,
            scene,
            request.route,
            request.availableRoutes,
            request.routeStatus,
            request.outputRole ?? 'take',
            request.referencePrompt,
            request.conditioning,
            request.conditioningIssue
          ),
        ],
        catalogVersion: request.catalogVersion,
        availableRoutes: request.availableRoutes,
        projectId: project.id,
        projectRevision: project.revision,
        ...(request.outputRole === undefined ? {} : { outputRole: request.outputRole }),
      });
    },
    [generationBlocked, project, readiness, studioJobs]
  );

  const openBatchReview = useCallback(
    (request: GenerationBatchReviewRequest): void => {
      if (project === null || generationBlocked || request.catalogVersion === null || request.sceneIds.length === 0) {
        return;
      }
      const scenes = request.sceneIds.flatMap((sceneId) => {
        const scene = project.scenes[sceneId];
        if (scene?.id !== sceneId) return [];
        const resolved = request.routes[scene.mediaKind];
        const route = resolved === null ? null : { sceneId: scene.id, ...resolved.route };
        return [toReviewScene(project, scene, route, request.availableRoutes, resolved?.routeStatus)];
      });
      if (scenes.length !== request.sceneIds.length) return;
      studioJobs.clearIssue();
      setGenerationReviewIssueMessageKey(null);
      setGenerationReview({
        mode: 'batch',
        scenes,
        excludedScenes: batchReviewExcludedScenes(project, request),
        catalogVersion: request.catalogVersion,
        availableRoutes: request.availableRoutes,
        projectId: project.id,
        projectRevision: project.revision,
      });
    },
    [generationBlocked, project, studioJobs]
  );

  const confirmGeneration = useCallback(
    async (confirmation: GenerationReviewConfirmation): Promise<void> => {
      const { sceneIds, routes } = confirmation;
      // Defence in depth behind the modal's disabled confirm button on this paid path.
      if (
        generationBlocked ||
        generationReview?.catalogVersion === null ||
        generationReview === null ||
        project === null ||
        generationReviewRefreshingRef.current
      ) {
        return;
      }

      if (generationReview.projectId !== project.id || generationReview.projectRevision !== project.revision) {
        generationReviewRefreshingRef.current = true;
        setGenerationReviewRefreshing(true);
        setGenerationReviewIssueMessageKey('conversation.creativeStudio.errors.staleProject');
        studioJobs.clearIssue();
        studioJobs.clearStaleIntent();
        try {
          await studioModels.refresh();
          const catalog = studioModels.catalog;
          if (catalog === null) {
            setGenerationReviewIssueMessageKey('conversation.creativeStudio.models.loading');
            return;
          }
          const canonical = canonicalProjectRef.current;
          if (canonical?.id !== project.id || canonical.revision !== project.revision) {
            setGenerationReviewIssueMessageKey('conversation.creativeStudio.errors.staleProject');
            return;
          }
          const canonicalReadiness = deriveStudioReadiness(canonical);
          const availableRoutes = catalogEntries(catalog);
          const refreshedReferenceReview =
            generationReview.mode === 'batch' && generationReview.referenceRequests !== undefined
              ? buildQueuedReferenceReview(
                  canonical,
                  canonicalReadiness,
                  generationReview.referenceRequests,
                  availableRoutes
                )
              : null;
          const refreshedScenes =
            generationReview.mode === 'single'
              ? generationReview.scenes.flatMap((reviewScene) => {
                  const scene = canonical.scenes[reviewScene.id];
                  if (
                    scene === undefined ||
                    (generationReview.outputRole !== 'reference' &&
                      !canOpenSingleSceneReview(canonicalReadiness.sceneStatuses[scene.id], scene.visualPrompt))
                  ) {
                    return [];
                  }
                  const route = projectRouteSnapshot(canonical, scene, generationReview.outputRole);
                  const catalogRoute =
                    route === null
                      ? undefined
                      : availableRoutes.find((candidate) => routeIdentity(candidate) === routeIdentity(route));
                  const conditioning =
                    generationReview.outputRole !== 'reference' || catalogRoute === undefined
                      ? undefined
                      : buildReferenceConditioningSnapshot(canonical, catalogRoute);
                  return [
                    toReviewScene(
                      canonical,
                      scene,
                      route,
                      availableRoutes,
                      undefined,
                      generationReview.outputRole ?? 'take',
                      reviewScene.referencePrompt,
                      conditioning
                    ),
                  ];
                })
              : (refreshedReferenceReview?.scenes ??
                generationReview.scenes.flatMap((reviewScene) => {
                  const scene = canonical.scenes[reviewScene.id];
                  if (scene?.id !== reviewScene.id || !canonicalReadiness.readySceneIds.includes(reviewScene.id)) {
                    return [];
                  }
                  return [
                    toReviewScene(
                      canonical,
                      scene,
                      projectRouteSnapshot(canonical, scene, generationReview.outputRole),
                      availableRoutes,
                      undefined,
                      generationReview.outputRole ?? 'take'
                    ),
                  ];
                }));
          setGenerationReview({
            mode: generationReview.mode,
            scenes: refreshedScenes,
            ...(refreshedReferenceReview === null
              ? generationReview.excludedScenes === undefined
                ? {}
                : { excludedScenes: generationReview.excludedScenes }
              : { excludedScenes: refreshedReferenceReview.excludedScenes }),
            catalogVersion: catalog.catalogVersion,
            availableRoutes,
            projectId: canonical.id,
            projectRevision: canonical.revision,
            ...(generationReview.outputRole === undefined ? {} : { outputRole: generationReview.outputRole }),
            ...(refreshedReferenceReview === null
              ? generationReview.referenceRequestIds === undefined
                ? {}
                : { referenceRequestIds: generationReview.referenceRequestIds }
              : { referenceRequestIds: refreshedReferenceReview.referenceRequestIds }),
            ...(generationReview.referenceRequests === undefined
              ? {}
              : { referenceRequests: generationReview.referenceRequests }),
            ...(generationReview.referenceRequestsRequireConfirmation === true
              ? { referenceRequestsRequireConfirmation: true as const }
              : {}),
          });
          if (generationReview.outputRole === 'reference') {
            setGenerationReviewIssueMessageKey('conversation.creativeStudio.conditioning.reviewChanged');
          }
        } catch {
          setGenerationReviewIssueMessageKey('conversation.creativeStudio.errors.provider');
        } finally {
          generationReviewRefreshingRef.current = false;
          setGenerationReviewRefreshing(false);
        }
        return;
      }

      if (generationReview.outputRole === 'reference') {
        generationReviewRefreshingRef.current = true;
        setGenerationReviewRefreshing(true);
        studioJobs.clearIssue();
        try {
          await studioModels.refresh();
          const catalog = studioModels.catalog;
          if (catalog === null) {
            setGenerationReviewIssueMessageKey('conversation.creativeStudio.models.loading');
            return;
          }
          const canonical = canonicalProjectRef.current;
          if (
            canonical === null ||
            canonical.id !== generationReview.projectId ||
            canonical.revision !== generationReview.projectRevision
          ) {
            if (canonical?.id === generationReview.projectId) {
              const canonicalReadiness = deriveStudioReadiness(canonical);
              const availableRoutes = catalogEntries(catalog);
              const refreshedReferenceReview =
                generationReview.referenceRequests === undefined
                  ? null
                  : buildQueuedReferenceReview(
                      canonical,
                      canonicalReadiness,
                      generationReview.referenceRequests,
                      availableRoutes
                    );
              setGenerationReview({
                ...generationReview,
                scenes: refreshedReferenceReview?.scenes ?? [],
                ...(refreshedReferenceReview === null
                  ? {}
                  : {
                      excludedScenes: refreshedReferenceReview.excludedScenes,
                      referenceRequestIds: refreshedReferenceReview.referenceRequestIds,
                    }),
                catalogVersion: catalog.catalogVersion,
                availableRoutes,
                projectRevision: canonical.revision,
              });
            }
            setGenerationReviewIssueMessageKey('conversation.creativeStudio.conditioning.reviewChanged');
            return;
          }
          const canonicalReadiness = deriveStudioReadiness(canonical);
          const availableRoutes = catalogEntries(catalog);
          const refreshedReferenceReview =
            generationReview.referenceRequests === undefined
              ? null
              : buildQueuedReferenceReview(
                  canonical,
                  canonicalReadiness,
                  generationReview.referenceRequests,
                  availableRoutes
                );
          const refreshedScenes =
            refreshedReferenceReview?.scenes ??
            generationReview.scenes.flatMap((reviewScene) => {
              const scene = canonical.scenes[reviewScene.id];
              if (scene === undefined) return [];
              const route = projectRouteSnapshot(canonical, scene, 'reference');
              const catalogRoute =
                route === null
                  ? undefined
                  : availableRoutes.find((candidate) => routeIdentity(candidate) === routeIdentity(route));
              const conditioning =
                catalogRoute === undefined ? undefined : buildReferenceConditioningSnapshot(canonical, catalogRoute);
              return [
                toReviewScene(
                  canonical,
                  scene,
                  route,
                  availableRoutes,
                  undefined,
                  'reference',
                  reviewScene.referencePrompt,
                  conditioning
                ),
              ];
            });
          if (
            catalog.catalogVersion !== generationReview.catalogVersion ||
            !reviewSceneAuthorityMatches(generationReview.scenes, refreshedScenes)
          ) {
            setGenerationReview({
              ...generationReview,
              scenes: refreshedScenes,
              ...(refreshedReferenceReview === null
                ? {}
                : {
                    excludedScenes: refreshedReferenceReview.excludedScenes,
                    referenceRequestIds: refreshedReferenceReview.referenceRequestIds,
                  }),
              catalogVersion: catalog.catalogVersion,
              availableRoutes,
              projectRevision: canonical.revision,
            });
            setGenerationReviewIssueMessageKey('conversation.creativeStudio.conditioning.reviewChanged');
            return;
          }
        } catch {
          setGenerationReviewIssueMessageKey('conversation.creativeStudio.errors.provider');
          return;
        } finally {
          generationReviewRefreshingRef.current = false;
          setGenerationReviewRefreshing(false);
        }
      }

      const submitResult = await submitExactGenerationReview(
        generationReview.scenes,
        confirmation,
        async (exactConfirmation) => {
          // Defence in depth: main refuses a reference submission whose scenes are not all described,
          // and a refused submit here would leave the queued requests dismissed and unpaid-for with
          // nothing on screen. Surfacing the issue keeps the review open so Cancel or a retry works.
          const referencePrompts =
            generationReview.outputRole === 'reference'
              ? collectReferencePrompts(generationReview.scenes, exactConfirmation.sceneIds)
              : null;
          if (generationReview.outputRole === 'reference' && referencePrompts === null) {
            setGenerationReviewIssueMessageKey('conversation.creativeStudio.errors.invalidPayload');
            return false;
          }

          if (generationReview.referenceRequestIds !== undefined) {
            const requestIds = generationReview.referenceRequestIds;
            const canonical = canonicalProjectRef.current;
            if (
              canonical?.id !== generationReview.projectId ||
              canonical.revision !== generationReview.projectRevision
            ) {
              setGenerationReviewIssueMessageKey('conversation.creativeStudio.conditioning.reviewChanged');
              return false;
            }
            let consumed = requestIds.length === 0;
            if (generationReview.referenceRequestsRequireConfirmation === true && requestIds.length > 0) {
              const reviewedRequestById = new Map(
                generationReview.referenceRequests?.map((request) => [request.id, request]) ?? []
              );
              const expectedRequests = requestIds.flatMap((requestId) => {
                const request = reviewedRequestById.get(requestId);
                return request === undefined ? [] : [{ ...request }];
              });
              if (expectedRequests.length !== requestIds.length) {
                setGenerationReviewIssueMessageKey('conversation.creativeStudio.conditioning.reviewChanged');
                return false;
              }
              const consumeResult = await studioJobs.consumeReferenceRequests(
                expectedRequests,
                generationReview.projectRevision
              );
              if (consumeResult === 'changed') {
                generationReviewRefreshingRef.current = true;
                setGenerationReviewRefreshing(true);
                try {
                  const authority = await studioJobs.refreshReferenceAuthority();
                  await studioModels.refresh();
                  const refreshedCatalog = studioModels.catalog;
                  if (authority === null || refreshedCatalog === null) {
                    setGenerationReviewIssueMessageKey('conversation.creativeStudio.reference.dismissFailed');
                    return false;
                  }
                  const currentRequestById = new Map(authority.requests.map((request) => [request.id, request]));
                  const survivingRequests = expectedRequests.flatMap((expected) => {
                    const current = currentRequestById.get(expected.id);
                    return current?.sceneId === expected.sceneId ? [{ id: current.id, sceneId: current.sceneId }] : [];
                  });
                  const recoveryRequests = survivingRequests.length > 0 ? survivingRequests : authority.requests;
                  if (recoveryRequests.length === 0) {
                    setGenerationReview(null);
                    return false;
                  }
                  const availableRoutes = catalogEntries(refreshedCatalog);
                  const refreshedReview = buildQueuedReferenceReview(
                    authority.project,
                    deriveStudioReadiness(authority.project),
                    recoveryRequests,
                    availableRoutes
                  );
                  const includedRequestIds = new Set(refreshedReview.referenceRequestIds);
                  const includedRequests = recoveryRequests.filter(({ id }) => includedRequestIds.has(id));
                  if (refreshedReview.scenes.length === 0 || includedRequests.length === 0) {
                    setGenerationReview(null);
                    return false;
                  }
                  setGenerationReview({
                    mode: 'batch',
                    scenes: refreshedReview.scenes,
                    excludedScenes: refreshedReview.excludedScenes,
                    catalogVersion: refreshedCatalog.catalogVersion,
                    availableRoutes,
                    projectId: authority.project.id,
                    projectRevision: authority.project.revision,
                    outputRole: 'reference',
                    referenceRequestIds: refreshedReview.referenceRequestIds,
                    referenceRequests: includedRequests,
                    referenceRequestsRequireConfirmation: true,
                  });
                  setGenerationReviewIssueMessageKey('conversation.creativeStudio.conditioning.reviewChanged');
                  return false;
                } finally {
                  generationReviewRefreshingRef.current = false;
                  setGenerationReviewRefreshing(false);
                }
              }
              consumed = consumeResult === 'consumed';
            } else if (requestIds.length > 0) {
              consumed = await studioJobs.dismissReferenceRequests(requestIds);
            }
            if (!consumed) {
              setGenerationReviewIssueMessageKey('conversation.creativeStudio.reference.dismissFailed');
              return false;
            }
            requestIds.forEach((requestId) => suppressedReferenceRequestIdsRef.current.add(requestId));
            setGenerationReview((current) => (current === null ? null : { ...current, referenceRequestIds: [] }));
          }

          return studioJobs.submitScenes({
            mode: generationReview.mode,
            sceneIds: exactConfirmation.sceneIds,
            routes: exactConfirmation.routes,
            catalogVersion: generationReview.catalogVersion,
            expectedRevision: generationReview.projectRevision,
            ...(generationReview.outputRole === undefined ? {} : { outputRole: generationReview.outputRole }),
            ...(referencePrompts === null ? {} : { referencePrompts }),
          });
        }
      );
      if (submitResult === 'rejected') {
        setGenerationReviewIssueMessageKey('conversation.creativeStudio.errors.invalidRoute');
        return;
      }
      if (submitResult === 'not_submitted') return;
      setGenerationReview(null);
    },
    [generationBlocked, generationReview, project, readiness, studioJobs, studioModels]
  );

  const dismissExcludedReferenceRequests = useCallback(async (): Promise<void> => {
    if (referenceNotice?.kind !== 'excluded') return;
    const requestIds = referenceNotice.requestIds;
    const dismissed = requestIds.length === 0 || (await studioJobs.dismissReferenceRequests(requestIds));
    if (!dismissed) return;
    requestIds.forEach((requestId) => suppressedReferenceRequestIdsRef.current.add(requestId));
    setReferenceNotice(null);
  }, [referenceNotice, studioJobs]);

  useEffect(() => {
    const staleIntent = studioJobs.staleIntent;
    if (staleIntent?.operation !== 'submit_scenes' || project === null) return;
    setGenerationReview((current) => {
      if (current === null) return null;
      const currentById = new Map(current.scenes.map((scene) => [scene.id, scene]));
      const availableRoutes =
        studioModels.catalog === null ? current.availableRoutes : catalogEntries(studioModels.catalog);
      return {
        ...current,
        catalogVersion: studioModels.catalog?.catalogVersion ?? staleIntent.catalogVersion,
        availableRoutes,
        projectId: project.id,
        projectRevision: project.revision,
        scenes: staleIntent.sceneIds.flatMap((sceneId) => {
          const scene = project.scenes[sceneId];
          const outputRole = current.outputRole ?? 'take';
          const route = scene === undefined ? null : projectRouteSnapshot(project, scene, outputRole);
          const eligible =
            scene !== undefined &&
            (outputRole === 'reference' ||
              canOpenSingleSceneReview(readiness?.sceneStatuses[scene.id], scene.visualPrompt)) &&
            (current.mode === 'single' || scene.selectedAssetId === null);
          if (eligible) {
            return [
              toReviewScene(
                project,
                scene,
                route,
                availableRoutes,
                undefined,
                outputRole,
                currentById.get(sceneId)?.referencePrompt
              ),
            ];
          }
          const previous = currentById.get(sceneId);
          return previous === undefined
            ? []
            : [
                {
                  ...previous,
                  route:
                    previous.route.status === 'missing'
                      ? previous.route
                      : {
                          status: 'invalid' as const,
                          snapshot: previous.route.snapshot,
                          providerName: previous.route.providerName,
                          integrationLabelKey: previous.route.integrationLabelKey,
                          silentOutput: previous.route.silentOutput,
                        },
                },
              ];
        }),
      };
    });
  }, [project, readiness, studioJobs.staleIntent, studioModels.catalog]);

  const handleSelectVariation = useCallback(
    async (request: StudioSelectVariationRequest): Promise<void> => {
      if (
        project === null ||
        canonicalMutationPending ||
        variationPendingRef.current ||
        editor.hasUnsavedSceneDrafts ||
        editor.conflict !== null ||
        request.projectId !== project.id
      ) {
        return;
      }
      const scene = project.scenes[request.sceneId];
      const asset = project.assets[request.assetId];
      if (
        scene === undefined ||
        asset === undefined ||
        asset.projectId !== project.id ||
        asset.sceneId !== scene.id ||
        asset.mediaKind !== scene.mediaKind ||
        asset.managedAsset.collection !== 'assets' ||
        !scene.assetIds.includes(asset.id)
      ) {
        return;
      }

      variationPendingRef.current = true;
      setVariationPending(true);
      setVariationIssueMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.selectAsset.invoke({
          projectId: project.id,
          sceneId: scene.id,
          assetId: asset.id,
          expectedRevision: project.revision,
        });
        if (result.ok === false) {
          if (result.error.code === 'stale_project') await refetch();
          setVariationIssueMessageKey(result.error.messageKey);
          return;
        }
        await refetch();
      } catch {
        setVariationIssueMessageKey('conversation.creativeStudio.errors.storage');
      } finally {
        variationPendingRef.current = false;
        setVariationPending(false);
      }
    },
    [canonicalMutationPending, editor.conflict, editor.hasUnsavedSceneDrafts, project, refetch]
  );

  const handleImportReference = useCallback(
    async (sceneId: string): Promise<void> => {
      if (
        !Object.hasOwn(editorRef.current.project?.scenes ?? {}, sceneId) ||
        editor.conflict !== null ||
        editor.drafting ||
        editor.mutationPending ||
        studioJobs.mutationPending ||
        variationPending ||
        referenceImportSceneId !== null ||
        referenceImportSceneIdRef.current !== null
      ) {
        return;
      }

      referenceImportSceneIdRef.current = sceneId;
      setReferenceImportSceneId(sceneId);
      setReferenceImportIssue(null);
      try {
        if (!(await editorRef.current.flushSceneDraftById(sceneId))) return;
        const canonical = await refetch();
        if (canonical === null || !Object.hasOwn(canonical.scenes, sceneId)) {
          setReferenceImportIssue({
            sceneId,
            messageKey: 'conversation.creativeStudio.errors.storage',
          });
          return;
        }
        const result = await ipcBridge.creativeStudio.chooseAndImportReference.invoke({
          projectId: canonical.id,
          sceneId,
          expectedRevision: canonical.revision,
        });
        if (result.ok === false) {
          if (result.error.code === 'stale_project') await refetch();
          setReferenceImportIssue({ sceneId, messageKey: result.error.messageKey });
          return;
        }
        if (result.data.status === 'imported') await refetch();
      } catch {
        setReferenceImportIssue({
          sceneId,
          messageKey: 'conversation.creativeStudio.errors.storage',
        });
      } finally {
        if (referenceImportSceneIdRef.current === sceneId) {
          referenceImportSceneIdRef.current = null;
        }
        setReferenceImportSceneId(null);
      }
    },
    [
      editor.conflict,
      editor.drafting,
      editor.mutationPending,
      refetch,
      referenceImportSceneId,
      studioJobs.mutationPending,
      variationPending,
    ]
  );

  const handleAddBriefReference = useCallback(
    async (role: StudioBriefReferenceRole): Promise<string | null> => {
      const canonical = canonicalProjectRef.current;
      const active = canonical === null ? null : resolveActiveStudioBriefReferences(canonical.assets);
      if (
        canonical === null ||
        active === null ||
        active.length >= STUDIO_MAX_ACTIVE_BRIEF_REFERENCES ||
        briefReferenceMutationPendingRef.current
      ) {
        return null;
      }

      briefReferenceMutationPendingRef.current = true;
      setBriefReferenceMutationPending(true);
      try {
        const result = await ipcBridge.creativeStudio.chooseAndImportReference.invoke({
          projectId: canonical.id,
          briefReferenceRole: role,
          expectedRevision: canonical.revision,
        });
        if (result.ok === false) {
          if (result.error.code === 'stale_project') {
            const refreshed = await refetch();
            if (refreshed !== null) canonicalProjectRef.current = refreshed;
          }
          setBriefReferenceIssueMessageKey(result.error.messageKey);
          return null;
        }
        if (result.data.status === 'cancelled') return null;
        setBriefReferenceIssueMessageKey(null);
        const refreshed = await refetch();
        if (refreshed !== null) canonicalProjectRef.current = refreshed;
        return result.data.asset.id;
      } catch {
        setBriefReferenceIssueMessageKey('conversation.creativeStudio.briefReferences.importError');
        return null;
      } finally {
        briefReferenceMutationPendingRef.current = false;
        setBriefReferenceMutationPending(false);
      }
    },
    [refetch]
  );

  const handleRemoveBriefReference = useCallback(
    async (assetId: string): Promise<boolean> => {
      const canonical = canonicalProjectRef.current;
      const active = canonical === null ? null : resolveActiveStudioBriefReferences(canonical.assets);
      if (
        canonical === null ||
        active === null ||
        !active.some((asset) => asset.id === assetId) ||
        briefReferenceMutationPendingRef.current
      ) {
        return false;
      }

      briefReferenceMutationPendingRef.current = true;
      setBriefReferenceMutationPending(true);
      setBriefReferenceIssueMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.detachBriefReference.invoke({
          projectId: canonical.id,
          assetId,
          expectedRevision: canonical.revision,
        });
        if (result.ok === false) {
          if (result.error.code === 'stale_project') {
            const refreshed = await refetch();
            if (refreshed !== null) canonicalProjectRef.current = refreshed;
          }
          setBriefReferenceIssueMessageKey(result.error.messageKey);
          return false;
        }
        const refreshed = await refetch();
        if (refreshed !== null) canonicalProjectRef.current = refreshed;
        return true;
      } catch {
        setBriefReferenceIssueMessageKey('conversation.creativeStudio.errors.storage');
        return false;
      } finally {
        briefReferenceMutationPendingRef.current = false;
        setBriefReferenceMutationPending(false);
      }
    },
    [refetch]
  );

  const handleExportAssets = useCallback(async (): Promise<void> => {
    if (exportBlocked || exportPending || project === null || readiness?.selectedAssetCount === 0) return;
    setExportIssueMessageKey(null);
    setExportPending(true);
    try {
      const result = await ipcBridge.creativeStudio.chooseAndExportAssets.invoke({
        projectId: project.id,
        includeReferences: exportIncludeReferences,
      });
      if (result.ok === false) {
        setExportIssueMessageKey(result.error.messageKey);
      } else if (result.data.status === 'exported') {
        setExportedFolderName(result.data.folderName);
        setExportMissingSceneIds(result.data.missingSceneIds);
      } else {
        setExportVisible(false);
      }
    } catch {
      setExportIssueMessageKey('conversation.creativeStudio.export.failed');
    } finally {
      setExportPending(false);
    }
  }, [exportBlocked, exportIncludeReferences, exportPending, project, readiness?.selectedAssetCount]);

  const openExport = useCallback((): void => {
    if (exportBlocked || readiness?.selectedAssetCount === 0 || project === null) return;
    setExportIncludeReferences(false);
    setExportedFolderName(null);
    setExportMissingSceneIds([]);
    setExportIssueMessageKey(null);
    setExportLatestRender(null);
    setExportLatestRenderReady(false);
    setExportVisible(true);
    void ipcBridge.creativeStudio.getLatestRender
      .invoke({ projectId: project.id })
      .then((result) => {
        if (result.ok === false) {
          setExportIssueMessageKey('conversation.creativeStudio.export.latestRenderUnavailable');
          return;
        }
        setExportLatestRender(result.data);
        setExportLatestRenderReady(true);
      })
      .catch(() => setExportIssueMessageKey('conversation.creativeStudio.export.latestRenderUnavailable'));
  }, [exportBlocked, project, readiness?.selectedAssetCount]);

  /**
   * Lands focus on the advisory that explains a refused view transition.
   *
   * Scoped to the work panel, not the document: the Director pane renders before it and has
   * `role="alert"` spans of its own — an over-length composer, a conversation that could not be
   * created — plus whatever the mounted conversation surface raises. A document-wide lookup takes
   * the first alert in order, which is one of those, and drops the user on an unrelated message
   * instead of the reason their transition was blocked. Worse when the pane is collapsed: those
   * spans are `visibility: hidden`, where `focus()` does nothing at all and the recovery is lost.
   */
  const focusRecoveryAlert = useCallback((): void => {
    requestAnimationFrame(() => {
      const alert = document.querySelector<HTMLElement>('[data-studio-work-panel] [role="alert"]');
      if (alert === null) return;
      alert.tabIndex = -1;
      alert.focus();
    });
  }, []);

  const requestTransition = useCallback(
    (transition: StudioViewTransition): void => {
      if (
        project === null ||
        transitionBlocked ||
        pendingTransitionRef.current !== null ||
        (transition.view === routeView && transition.state === undefined)
      ) {
        return;
      }
      pendingTransitionRef.current = transition;
      setPendingTransition(transition);
      setTransitionReady(false);
      setTransitionIssueMessageKey(null);
      void (async (): Promise<void> => {
        const clearPendingTransition = (): void => {
          pendingTransitionRef.current = null;
          setPendingTransition(null);
          setTransitionReady(false);
        };
        const projectSaved = await editorRef.current.flushProjectDraft();
        if (!projectSaved || editorRef.current.conflict !== null) {
          clearPendingTransition();
          focusRecoveryAlert();
          return;
        }

        for (let round = 0; round < 3; round += 1) {
          const result = await editorRef.current.flushAllSceneDrafts();
          if (result.failed.length > 0 || editorRef.current.conflict !== null) {
            clearPendingTransition();
            focusRecoveryAlert();
            return;
          }
          if (result.dirtied.length === 0) {
            setTransitionReady(true);
            return;
          }
        }

        clearPendingTransition();
        setTransitionIssueMessageKey('conversation.creativeStudio.transition.savingBlocked');
        focusRecoveryAlert();
      })();
    },
    [focusRecoveryAlert, project, routeView, transitionBlocked]
  );

  useEffect(() => {
    if (project === null || pendingTransition === null || !transitionReady) return;
    const transition = pendingTransition;
    rememberStudioView(project.id, transition.view);
    navigate(studioViewPath(project.id, transition.view), {
      state: transition.state ?? null,
    });
    pendingTransitionRef.current = null;
    setPendingTransition(null);
    setTransitionReady(false);
  }, [navigate, pendingTransition, project, transitionReady]);

  const clearWriteFocusIntent = useCallback((): void => {
    if (parseWriteFocusIntent(location.state) === null) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const openModelSettings = useCallback((): void => {
    setTimeout(() => navigate('/settings/model'), 0);
  }, [navigate]);

  const focusEngineRole = useCallback((role: StudioMediaKind): void => setPendingEngineFocusRole(role), []);

  useEffect(() => {
    if (pendingEngineFocusRole === null || generationReview !== null) return;
    let frame = 0;
    const focusPendingRole = (): void => {
      const selector = `[data-engine-role="${pendingEngineFocusRole}"]`;
      const briefScope = document.querySelector<HTMLElement>('[data-studio-engine-scope="brief"]');
      const activePhase = document.querySelector<HTMLElement>('[data-studio-phase-shell]');
      const roleSlot =
        briefScope?.querySelector<HTMLElement>(selector) ?? activePhase?.querySelector<HTMLElement>(selector);
      if (roleSlot === null || roleSlot === undefined) {
        setBriefOpen(true);
        frame = requestAnimationFrame(focusPendingRole);
        return;
      }
      const target = roleSlot.querySelector<HTMLElement>('button:not([disabled])') ?? roleSlot;
      target.focus({ preventScroll: true });
      if (document.activeElement === target) {
        setPendingEngineFocusRole(null);
        return;
      }
      frame = requestAnimationFrame(focusPendingRole);
    };
    frame = requestAnimationFrame(focusPendingRole);
    return () => cancelAnimationFrame(frame);
  }, [generationReview, pendingEngineFocusRole]);

  const closeExportAndOpenProduce = useCallback((): void => {
    if (exportPending) return;
    setPostModalTransition({ view: 'board' });
    setExportVisible(false);
    setExportIncludeReferences(false);
    setExportedFolderName(null);
    setExportMissingSceneIds([]);
    setExportIssueMessageKey(null);
  }, [exportPending]);

  const setBriefRules = useCallback(
    async (rules: StudioBriefRuleDraft[]): Promise<boolean> => {
      if (project === null) return false;
      setRulesPending(true);
      setRulesErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.setBriefRules.invoke({
          projectId: project.id,
          expectedRevision: project.revision,
          rules,
        });
        if (result.ok === false) {
          setRulesErrorMessageKey(result.error.messageKey);
          return false;
        }
        // Adopt the bumped revision before returning, so the drawer's NEXT write CASes against the
        // revision this one produced. `refetch` is the handle the page already destructures at :271
        // and already passes to useStoryboardEditor, useStudioJobs and useStudioModels for exactly
        // this purpose; it reloads `loadedProject`, which flows back through
        // `newestProject(studioJobs.project, editor.project, loadedProject)` at :281.
        //
        // There is no `applyProject` to call: `adoptProject` is private to useStoryboardEditor
        // (:494) and is not on `UseStoryboardEditorResult`, `creativeStudio.updateProject.invoke` is
        // only ever called from inside that hook (:1249, :1386) and never from this page, and
        // `useStudioProject` exposes only `refetch` (useStudioProject.ts:180-188). Do not widen the
        // editor hook's API to satisfy a call that was never needed.
        //
        // `setBriefRules` also goes through main's `notify` (creativeStudioService.ts:979-982), which
        // fires `onProjectUpdated` → `creativeStudio.projectUpdated.emit` → `useStudioJobs`'s
        // subscription (useStudioJobs.ts:392) → the same `refetch`. That path would adopt eventually;
        // awaiting here makes it deterministic instead, which is what add-then-remove in one drawer
        // session needs.
        await refetch();
        return true;
      } finally {
        setRulesPending(false);
      }
    },
    [project, refetch]
  );

  const undoBriefRules = useCallback(async (): Promise<boolean> => {
    if (project === null) return false;
    setRulesPending(true);
    setRulesErrorMessageKey(null);
    try {
      const result = await ipcBridge.creativeStudio.undoBriefRules.invoke({ projectId: project.id });
      if (result.ok === false) {
        setRulesErrorMessageKey(result.error.messageKey);
        return false;
      }
      await refetch();
      return true;
    } finally {
      setRulesPending(false);
    }
  }, [project, refetch]);

  useEffect(() => {
    if (postModalTransition === null || exportVisible) return;
    const transition = postModalTransition;
    setPostModalTransition(null);
    requestTransition(transition);
  }, [exportVisible, postModalTransition, requestTransition]);

  if (loading) {
    return (
      <div className={styles.centered}>
        <Spin tip={t('conversation.creativeStudio.project.loading')} />
      </div>
    );
  }

  if (errorMessageKey && !project) {
    return (
      <div role='alert' className={styles.centered}>
        {t(errorMessageKey)}
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className={styles.centered}>
        <p>{t('conversation.creativeStudio.project.notFound')}</p>
        <Button type='primary' onClick={() => navigate('/studio')}>
          {t('conversation.creativeStudio.library.openProject')}
        </Button>
      </div>
    );
  }

  if (readiness === null) return null;

  const activeView = routeView ?? resolveStudioEntryView(project.id);
  const projectUpdateIssue =
    editor.conflict?.operation === 'update_project'
      ? editor.conflict.messageKey
      : editor.error?.operation === 'update_project'
        ? editor.error.messageKey
        : null;
  const shellIssueMessageKey =
    transitionIssueMessageKey ??
    errorMessageKey ??
    variationIssueMessageKey ??
    referenceImportIssue?.messageKey ??
    (briefOpen ? null : projectUpdateIssue);
  const advisory: StudioPhaseControllers['advisory'] =
    shellIssueMessageKey !== null
      ? { messageKey: shellIssueMessageKey, anchor: 'shell' }
      : // Cut-time concern with no Table render site since the pacing bar was
        // removed, so it rides the shell advisory slot instead of vanishing silently.
        activeView === 'table' && readiness.durationDeltaSeconds !== 0
        ? { messageKey: 'conversation.creativeStudio.review.durationMismatch', anchor: 'shell' }
        : activeView === 'board' && readiness.readySceneIds.length === 0
          ? { messageKey: 'conversation.creativeStudio.review.noReadyScenes', anchor: 'batch' }
          : activeView === 'board' && readiness.durationDeltaSeconds !== 0
            ? { messageKey: 'conversation.creativeStudio.review.durationMismatch', anchor: 'batch' }
            : null;
  const controller: StudioPhaseControllers = {
    project,
    proposals,
    readiness,
    editor,
    models: studioModels,
    jobs: studioJobs,
    render: studioRender,
    selectedAsset,
    posterAsset,
    selectedReferenceAsset,
    writeFocusIntent,
    advisory,
    mutationPending:
      canonicalMutationPending || referenceImportSceneId !== null || generationReviewRefreshing || exportPending,
    generationReviewOpen: generationReview !== null,
    requestTransition,
    openBrief: () => setBriefOpen(true),
    openRules: () => setRulesOpen(true),
    acceptProposal: (request) => ipcBridge.creativeStudio.acceptProposal.invoke(request),
    rejectProposal: (request) => ipcBridge.creativeStudio.rejectProposal.invoke(request),
    openDraftReview: () => setDraftModalVisible(true),
    openSingleGenerationReview: openSingleReview,
    openBatchGenerationReview: openBatchReview,
    focusEngineRole,
    openExport,
    refreshProject: refetch,
    openModelSettings,
    importReference: handleImportReference,
    selectVariation: handleSelectVariation,
    clearWriteFocusIntent,
    openDuplicateChargeConfirmation: setDuplicateChargeJobId,
  };
  // Undefined rather than an always-rendered component, so the pane can drop its separator and
  // padding entirely when nothing is pending instead of showing an empty bordered strip.
  const directorProposals =
    pendingDirectorProposals(proposals).length > 0 ? (
      <DirectorProposals
        project={project}
        proposals={proposals}
        editor={editor}
        acceptProposal={controller.acceptProposal}
        rejectProposal={controller.rejectProposal}
      />
    ) : undefined;
  const referenceAdvisory =
    referenceNotice?.kind === 'excluded' ? (
      <Alert
        type='warning'
        content={
          <div data-testid='reference-exclusion-notice'>
            <p className='m-0'>{t('conversation.creativeStudio.reference.excludedNoneReady')}</p>
            <ul className='mb-0 mt-6px pl-18px'>
              {referenceNotice.scenes.map((scene) => (
                <li key={scene.id}>
                  <span>{scene.title}</span>
                  <span> — {t(scene.reasonMessageKey)}</span>
                </li>
              ))}
            </ul>
            <Button
              className='mt-8px'
              type='text'
              status='danger'
              loading={studioJobs.mutationPending}
              onClick={() => void dismissExcludedReferenceRequests()}
            >
              {t('conversation.creativeStudio.reference.discardExcludedRequests')}
            </Button>
          </div>
        }
      />
    ) : referenceNotice?.kind === 'dismiss_failed' ? (
      <Alert type='error' content={t('conversation.creativeStudio.reference.dismissFailed')} />
    ) : undefined;

  return (
    <section aria-label={t('conversation.creativeStudio.project.title')} className={styles.projectShell}>
      <BriefConversationProvider project={project}>
        <StudioShell director={<DirectorPane proposals={directorProposals} />} projectId={project.id}>
          <StudioPhaseShell
            activeView={activeView}
            controller={controller}
            navigationDisabled={transitionBlocked || pendingTransition !== null}
            notice={referenceAdvisory}
            onBack={() => navigate('/studio')}
          />
        </StudioShell>
        <StudioGenerationReview
          reports={breachReports}
          onAsked={() => setGenerationReview(null)}
          visible={generationReview !== null}
          mode={generationReview?.mode ?? 'single'}
          scenes={generationReview?.scenes ?? []}
          ruleBreachesBySceneId={ruleBreachesBySceneId}
          excludedScenes={generationReview?.excludedScenes}
          aspectRatio={project.aspectRatio}
          resolution={project.resolution}
          targetDurationSeconds={project.targetDurationSeconds}
          selectedDurationSeconds={
            generationReview?.scenes.reduce((total, scene) => total + scene.durationSeconds, 0) ?? 0
          }
          projectDurationSeconds={project.sceneOrder.reduce((total, sceneId) => {
            const scene = project.scenes[sceneId];
            return scene?.id === sceneId ? total + scene.durationSeconds : total;
          }, 0)}
          submitting={studioJobs.mutationPending || generationReviewRefreshing}
          submissionBlocked={
            generationBlocked ||
            (studioJobs.issue?.operation === 'submit_scenes' && studioJobs.issue.code === 'invalid_route')
          }
          errorMessageKey={
            studioJobs.issue?.operation === 'submit_scenes'
              ? studioJobs.issue.messageKey
              : generationReviewIssueMessageKey
          }
          onCancel={async () => {
            if (!studioJobs.mutationPending && !generationReviewRefreshing && !generationReviewRefreshingRef.current) {
              const requestIds = generationReview?.referenceRequestIds;
              if (generationReview?.referenceRequestsRequireConfirmation === true) {
                requestIds?.forEach((requestId) => suppressedReferenceRequestIdsRef.current.add(requestId));
                studioJobs.clearIssue();
                studioJobs.clearStaleIntent();
                setGenerationReviewIssueMessageKey(null);
                setGenerationReview(null);
                return;
              }
              const dismissed =
                requestIds === undefined ||
                requestIds.length === 0 ||
                (await studioJobs.dismissReferenceRequests(requestIds));
              const suppressedIds = dismissed
                ? requestIds
                : (generationReview?.referenceRequests?.map(({ id: requestId }) => requestId) ?? requestIds);
              suppressedIds?.forEach((requestId) => suppressedReferenceRequestIdsRef.current.add(requestId));
              if (dismissed) studioJobs.clearIssue();
              studioJobs.clearStaleIntent();
              setGenerationReviewIssueMessageKey(null);
              setGenerationReview(null);
              if (!dismissed) setReferenceNotice({ kind: 'dismiss_failed' });
            }
          }}
          onSetEngines={(role) => {
            if (
              generationReview?.referenceRequestIds !== undefined &&
              generationReview.referenceRequests !== undefined
            ) {
              const requestById = new Map(generationReview.referenceRequests.map((request) => [request.id, request]));
              const includedRequests = generationReview.referenceRequestIds.map((requestId) =>
                requestById.get(requestId)
              );
              if (includedRequests.length > 0 && includedRequests.every((request) => request !== undefined)) {
                deferredReferenceReviewsRef.current.push({
                  requests: includedRequests,
                  sceneIds: generationReview.scenes.map(({ id }) => id),
                });
              }
            }
            studioJobs.clearIssue();
            studioJobs.clearStaleIntent();
            setGenerationReviewIssueMessageKey(null);
            setGenerationReview(null);
            focusEngineRole(role);
          }}
          onConfirm={confirmGeneration}
        />
      </BriefConversationProvider>
      <StoryboardDraftModal
        visible={draftModalVisible}
        project={project}
        storyboard={studioModels.catalog?.storyboard ?? null}
        catalogLoading={studioModels.loading}
        catalogErrorMessageKey={draftErrorMessageKey}
        selectionPending={studioModels.pendingRole === 'storyboard'}
        draftConflict={draftConflict !== null}
        drafting={editor.drafting}
        onCancel={() => setDraftModalVisible(false)}
        proposeStoryboard={handleDraftStoryboard}
        onDiscardDraftConflict={editor.discardConflict}
        onContinueManual={() => setDraftModalVisible(false)}
        onOpenSettings={() => setTimeout(() => navigate('/settings/model'), 0)}
        onRefreshCatalog={studioModels.refresh}
        onSelectStoryboardModel={(selection) => studioModels.updateSelection({ role: 'storyboard', selection })}
      />
      <StudioBriefDrawer
        visible={briefOpen}
        controller={{
          ...controller,
          briefReferenceMutationPending,
          briefReferenceIssueMessageKey,
          addBriefReference: handleAddBriefReference,
          removeBriefReference: handleRemoveBriefReference,
        }}
        onClose={() => setBriefOpen(false)}
      />
      {project !== null && (
        <StudioRulesDrawer
          visible={rulesOpen}
          project={project}
          pending={rulesPending}
          errorMessageKey={rulesErrorMessageKey}
          onClose={() => setRulesOpen(false)}
          onSetRules={setBriefRules}
          onUndoRules={undoBriefRules}
        />
      )}
      <StudioExportModal
        visible={exportVisible}
        project={project}
        selectedAssetCount={readiness.selectedAssetCount}
        pending={exportPending}
        includeReferences={exportIncludeReferences}
        exportedFolderName={exportedFolderName}
        missingSceneIds={exportMissingSceneIds}
        issueMessageKey={exportIssueMessageKey}
        latestRender={exportLatestRender}
        latestRenderReady={exportLatestRenderReady}
        onCancel={() => setExportVisible(false)}
        onConfirm={() => void handleExportAssets()}
        onIncludeReferencesChange={setExportIncludeReferences}
        onOpenProduce={closeExportAndOpenProduce}
      />
      <Modal
        visible={duplicateChargeJobId !== null}
        wrapClassName={styles.modalSurface}
        title={t('conversation.creativeStudio.jobs.retryChargeTitle')}
        closable={!studioJobs.mutationPending}
        maskClosable={!studioJobs.mutationPending}
        escToExit={!studioJobs.mutationPending}
        onCancel={() => {
          if (!studioJobs.mutationPending) setDuplicateChargeJobId(null);
        }}
        footer={
          <div className='flex flex-wrap justify-end gap-8px'>
            <Button disabled={studioJobs.mutationPending} onClick={() => setDuplicateChargeJobId(null)}>
              {t('conversation.creativeStudio.review.cancel')}
            </Button>
            <Button
              type='primary'
              loading={studioJobs.mutationPending}
              onClick={() => {
                const jobId = duplicateChargeJobId;
                if (jobId === null || studioJobs.mutationPending) return;
                void studioJobs.retryJob(jobId, true).then((retried) => {
                  if (retried) setDuplicateChargeJobId(null);
                });
              }}
            >
              {t('conversation.creativeStudio.jobs.retryChargeConfirm')}
            </Button>
          </div>
        }
      >
        <p>{t('conversation.creativeStudio.jobs.retryChargeBody')}</p>
        {studioJobs.issue?.jobId === duplicateChargeJobId && (
          <div role='alert' className={styles.projectAlert}>
            {t(studioJobs.issue.messageKey)}
          </div>
        )}
      </Modal>
    </section>
  );
};

const StudioPage: React.FC = () => {
  const { id, view } = useParams<{ id: string; view?: string }>();
  const routeView = parseStudioView(view);

  // The library is a document — it scrolls the page and sits inside its margins. A project is a
  // frame: it fills the viewport so the Director's composer stays on screen, and hands scrolling
  // to the work panel. One element serves both, so the frame is a modifier rather than the default.
  return (
    <main className={id ? `${styles.page} ${styles.pageProject}` : styles.page}>
      {id ? <StudioProjectShell key={id} routeView={routeView} /> : <StudioLibrary />}
    </main>
  );
};

export default StudioPage;
