import { STUDIO_VIEWS, type StudioView } from '@/common/types/project/creativeStudioTypes';

/**
 * Re-exported, not redeclared: the view vocabulary is shared with the main process, which gates its
 * unsaved-draft close preflight on the same segments. Renderer call sites keep importing it from
 * here so the route module stays the single place the renderer reasons about view addresses.
 */
export { STUDIO_VIEWS, type StudioView };

/**
 * Deliberately not the old `last-phase:` key. The stored vocabulary changed wholesale, and
 * `parseStudioView` rejecting an unknown value already self-heals into one replace-navigation, so
 * a migration map would buy a nicer first landing at the cost of code that outlives its reason.
 */
const viewStorageKey = (projectId: string): string => `aionui:creative-studio:last-view:${projectId}`;
const referencesOpenedStorageKey = (projectId: string): string =>
  `aionui:creative-studio:references-opened:${projectId}`;
const cutOpenedStorageKey = (projectId: string): string => `aionui:creative-studio:cut-opened:${projectId}`;

const resolveStorage = (storage?: Storage): Storage | null => {
  if (storage !== undefined) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function parseStudioView(value: string | undefined): StudioView | null {
  return STUDIO_VIEWS.find((view) => view === value) ?? null;
}

export function studioViewPath(projectId: string, view: StudioView): string {
  return `/studio/${encodeURIComponent(projectId)}/${view}`;
}

/** A view-less entry lets the loaded project decide whether first-time reference work comes first. */
export function studioProjectPath(projectId: string): string {
  return `/studio/${encodeURIComponent(projectId)}`;
}

/** The visible journey begins at the Table; exact progress may then open first-time reference work. */
export function defaultStudioView(_hasReferenceWork = false): StudioView {
  return 'table';
}

export function readLastStudioView(projectId: string, storage?: Storage): StudioView | null {
  try {
    return parseStudioView(resolveStorage(storage)?.getItem(viewStorageKey(projectId)) ?? undefined);
  } catch {
    return null;
  }
}

export function rememberStudioView(projectId: string, view: StudioView, storage?: Storage): void {
  try {
    resolveStorage(storage)?.setItem(viewStorageKey(projectId), view);
  } catch {
    // View persistence is a best-effort renderer-local enhancement.
  }
}

export function resolveStudioEntryView(projectId: string, storage?: Storage, hasReferenceWork = false): StudioView {
  return readLastStudioView(projectId, storage) ?? defaultStudioView(hasReferenceWork);
}

/** A remembered choice is explicit; otherwise defer first-entry routing until the project is loaded. */
export function studioEntryPath(projectId: string, storage?: Storage): string {
  const remembered = readLastStudioView(projectId, storage);
  return remembered === null ? studioProjectPath(projectId) : studioViewPath(projectId, remembered);
}

export function hasOpenedStudioReferences(projectId: string, storage?: Storage): boolean {
  try {
    return resolveStorage(storage)?.getItem(referencesOpenedStorageKey(projectId)) === '1';
  } catch {
    return false;
  }
}

/** Set before navigation so a render interruption cannot replay the one-time References transition. */
export function markStudioReferencesOpened(projectId: string, storage?: Storage): void {
  try {
    resolveStorage(storage)?.setItem(referencesOpenedStorageKey(projectId), '1');
  } catch {
    // The page also carries an in-memory fence when storage is unavailable.
  }
}

/** A Cut opening is valid only for the exact ordered set of current video takes that was shown. */
export function hasOpenedStudioCut(projectId: string, signature: string, storage?: Storage): boolean {
  try {
    return resolveStorage(storage)?.getItem(cutOpenedStorageKey(projectId)) === signature;
  } catch {
    return false;
  }
}

/** Renderer-local visit memory; changing any current take changes the signature and reopens the handoff. */
export function markStudioCutOpened(projectId: string, signature: string, storage?: Storage): void {
  try {
    resolveStorage(storage)?.setItem(cutOpenedStorageKey(projectId), signature);
  } catch {
    // Visit memory is a best-effort renderer-local enhancement.
  }
}
