/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  StudioCommandErrorCode,
  StudioCommandResult,
  StudioEditableScene,
  StudioFitStoryboardOutcome,
  StudioRendererProject,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { draftKey, persistDrafts, takePersistedDrafts, type PersistedDrafts } from './useDraftPersistence';

const MAX_SCENES = 24;
const DEFAULT_SCENE_DURATION_SECONDS = 5;
const SCENE_SAVE_DEBOUNCE_MS = 450;
const MAX_PROJECT_NAME_CHARS = 256;
const MAX_PROJECT_BRIEF_CHARS = 16 * 1024;
const MAX_SCENE_TITLE_CHARS = 256;
const INVALID_DURATION_MESSAGE_KEY = 'conversation.creativeStudio.inspector.invalidDuration';
const INVALID_SCENE_TITLE_MESSAGE_KEY = 'conversation.creativeStudio.phase.write.invalidTitle';
const INVALID_PROJECT_MESSAGE_KEY = 'conversation.creativeStudio.errors.invalidPayload';
const INVALID_PROJECT_NAME_MESSAGE_KEY = 'conversation.creativeStudio.phase.brief.invalidName';
const INVALID_PROJECT_DURATION_MESSAGE_KEY = 'conversation.creativeStudio.create.invalidDuration';
const STORAGE_ERROR_MESSAGE_KEY = 'conversation.creativeStudio.errors.storage';
const STALE_PROJECT_MESSAGE_KEY = 'conversation.creativeStudio.errors.staleProject';

export type StoryboardEditorOperation =
  | 'save_scene'
  | 'update_project'
  | 'add_scene'
  | 'remove_scene'
  | 'reorder_scenes'
  | 'update_target'
  | 'fit_duration'
  | 'draft_storyboard';

export type StoryboardEditorIssue = {
  operation: StoryboardEditorOperation;
  code: StudioCommandErrorCode;
  messageKey: string;
  sceneId?: string;
};

export type StoryboardEditorConflict = StoryboardEditorIssue & {
  code: 'stale_project';
};

export type SelectedSceneSaveState = 'saved' | 'dirty' | 'saving' | 'failed';

export type SceneDraftFlushResult = {
  failed: string[];
  dirtied: string[];
};

export type StudioProjectDraft = Pick<
  StudioRendererProject,
  'name' | 'brief' | 'aspectRatio' | 'targetDurationSeconds'
>;

export type UseStoryboardEditorOptions = {
  project: StudioRendererProject | null;
  refetch: () => Promise<StudioRendererProject | null>;
};

export type UseStoryboardEditorResult = {
  project: StudioRendererProject | null;
  orderedScenes: StudioScene[];
  selectedSceneId: string | null;
  selectedScene: StudioScene | null;
  sceneDraft: StudioEditableScene | null;
  sceneDrafts: Record<string, StudioEditableScene>;
  sceneSaveStates: Record<string, SelectedSceneSaveState>;
  projectDraft: StudioProjectDraft | null;
  projectSaveState: SelectedSceneSaveState;
  hasUnsavedProjectDraft: boolean;
  hasUnsavedSceneDrafts: boolean;
  hasUnsavedSelectedSceneDraft: boolean;
  selectedSceneSaveState: SelectedSceneSaveState;
  saveIssues: StoryboardEditorIssue[];
  selectScene: (sceneId: string) => void;
  updateSceneDraft: (patch: Partial<StudioEditableScene>) => void;
  updateSceneDraftById: (sceneId: string, patch: Partial<StudioEditableScene>) => void;
  updateProjectDraft: (patch: Partial<StudioProjectDraft>) => void;
  flushProjectDraft: () => Promise<boolean>;
  discardProjectDraft: () => void;
  flushSceneDraft: () => Promise<boolean>;
  flushSceneDraftById: (sceneId: string) => Promise<boolean>;
  flushAllSceneDrafts: () => Promise<SceneDraftFlushResult>;
  discardSceneDraft: () => void;
  discardSceneDraftById: (sceneId: string) => void;
  addScene: () => Promise<boolean>;
  removeScene: (sceneId: string) => Promise<boolean>;
  reorderScenes: (sceneOrder: string[]) => Promise<boolean>;
  moveScene: (sceneId: string, direction: 'up' | 'down') => Promise<boolean>;
  canAddScene: boolean;
  durationTotalSeconds: number;
  durationMatchesTarget: boolean;
  remainingDurationSeconds: number;
  suggestedExpandedTargetSeconds: number | null;
  increaseTargetDuration: () => Promise<boolean>;
  fitToTarget: (catalogVersion: string) => Promise<StudioFitStoryboardOutcome | null>;
  latestFitOutcome: StudioFitStoryboardOutcome | null;
  latestFitCatalogVersion: string | null;
  clearLatestFitOutcome: () => void;
  mutationPending: boolean;
  error: StoryboardEditorIssue | null;
  clearError: () => void;
  conflict: StoryboardEditorConflict | null;
  retryConflict: () => Promise<boolean>;
  discardConflict: () => void;
  drafting: boolean;
  proposeStoryboard: (replaceExisting: boolean) => Promise<boolean>;
};

type MutationIntent = {
  operation: StoryboardEditorOperation;
  sceneId?: string;
  invoke: (project: StudioRendererProject) => Promise<StudioCommandResult<StudioRendererProject>>;
  onSuccess?: (project: StudioRendererProject) => void;
  onDiscard?: () => void;
};

type QueuedMutationIntent = MutationIntent & {
  projectId: string;
  session: number;
};

type InternalConflict = {
  publicIssue: StoryboardEditorConflict;
  intent: QueuedMutationIntent;
};

type PausedMutationIntent = {
  intent: QueuedMutationIntent;
  resolve: (result: boolean) => void;
};

type ActiveSaveIntent = {
  projectId: string;
  session: number;
  operation: 'save_scene' | 'update_project';
  sceneId?: string;
};

const editableScene = (scene: StudioScene): StudioEditableScene => ({
  title: scene.title,
  purpose: scene.purpose,
  visualPrompt: scene.visualPrompt,
  narration: scene.narration,
  onScreenText: scene.onScreenText,
  mediaKind: scene.mediaKind,
  durationSeconds: scene.durationSeconds,
  referenceAssetId: scene.referenceAssetId,
});

const editableProject = (project: StudioRendererProject): StudioProjectDraft => ({
  name: project.name,
  brief: project.brief,
  aspectRatio: project.aspectRatio,
  targetDurationSeconds: project.targetDurationSeconds,
});

const PROJECT_DRAFT_FIELDS = [
  'name',
  'brief',
  'aspectRatio',
  'targetDurationSeconds',
] as const satisfies readonly (keyof StudioProjectDraft)[];

const projectDraftMatches = (project: StudioRendererProject, draft: StudioProjectDraft): boolean =>
  PROJECT_DRAFT_FIELDS.every((field) => Object.is(project[field], draft[field]));

const applyLocalProjectFields = (
  base: StudioProjectDraft,
  local: StudioProjectDraft,
  fields: Iterable<keyof StudioProjectDraft>
): StudioProjectDraft => {
  const merged = { ...base };
  for (const field of fields) Object.assign(merged, { [field]: local[field] });
  return merged;
};

const EDITABLE_SCENE_FIELDS = [
  'title',
  'purpose',
  'visualPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
] as const satisfies readonly (keyof StudioEditableScene)[];

const draftSnapshotOwners = new Map<string, symbol>();

type SceneDraftState = {
  drafts: Map<string, StudioEditableScene>;
  dirtySceneIds: Set<string>;
  dirtyFields: Map<string, Set<keyof StudioEditableScene>>;
  dirtyFieldVersions: Map<string, Map<keyof StudioEditableScene, number>>;
  sceneEditVersions: Map<string, number>;
  restoredSceneIds: Set<string>;
};

const emptySceneDraftState = (): SceneDraftState => ({
  drafts: new Map(),
  dirtySceneIds: new Set(),
  dirtyFields: new Map(),
  dirtyFieldVersions: new Map(),
  sceneEditVersions: new Map(),
  restoredSceneIds: new Set(),
});

const restoredSceneDraftState = (project: StudioRendererProject | null): SceneDraftState => {
  const state = emptySceneDraftState();
  if (project === null) return state;
  const persisted = takePersistedDrafts(project.id, project.revision);
  draftSnapshotOwners.delete(draftKey(project.id));
  if (persisted === null || typeof persisted !== 'object') return state;

  for (const [sceneId, patch] of Object.entries(persisted)) {
    const canonicalScene = project.scenes[sceneId];
    if (canonicalScene === undefined || typeof patch !== 'object' || patch === null) continue;
    const draft = editableScene(canonicalScene);
    const fields = new Set<keyof StudioEditableScene>();
    const fieldVersions = new Map<keyof StudioEditableScene, number>();
    for (const field of EDITABLE_SCENE_FIELDS) {
      if (!Object.hasOwn(patch, field) || patch[field] === undefined) continue;
      Object.assign(draft, { [field]: patch[field] });
      fields.add(field);
      fieldVersions.set(field, 1);
    }
    if (fields.size === 0) continue;
    state.drafts.set(sceneId, draft);
    state.dirtySceneIds.add(sceneId);
    state.dirtyFields.set(sceneId, fields);
    state.dirtyFieldVersions.set(sceneId, fieldVersions);
    state.sceneEditVersions.set(sceneId, 1);
    state.restoredSceneIds.add(sceneId);
  }
  return state;
};

const applyLocalFields = (
  base: StudioEditableScene,
  local: StudioEditableScene,
  fields: Iterable<keyof StudioEditableScene>
): StudioEditableScene => {
  const merged = { ...base };
  for (const field of fields) Object.assign(merged, { [field]: local[field] });
  return merged;
};

const isValidDuration = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 60;

const isExactPermutation = (current: string[], candidate: string[]): boolean =>
  current.length === candidate.length &&
  new Set(candidate).size === candidate.length &&
  candidate.every((sceneId) => current.includes(sceneId));

const storageIssue = (operation: StoryboardEditorOperation, sceneId?: string): StoryboardEditorIssue => ({
  operation,
  code: 'storage_error',
  messageKey: STORAGE_ERROR_MESSAGE_KEY,
  ...(sceneId === undefined ? {} : { sceneId }),
});

const validateProjectDraft = (draft: StudioProjectDraft): StoryboardEditorIssue | null => {
  if (draft.name.trim().length === 0 || draft.name.length > MAX_PROJECT_NAME_CHARS) {
    return {
      operation: 'update_project',
      code: 'invalid_payload',
      messageKey: INVALID_PROJECT_NAME_MESSAGE_KEY,
    };
  }
  if (draft.brief.length > MAX_PROJECT_BRIEF_CHARS) {
    return {
      operation: 'update_project',
      code: 'invalid_payload',
      messageKey: INVALID_PROJECT_MESSAGE_KEY,
    };
  }
  if (
    !Number.isInteger(draft.targetDurationSeconds) ||
    draft.targetDurationSeconds < 5 ||
    draft.targetDurationSeconds > 60
  ) {
    return {
      operation: 'update_project',
      code: 'invalid_payload',
      messageKey: INVALID_PROJECT_DURATION_MESSAGE_KEY,
    };
  }
  return null;
};

/**
 * Owns local storyboard drafts and serializes every canonical project mutation.
 *
 * The renderer only sends bounded scene fields and safe IDs. Operational scene
 * state and revision conflict enforcement remain in the main-process service.
 */
export const useStoryboardEditor = ({
  project: parentProject,
  refetch,
}: UseStoryboardEditorOptions): UseStoryboardEditorResult => {
  const [project, setProject] = useState<StudioRendererProject | null>(parentProject);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(parentProject?.sceneOrder[0] ?? null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [projectDraftVersion, setProjectDraftVersion] = useState(0);
  const [saveIssueVersion, setSaveIssueVersion] = useState(0);
  const [mutationCount, setMutationCount] = useState(0);
  const [error, setError] = useState<StoryboardEditorIssue | null>(null);
  const [conflict, setConflict] = useState<StoryboardEditorConflict | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [latestFitOutcome, setLatestFitOutcome] = useState<StudioFitStoryboardOutcome | null>(null);
  const [latestFitCatalogVersion, setLatestFitCatalogVersion] = useState<string | null>(null);
  const [activeSaveIntent, setActiveSaveIntent] = useState<ActiveSaveIntent | null>(null);

  const initialSceneDraftStateRef = useRef<SceneDraftState | null>(null);
  if (initialSceneDraftStateRef.current === null) {
    initialSceneDraftStateRef.current = restoredSceneDraftState(parentProject);
  }
  const initialSceneDraftState = initialSceneDraftStateRef.current;
  const mountedRef = useRef(true);
  const projectRef = useRef<StudioRendererProject | null>(parentProject);
  const selectedSceneIdRef = useRef<string | null>(parentProject?.sceneOrder[0] ?? null);
  const draftsRef = useRef(initialSceneDraftState.drafts);
  const projectDraftRef = useRef<StudioProjectDraft | null>(null);
  const projectDirtyFieldsRef = useRef(new Set<keyof StudioProjectDraft>());
  const projectFieldVersionsRef = useRef(new Map<keyof StudioProjectDraft, number>());
  const projectEditVersionRef = useRef(0);
  const queuedProjectVersionRef = useRef<number | null>(null);
  const dirtySceneIdsRef = useRef(initialSceneDraftState.dirtySceneIds);
  const dirtyFieldsRef = useRef(initialSceneDraftState.dirtyFields);
  const dirtyFieldVersionsRef = useRef(initialSceneDraftState.dirtyFieldVersions);
  const sceneEditVersionsRef = useRef(initialSceneDraftState.sceneEditVersions);
  const restoredSceneIdsRef = useRef(initialSceneDraftState.restoredSceneIds);
  const draftSnapshotOwnerRef = useRef(Symbol('studio-draft-snapshot-owner'));
  const lastPersistedDraftValueRef = useRef<{ projectId: string; value: string } | null>(null);
  const saveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queuedSceneVersionsRef = useRef(new Map<string, number>());
  const saveIssuesRef = useRef(new Map<string, StoryboardEditorIssue>());
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const internalConflictRef = useRef<InternalConflict | null>(null);
  const pausedIntentsRef = useRef<PausedMutationIntent[]>([]);
  const projectSessionRef = useRef(0);
  const storyboardEpochRef = useRef(0);
  const canonicalRefetchRequestRef = useRef(0);
  const draftingTokenRef = useRef<{ projectId: string; session: number } | null>(null);
  const activeSaveIntentRef = useRef<ActiveSaveIntent | null>(null);
  const refetchRef = useRef(refetch);
  const flushSceneRef = useRef<(sceneId: string, allowMissingCanonical?: boolean) => Promise<boolean>>(
    async () => false
  );
  const flushProjectRef = useRef<() => Promise<boolean>>(async () => false);
  const enqueueIntentRef = useRef<(intent: MutationIntent) => Promise<boolean>>(async () => false);

  refetchRef.current = refetch;

  const rerenderDrafts = useCallback(() => {
    if (mountedRef.current) setDraftVersion((version) => version + 1);
  }, []);

  const rerenderProjectDraft = useCallback(() => {
    if (mountedRef.current) setProjectDraftVersion((version) => version + 1);
  }, []);

  const persistDirtySceneDrafts = useCallback((canonical: StudioRendererProject, allowOverwrite: boolean): void => {
    const scenes: PersistedDrafts['scenes'] = {};
    for (const sceneId of dirtySceneIdsRef.current) {
      const draft = draftsRef.current.get(sceneId);
      const dirtyFields = dirtyFieldsRef.current.get(sceneId);
      if (draft === undefined || dirtyFields === undefined || dirtyFields.size === 0) continue;
      const patch: Partial<StudioEditableScene> = {};
      for (const field of dirtyFields) Object.assign(patch, { [field]: draft[field] });
      scenes[sceneId] = patch;
    }

    try {
      const key = draftKey(canonical.id);
      const currentValue = sessionStorage.getItem(key);
      const ownedValue = lastPersistedDraftValueRef.current;
      const ownsCurrentValue =
        draftSnapshotOwners.get(key) === draftSnapshotOwnerRef.current &&
        ownedValue?.projectId === canonical.id &&
        currentValue !== null &&
        currentValue === ownedValue.value;
      if (!allowOverwrite && !ownsCurrentValue) return;

      if (Object.keys(scenes).length === 0) {
        if (ownsCurrentValue) {
          persistDrafts(canonical.id, canonical.revision, scenes);
          draftSnapshotOwners.delete(key);
          lastPersistedDraftValueRef.current = null;
        }
        return;
      }

      const nextValue = JSON.stringify({ revision: canonical.revision, scenes } satisfies PersistedDrafts);
      persistDrafts(canonical.id, canonical.revision, scenes);
      draftSnapshotOwners.set(key, draftSnapshotOwnerRef.current);
      lastPersistedDraftValueRef.current = { projectId: canonical.id, value: nextValue };
    } catch {
      // Session-scoped recovery is best-effort; canonical saves still own durability.
    }
  }, []);

  const initialPersistenceAppliedRef = useRef(false);
  if (!initialPersistenceAppliedRef.current) {
    initialPersistenceAppliedRef.current = true;
    if (parentProject !== null && initialSceneDraftState.restoredSceneIds.size > 0) {
      persistDirtySceneDrafts(parentProject, true);
    }
  }

  const clearProjectDraft = useCallback(() => {
    projectDraftRef.current = null;
    projectDirtyFieldsRef.current.clear();
    projectFieldVersionsRef.current.clear();
    projectEditVersionRef.current = 0;
    queuedProjectVersionRef.current = null;
    rerenderProjectDraft();
  }, [rerenderProjectDraft]);

  const clearSaveTimer = useCallback((sceneId: string) => {
    const timer = saveTimersRef.current.get(sceneId);
    if (timer !== undefined) {
      clearTimeout(timer);
      saveTimersRef.current.delete(sceneId);
    }
  }, []);

  const clearAllDrafts = useCallback(
    (discardPersisted = true) => {
      const canonical = projectRef.current;
      storyboardEpochRef.current += 1;
      for (const timer of saveTimersRef.current.values()) clearTimeout(timer);
      saveTimersRef.current.clear();
      draftsRef.current.clear();
      dirtySceneIdsRef.current.clear();
      dirtyFieldsRef.current.clear();
      dirtyFieldVersionsRef.current.clear();
      sceneEditVersionsRef.current.clear();
      restoredSceneIdsRef.current.clear();
      queuedSceneVersionsRef.current.clear();
      saveIssuesRef.current.clear();
      if (mountedRef.current) {
        setSaveIssueVersion((version) => version + 1);
        setError((currentError) => (currentError?.operation === 'save_scene' ? null : currentError));
      }
      if (discardPersisted && canonical !== null) persistDirtySceneDrafts(canonical, mountedRef.current);
      rerenderDrafts();
    },
    [persistDirtySceneDrafts, rerenderDrafts]
  );

  const discardPausedIntents = useCallback(() => {
    const paused = pausedIntentsRef.current.splice(0);
    for (const pending of paused) pending.resolve(false);
  }, []);

  const startProjectSession = useCallback(() => {
    projectSessionRef.current += 1;
    mutationQueueRef.current = Promise.resolve();
    internalConflictRef.current = null;
    discardPausedIntents();
    draftingTokenRef.current = null;
    activeSaveIntentRef.current = null;
    projectDraftRef.current = null;
    projectDirtyFieldsRef.current.clear();
    projectFieldVersionsRef.current.clear();
    projectEditVersionRef.current = 0;
    queuedProjectVersionRef.current = null;
    if (mountedRef.current) {
      setMutationCount(0);
      setConflict(null);
      setError(null);
      setDrafting(false);
      setLatestFitOutcome(null);
      setLatestFitCatalogVersion(null);
      setActiveSaveIntent(null);
      setProjectDraftVersion((version) => version + 1);
    }
  }, [discardPausedIntents]);

  const adoptProject = useCallback(
    (candidate: StudioRendererProject, rewritePersistedRevision = true): StudioRendererProject => {
      const current = projectRef.current;
      if (current?.id === candidate.id && current.revision >= candidate.revision) return current;

      const projectChanged = current?.id !== candidate.id;
      const localProjectDraft = projectDraftRef.current;
      const localProjectDirtyFields = projectDirtyFieldsRef.current;
      if (projectChanged) {
        if (current !== null) persistDirtySceneDrafts(current, mountedRef.current);
        startProjectSession();
        clearAllDrafts(false);
        const restored = restoredSceneDraftState(candidate);
        draftsRef.current = restored.drafts;
        dirtySceneIdsRef.current = restored.dirtySceneIds;
        dirtyFieldsRef.current = restored.dirtyFields;
        dirtyFieldVersionsRef.current = restored.dirtyFieldVersions;
        sceneEditVersionsRef.current = restored.sceneEditVersions;
        restoredSceneIdsRef.current = restored.restoredSceneIds;
      } else {
        for (const [sceneId, draft] of draftsRef.current) {
          const canonicalScene = candidate.scenes[sceneId];
          const dirtyFields = dirtyFieldsRef.current.get(sceneId);
          if (canonicalScene !== undefined && dirtyFields !== undefined && dirtyFields.size > 0) {
            draftsRef.current.set(sceneId, applyLocalFields(editableScene(canonicalScene), draft, dirtyFields));
          }
        }
        if (localProjectDraft !== null && localProjectDirtyFields.size > 0) {
          projectDraftRef.current = applyLocalProjectFields(
            editableProject(candidate),
            localProjectDraft,
            localProjectDirtyFields
          );
        }
      }
      projectRef.current = candidate;
      if (projectChanged) {
        if (restoredSceneIdsRef.current.size > 0) persistDirtySceneDrafts(candidate, true);
      } else if (rewritePersistedRevision) {
        persistDirtySceneDrafts(candidate, mountedRef.current);
      }
      if (mountedRef.current) {
        setProject(candidate);
        setLatestFitOutcome(null);
        setLatestFitCatalogVersion(null);
      }

      if (projectChanged) {
        const firstSceneId = candidate.sceneOrder[0] ?? null;
        selectedSceneIdRef.current = firstSceneId;
        if (mountedRef.current) {
          setSelectedSceneId(firstSceneId);
          setConflict(null);
          setError(null);
        }
      } else if (selectedSceneIdRef.current === null || !Object.hasOwn(candidate.scenes, selectedSceneIdRef.current)) {
        const firstSceneId = candidate.sceneOrder[0] ?? null;
        selectedSceneIdRef.current = firstSceneId;
        if (mountedRef.current) setSelectedSceneId(firstSceneId);
      }

      if (!projectChanged && localProjectDraft !== null) {
        const mergedDraft = projectDraftRef.current;
        if (mergedDraft === null || projectDraftMatches(candidate, mergedDraft)) {
          clearProjectDraft();
        } else {
          rerenderProjectDraft();
        }
      }

      return candidate;
    },
    [clearAllDrafts, clearProjectDraft, persistDirtySceneDrafts, rerenderProjectDraft, startProjectSession]
  );

  const refetchCanonical = useCallback(
    async (expectedProjectId: string, expectedSession: number): Promise<StudioRendererProject | null> => {
      if (projectRef.current?.id !== expectedProjectId || projectSessionRef.current !== expectedSession) return null;
      const request = ++canonicalRefetchRequestRef.current;
      const candidate = await refetchRef.current();
      if (
        request !== canonicalRefetchRequestRef.current ||
        candidate === null ||
        candidate.id !== expectedProjectId ||
        projectRef.current?.id !== expectedProjectId ||
        projectSessionRef.current !== expectedSession
      ) {
        return null;
      }
      return adoptProject(candidate, false);
    },
    [adoptProject]
  );

  const clearSaveIssue = useCallback((sceneId: string) => {
    if (!saveIssuesRef.current.delete(sceneId)) return;
    if (mountedRef.current) {
      setSaveIssueVersion((version) => version + 1);
      setError((currentError) => {
        if (currentError?.operation !== 'save_scene' || currentError.sceneId !== sceneId) return currentError;
        return saveIssuesRef.current.values().next().value ?? null;
      });
    }
  }, []);

  const publishIssue = useCallback((issue: StoryboardEditorIssue) => {
    if (issue.operation === 'save_scene' && issue.sceneId !== undefined) {
      saveIssuesRef.current.set(issue.sceneId, issue);
      if (mountedRef.current) setSaveIssueVersion((version) => version + 1);
    }
    if (mountedRef.current) setError(issue);
  }, []);

  const executeIntent = useCallback(
    async (intent: QueuedMutationIntent): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || current.id !== intent.projectId || projectSessionRef.current !== intent.session) {
        return false;
      }

      const saveIntent: ActiveSaveIntent | null =
        intent.operation === 'save_scene' && intent.sceneId !== undefined
          ? {
              projectId: intent.projectId,
              session: intent.session,
              operation: 'save_scene',
              sceneId: intent.sceneId,
            }
          : intent.operation === 'update_project'
            ? { projectId: intent.projectId, session: intent.session, operation: 'update_project' }
            : null;
      if (saveIntent !== null) {
        activeSaveIntentRef.current = saveIntent;
        if (mountedRef.current) setActiveSaveIntent(saveIntent);
      }

      try {
        const result = await intent.invoke(current);
        if (projectRef.current?.id !== intent.projectId || projectSessionRef.current !== intent.session) return false;
        if (result.ok === true) {
          if (result.data.id !== intent.projectId) {
            publishIssue(storageIssue(intent.operation, intent.sceneId));
            return false;
          }
          const adopted = adoptProject(result.data);
          intent.onSuccess?.(adopted);
          if (mountedRef.current) {
            if (intent.operation === 'save_scene' && intent.sceneId !== undefined) {
              clearSaveIssue(intent.sceneId);
            } else {
              setError((currentError) =>
                currentError?.operation === intent.operation && currentError.sceneId === intent.sceneId
                  ? null
                  : currentError
              );
            }
          }
          return true;
        }

        const issue: StoryboardEditorIssue = {
          operation: intent.operation,
          code: result.error.code,
          messageKey: result.error.messageKey,
          ...(intent.sceneId === undefined ? {} : { sceneId: intent.sceneId }),
        };
        if (result.error.code !== 'stale_project') {
          publishIssue(issue);
          return false;
        }

        try {
          await refetchCanonical(intent.projectId, intent.session);
        } catch {
          if (projectRef.current?.id !== intent.projectId || projectSessionRef.current !== intent.session) return false;
          publishIssue(storageIssue(intent.operation, intent.sceneId));
        }
        if (projectRef.current?.id !== intent.projectId || projectSessionRef.current !== intent.session) return false;
        const staleIssue: StoryboardEditorConflict = { ...issue, code: 'stale_project' };
        if (intent.operation === 'save_scene' && intent.sceneId !== undefined) clearSaveIssue(intent.sceneId);
        internalConflictRef.current = { publicIssue: staleIssue, intent };
        if (mountedRef.current) {
          setConflict(staleIssue);
          setError(null);
        }
        return false;
      } catch {
        if (projectRef.current?.id !== intent.projectId || projectSessionRef.current !== intent.session) return false;
        const issue = storageIssue(intent.operation, intent.sceneId);
        publishIssue(issue);
        return false;
      } finally {
        if (saveIntent !== null && activeSaveIntentRef.current === saveIntent) {
          activeSaveIntentRef.current = null;
          if (mountedRef.current) setActiveSaveIntent(null);
        }
      }
    },
    [adoptProject, clearSaveIssue, publishIssue, refetchCanonical]
  );

  const enqueueIntent = useCallback(
    (intent: MutationIntent): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null) return Promise.resolve(false);
      const session = projectSessionRef.current;
      const queuedIntent: QueuedMutationIntent = { ...intent, projectId: current.id, session };
      if (mountedRef.current) setMutationCount((count) => count + 1);

      let resolveResult!: (result: boolean) => void;
      const resultPromise = new Promise<boolean>((resolve) => {
        resolveResult = resolve;
      });

      mutationQueueRef.current = mutationQueueRef.current
        .catch((): void => {})
        .then(async () => {
          const blockingConflict = internalConflictRef.current;
          if (blockingConflict !== null) {
            const supersededSameSceneSave =
              blockingConflict.intent.operation === 'save_scene' &&
              queuedIntent.operation === 'save_scene' &&
              blockingConflict.intent.sceneId === queuedIntent.sceneId;
            if (
              queuedIntent.operation === 'draft_storyboard' ||
              queuedIntent.operation === 'update_project' ||
              supersededSameSceneSave
            ) {
              resolveResult(false);
              return;
            }
            pausedIntentsRef.current.push({ intent: queuedIntent, resolve: resolveResult });
            return;
          }
          resolveResult(await executeIntent(queuedIntent));
        })
        .finally(() => {
          if (mountedRef.current && projectSessionRef.current === session) {
            setMutationCount((count) => Math.max(0, count - 1));
          }
        });
      return resultPromise;
    },
    [executeIntent]
  );
  enqueueIntentRef.current = enqueueIntent;

  const drainMutationQueue = useCallback(async function waitForCurrentMutationQueue(): Promise<void> {
    const observedQueue = mutationQueueRef.current;
    await observedQueue.catch((): void => {});
    if (observedQueue !== mutationQueueRef.current) await waitForCurrentMutationQueue();
  }, []);

  const resumePausedIntents = useCallback(() => {
    const current = projectRef.current;
    const session = projectSessionRef.current;
    const paused = pausedIntentsRef.current.splice(0);
    for (const pending of paused) {
      if (current === null || pending.intent.projectId !== current.id || pending.intent.session !== session) {
        pending.resolve(false);
        continue;
      }
      void enqueueIntentRef.current(pending.intent).then(pending.resolve);
    }
  }, []);

  const runDraftIntent = useCallback(
    async (intent: MutationIntent): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || draftingTokenRef.current !== null) return false;

      const token = { projectId: current.id, session: projectSessionRef.current };
      draftingTokenRef.current = token;
      if (mountedRef.current) {
        setDrafting(true);
      }
      try {
        return await enqueueIntent(intent);
      } finally {
        if (draftingTokenRef.current === token) {
          draftingTokenRef.current = null;
          if (mountedRef.current) setDrafting(false);
        }
      }
    },
    [enqueueIntent]
  );

  const flushScene = useCallback(
    (sceneId: string, allowMissingCanonical = false): Promise<boolean> => {
      clearSaveTimer(sceneId);
      const current = projectRef.current;
      const draft = draftsRef.current.get(sceneId);
      const dirtyFields = dirtyFieldsRef.current.get(sceneId);
      if (
        current === null ||
        draft === undefined ||
        !dirtySceneIdsRef.current.has(sceneId) ||
        dirtyFields === undefined ||
        dirtyFields.size === 0
      ) {
        return Promise.resolve(false);
      }
      if (dirtyFields.has('title') && (draft.title.trim().length === 0 || draft.title.length > MAX_SCENE_TITLE_CHARS)) {
        publishIssue({
          operation: 'save_scene',
          code: 'invalid_payload',
          messageKey: INVALID_SCENE_TITLE_MESSAGE_KEY,
          sceneId,
        });
        return Promise.resolve(false);
      }
      if (!isValidDuration(draft.durationSeconds)) {
        publishIssue({
          operation: 'save_scene',
          code: 'invalid_payload',
          messageKey: INVALID_DURATION_MESSAGE_KEY,
          sceneId,
        });
        return Promise.resolve(false);
      }

      const localDraft = { ...draft };
      const capturedFields = new Set(dirtyFields);
      const capturedStoryboardEpoch = storyboardEpochRef.current;
      const capturedVersion = sceneEditVersionsRef.current.get(sceneId) ?? 0;
      const fieldVersions = dirtyFieldVersionsRef.current.get(sceneId);
      const capturedFieldVersions = new Map(
        [...capturedFields].map((field) => [field, fieldVersions?.get(field) ?? capturedVersion])
      );
      if (queuedSceneVersionsRef.current.get(sceneId) === capturedVersion) return Promise.resolve(false);
      queuedSceneVersionsRef.current.set(sceneId, capturedVersion);
      const save = enqueueIntent({
        operation: 'save_scene',
        sceneId,
        invoke: (canonical) => {
          if (capturedStoryboardEpoch !== storyboardEpochRef.current) {
            return Promise.resolve({ ok: true, data: canonical });
          }
          if (!dirtySceneIdsRef.current.has(sceneId)) {
            return Promise.resolve({ ok: true, data: canonical });
          }
          const canonicalScene = canonical.scenes[sceneId];
          if (canonicalScene === undefined && !allowMissingCanonical) {
            return Promise.resolve({
              ok: false,
              error: {
                code: 'stale_project',
                messageKey: STALE_PROJECT_MESSAGE_KEY,
              },
            });
          }
          const payload =
            canonicalScene === undefined
              ? localDraft
              : applyLocalFields(editableScene(canonicalScene), localDraft, capturedFields);
          return ipcBridge.creativeStudio.updateScene.invoke({
            projectId: canonical.id,
            sceneId,
            expectedRevision: canonical.revision,
            scene: payload,
          });
        },
        onSuccess: (canonical) => {
          const currentDirtyFields = dirtyFieldsRef.current.get(sceneId);
          const currentFieldVersions = dirtyFieldVersionsRef.current.get(sceneId);
          if (currentDirtyFields === undefined || currentFieldVersions === undefined) return;

          for (const [field, version] of capturedFieldVersions) {
            if (currentFieldVersions.get(field) === version) {
              currentDirtyFields.delete(field);
              currentFieldVersions.delete(field);
            }
          }

          if (currentDirtyFields.size === 0) {
            dirtySceneIdsRef.current.delete(sceneId);
            dirtyFieldsRef.current.delete(sceneId);
            dirtyFieldVersionsRef.current.delete(sceneId);
            sceneEditVersionsRef.current.delete(sceneId);
            draftsRef.current.delete(sceneId);
          } else {
            const canonicalScene = canonical.scenes[sceneId];
            const currentDraft = draftsRef.current.get(sceneId);
            if (canonicalScene !== undefined && currentDraft !== undefined) {
              draftsRef.current.set(
                sceneId,
                applyLocalFields(editableScene(canonicalScene), currentDraft, currentDirtyFields)
              );
            }
          }
          persistDirtySceneDrafts(canonical, mountedRef.current);
          rerenderDrafts();
        },
        onDiscard: () => {
          dirtySceneIdsRef.current.delete(sceneId);
          dirtyFieldsRef.current.delete(sceneId);
          dirtyFieldVersionsRef.current.delete(sceneId);
          sceneEditVersionsRef.current.delete(sceneId);
          draftsRef.current.delete(sceneId);
          const canonical = projectRef.current;
          if (canonical !== null) persistDirtySceneDrafts(canonical, mountedRef.current);
          rerenderDrafts();
        },
      });
      return save.finally(() => {
        if (queuedSceneVersionsRef.current.get(sceneId) === capturedVersion) {
          queuedSceneVersionsRef.current.delete(sceneId);
        }
      });
    },
    [clearSaveTimer, enqueueIntent, persistDirtySceneDrafts, publishIssue, rerenderDrafts]
  );
  flushSceneRef.current = flushScene;

  const flushSceneDraftById = useCallback(
    async (sceneId: string): Promise<boolean> => {
      clearSaveTimer(sceneId);
      if (!dirtySceneIdsRef.current.has(sceneId)) return true;
      const flushed = await flushScene(sceneId);
      if (!flushed) await drainMutationQueue();
      return !dirtySceneIdsRef.current.has(sceneId) && internalConflictRef.current === null;
    },
    [clearSaveTimer, drainMutationQueue, flushScene]
  );

  const flushAllSceneDrafts = useCallback(async (): Promise<SceneDraftFlushResult> => {
    const initialSceneIds = [...dirtySceneIdsRef.current];
    const initialVersions = new Map(
      initialSceneIds.map((sceneId) => [sceneId, sceneEditVersionsRef.current.get(sceneId) ?? 0] as const)
    );
    const attemptedSceneIds = new Set<string>();
    const cleanAfterAttemptSceneIds = new Set<string>();
    const failedSceneIds = new Set<string>();
    const dirtiedSceneIds = new Set<string>();

    for (const sceneId of initialSceneIds) clearSaveTimer(sceneId);
    for (const sceneId of initialSceneIds) {
      const blockingConflict = internalConflictRef.current;
      if (blockingConflict !== null) {
        failedSceneIds.add(blockingConflict.publicIssue.sceneId ?? sceneId);
        break;
      }

      attemptedSceneIds.add(sceneId);
      const flushed = await flushScene(sceneId);
      if (!flushed) await drainMutationQueue();

      const remainsDirty = dirtySceneIdsRef.current.has(sceneId);
      if (!remainsDirty) {
        cleanAfterAttemptSceneIds.add(sceneId);
      } else {
        const initialVersion = initialVersions.get(sceneId) ?? 0;
        const currentVersion = sceneEditVersionsRef.current.get(sceneId) ?? 0;
        const versionChanged = currentVersion !== initialVersion;
        const saveFailed =
          saveIssuesRef.current.has(sceneId) || internalConflictRef.current?.publicIssue.sceneId === sceneId;
        if (!flushed && (saveFailed || !versionChanged)) {
          failedSceneIds.add(sceneId);
        } else if (versionChanged) {
          dirtiedSceneIds.add(sceneId);
        } else {
          failedSceneIds.add(sceneId);
        }
      }

      if (failedSceneIds.size > 0 || internalConflictRef.current !== null) break;
    }

    await drainMutationQueue();

    const blockingConflictSceneId = internalConflictRef.current?.publicIssue.sceneId;
    if (blockingConflictSceneId !== undefined) {
      failedSceneIds.add(blockingConflictSceneId);
      dirtiedSceneIds.delete(blockingConflictSceneId);
    }
    for (const sceneId of dirtySceneIdsRef.current) {
      if (saveIssuesRef.current.has(sceneId) || blockingConflictSceneId === sceneId) {
        failedSceneIds.add(sceneId);
        dirtiedSceneIds.delete(sceneId);
        continue;
      }

      const initialVersion = initialVersions.get(sceneId);
      const currentVersion = sceneEditVersionsRef.current.get(sceneId) ?? 0;
      if (
        initialVersion === undefined ||
        cleanAfterAttemptSceneIds.has(sceneId) ||
        currentVersion !== initialVersion ||
        dirtiedSceneIds.has(sceneId)
      ) {
        if (!failedSceneIds.has(sceneId)) dirtiedSceneIds.add(sceneId);
      } else if (attemptedSceneIds.has(sceneId)) {
        failedSceneIds.add(sceneId);
      }
    }

    return {
      failed: [...failedSceneIds],
      dirtied: [...dirtiedSceneIds].filter((sceneId) => !failedSceneIds.has(sceneId)),
    };
  }, [clearSaveTimer, drainMutationQueue, flushScene]);

  const scheduleSceneSave = useCallback(
    (sceneId: string) => {
      clearSaveTimer(sceneId);
      const timer = setTimeout(() => {
        saveTimersRef.current.delete(sceneId);
        void flushSceneRef.current(sceneId);
      }, SCENE_SAVE_DEBOUNCE_MS);
      saveTimersRef.current.set(sceneId, timer);
    },
    [clearSaveTimer]
  );

  useEffect(() => {
    const restoredSceneIds = [...restoredSceneIdsRef.current];
    restoredSceneIdsRef.current.clear();
    for (const sceneId of restoredSceneIds) scheduleSceneSave(sceneId);
  }, [project?.id, scheduleSceneSave]);

  useLayoutEffect(() => {
    const current = projectRef.current;
    if (parentProject === null) {
      if (current !== null) {
        startProjectSession();
        clearAllDrafts(false);
        projectRef.current = null;
        selectedSceneIdRef.current = null;
        setProject(null);
        setSelectedSceneId(null);
      }
      return;
    }
    adoptProject(parentProject);
  }, [adoptProject, clearAllDrafts, parentProject, startProjectSession]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      void flushProjectRef.current();
      for (const sceneId of dirtySceneIdsRef.current) void flushSceneRef.current(sceneId);
      canonicalRefetchRequestRef.current += 1;
    },
    []
  );

  const selectedScene = useMemo(
    () => (selectedSceneId === null ? null : (project?.scenes[selectedSceneId] ?? null)),
    [project, selectedSceneId]
  );
  const sceneDrafts = useMemo(
    () =>
      Object.fromEntries(
        project?.sceneOrder.flatMap((sceneId) => {
          const canonical = project.scenes[sceneId];
          if (canonical === undefined) return [];
          return [[sceneId, draftsRef.current.get(sceneId) ?? editableScene(canonical)] as const];
        }) ?? []
      ),
    [draftVersion, project]
  );
  const sceneDraft = selectedSceneId === null ? null : (sceneDrafts[selectedSceneId] ?? null);
  const orderedScenes = useMemo(
    () =>
      project?.sceneOrder.flatMap((sceneId) => {
        const currentScene = project.scenes[sceneId];
        if (currentScene === undefined) return [];
        const draft = sceneDrafts[sceneId];
        return [{ ...currentScene, ...draft }];
      }) ?? [],
    [project, sceneDrafts]
  );
  const saveIssues = useMemo(() => [...saveIssuesRef.current.values()], [saveIssueVersion]);
  const projectDraft = useMemo(() => projectDraftRef.current, [projectDraftVersion]);
  const projectSaveState: SelectedSceneSaveState = (() => {
    if (
      activeSaveIntent !== null &&
      activeSaveIntent.projectId === project?.id &&
      activeSaveIntent.session === projectSessionRef.current &&
      activeSaveIntent.operation === 'update_project'
    ) {
      return 'saving';
    }
    if (conflict?.operation === 'update_project' || error?.operation === 'update_project') return 'failed';
    return projectDraft === null ? 'saved' : 'dirty';
  })();
  const sceneSaveStates = useMemo(
    () =>
      Object.fromEntries(
        project?.sceneOrder.flatMap((sceneId) => {
          if (!Object.hasOwn(project.scenes, sceneId)) return [];
          let state: SelectedSceneSaveState;
          if (
            activeSaveIntent?.projectId === project.id &&
            activeSaveIntent.session === projectSessionRef.current &&
            activeSaveIntent.operation === 'save_scene' &&
            activeSaveIntent.sceneId === sceneId
          ) {
            state = 'saving';
          } else if (
            (conflict?.operation === 'save_scene' && conflict.sceneId === sceneId) ||
            saveIssues.some((issue) => issue.sceneId === sceneId)
          ) {
            state = 'failed';
          } else {
            state = dirtySceneIdsRef.current.has(sceneId) ? 'dirty' : 'saved';
          }
          return [[sceneId, state] as const];
        }) ?? []
      ),
    [activeSaveIntent, conflict, draftVersion, project, saveIssues]
  );
  const selectedSceneSaveState: SelectedSceneSaveState =
    selectedSceneId === null || selectedScene === null ? 'saved' : (sceneSaveStates[selectedSceneId] ?? 'saved');
  const durationTotalSeconds = useMemo(
    () => orderedScenes.reduce((total, currentScene) => total + currentScene.durationSeconds, 0),
    [orderedScenes]
  );
  const remainingDurationSeconds = project === null ? 0 : project.targetDurationSeconds - durationTotalSeconds;
  const suggestedExpandedTargetSeconds = useMemo(() => {
    if (project === null) return null;
    const suggested = Math.min(
      60,
      Math.max(
        project.targetDurationSeconds + DEFAULT_SCENE_DURATION_SECONDS,
        durationTotalSeconds + DEFAULT_SCENE_DURATION_SECONDS
      )
    );
    return suggested > project.targetDurationSeconds && suggested > durationTotalSeconds ? suggested : null;
  }, [durationTotalSeconds, project]);

  const selectScene = useCallback((sceneId: string) => {
    const current = projectRef.current;
    if (current === null || !Object.hasOwn(current.scenes, sceneId) || selectedSceneIdRef.current === sceneId) return;
    const previousSceneId = selectedSceneIdRef.current;
    if (previousSceneId !== null) void flushSceneRef.current(previousSceneId);
    selectedSceneIdRef.current = sceneId;
    if (mountedRef.current) {
      setSelectedSceneId(sceneId);
    }
  }, []);

  const updateSceneDraftById = useCallback(
    (sceneId: string, patch: Partial<StudioEditableScene>) => {
      const current = projectRef.current;
      if (current === null) return;
      const canonicalScene = current.scenes[sceneId];
      if (canonicalScene === undefined) return;
      const previous = draftsRef.current.get(sceneId) ?? editableScene(canonicalScene);
      const next = { ...previous };
      const changedFields: (keyof StudioEditableScene)[] = [];
      for (const field of EDITABLE_SCENE_FIELDS) {
        if (!Object.hasOwn(patch, field) || patch[field] === undefined || Object.is(previous[field], patch[field])) {
          continue;
        }
        Object.assign(next, { [field]: patch[field] });
        changedFields.push(field);
      }
      if (changedFields.length === 0) return;

      const nextVersion = (sceneEditVersionsRef.current.get(sceneId) ?? 0) + 1;
      const dirtyFields = dirtyFieldsRef.current.get(sceneId) ?? new Set<keyof StudioEditableScene>();
      const dirtyFieldVersions =
        dirtyFieldVersionsRef.current.get(sceneId) ?? new Map<keyof StudioEditableScene, number>();
      for (const field of changedFields) {
        dirtyFields.add(field);
        dirtyFieldVersions.set(field, nextVersion);
      }
      draftsRef.current.set(sceneId, next);
      dirtySceneIdsRef.current.add(sceneId);
      dirtyFieldsRef.current.set(sceneId, dirtyFields);
      dirtyFieldVersionsRef.current.set(sceneId, dirtyFieldVersions);
      sceneEditVersionsRef.current.set(sceneId, nextVersion);
      persistDirtySceneDrafts(current, true);
      rerenderDrafts();
      scheduleSceneSave(sceneId);
    },
    [persistDirtySceneDrafts, rerenderDrafts, scheduleSceneSave]
  );

  const updateSceneDraft = useCallback(
    (patch: Partial<StudioEditableScene>) => {
      const sceneId = selectedSceneIdRef.current;
      if (sceneId !== null) updateSceneDraftById(sceneId, patch);
    },
    [updateSceneDraftById]
  );

  const updateProjectDraft = useCallback(
    (patch: Partial<StudioProjectDraft>) => {
      const current = projectRef.current;
      if (current === null) return;
      const previous = projectDraftRef.current ?? editableProject(current);
      const next = { ...previous };
      const nextVersion = projectEditVersionRef.current + 1;
      const changedFields: (keyof StudioProjectDraft)[] = [];
      for (const field of PROJECT_DRAFT_FIELDS) {
        if (!Object.hasOwn(patch, field) || patch[field] === undefined || Object.is(previous[field], patch[field])) {
          continue;
        }
        Object.assign(next, { [field]: patch[field] });
        changedFields.push(field);
      }
      if (changedFields.length === 0) return;
      for (const field of changedFields) {
        if (Object.is(current[field], next[field])) {
          projectDirtyFieldsRef.current.delete(field);
          projectFieldVersionsRef.current.delete(field);
        } else {
          projectDirtyFieldsRef.current.add(field);
          projectFieldVersionsRef.current.set(field, nextVersion);
        }
      }
      projectEditVersionRef.current = nextVersion;
      projectDraftRef.current =
        projectDirtyFieldsRef.current.size === 0
          ? null
          : applyLocalProjectFields(editableProject(current), next, projectDirtyFieldsRef.current);
      if (mountedRef.current) {
        setError((currentError) => (currentError?.operation === 'update_project' ? null : currentError));
      }
      rerenderProjectDraft();
    },
    [rerenderProjectDraft]
  );

  const flushProjectDraft = useCallback(async (): Promise<boolean> => {
    if (projectRef.current === null) return false;
    if (projectDraftRef.current === null) return true;
    const validationIssue = validateProjectDraft(projectDraftRef.current);
    if (validationIssue !== null) {
      publishIssue(validationIssue);
      return false;
    }
    if (queuedProjectVersionRef.current === projectEditVersionRef.current) {
      await drainMutationQueue();
      return projectDraftRef.current === null && internalConflictRef.current === null;
    }

    await drainMutationQueue();
    if (internalConflictRef.current !== null) return false;
    const draft = projectDraftRef.current;
    if (projectRef.current === null) return false;
    if (draft === null) return true;
    const capturedVersion = projectEditVersionRef.current;
    queuedProjectVersionRef.current = capturedVersion;
    const capturedFields = new Set(projectDirtyFieldsRef.current);
    const capturedFieldVersions = new Map(
      [...capturedFields].map((field) => [field, projectFieldVersionsRef.current.get(field) ?? capturedVersion])
    );
    const capturedDraft = { ...draft, name: draft.name.trim() };
    const saved = await enqueueIntent({
      operation: 'update_project',
      invoke: (canonical) =>
        ipcBridge.creativeStudio.updateProject.invoke({
          projectId: canonical.id,
          expectedRevision: canonical.revision,
          ...capturedDraft,
        }),
      onSuccess: (canonical) => {
        for (const [field, version] of capturedFieldVersions) {
          if (projectFieldVersionsRef.current.get(field) === version) {
            projectDirtyFieldsRef.current.delete(field);
            projectFieldVersionsRef.current.delete(field);
          }
        }
        if (projectDirtyFieldsRef.current.size === 0) {
          projectDraftRef.current = null;
          projectEditVersionRef.current = 0;
        } else if (projectDraftRef.current !== null) {
          projectDraftRef.current = applyLocalProjectFields(
            editableProject(canonical),
            projectDraftRef.current,
            projectDirtyFieldsRef.current
          );
        }
        rerenderProjectDraft();
      },
      onDiscard: clearProjectDraft,
    });
    if (queuedProjectVersionRef.current === capturedVersion) queuedProjectVersionRef.current = null;
    return saved && projectDraftRef.current === null && internalConflictRef.current === null;
  }, [clearProjectDraft, drainMutationQueue, enqueueIntent, publishIssue, rerenderProjectDraft]);
  flushProjectRef.current = flushProjectDraft;

  const flushUnsavedWork = useCallback(async (): Promise<{ saved: boolean }> => {
    try {
      for (let round = 0; round < 3; round += 1) {
        if (!(await flushProjectDraft()) || internalConflictRef.current !== null) return { saved: false };

        const result = await flushAllSceneDrafts();
        if (result.failed.length > 0 || internalConflictRef.current !== null) return { saved: false };
        if (result.dirtied.length === 0 && projectDraftRef.current === null) return { saved: true };
      }
      return { saved: false };
    } catch {
      return { saved: false };
    }
  }, [flushAllSceneDrafts, flushProjectDraft]);

  const activeProjectId = project?.id;
  useEffect(() => {
    if (activeProjectId === undefined) return;

    const disposeHasUnsavedWork = ipcBridge.creativeStudio.hasUnsavedWork.provider(() => ({
      dirtySceneCount: dirtySceneIdsRef.current.size,
    }));
    const disposeFlushUnsavedWork = ipcBridge.creativeStudio.flushUnsavedWork.provider(flushUnsavedWork);
    return () => {
      disposeFlushUnsavedWork();
      disposeHasUnsavedWork();
    };
  }, [activeProjectId, flushUnsavedWork]);

  const discardProjectDraft = useCallback(() => {
    clearProjectDraft();
    if (mountedRef.current) {
      setError((currentError) => (currentError?.operation === 'update_project' ? null : currentError));
    }
  }, [clearProjectDraft]);

  const flushSceneDraft = useCallback((): Promise<boolean> => {
    const sceneId = selectedSceneIdRef.current;
    return sceneId === null ? Promise.resolve(false) : flushScene(sceneId);
  }, [flushScene]);

  const discardSceneDraftById = useCallback(
    (sceneId: string) => {
      clearSaveTimer(sceneId);
      draftsRef.current.delete(sceneId);
      dirtySceneIdsRef.current.delete(sceneId);
      dirtyFieldsRef.current.delete(sceneId);
      dirtyFieldVersionsRef.current.delete(sceneId);
      sceneEditVersionsRef.current.delete(sceneId);
      clearSaveIssue(sceneId);
      const canonical = projectRef.current;
      if (canonical !== null) persistDirtySceneDrafts(canonical, mountedRef.current);
      rerenderDrafts();
    },
    [clearSaveIssue, clearSaveTimer, persistDirtySceneDrafts, rerenderDrafts]
  );

  const discardSceneDraft = useCallback(() => {
    const sceneId = selectedSceneIdRef.current;
    if (sceneId !== null) discardSceneDraftById(sceneId);
  }, [discardSceneDraftById]);

  const addScene = useCallback(async (): Promise<boolean> => {
    const current = projectRef.current;
    if (current === null || current.sceneOrder.length >= MAX_SCENES) return false;
    const sceneId = globalThis.crypto.randomUUID();
    const remainingSeconds =
      current.targetDurationSeconds -
      current.sceneOrder.reduce((total, id) => total + (current.scenes[id]?.durationSeconds ?? 0), 0);
    const scene: StudioEditableScene = {
      title: '',
      purpose: '',
      visualPrompt: '',
      narration: '',
      onScreenText: '',
      mediaKind: 'image',
      durationSeconds:
        remainingSeconds > 0
          ? Math.min(DEFAULT_SCENE_DURATION_SECONDS, remainingSeconds)
          : DEFAULT_SCENE_DURATION_SECONDS,
      referenceAssetId: null,
    };
    return enqueueIntent({
      operation: 'add_scene',
      sceneId,
      invoke: (canonical) =>
        ipcBridge.creativeStudio.updateScene.invoke({
          projectId: canonical.id,
          sceneId,
          expectedRevision: canonical.revision,
          scene,
        }),
      onSuccess: (canonical) => {
        if (!Object.hasOwn(canonical.scenes, sceneId)) return;
        selectedSceneIdRef.current = sceneId;
        if (mountedRef.current) setSelectedSceneId(sceneId);
      },
    });
  }, [enqueueIntent]);

  const increaseTargetDuration = useCallback((): Promise<boolean> => {
    const suggestedTarget = suggestedExpandedTargetSeconds;
    if (suggestedTarget === null) return Promise.resolve(false);
    return enqueueIntent({
      operation: 'update_target',
      invoke: (canonical) =>
        ipcBridge.creativeStudio.updateProject.invoke({
          projectId: canonical.id,
          expectedRevision: canonical.revision,
          targetDurationSeconds: suggestedTarget,
        }),
    });
  }, [enqueueIntent, suggestedExpandedTargetSeconds]);

  const fitToTarget = useCallback(
    async (catalogVersion: string): Promise<StudioFitStoryboardOutcome | null> => {
      if (projectRef.current === null) return null;
      if (mountedRef.current) {
        setLatestFitOutcome(null);
        setLatestFitCatalogVersion(null);
      }
      let immediateOutcome: StudioFitStoryboardOutcome | null = null;
      const accepted = await enqueueIntent({
        operation: 'fit_duration',
        invoke: async (canonical) => {
          const result = await ipcBridge.creativeStudio.fitStoryboard.invoke({
            projectId: canonical.id,
            expectedRevision: canonical.revision,
            catalogVersion,
          });
          if (result.ok === false) return result;
          immediateOutcome = result.data;
          return { ok: true, data: result.data.project };
        },
        onSuccess: (canonical) => {
          if (
            immediateOutcome === null ||
            immediateOutcome.project.id !== canonical.id ||
            immediateOutcome.project.revision !== canonical.revision ||
            !mountedRef.current
          ) {
            return;
          }
          setLatestFitOutcome(immediateOutcome);
          setLatestFitCatalogVersion(catalogVersion);
        },
      });
      return accepted ? immediateOutcome : null;
    },
    [enqueueIntent]
  );

  const clearLatestFitOutcome = useCallback(() => {
    setLatestFitOutcome(null);
    setLatestFitCatalogVersion(null);
  }, []);

  const removeScene = useCallback(
    async (sceneId: string): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || !Object.hasOwn(current.scenes, sceneId)) return false;
      return enqueueIntent({
        operation: 'remove_scene',
        sceneId,
        invoke: (canonical) =>
          ipcBridge.creativeStudio.updateScene.invoke({
            projectId: canonical.id,
            sceneId,
            expectedRevision: canonical.revision,
            scene: null,
          }),
        onSuccess: (canonical) => {
          draftsRef.current.delete(sceneId);
          dirtySceneIdsRef.current.delete(sceneId);
          dirtyFieldsRef.current.delete(sceneId);
          dirtyFieldVersionsRef.current.delete(sceneId);
          sceneEditVersionsRef.current.delete(sceneId);
          clearSaveIssue(sceneId);
          persistDirtySceneDrafts(canonical, mountedRef.current);
          rerenderDrafts();
        },
      });
    },
    [clearSaveIssue, enqueueIntent, persistDirtySceneDrafts, rerenderDrafts]
  );

  const reorderScenes = useCallback(
    (sceneOrder: string[]): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || !isExactPermutation(current.sceneOrder, sceneOrder)) return Promise.resolve(false);
      if (current.sceneOrder.every((sceneId, index) => sceneId === sceneOrder[index])) return Promise.resolve(false);
      const requestedOrder = [...sceneOrder];
      return enqueueIntent({
        operation: 'reorder_scenes',
        invoke: (canonical) =>
          ipcBridge.creativeStudio.reorderScenes.invoke({
            projectId: canonical.id,
            expectedRevision: canonical.revision,
            sceneOrder: requestedOrder,
          }),
      });
    },
    [enqueueIntent]
  );

  const moveScene = useCallback(
    (sceneId: string, direction: 'up' | 'down'): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null) return Promise.resolve(false);
      const index = current.sceneOrder.indexOf(sceneId);
      const destination = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || destination < 0 || destination >= current.sceneOrder.length) return Promise.resolve(false);
      const sceneOrder = [...current.sceneOrder];
      [sceneOrder[index], sceneOrder[destination]] = [sceneOrder[destination], sceneOrder[index]];
      return reorderScenes(sceneOrder);
    },
    [reorderScenes]
  );

  const clearError = useCallback(() => setError(null), []);

  const retryConflict = useCallback(async (): Promise<boolean> => {
    const pending = internalConflictRef.current;
    if (pending === null) return false;
    if (pending.intent.operation === 'draft_storyboard') return false;

    if (pending.intent.operation === 'save_scene' && pending.intent.sceneId !== undefined) {
      await drainMutationQueue();
      if (internalConflictRef.current !== pending) return false;
      internalConflictRef.current = null;
      if (mountedRef.current) setConflict(null);

      const retried = await flushScene(pending.intent.sceneId, true);
      if (retried) {
        resumePausedIntents();
      } else if (internalConflictRef.current === null) {
        resumePausedIntents();
      }
      return retried;
    }

    internalConflictRef.current = null;
    if (mountedRef.current) setConflict(null);
    const retried = await enqueueIntent(pending.intent);
    if (retried) {
      resumePausedIntents();
    } else if (internalConflictRef.current === null) {
      resumePausedIntents();
    }
    return retried;
  }, [drainMutationQueue, enqueueIntent, flushScene, resumePausedIntents]);

  const discardConflict = useCallback(() => {
    const pending = internalConflictRef.current;
    internalConflictRef.current = null;
    pending?.intent.onDiscard?.();
    if (mountedRef.current) {
      setConflict(null);
      setError(null);
    }
    resumePausedIntents();
  }, [resumePausedIntents]);

  const proposeStoryboard = useCallback(
    async (replaceExisting: boolean): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null) return false;
      const pendingConflict = internalConflictRef.current;
      if (pendingConflict !== null && pendingConflict.intent.operation !== 'draft_storyboard') {
        return false;
      }
      if (pendingConflict?.intent.operation === 'draft_storyboard') {
        internalConflictRef.current = null;
        if (mountedRef.current) setConflict(null);
        resumePausedIntents();
      }

      if (dirtySceneIdsRef.current.size > 0) {
        const flushed = await flushAllSceneDrafts();
        if (flushed.failed.length > 0 || flushed.dirtied.length > 0) return false;
      }

      const drafted = await runDraftIntent({
        operation: 'draft_storyboard',
        invoke: (canonical) =>
          ipcBridge.creativeStudio.proposeStoryboard.invoke({
            projectId: canonical.id,
            expectedRevision: canonical.revision,
            replaceExisting,
          }),
        onSuccess: (canonical) => {
          discardPausedIntents();
          clearAllDrafts();
          const firstSceneId = canonical.sceneOrder[0] ?? null;
          selectedSceneIdRef.current = firstSceneId;
          if (mountedRef.current) setSelectedSceneId(firstSceneId);
        },
      });
      if (!drafted && internalConflictRef.current === null) resumePausedIntents();
      return drafted;
    },
    [clearAllDrafts, discardPausedIntents, flushAllSceneDrafts, resumePausedIntents, runDraftIntent]
  );

  return {
    project,
    orderedScenes,
    selectedSceneId,
    selectedScene,
    sceneDraft,
    sceneDrafts,
    sceneSaveStates,
    projectDraft,
    projectSaveState,
    hasUnsavedProjectDraft: projectDraft !== null,
    hasUnsavedSceneDrafts: dirtySceneIdsRef.current.size > 0,
    hasUnsavedSelectedSceneDraft: selectedSceneId !== null && dirtySceneIdsRef.current.has(selectedSceneId),
    selectedSceneSaveState,
    saveIssues,
    selectScene,
    updateSceneDraft,
    updateSceneDraftById,
    updateProjectDraft,
    flushProjectDraft,
    discardProjectDraft,
    flushSceneDraft,
    flushSceneDraftById,
    flushAllSceneDrafts,
    discardSceneDraft,
    discardSceneDraftById,
    addScene,
    removeScene,
    reorderScenes,
    moveScene,
    canAddScene: project !== null && project.sceneOrder.length < MAX_SCENES,
    durationTotalSeconds,
    durationMatchesTarget: project !== null && durationTotalSeconds === project.targetDurationSeconds,
    remainingDurationSeconds,
    suggestedExpandedTargetSeconds,
    increaseTargetDuration,
    fitToTarget,
    latestFitOutcome,
    latestFitCatalogVersion,
    clearLatestFitOutcome,
    mutationPending: mutationCount > 0,
    error,
    clearError,
    conflict,
    retryConflict,
    discardConflict,
    drafting,
    proposeStoryboard,
  };
};
