/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export type WorkspaceDraftValue = string | number | boolean | null;

const GENERATION_AFFECTING_DRAFT_KEYS = new Set([
  'settings.aspectRatio',
  'settings.resolution',
  'brief.text',
  'brief.imageRouteId',
  'brief.videoRouteId',
  'brief.spendCurrency',
  'brief.spendMajorUnits',
  'brief.rules',
]);

export const hasGenerationAffectingWorkspaceDrafts = (keys: readonly string[]): boolean =>
  keys.some((key) => GENERATION_AFFECTING_DRAFT_KEYS.has(key));

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
  version: 2;
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
  resetAll: () => void;
  selection: WorkspaceSelection;
  selectBeat: (beatId: string | null) => void;
  selectShot: (shotId: string, intent?: WorkspaceSelectionIntent) => void;
  clearSelection: () => void;
};

const MAX_DRAFT_FIELDS = 12;
const MAX_FIELD_KEY_LENGTH = 128;
const MAX_STRING_VALUE_LENGTH = 8_192;
const MAX_SELECTION = 256;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const validKey = (key: string): boolean =>
  key.length > 0 && key.length <= MAX_FIELD_KEY_LENGTH && !FORBIDDEN_KEYS.has(key);

const emptyEntries = (): Record<string, WorkspaceDraftEntry> =>
  Object.create(null) as Record<string, WorkspaceDraftEntry>;

const storageKey = (projectId: string): string => `aionui:creative-studio:v2:workspace-drafts:${projectId}`;

const resolveStorage = (storage?: Storage): Storage | null => {
  if (storage !== undefined) return storage;
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const validValue = (value: unknown): value is WorkspaceDraftValue =>
  value === null ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isSafeInteger(value)) ||
  (typeof value === 'string' && value.length <= MAX_STRING_VALUE_LENGTH);

const emptyDrafts = (projectId: string, sourceRevision: number): PersistedWorkspaceDrafts => ({
  version: 2,
  projectId,
  sourceRevision,
  entries: emptyEntries(),
  selection: { selectedBeatId: null, selectedShotIds: [], anchorShotId: null },
});

const readDrafts = (
  projectId: string,
  projectRevision: number,
  activeBeatIds: readonly string[],
  activeShotIds: readonly string[],
  storage?: Storage
): PersistedWorkspaceDrafts => {
  try {
    const bytes = resolveStorage(storage)?.getItem(storageKey(projectId));
    if (bytes === null || bytes === undefined || bytes.length > 1_048_576)
      return emptyDrafts(projectId, projectRevision);
    const decoded = JSON.parse(bytes) as Partial<PersistedWorkspaceDrafts>;
    if (
      decoded.version !== 2 ||
      decoded.projectId !== projectId ||
      !Number.isSafeInteger(decoded.sourceRevision) ||
      typeof decoded.entries !== 'object' ||
      decoded.entries === null ||
      Array.isArray(decoded.entries)
    ) {
      return emptyDrafts(projectId, projectRevision);
    }
    const entries = emptyEntries();
    for (const [key, candidate] of Object.entries(decoded.entries).slice(0, MAX_DRAFT_FIELDS)) {
      if (
        !validKey(key) ||
        typeof candidate !== 'object' ||
        candidate === null ||
        !validValue(candidate.baseValue) ||
        !validValue(candidate.value)
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
    return {
      version: 2,
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
  } catch {
    return emptyDrafts(projectId, projectRevision);
  }
};

const writeDrafts = (drafts: PersistedWorkspaceDrafts, storage?: Storage): void => {
  try {
    const target = resolveStorage(storage);
    if (target === null) return;
    if (
      Object.keys(drafts.entries).length === 0 &&
      drafts.selection.selectedBeatId === null &&
      drafts.selection.selectedShotIds.length === 0
    ) {
      target.removeItem(storageKey(drafts.projectId));
      return;
    }
    target.setItem(storageKey(drafts.projectId), JSON.stringify(drafts));
  } catch {
    // Draft persistence is best effort; the in-memory owner remains authoritative for this view.
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

  useEffect(() => {
    if (!enabled) return;
    setDrafts(readDrafts(projectId, projectRevision, activeBeatIds, activeShotIds, storage));
  }, [enabled, projectId, storage]);

  useEffect(() => {
    if (!enabled) return;
    setDrafts((current) => {
      if (current.projectId !== projectId) return current;
      const entries = emptyEntries();
      let hasConflict = false;
      for (const [key, entry] of Object.entries(current.entries)) {
        if (!validKey(key) || !Object.hasOwn(canonicalValues, key)) continue;
        const canonical = canonicalValues[key]!;
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
      return {
        ...current,
        sourceRevision: hasConflict ? current.sourceRevision : projectRevision,
        entries,
        selection,
      };
    });
  }, [activeBeatFingerprint, activeShotFingerprint, canonicalFingerprint, enabled, projectId, projectRevision]);

  useEffect(() => {
    if (enabled) writeDrafts(drafts, storage);
  }, [drafts, enabled, storage]);

  const conflictKeys = useMemo(
    () =>
      Object.entries(drafts.entries)
        .filter(
          ([key, entry]) =>
            validKey(key) && Object.hasOwn(canonicalValues, key) && entry.baseValue !== canonicalValues[key]
        )
        .map(([key]) => key)
        .toSorted(),
    [canonicalFingerprint, drafts.entries]
  );
  const dirtyKeys = useMemo(
    () =>
      Object.keys(drafts.entries)
        .filter((key) => !key.startsWith('gate.'))
        .toSorted(),
    [drafts.entries]
  );

  const setValue = useCallback(
    (key: string, value: WorkspaceDraftValue): void => {
      if (!enabled || !validKey(key) || !validValue(value) || !Object.hasOwn(canonicalValues, key)) return;
      const canonical = canonicalValues[key]!;
      setDrafts((current) => {
        const entries = { ...current.entries };
        if (value === canonical) delete entries[key];
        else {
          const existing = entries[key];
          entries[key] = { baseValue: existing === undefined ? canonical : existing.baseValue, value };
        }
        if (Object.keys(entries).length > MAX_DRAFT_FIELDS) return current;
        return { ...current, entries };
      });
    },
    [canonicalFingerprint, enabled]
  );

  const reset = useCallback((key: string): void => {
    setDrafts((current) => {
      if (!Object.hasOwn(current.entries, key)) return current;
      const entries = { ...current.entries };
      delete entries[key];
      return { ...current, entries };
    });
  }, []);

  const resetAll = useCallback((): void => {
    setDrafts((current) => ({ ...current, sourceRevision: projectRevision, entries: {} }));
  }, [projectRevision]);

  const value = useCallback(
    (key: string): WorkspaceDraftValue | undefined => {
      if (!validKey(key) || !Object.hasOwn(canonicalValues, key)) return undefined;
      return Object.hasOwn(drafts.entries, key) ? drafts.entries[key]!.value : canonicalValues[key];
    },
    [canonicalFingerprint, drafts.entries]
  );

  const selectBeat = useCallback(
    (beatId: string | null): void => {
      if (beatId !== null && !activeBeatIds.includes(beatId)) return;
      setDrafts((current) => ({
        ...current,
        selection: { ...current.selection, selectedBeatId: beatId },
      }));
    },
    [activeBeatFingerprint]
  );

  const selectShot = useCallback(
    (shotId: string, intent: WorkspaceSelectionIntent = 'toggle'): void => {
      setDrafts((current) => ({
        ...current,
        selection: updateWorkspaceSelection({ selection: current.selection, activeShotIds, shotId, intent }),
      }));
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
    resetAll,
    selection: drafts.selection,
    selectBeat,
    selectShot,
    clearSelection,
  };
};
