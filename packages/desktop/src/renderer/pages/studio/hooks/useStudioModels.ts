/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  StudioModelSelectionChange,
  StudioRendererProject,
  StudioRouteCatalog,
} from '@/common/types/project/creativeStudioTypes';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { StudioRouteAdoption } from '../studioRouteDefaults';
import { resolveSoleRouteAdoptions } from '../studioRouteDefaults';

const STORAGE_ERROR_MESSAGE_KEY = 'conversation.creativeStudio.errors.storage';

const mediaSelectionKey = (selection: StudioRendererProject['routing']['image']): string =>
  selection === null ? 'none' : selection.choiceId;

const projectCatalogKey = (project: StudioRendererProject | null): string => {
  if (project === null) return 'none';
  const storyboard = project.routing.storyboard;
  return [
    project.id,
    storyboard === null ? 'none' : `${storyboard.providerId}\u0000${storyboard.model}`,
    mediaSelectionKey(project.routing.image),
    mediaSelectionKey(project.routing.video),
    project.aspectRatio,
    project.resolution,
  ].join('\u0001');
};

const adoptionKey = (projectId: string, adoption: StudioRouteAdoption): string =>
  [projectId, adoption.role, adoption.choiceId].join('\u0000');

export type UseStudioModelsOptions = {
  project: StudioRendererProject | null;
  refetch: () => Promise<StudioRendererProject | null>;
  beforeMutation: () => Promise<boolean>;
  /**
   * Whether the page may persist an unambiguous route for the project right
   * now. Callers withhold it while an edit is unsaved or in flight so an
   * automatic selection never races a user's own revision.
   */
  autoSelectSoleRoute?: boolean;
};

export type UseStudioModelsResult = {
  catalog: StudioRouteCatalog | null;
  loading: boolean;
  errorMessageKey: string | null;
  selectionIssue: StudioModelSelectionIssue | null;
  pendingRole: 'storyboard' | 'image' | 'video' | null;
  refresh: () => Promise<void>;
  updateSelection: (input: StudioModelSelectionChange) => Promise<boolean>;
};

export type StudioModelSelectionIssue = 'save_failed' | 'save_blocked' | 'save_stale';

/**
 * Owns the project-scoped Studio model catalog and CAS selection mutations.
 *
 * Request identities prevent late project/catalog responses from replacing the
 * current view. Selection state is always re-read from the canonical project;
 * the renderer never applies an optimistic route preference.
 */
export const useStudioModels = ({
  project,
  refetch,
  beforeMutation,
  autoSelectSoleRoute = false,
}: UseStudioModelsOptions): UseStudioModelsResult => {
  const [catalog, setCatalog] = useState<StudioRouteCatalog | null>(null);
  const [loading, setLoading] = useState(project !== null);
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [selectionIssue, setSelectionIssue] = useState<StudioModelSelectionIssue | null>(null);
  const [pendingRole, setPendingRole] = useState<'storyboard' | 'image' | 'video' | null>(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const catalogRef = useRef(catalog);
  const projectRef = useRef(project);
  const refetchRef = useRef(refetch);
  const beforeMutationRef = useRef(beforeMutation);
  const pendingRoleRef = useRef<'storyboard' | 'image' | 'video' | null>(null);
  const lastRequestedCatalogKeyRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const attemptedAdoptionsRef = useRef(new Set<string>());

  useLayoutEffect(() => {
    catalogRef.current = catalog;
    projectRef.current = project;
    refetchRef.current = refetch;
    beforeMutationRef.current = beforeMutation;
  });

  const refresh = useCallback((): Promise<void> => {
    const current = projectRef.current;
    const key = projectCatalogKey(current);
    const inFlight = refreshInFlightRef.current;
    if (inFlight?.key === key) return inFlight.promise;

    lastRequestedCatalogKeyRef.current = key;
    const request = ++requestRef.current;
    const operation = (async (): Promise<void> => {
      if (current === null) {
        if (mountedRef.current) {
          catalogRef.current = null;
          setCatalog(null);
          setLoading(false);
          setErrorMessageKey(null);
        }
        return;
      }

      if (mountedRef.current) {
        setLoading(true);
        setErrorMessageKey(null);
      }
      try {
        const result = await ipcBridge.creativeStudio.listRoutes.invoke({ projectId: current.id });
        if (!mountedRef.current || requestRef.current !== request || projectRef.current?.id !== current.id) return;
        if (result.ok === false) {
          catalogRef.current = null;
          setCatalog(null);
          setErrorMessageKey(result.error.messageKey);
          return;
        }
        catalogRef.current = result.data;
        setCatalog(result.data);
      } catch {
        if (mountedRef.current && requestRef.current === request && projectRef.current?.id === current.id) {
          catalogRef.current = null;
          setCatalog(null);
          setErrorMessageKey(STORAGE_ERROR_MESSAGE_KEY);
        }
      } finally {
        if (mountedRef.current && requestRef.current === request && projectRef.current?.id === current.id) {
          setLoading(false);
        }
      }
    })();
    refreshInFlightRef.current = { key, promise: operation };
    void operation.then(
      () => {
        if (refreshInFlightRef.current?.promise === operation) refreshInFlightRef.current = null;
      },
      () => {
        if (refreshInFlightRef.current?.promise === operation) refreshInFlightRef.current = null;
      }
    );
    return operation;
  }, []);

  const routingKey = projectCatalogKey(project);
  useEffect(() => {
    if (lastRequestedCatalogKeyRef.current === routingKey) return;
    requestRef.current += 1;
    catalogRef.current = null;
    setCatalog(null);
    setErrorMessageKey(null);
    setLoading(project !== null);
    void refresh();
  }, [project, refresh, routingKey]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      requestRef.current += 1;
    },
    []
  );

  useEffect(() => {
    const handleFocus = (): void => {
      void refresh();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refresh]);

  const updateSelection = useCallback(
    async (input: StudioModelSelectionChange): Promise<boolean> => {
      const origin = projectRef.current;
      if (!mountedRef.current || origin === null || pendingRoleRef.current !== null) return false;
      pendingRoleRef.current = input.role;
      setPendingRole(input.role);
      setSelectionIssue(null);

      try {
        if (!(await beforeMutationRef.current())) {
          if (mountedRef.current && projectRef.current?.id === origin.id) setSelectionIssue('save_blocked');
          return false;
        }
        if (!mountedRef.current || projectRef.current?.id !== origin.id) return false;
        const current = projectRef.current;
        const result = await ipcBridge.creativeStudio.updateModelSelection.invoke({
          projectId: current.id,
          expectedRevision: current.revision,
          role: input.role,
          selection: input.selection,
        });
        if (!mountedRef.current || projectRef.current?.id !== origin.id) return false;
        if (result.ok === false) {
          if (result.error.code === 'stale_project') {
            const canonical = await refetchRef.current();
            if (!mountedRef.current || projectRef.current?.id !== origin.id) return false;
            if (canonical?.id === origin.id) projectRef.current = canonical;
            await refresh();
            if (mountedRef.current && projectRef.current?.id === origin.id) setSelectionIssue('save_stale');
          } else if (mountedRef.current) {
            setSelectionIssue('save_failed');
          }
          return false;
        }

        const canonical = await refetchRef.current();
        if (!mountedRef.current || projectRef.current?.id !== origin.id) return false;
        if (canonical?.id === origin.id) projectRef.current = canonical;
        await refresh();
        if (mountedRef.current && projectRef.current?.id === origin.id) setSelectionIssue(null);
        return true;
      } catch {
        if (mountedRef.current && projectRef.current?.id === origin.id) setSelectionIssue('save_failed');
        return false;
      } finally {
        pendingRoleRef.current = null;
        if (mountedRef.current) setPendingRole(null);
      }
    },
    [refresh]
  );

  const adoptions = useMemo(() => resolveSoleRouteAdoptions(catalog), [catalog]);
  const projectId = project?.id ?? null;

  /**
   * Persists each unambiguous route through the same CAS command a person
   * would use. Candidates are claimed before the first await and run in
   * sequence, because the command admits one mutation at a time; claiming them
   * up front also caps every candidate at one attempt per mount, so a refused
   * adoption stops there instead of retrying against each catalog refresh.
   */
  useEffect(() => {
    if (!autoSelectSoleRoute || projectId === null || pendingRole !== null) return;
    const claimed = adoptions.filter((candidate) => {
      const key = adoptionKey(projectId, candidate);
      if (attemptedAdoptionsRef.current.has(key)) return false;
      attemptedAdoptionsRef.current.add(key);
      return true;
    });
    if (claimed.length === 0) return;
    void (async () => {
      for (const adoption of claimed) {
        await updateSelection({ role: adoption.role, selection: { choiceId: adoption.choiceId } });
      }
    })();
  }, [adoptions, autoSelectSoleRoute, pendingRole, projectId, updateSelection]);

  return {
    get catalog() {
      return catalogRef.current;
    },
    loading,
    errorMessageKey,
    selectionIssue,
    pendingRole,
    refresh,
    updateSelection,
  };
};
