import {
  STUDIO_VIEWS,
  type StudioProjectStatusStageIdV2,
  type StudioProjectStatusV2,
  type StudioView,
} from '@/common/types/project/creativeStudioTypes';

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

export type StudioViewReadiness = Readonly<Record<StudioView, boolean>>;

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

/** A view-less entry lets exact project status decide whether any work area has content yet. */
export function studioProjectPath(projectId: string): string {
  return `/studio/${encodeURIComponent(projectId)}`;
}

const stageHasContent = (status: StudioProjectStatusV2, stageId: StudioProjectStatusStageIdV2): boolean =>
  status.stages.some((stage) => stage.id === stageId && stage.state !== 'not_started');

/** Derives view content only from Main's exact project-status stages. */
export function studioViewReadiness(status: StudioProjectStatusV2): StudioViewReadiness {
  return {
    references: stageHasContent(status, 'references'),
    table: stageHasContent(status, 'storyboard') || stageHasContent(status, 'bindings'),
    board: stageHasContent(status, 'production'),
    cut: stageHasContent(status, 'cut'),
  };
}

/** Reports whether any Studio view has authoritative content. */
export function hasReadyStudioView(readiness: StudioViewReadiness): boolean {
  return STUDIO_VIEWS.some((view) => readiness[view]);
}

/** Returns the first ready view in the document's fixed References-to-Cut order. */
export function firstReadyStudioView(readiness: StudioViewReadiness): StudioView | null {
  return STUDIO_VIEWS.find((view) => readiness[view]) ?? null;
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

/** An explicit remembered choice outranks readiness; otherwise an empty workspace stays view-less. */
export function resolveStudioEntryView(
  projectId: string,
  readiness: StudioViewReadiness,
  storage?: Storage
): StudioView | null {
  const remembered = readLastStudioView(projectId, storage);
  return remembered ?? firstReadyStudioView(readiness);
}

/** A remembered choice is explicit; otherwise defer first-entry routing until the project is loaded. */
export function studioEntryPath(projectId: string, storage?: Storage): string {
  const remembered = readLastStudioView(projectId, storage);
  return remembered === null ? studioProjectPath(projectId) : studioViewPath(projectId, remembered);
}
