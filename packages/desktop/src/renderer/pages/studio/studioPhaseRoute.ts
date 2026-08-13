export const STUDIO_VIEWS = ['table', 'board', 'cut', 'brief'] as const;

export type StudioView = (typeof STUDIO_VIEWS)[number];

export type StudioWriteFocusIntent = {
  sceneId: string;
  field: 'visualPrompt';
};

export type StudioViewTransition = {
  view: StudioView;
  state?: { writeFocus?: StudioWriteFocusIntent };
};

/**
 * Deliberately not the old `last-phase:` key. The stored vocabulary changed wholesale, and
 * `parseStudioView` rejecting an unknown value already self-heals into one replace-navigation, so
 * a migration map would buy a nicer first landing at the cost of code that outlives its reason.
 */
const viewStorageKey = (projectId: string): string => `aionui:creative-studio:last-view:${projectId}`;

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

/** The script is the document; every other view is a lens on it, so Table is where a project opens. */
export function defaultStudioView(): StudioView {
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

export function resolveStudioEntryView(projectId: string, storage?: Storage): StudioView {
  return readLastStudioView(projectId, storage) ?? defaultStudioView();
}
