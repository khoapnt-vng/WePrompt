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
import {
  STUDIO_REFERENCE_PROMPT_MAX_LENGTH,
  type StudioRendererProject,
  type StudioReferenceRequest,
  type StudioLatestRender,
  type StudioRouteCatalog,
  type StudioRouteCatalogEntry,
  type StudioScene,
  type StudioSceneGenerationChoice,
  type StudioSelectVariationRequest,
} from '@/common/types/project/creativeStudioTypes';
import { requestedMediaKind } from '@/common/types/project/creativeStudioOutputRole';
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
  GenerationReviewModal,
  routeSupportsScene,
  type GenerationBatchReviewRequest,
  type GenerationReviewExcludedScene,
  type GenerationReviewScene,
  type GenerationReviewRouteSnapshot,
  type GenerationSingleReviewRequest,
  StoryboardDraftModal,
  StudioExportModal,
  StudioLibrary,
  StudioPhaseShell,
  type StudioPhaseControllers,
} from './components';
import { BriefConversationProvider } from './components/Shell/BriefConversationContext';
import { DirectorPane } from './components/Shell/DirectorPane';
import { DirectorProposals, pendingDirectorProposals } from './components/Shell/DirectorProposals';
import { StudioShell } from './components/Shell/StudioShell';
import { useStoryboardEditor, useStudioJobs, useStudioModels, useStudioProject, useStudioRender } from './hooks';
import styles from './StudioPage.module.css';
import {
  parseStudioPhase,
  rememberStudioPhase,
  resolveStudioEntryPhase,
  studioPhasePath,
  type StudioPhase,
  type StudioPhaseTransition,
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
};

type ReferenceNotice =
  | { kind: 'excluded'; scenes: GenerationReviewExcludedScene[]; requestIds: string[] }
  | { kind: 'dismiss_failed' };

const routeIdentity = (
  route: Pick<StudioRouteCatalogEntry | GenerationReviewRouteSnapshot, 'choiceId' | 'kind'>
): string => `${route.choiceId}\u0000${route.kind}`;

const toReviewScene = (
  project: StudioRendererProject,
  scene: StudioScene,
  route: GenerationReviewRouteSnapshot | null,
  availableRoutes: readonly StudioRouteCatalogEntry[],
  routeStatus?: 'valid' | 'invalid' | 'missing',
  outputRole: GenerationReviewScene['outputRole'] = 'take',
  referencePrompt?: string
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
              catalogRoute === undefined ||
              !routeSupportsScene(catalogRoute, {
                kind: mediaKind,
                sceneId: scene.id,
                routeSceneId: route.sceneId,
                aspectRatio: project.aspectRatio,
                resolution: project.resolution,
                durationSeconds: outputRole === 'reference' ? undefined : scene.durationSeconds,
                hasReference: scene.referenceAssetId !== null,
              })
                ? 'invalid'
                : 'valid',
            snapshot: route,
            providerName: catalogRoute?.providerName ?? null,
            silentOutput: catalogRoute?.constraints.silentOutput ?? null,
          },
  };
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
  const selected = project.routing[mediaKind];
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
    return [
      toReviewScene(
        project,
        scene,
        projectRouteSnapshot(project, scene, 'reference'),
        availableRoutes,
        undefined,
        'reference',
        referencePrompt
      ),
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

const parseWriteFocusIntent = (state: unknown): StudioWriteFocusIntent | null => {
  if (typeof state !== 'object' || state === null || !Object.hasOwn(state, 'writeFocus')) return null;
  const writeFocus = (state as { writeFocus?: unknown }).writeFocus;
  if (typeof writeFocus !== 'object' || writeFocus === null) return null;
  const candidate = writeFocus as { sceneId?: unknown; field?: unknown };
  return typeof candidate.sceneId === 'string' && candidate.sceneId.length > 0 && candidate.field === 'visualPrompt'
    ? { sceneId: candidate.sceneId, field: candidate.field }
    : null;
};

const StudioProjectShell: React.FC<{ routePhase: StudioPhase | null }> = ({ routePhase }) => {
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
  // Project scope, not phase scope: a cut render outlives the Review view that starts it, and
  // must stay observable while the user works elsewhere in the document. Keyed on the route id
  // rather than the loaded project so the stream is not re-subscribed once the project arrives.
  const studioRender = useStudioRender(routeProjectId);

  useEffect(() => {
    if (project === null) return;
    if (routePhase !== null) {
      rememberStudioPhase(project.id, routePhase);
      return;
    }
    navigate(studioPhasePath(project.id, resolveStudioEntryPhase(project.id, project.sceneOrder.length)), {
      replace: true,
    });
  }, [navigate, project, routePhase]);
  const studioModels = useStudioModels({
    project,
    refetch,
    beforeMutation: async () => {
      if (editor.mutationPending) return false;
      if (!(await editor.flushProjectDraft())) return false;
      const result = await editor.flushAllSceneDrafts();
      return result.failed.length === 0 && result.dirtied.length === 0;
    },
    // An unambiguous engine may be adopted only while nothing else holds the
    // project revision, so the automatic write never collides with an edit.
    autoSelectSoleRoute:
      editor.conflict === null &&
      !editor.mutationPending &&
      !editor.drafting &&
      !editor.hasUnsavedProjectDraft &&
      !editor.hasUnsavedSceneDrafts,
  });
  const [draftModalVisible, setDraftModalVisible] = useState(false);
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
  const [exportVisible, setExportVisible] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [exportIncludeReferences, setExportIncludeReferences] = useState(false);
  const [exportedFolderName, setExportedFolderName] = useState<string | null>(null);
  const [exportMissingSceneIds, setExportMissingSceneIds] = useState<string[]>([]);
  const [exportIssueMessageKey, setExportIssueMessageKey] = useState<string | null>(null);
  const [exportLatestRender, setExportLatestRender] = useState<StudioLatestRender | null>(null);
  const [exportLatestRenderReady, setExportLatestRenderReady] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<StudioPhaseTransition | null>(null);
  const [transitionReady, setTransitionReady] = useState(false);
  const [transitionIssueMessageKey, setTransitionIssueMessageKey] = useState<string | null>(null);
  const [postModalTransition, setPostModalTransition] = useState<StudioPhaseTransition | null>(null);
  const generationReviewRefreshingRef = useRef(false);
  const suppressedReferenceRequestIdsRef = useRef(new Set<string>());
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
  const pendingTransitionRef = useRef<StudioPhaseTransition | null>(null);
  const editorRef = useRef(editor);
  const canonicalProjectRef = useRef<StudioRendererProject | null>(project);
  canonicalProjectRef.current = project;
  editorRef.current = editor;
  const writeFocusIntent = useMemo(() => parseWriteFocusIntent(location.state), [location.state]);
  const draftConflict = editor.conflict?.operation === 'draft_storyboard' ? editor.conflict : null;
  const draftErrorMessageKey =
    editor.error?.operation === 'draft_storyboard'
      ? editor.error.messageKey
      : draftConflict
        ? draftConflict.messageKey
        : studioModels.errorMessageKey;
  const readiness = useMemo(() => (project === null ? null : deriveStudioReadiness(project)), [project]);
  const readyScenes = useMemo(
    () =>
      readiness === null || project === null
        ? []
        : readiness.readySceneIds.flatMap((sceneId) => {
            const scene = project.scenes[sceneId];
            return scene === undefined ? [] : [scene];
          }),
    [project, readiness]
  );
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
    notifiedExcludedReferenceRequestsRef.current = null;
    setReferenceNotice(null);
  }, [project?.id]);

  useEffect(() => {
    if (
      generationReview !== null ||
      generationBlocked ||
      project === null ||
      readiness === null ||
      studioModels.catalog === null ||
      studioJobs.referenceRequests.length === 0
    ) {
      return;
    }
    // Requests this mount has already acted on are dropped here rather than checked as a whole
    // batch further down. The batch is rebuilt from every pending request on each run, so an id
    // that has been through the paid path must not be able to take the requests queued alongside
    // it with it — filtering leaves the untouched ones free to be submitted on their own.
    const requests = studioJobs.referenceRequests.filter(
      ({ id }) =>
        !suppressedReferenceRequestIdsRef.current.has(id) && !autoSubmittedReferenceRequestIdsRef.current.has(id)
    );
    if (requests.length === 0) return;
    const availableRoutes = catalogEntries(studioModels.catalog);
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
    const openQueuedReferenceReview = (): void =>
      setGenerationReview({
        mode: 'batch',
        scenes: review.scenes,
        excludedScenes: review.excludedScenes,
        catalogVersion,
        availableRoutes,
        projectId,
        projectRevision,
        outputRole: 'reference',
        referenceRequestIds: requestIds,
        referenceRequests: requests.map(({ id, sceneId }) => ({ id, sceneId })),
      });

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
      openQueuedReferenceReview();
    })();
  }, [generationBlocked, generationReview, project, readiness, studioJobs, studioModels.catalog]);

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
            request.referencePrompt
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
      if (project === null || generationBlocked || request.catalogVersion === null || readyScenes.length === 0) {
        return;
      }
      const scenes = readyScenes.map((scene) => {
        const resolved = request.routes[scene.mediaKind];
        const route = resolved === null ? null : { sceneId: scene.id, ...resolved.route };
        return toReviewScene(project, scene, route, request.availableRoutes, resolved?.routeStatus);
      });
      studioJobs.clearIssue();
      setGenerationReviewIssueMessageKey(null);
      setGenerationReview({
        mode: 'batch',
        scenes,
        catalogVersion: request.catalogVersion,
        availableRoutes: request.availableRoutes,
        projectId: project.id,
        projectRevision: project.revision,
      });
    },
    [generationBlocked, project, readyScenes, studioJobs]
  );

  const confirmGeneration = useCallback(
    async ({ sceneIds, routes }: { sceneIds: string[]; routes: StudioSceneGenerationChoice[] }): Promise<void> => {
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
          const availableRoutes = catalogEntries(catalog);
          const refreshedReferenceReview =
            generationReview.mode === 'batch' && generationReview.referenceRequests !== undefined
              ? buildQueuedReferenceReview(project, readiness, generationReview.referenceRequests, availableRoutes)
              : null;
          const refreshedScenes =
            generationReview.mode === 'single'
              ? generationReview.scenes.flatMap((reviewScene) => {
                  const scene = project.scenes[reviewScene.id];
                  return scene === undefined ||
                    (generationReview.outputRole !== 'reference' &&
                      !canOpenSingleSceneReview(readiness?.sceneStatuses[scene.id], scene.visualPrompt))
                    ? []
                    : [
                        toReviewScene(
                          project,
                          scene,
                          projectRouteSnapshot(project, scene, generationReview.outputRole),
                          availableRoutes,
                          undefined,
                          generationReview.outputRole ?? 'take',
                          reviewScene.referencePrompt
                        ),
                      ];
                })
              : (refreshedReferenceReview?.scenes ??
                readyScenes.map((scene) =>
                  toReviewScene(
                    project,
                    scene,
                    projectRouteSnapshot(project, scene, generationReview.outputRole),
                    availableRoutes,
                    undefined,
                    generationReview.outputRole ?? 'take'
                  )
                ));
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
            projectId: project.id,
            projectRevision: project.revision,
            ...(generationReview.outputRole === undefined ? {} : { outputRole: generationReview.outputRole }),
            ...(refreshedReferenceReview === null
              ? generationReview.referenceRequestIds === undefined
                ? {}
                : { referenceRequestIds: generationReview.referenceRequestIds }
              : { referenceRequestIds: refreshedReferenceReview.referenceRequestIds }),
            ...(generationReview.referenceRequests === undefined
              ? {}
              : { referenceRequests: generationReview.referenceRequests }),
          });
        } catch {
          setGenerationReviewIssueMessageKey('conversation.creativeStudio.errors.provider');
        } finally {
          generationReviewRefreshingRef.current = false;
          setGenerationReviewRefreshing(false);
        }
        return;
      }

      // Defence in depth: main refuses a reference submission whose scenes are not all described,
      // and a refused submit here would leave the queued requests dismissed and unpaid-for with
      // nothing on screen. Surfacing the issue keeps the review open so Cancel or a retry works.
      const referencePrompts =
        generationReview.outputRole === 'reference' ? collectReferencePrompts(generationReview.scenes, sceneIds) : null;
      if (generationReview.outputRole === 'reference' && referencePrompts === null) {
        setGenerationReviewIssueMessageKey('conversation.creativeStudio.errors.invalidPayload');
        return;
      }

      const submitted = await studioJobs.submitScenes({
        mode: generationReview.mode,
        sceneIds,
        routes,
        catalogVersion: generationReview.catalogVersion,
        expectedRevision: generationReview.projectRevision,
        ...(generationReview.outputRole === undefined ? {} : { outputRole: generationReview.outputRole }),
        ...(referencePrompts === null ? {} : { referencePrompts }),
      });
      if (!submitted) return;
      if (generationReview.referenceRequestIds === undefined) {
        setGenerationReview(null);
        return;
      }
      const dismissed =
        generationReview.referenceRequestIds.length === 0 ||
        (await studioJobs.dismissReferenceRequests(generationReview.referenceRequestIds));
      const suppressedIds = dismissed
        ? generationReview.referenceRequestIds
        : (generationReview.referenceRequests?.map(({ id: requestId }) => requestId) ??
          generationReview.referenceRequestIds);
      suppressedIds.forEach((requestId) => suppressedReferenceRequestIdsRef.current.add(requestId));
      setGenerationReview(null);
      if (!dismissed) setReferenceNotice({ kind: 'dismiss_failed' });
    },
    [generationBlocked, generationReview, project, readiness, readyScenes, studioJobs, studioModels]
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
   * Lands focus on the advisory that explains a refused phase transition.
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
    (transition: StudioPhaseTransition): void => {
      if (
        project === null ||
        transitionBlocked ||
        pendingTransitionRef.current !== null ||
        (transition.phase === routePhase && transition.state === undefined)
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
    [focusRecoveryAlert, project, routePhase, transitionBlocked]
  );

  useEffect(() => {
    if (project === null || pendingTransition === null || !transitionReady) return;
    const transition = pendingTransition;
    rememberStudioPhase(project.id, transition.phase);
    navigate(studioPhasePath(project.id, transition.phase), {
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

  const closeExportAndOpenProduce = useCallback((): void => {
    if (exportPending) return;
    setPostModalTransition({ phase: 'produce' });
    setExportVisible(false);
    setExportIncludeReferences(false);
    setExportedFolderName(null);
    setExportMissingSceneIds([]);
    setExportIssueMessageKey(null);
  }, [exportPending]);

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

  const activePhase = routePhase ?? resolveStudioEntryPhase(project.id, project.sceneOrder.length);
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
    (activePhase === 'brief' ? null : projectUpdateIssue);
  const advisory: StudioPhaseControllers['advisory'] =
    shellIssueMessageKey !== null
      ? { messageKey: shellIssueMessageKey, anchor: 'shell' }
      : // Review-time concern with no Write-phase render site since the pacing bar was
        // removed, so it rides the shell advisory slot instead of vanishing silently.
        activePhase === 'write' && readiness.durationDeltaSeconds !== 0
        ? { messageKey: 'conversation.creativeStudio.review.durationMismatch', anchor: 'shell' }
        : activePhase === 'produce' && readiness.readySceneIds.length === 0
          ? { messageKey: 'conversation.creativeStudio.review.noReadyScenes', anchor: 'batch' }
          : activePhase === 'produce' && readiness.durationDeltaSeconds !== 0
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
    requestTransition,
    acceptProposal: (request) => ipcBridge.creativeStudio.acceptProposal.invoke(request),
    rejectProposal: (request) => ipcBridge.creativeStudio.rejectProposal.invoke(request),
    openDraftReview: () => setDraftModalVisible(true),
    openSingleGenerationReview: openSingleReview,
    openBatchGenerationReview: openBatchReview,
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
            activePhase={activePhase}
            controller={controller}
            navigationDisabled={transitionBlocked || pendingTransition !== null}
            notice={referenceAdvisory}
            onBack={() => navigate('/studio')}
          />
        </StudioShell>
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
      <GenerationReviewModal
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
          if (!studioJobs.mutationPending && !generationReviewRefreshing) {
            const requestIds = generationReview?.referenceRequestIds;
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
        onConfirm={confirmGeneration}
      />
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
  const { id, phase } = useParams<{ id: string; phase?: string }>();
  const routePhase = parseStudioPhase(phase);

  // The library is a document — it scrolls the page and sits inside its margins. A project is a
  // frame: it fills the viewport so the Director's composer stays on screen, and hands scrolling
  // to the work panel. One element serves both, so the frame is a modifier rather than the default.
  return (
    <main className={id ? `${styles.page} ${styles.pageProject}` : styles.page}>
      {id ? <StudioProjectShell key={id} routePhase={routePhase} /> : <StudioLibrary />}
    </main>
  );
};

export default StudioPage;
