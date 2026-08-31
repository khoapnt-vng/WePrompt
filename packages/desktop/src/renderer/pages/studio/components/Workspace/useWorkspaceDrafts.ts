/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { STUDIO_MAX_SHOOTING_SCRIPT_LENGTH, STUDIO_MAX_STORY_LENGTH } from '@/common/types/project/creativeStudioTypes';

export type WorkspaceDraftValue = string | number | boolean | null;

const GENERATION_AFFECTING_DRAFT_KEYS = new Set([
  'settings.aspectRatio',
  'settings.resolution',
  'brief.text',
  'brief.imageRouteId',
  'brief.videoRouteId',
  'brief.spendCurrency',
  'brief.spendMajorUnits',
]);

export const hasGenerationAffectingWorkspaceDrafts = (keys: readonly string[]): boolean =>
  keys.some((key) => GENERATION_AFFECTING_DRAFT_KEYS.has(key) || key.startsWith('beat.') || key.startsWith('shot.'));

export type WorkspaceDraftEntry = {
  baseValue: WorkspaceDraftValue;
  value: WorkspaceDraftValue;
};

export type WorkspaceSelection = {
  selectedBeatId: string | null;
  selectedShotIds: string[];
  anchorShotId: string | null;
};

type PersistedWorkspaceDrafts = {
  version: 3;
  projectId: string;
  sourceRevision: number;
  entries: Record<string, WorkspaceDraftEntry>;
  selection: WorkspaceSelection;
};

export type WorkspaceSelectionIntent = 'replace' | 'toggle' | 'range';

export type UseWorkspaceDraftsInput = {
  projectId: string;
  projectRevision: number;
  canonicalValues: Readonly<Record<string, WorkspaceDraftValue>>;
  activeBeatIds?: readonly string[];
  activeShotIds: readonly string[];
  storage?: Storage;
  enabled?: boolean;
};

export type UseWorkspaceDraftsResult = {
  value: (key: string) => WorkspaceDraftValue | undefined;
  entries: Readonly<Record<string, WorkspaceDraftEntry>>;
  dirtyKeys: string[];
  conflictKeys: string[];
  dirtyCount: number;
  staleRevision: boolean;
  setValue: (key: string, value: WorkspaceDraftValue) => void;
  reset: (key: string) => void;
  resetIfValue: (key: string, expectedValue: WorkspaceDraftValue) => void;
  resetAll: () => void;
  selection: WorkspaceSelection;
  selectBeat: (beatId: string | null) => void;
  selectShot: (shotId: string, intent?: WorkspaceSelectionIntent) => void;
  clearSelection: () => void;
};

// Field count and serialized bytes independently bound the renderer-owned draft sidecar.
const MAX_DRAFT_FIELDS = 1_024;
const MAX_FIELD_KEY_LENGTH = 512;
const DEFAULT_MAX_STRING_VALUE_LENGTH = 8_192;
const MAX_BRIEF_DRAFT_LENGTH = 16 * 1_024;
const MAX_SELECTION = 256;
const MAX_PERSISTED_DRAFT_LENGTH = 1_048_576;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Task 8's raw rule document was replaced by typed, revision-guarded rule commands. Never revive
// that opaque scalar from an older session: it can exceed the scalar bound, conflict invisibly, and
// overwrite rules added by the Director after the draft was captured.
const RETIRED_DRAFT_KEYS = new Set(['brief.rules', 'settings.name', 'settings.targetDurationSeconds']);
const WORKSPACE_DRAFT_STORAGE_PREFIX = 'aionui:creative-studio:v3:workspace-drafts:';
const RETIRED_WORKSPACE_DRAFT_STORAGE_PREFIX = 'aionui:creative-studio:v2:workspace-drafts:';

type VolatileWorkspaceDrafts = {
  drafts: PersistedWorkspaceDrafts | null;
  storageBacked: boolean;
};

const volatileWorkspaceDrafts = new Map<string, VolatileWorkspaceDrafts>();

const validKey = (key: string): boolean =>
  key.length > 0 &&
  key.length <= MAX_FIELD_KEY_LENGTH &&
  !FORBIDDEN_KEYS.has(key) &&
  !RETIRED_DRAFT_KEYS.has(key) &&
  !(key.startsWith('beat.') && key.endsWith('.targetSeconds'));

const emptyEntries = (): Record<string, WorkspaceDraftEntry> =>
  Object.create(null) as Record<string, WorkspaceDraftEntry>;

const storageKey = (projectId: string): string => `${WORKSPACE_DRAFT_STORAGE_PREFIX}${projectId}`;
const retiredStorageKey = (projectId: string): string => `${RETIRED_WORKSPACE_DRAFT_STORAGE_PREFIX}${projectId}`;

const resolveStorage = (storage?: Storage): Storage | null => {
  if (storage !== undefined) return storage;
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const maxStringValueLength = (key: string): number => {
  if (key.startsWith('shot.') && key.endsWith('.shootingScript')) return STUDIO_MAX_SHOOTING_SCRIPT_LENGTH;
  if (key.startsWith('beat.') && key.endsWith('.story')) return STUDIO_MAX_STORY_LENGTH;
  if (key === 'brief.text') return MAX_BRIEF_DRAFT_LENGTH;
  return DEFAULT_MAX_STRING_VALUE_LENGTH;
};

const validValue = (key: string, value: unknown): value is WorkspaceDraftValue =>
  value === null ||
  typeof value === 'boolean' ||
  (typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER &&
    !Object.is(value, -0)) ||
  (typeof value === 'string' && value.length <= maxStringValueLength(key));

const matchesCanonicalValueKind = (_key: string, value: WorkspaceDraftValue, canonical: WorkspaceDraftValue): boolean =>
  canonical === null ? value === null : typeof value === typeof canonical;

const fitsPersistedDraftBound = (drafts: PersistedWorkspaceDrafts): boolean => {
  try {
    return JSON.stringify(drafts).length <= MAX_PERSISTED_DRAFT_LENGTH;
  } catch {
    return false;
  }
};

const emptyDrafts = (projectId: string, sourceRevision: number): PersistedWorkspaceDrafts => ({
  version: 3,
  projectId,
  sourceRevision,
  entries: emptyEntries(),
  selection: { selectedBeatId: null, selectedShotIds: [], anchorShotId: null },
});

const cloneDrafts = (drafts: PersistedWorkspaceDrafts): PersistedWorkspaceDrafts => {
  const entries = emptyEntries();
  for (const [key, entry] of Object.entries(drafts.entries)) entries[key] = { ...entry };
  return {
    ...drafts,
    entries,
    selection: { ...drafts.selection, selectedShotIds: [...drafts.selection.selectedShotIds] },
  };
};

const readDrafts = (
  projectId: string,
  projectRevision: number,
  activeBeatIds: readonly string[],
  activeShotIds: readonly string[],
  storage?: Storage
): PersistedWorkspaceDrafts => {
  const volatile = storage === undefined ? volatileWorkspaceDrafts.get(projectId) : undefined;
  let storageBacked = false;
  try {
    const target = resolveStorage(storage);
    let decoded: Partial<PersistedWorkspaceDrafts>;
    if (
      volatile?.storageBacked === false ||
      (target === null && volatile?.drafts !== null && volatile?.drafts !== undefined)
    ) {
      if (volatile.drafts === null) return emptyDrafts(projectId, projectRevision);
      decoded = cloneDrafts(volatile.drafts);
    } else {
      if (target === null) return emptyDrafts(projectId, projectRevision);
      target.removeItem(retiredStorageKey(projectId));
      const bytes = target.getItem(storageKey(projectId));
      if (bytes === null) {
        if (storage === undefined) volatileWorkspaceDrafts.delete(projectId);
        return emptyDrafts(projectId, projectRevision);
      }
      if (bytes.length > MAX_PERSISTED_DRAFT_LENGTH) throw new Error('oversized workspace draft');
      decoded = JSON.parse(bytes) as Partial<PersistedWorkspaceDrafts>;
      storageBacked = true;
    }
    if (
      decoded.version !== 3 ||
      decoded.projectId !== projectId ||
      !Number.isSafeInteger(decoded.sourceRevision) ||
      typeof decoded.entries !== 'object' ||
      decoded.entries === null ||
      Array.isArray(decoded.entries)
    ) {
      throw new Error('invalid workspace draft envelope');
    }
    const entries = emptyEntries();
    for (const [key, candidate] of Object.entries(decoded.entries).slice(0, MAX_DRAFT_FIELDS)) {
      if (
        !validKey(key) ||
        typeof candidate !== 'object' ||
        candidate === null ||
        !validValue(key, candidate.baseValue) ||
        !validValue(key, candidate.value)
      ) {
        continue;
      }
      entries[key] = { baseValue: candidate.baseValue, value: candidate.value };
    }
    const activeBeatOrder = [...new Set(activeBeatIds)];
    const activeBeats = new Set(activeBeatOrder);
    const activeShotOrder = [...new Set(activeShotIds)];
    const activeShots = new Set(activeShotOrder);
    const requestedSelection = Array.isArray(decoded.selection?.selectedShotIds)
      ? decoded.selection.selectedShotIds
      : [];
    const requested = new Set(
      requestedSelection.filter((shotId): shotId is string => typeof shotId === 'string' && activeShots.has(shotId))
    );
    const selectedShotIds = activeShotOrder.filter((shotId) => requested.has(shotId)).slice(0, MAX_SELECTION);
    const requestedBeatId = decoded.selection?.selectedBeatId;
    const requestedAnchor = decoded.selection?.anchorShotId;
    const result: PersistedWorkspaceDrafts = {
      version: 3,
      projectId,
      sourceRevision: decoded.sourceRevision,
      entries,
      selection: {
        selectedBeatId:
          typeof requestedBeatId === 'string' && activeBeats.has(requestedBeatId) ? requestedBeatId : null,
        selectedShotIds,
        anchorShotId: typeof requestedAnchor === 'string' && activeShots.has(requestedAnchor) ? requestedAnchor : null,
      },
    };
    if (storage === undefined) {
      volatileWorkspaceDrafts.set(projectId, { drafts: cloneDrafts(result), storageBacked });
    }
    return result;
  } catch {
    if (volatile?.drafts !== null && volatile?.drafts !== undefined) {
      volatileWorkspaceDrafts.set(projectId, { drafts: cloneDrafts(volatile.drafts), storageBacked: false });
      return cloneDrafts(volatile.drafts);
    }
    try {
      resolveStorage(storage)?.removeItem(storageKey(projectId));
    } catch {
      // Invalid storage remains untrusted and is ignored.
    }
    return emptyDrafts(projectId, projectRevision);
  }
};

const writeDrafts = (drafts: PersistedWorkspaceDrafts, storage?: Storage): void => {
  const isEmpty =
    Object.keys(drafts.entries).length === 0 &&
    drafts.selection.selectedBeatId === null &&
    drafts.selection.selectedShotIds.length === 0;
  if (isEmpty) {
    try {
      resolveStorage(storage)?.removeItem(storageKey(drafts.projectId));
      if (storage === undefined) volatileWorkspaceDrafts.delete(drafts.projectId);
    } catch {
      if (storage === undefined) {
        volatileWorkspaceDrafts.set(drafts.projectId, { drafts: null, storageBacked: false });
      }
    }
    return;
  }
  const snapshot = cloneDrafts(drafts);
  let storageBacked = false;
  try {
    const target = resolveStorage(storage);
    if (target !== null && fitsPersistedDraftBound(snapshot)) {
      target.setItem(storageKey(snapshot.projectId), JSON.stringify(snapshot));
      storageBacked = true;
    }
  } catch {
    // The bounded volatile fallback preserves navigation and close protection.
  }
  if (storage === undefined) {
    volatileWorkspaceDrafts.set(drafts.projectId, { drafts: snapshot, storageBacked });
  }
};

const storedWorkspaceDraftCount = (drafts: PersistedWorkspaceDrafts): number =>
  Object.keys(drafts.entries).filter((key) => validKey(key) && !key.startsWith('gate.')).length;

export const countStoredWorkspaceDrafts = (excludedProjectId: string | null = null): number => {
  const projectIds = new Set(volatileWorkspaceDrafts.keys());
  try {
    const keys = Array.from({ length: window.sessionStorage.length }, (_value, index) =>
      window.sessionStorage.key(index)
    );
    for (const key of keys) {
      if (key !== null && key.startsWith(RETIRED_WORKSPACE_DRAFT_STORAGE_PREFIX)) {
        window.sessionStorage.removeItem(key);
        continue;
      }
      if (key === null || !key.startsWith(WORKSPACE_DRAFT_STORAGE_PREFIX)) continue;
      const projectId = key.slice(WORKSPACE_DRAFT_STORAGE_PREFIX.length);
      if (projectId.length === 0 || storageKey(projectId) !== key) continue;
      projectIds.add(projectId);
    }
    let count = 0;
    for (const projectId of projectIds) {
      if (projectId === excludedProjectId) continue;
      const volatile = volatileWorkspaceDrafts.get(projectId);
      if (volatile?.storageBacked === false) {
        if (volatile.drafts !== null) count += storedWorkspaceDraftCount(volatile.drafts);
        continue;
      }
      let bytes: string | null;
      try {
        bytes = window.sessionStorage.getItem(storageKey(projectId));
      } catch {
        if (volatile?.drafts !== null && volatile?.drafts !== undefined) {
          count += storedWorkspaceDraftCount(volatile.drafts);
        }
        continue;
      }
      if (bytes === null) {
        volatileWorkspaceDrafts.delete(projectId);
        continue;
      }
      try {
        if (bytes.length > MAX_PERSISTED_DRAFT_LENGTH) throw new Error('oversized workspace draft');
        const decoded = JSON.parse(bytes) as Partial<PersistedWorkspaceDrafts>;
        if (
          decoded.version !== 3 ||
          decoded.projectId !== projectId ||
          !Number.isSafeInteger(decoded.sourceRevision) ||
          typeof decoded.entries !== 'object' ||
          decoded.entries === null ||
          Array.isArray(decoded.entries) ||
          typeof decoded.selection !== 'object' ||
          decoded.selection === null ||
          !Array.isArray(decoded.selection.selectedShotIds)
        ) {
          throw new Error('invalid workspace draft envelope');
        }
        const entries = emptyEntries();
        for (const [key, candidate] of Object.entries(decoded.entries).slice(0, MAX_DRAFT_FIELDS)) {
          if (
            validKey(key) &&
            typeof candidate === 'object' &&
            candidate !== null &&
            validValue(key, candidate.baseValue) &&
            validValue(key, candidate.value)
          ) {
            entries[key] = { baseValue: candidate.baseValue, value: candidate.value };
          }
        }
        const selectedBeatId = decoded.selection.selectedBeatId;
        const anchorShotId = decoded.selection.anchorShotId;
        const persisted: PersistedWorkspaceDrafts = {
          version: 3,
          projectId,
          sourceRevision: decoded.sourceRevision,
          entries,
          selection: {
            selectedBeatId:
              typeof selectedBeatId === 'string' && selectedBeatId.length <= MAX_FIELD_KEY_LENGTH
                ? selectedBeatId
                : null,
            selectedShotIds: decoded.selection.selectedShotIds
              .filter((shotId): shotId is string => typeof shotId === 'string' && shotId.length <= MAX_FIELD_KEY_LENGTH)
              .slice(0, MAX_SELECTION),
            anchorShotId:
              typeof anchorShotId === 'string' && anchorShotId.length <= MAX_FIELD_KEY_LENGTH ? anchorShotId : null,
          },
        };
        volatileWorkspaceDrafts.set(projectId, { drafts: cloneDrafts(persisted), storageBacked: true });
        count += storedWorkspaceDraftCount(persisted);
      } catch {
        if (volatile?.drafts !== null && volatile?.drafts !== undefined) {
          count += storedWorkspaceDraftCount(volatile.drafts);
        }
      }
    }
    return count;
  } catch {
    let count = 0;
    for (const [projectId, volatile] of volatileWorkspaceDrafts) {
      if (projectId !== excludedProjectId && volatile.drafts !== null) {
        count += storedWorkspaceDraftCount(volatile.drafts);
      }
    }
    return count;
  }
};

export const purgeStoredWorkspaceDrafts = (projectId: string): void => {
  volatileWorkspaceDrafts.set(projectId, { drafts: null, storageBacked: false });
  try {
    window.sessionStorage.removeItem(storageKey(projectId));
    window.sessionStorage.removeItem(retiredStorageKey(projectId));
    volatileWorkspaceDrafts.delete(projectId);
  } catch {
    // The volatile tombstone prevents a stale envelope from resurfacing in this renderer session.
  }
};

export const updateWorkspaceSelection = (input: {
  selection: WorkspaceSelection;
  activeShotIds: readonly string[];
  shotId: string;
  intent: WorkspaceSelectionIntent;
}): WorkspaceSelection => {
  const activeShotIds = [...new Set(input.activeShotIds)];
  const targetIndex = activeShotIds.indexOf(input.shotId);
  if (targetIndex < 0) return input.selection;
  if (input.intent === 'replace') {
    return {
      selectedBeatId: input.selection.selectedBeatId,
      selectedShotIds: [input.shotId],
      anchorShotId: input.shotId,
    };
  }
  if (input.intent === 'range' && input.selection.anchorShotId !== null) {
    const anchorIndex = activeShotIds.indexOf(input.selection.anchorShotId);
    if (anchorIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      return {
        selectedBeatId: input.selection.selectedBeatId,
        selectedShotIds: activeShotIds.slice(start, Math.min(end + 1, start + MAX_SELECTION)),
        anchorShotId: input.selection.anchorShotId,
      };
    }
  }
  const selected = new Set(input.selection.selectedShotIds);
  if (selected.has(input.shotId)) selected.delete(input.shotId);
  else if (selected.size < MAX_SELECTION) selected.add(input.shotId);
  return {
    selectedBeatId: input.selection.selectedBeatId,
    selectedShotIds: activeShotIds.filter((shotId) => selected.has(shotId)).slice(0, MAX_SELECTION),
    anchorShotId: input.shotId,
  };
};

export const useWorkspaceDrafts = ({
  projectId,
  projectRevision,
  canonicalValues,
  activeBeatIds = [],
  activeShotIds,
  storage,
  enabled = true,
}: UseWorkspaceDraftsInput): UseWorkspaceDraftsResult => {
  const canonicalFingerprint = JSON.stringify(canonicalValues);
  const activeBeatFingerprint = activeBeatIds.join('\0');
  const activeShotFingerprint = activeShotIds.join('\0');
  const [drafts, setDrafts] = useState<PersistedWorkspaceDrafts>(() =>
    enabled
      ? readDrafts(projectId, projectRevision, activeBeatIds, activeShotIds, storage)
      : emptyDrafts(projectId, projectRevision)
  );
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const hydratedScopeRef = useRef<{ projectId: string; storage: Storage | undefined } | null>(
    enabled ? { projectId, storage } : null
  );

  useLayoutEffect(() => {
    if (!enabled) {
      hydratedScopeRef.current = null;
      return;
    }
    const hydrated = hydratedScopeRef.current;
    if (hydrated === null || hydrated.projectId !== projectId || hydrated.storage !== storage) {
      hydratedScopeRef.current = { projectId, storage };
      setDrafts(readDrafts(projectId, projectRevision, activeBeatIds, activeShotIds, storage));
      return;
    }
    writeDrafts(drafts, storage);
  }, [activeBeatFingerprint, activeShotFingerprint, drafts, enabled, projectId, projectRevision, storage]);

  useEffect(() => {
    if (!enabled) return;
    setDrafts((current) => {
      if (current.projectId !== projectId) return current;
      const entries = emptyEntries();
      let hasConflict = false;
      for (const [key, entry] of Object.entries(current.entries)) {
        if (!validKey(key) || !Object.hasOwn(canonicalValues, key)) continue;
        const canonical = canonicalValues[key]!;
        if (
          !matchesCanonicalValueKind(key, entry.baseValue, canonical) ||
          !matchesCanonicalValueKind(key, entry.value, canonical)
        ) {
          continue;
        }
        if (entry.value === canonical) continue;
        if (entry.baseValue !== canonical) hasConflict = true;
        entries[key] = entry.baseValue === canonical ? entry : { ...entry };
      }
      const activeBeats = new Set(activeBeatIds);
      const activeShots = new Set(activeShotIds);
      const selection = {
        selectedBeatId:
          current.selection.selectedBeatId !== null && activeBeats.has(current.selection.selectedBeatId)
            ? current.selection.selectedBeatId
            : null,
        selectedShotIds: [...new Set(current.selection.selectedShotIds)]
          .filter((shotId) => activeShots.has(shotId))
          .slice(0, MAX_SELECTION),
        anchorShotId:
          current.selection.anchorShotId !== null && activeShots.has(current.selection.anchorShotId)
            ? current.selection.anchorShotId
            : null,
      };
      const next = {
        ...current,
        sourceRevision: hasConflict ? current.sourceRevision : projectRevision,
        entries,
        selection,
      };
      if (fitsPersistedDraftBound(next)) return next;
      const bounded = { ...next, sourceRevision: current.sourceRevision };
      return fitsPersistedDraftBound(bounded) ? bounded : current;
    });
  }, [activeBeatFingerprint, activeShotFingerprint, canonicalFingerprint, enabled, projectId, projectRevision]);

  const conflictKeys = useMemo(
    () =>
      Object.entries(drafts.entries)
        .filter(
          ([key, entry]) =>
            validKey(key) &&
            Object.hasOwn(canonicalValues, key) &&
            matchesCanonicalValueKind(key, entry.baseValue, canonicalValues[key]!) &&
            matchesCanonicalValueKind(key, entry.value, canonicalValues[key]!) &&
            entry.baseValue !== canonicalValues[key]
        )
        .map(([key]) => key)
        .toSorted(),
    [canonicalFingerprint, drafts.entries]
  );
  const dirtyKeys = useMemo(
    () =>
      Object.keys(drafts.entries)
        .filter((key) => {
          if (key.startsWith('gate.') || !validKey(key) || !Object.hasOwn(canonicalValues, key)) return false;
          const entry = drafts.entries[key]!;
          const canonical = canonicalValues[key]!;
          return (
            matchesCanonicalValueKind(key, entry.baseValue, canonical) &&
            matchesCanonicalValueKind(key, entry.value, canonical)
          );
        })
        .toSorted(),
    [canonicalFingerprint, drafts.entries]
  );

  const setValue = useCallback(
    (key: string, value: WorkspaceDraftValue): void => {
      if (!enabled || !validKey(key) || !validValue(key, value) || !Object.hasOwn(canonicalValues, key)) return;
      const canonical = canonicalValues[key]!;
      if (!matchesCanonicalValueKind(key, value, canonical)) return;
      setDrafts((current) => {
        const entries = { ...current.entries };
        if (value === canonical) delete entries[key];
        else {
          const existing = entries[key];
          entries[key] = { baseValue: existing === undefined ? canonical : existing.baseValue, value };
        }
        if (Object.keys(entries).length > MAX_DRAFT_FIELDS) return current;
        const next = { ...current, entries };
        return fitsPersistedDraftBound(next) ? next : current;
      });
    },
    [canonicalFingerprint, enabled]
  );

  const reset = useCallback(
    (key: string): void => {
      const current = draftsRef.current;
      if (!Object.hasOwn(current.entries, key)) return;
      const entries = { ...current.entries };
      delete entries[key];
      const next = { ...current, entries };
      draftsRef.current = next;
      writeDrafts(next, storage);
      setDrafts(next);
    },
    [storage]
  );

  const resetIfValue = useCallback(
    (key: string, expectedValue: WorkspaceDraftValue): void => {
      if (!validKey(key) || !validValue(key, expectedValue)) return;
      const current = draftsRef.current;
      const entry = Object.hasOwn(current.entries, key) ? current.entries[key] : undefined;
      if (entry === undefined || entry.value !== expectedValue) return;
      const entries = { ...current.entries };
      delete entries[key];
      const next = { ...current, entries };
      draftsRef.current = next;
      writeDrafts(next, storage);
      setDrafts(next);
    },
    [storage]
  );

  const resetAll = useCallback((): void => {
    const next = { ...draftsRef.current, sourceRevision: projectRevision, entries: emptyEntries() };
    draftsRef.current = next;
    writeDrafts(next, storage);
    setDrafts(next);
  }, [projectRevision, storage]);

  const value = useCallback(
    (key: string): WorkspaceDraftValue | undefined => {
      if (!validKey(key) || !Object.hasOwn(canonicalValues, key)) return undefined;
      const canonical = canonicalValues[key]!;
      if (!Object.hasOwn(drafts.entries, key)) return canonical;
      const entry = drafts.entries[key]!;
      return matchesCanonicalValueKind(key, entry.baseValue, canonical) &&
        matchesCanonicalValueKind(key, entry.value, canonical)
        ? entry.value
        : canonical;
    },
    [canonicalFingerprint, drafts.entries]
  );

  const selectBeat = useCallback(
    (beatId: string | null): void => {
      if (beatId !== null && !activeBeatIds.includes(beatId)) return;
      setDrafts((current) => {
        const next = {
          ...current,
          selection: { ...current.selection, selectedBeatId: beatId },
        };
        return fitsPersistedDraftBound(next) ? next : current;
      });
    },
    [activeBeatFingerprint]
  );

  const selectShot = useCallback(
    (shotId: string, intent: WorkspaceSelectionIntent = 'toggle'): void => {
      setDrafts((current) => {
        const next = {
          ...current,
          selection: updateWorkspaceSelection({ selection: current.selection, activeShotIds, shotId, intent }),
        };
        return fitsPersistedDraftBound(next) ? next : current;
      });
    },
    [activeShotFingerprint]
  );

  const clearSelection = useCallback((): void => {
    setDrafts((current) => ({
      ...current,
      selection: { ...current.selection, selectedShotIds: [], anchorShotId: null },
    }));
  }, []);

  return {
    value,
    entries: drafts.entries,
    dirtyKeys,
    conflictKeys,
    dirtyCount: dirtyKeys.length,
    staleRevision: conflictKeys.length > 0,
    setValue,
    reset,
    resetIfValue,
    resetAll,
    selection: drafts.selection,
    selectBeat,
    selectShot,
    clearSelection,
  };
};
