/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  StudioCommandErrorCode,
  StudioRenderErrorCode,
  StudioRenderProgressEvent,
} from '@/common/types/project/creativeStudioTypes';
import { useCallback, useEffect, useRef, useState } from 'react';

export type StudioRenderViewState = {
  status: 'idle' | StudioRenderProgressEvent['status'];
  progress: number;
  clipIndex: number | null;
  clipTotal: number | null;
  assetId: string | null;
  missingSceneIds: string[] | null;
  errorCode: StudioRenderErrorCode | null;
  errorMessageKey: string | null;
  busy: boolean;
};

export type UseStudioRenderResult = StudioRenderViewState & {
  render(): Promise<void>;
  cancel(): Promise<void>;
};

const RENDER_ERROR_MESSAGE_KEYS: Record<StudioRenderErrorCode, string> = {
  busy: 'conversation.creativeStudio.phase.review.render.errors.busy',
  ffmpeg_unavailable: 'conversation.creativeStudio.phase.review.render.errors.ffmpegUnavailable',
  render_failed: 'conversation.creativeStudio.phase.review.render.errors.failed',
  no_renderable_scenes: 'conversation.creativeStudio.phase.review.render.errors.noRenderableScenes',
  cancelled: 'conversation.creativeStudio.phase.review.render.errors.cancelled',
};

const idleState = (): StudioRenderViewState => ({
  status: 'idle',
  progress: 0,
  clipIndex: null,
  clipTotal: null,
  assetId: null,
  missingSceneIds: null,
  errorCode: null,
  errorMessageKey: null,
  busy: false,
});

const isRenderErrorCode = (code: StudioCommandErrorCode): code is StudioRenderErrorCode =>
  Object.hasOwn(RENDER_ERROR_MESSAGE_KEYS, code);

const clipProgressFromEvent = (
  event: Extract<StudioRenderProgressEvent, { status: 'running' | 'failed' }>
): Pick<StudioRenderViewState, 'clipIndex' | 'clipTotal'> => {
  const valid =
    Number.isSafeInteger(event.clipIndex) &&
    Number.isSafeInteger(event.clipTotal) &&
    event.clipIndex! > 0 &&
    event.clipTotal! > 0 &&
    event.clipIndex! <= event.clipTotal!;
  return valid ? { clipIndex: event.clipIndex!, clipTotal: event.clipTotal! } : { clipIndex: null, clipTotal: null };
};

const stateFromEvent = (event: StudioRenderProgressEvent): StudioRenderViewState => {
  switch (event.status) {
    case 'running':
      return {
        status: 'running',
        progress: event.progress,
        ...clipProgressFromEvent(event),
        assetId: null,
        missingSceneIds: null,
        errorCode: null,
        errorMessageKey: null,
        busy: false,
      };
    case 'succeeded':
      return {
        status: 'succeeded',
        progress: 1,
        clipIndex: null,
        clipTotal: null,
        assetId: event.assetId,
        missingSceneIds: [...event.missingSceneIds],
        errorCode: null,
        errorMessageKey: null,
        busy: false,
      };
    case 'failed':
      return {
        status: 'failed',
        progress: event.progress,
        ...clipProgressFromEvent(event),
        assetId: null,
        missingSceneIds: event.missingSceneIds === undefined ? null : [...event.missingSceneIds],
        errorCode: event.errorCode,
        errorMessageKey: RENDER_ERROR_MESSAGE_KEYS[event.errorCode],
        busy: false,
      };
    case 'cancelled':
      return {
        status: 'cancelled',
        progress: event.progress,
        clipIndex: null,
        clipTotal: null,
        assetId: null,
        missingSceneIds: [...event.missingSceneIds],
        errorCode: 'cancelled',
        errorMessageKey: RENDER_ERROR_MESSAGE_KEYS.cancelled,
        busy: false,
      };
  }
};

/**
 * Keeps one project's local render action synchronized with the terminal event stream.
 *
 * A cut render is a property of the document, not of the view that started it, so this hook is
 * mounted at project scope and its result is handed down. `projectId` is optional because the
 * project scope exists before a project id is known, and a hook cannot be called conditionally.
 */
export const useStudioRender = (projectId: string | undefined): UseStudioRenderResult => {
  const [state, setState] = useState<StudioRenderViewState>(idleState);
  const projectIdRef = useRef(projectId);
  const requestGenerationRef = useRef(0);
  const renderInFlightRef = useRef(false);
  projectIdRef.current = projectId;

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    renderInFlightRef.current = false;
    setState(idleState());
    const unsubscribe =
      projectId === undefined
        ? null
        : ipcBridge.creativeStudio.renderProgress.on((event) => {
            if (event.projectId !== projectId || requestGenerationRef.current !== generation) return;
            const next = stateFromEvent(event);
            setState(
              event.status === 'running' && !renderInFlightRef.current
                ? {
                    ...next,
                    errorCode: 'busy',
                    errorMessageKey: RENDER_ERROR_MESSAGE_KEYS.busy,
                    busy: true,
                  }
                : next
            );
          });
    return () => {
      if (requestGenerationRef.current === generation) requestGenerationRef.current += 1;
      unsubscribe?.();
    };
  }, [projectId]);

  const render = useCallback(async (): Promise<void> => {
    if (projectId === undefined || renderInFlightRef.current) return;
    renderInFlightRef.current = true;
    const requestedProjectId = projectId;
    const generation = requestGenerationRef.current;
    setState({
      status: 'running',
      progress: 0,
      clipIndex: null,
      clipTotal: null,
      assetId: null,
      missingSceneIds: null,
      errorCode: null,
      errorMessageKey: null,
      busy: false,
    });
    try {
      const result = await ipcBridge.creativeStudio.renderCut.invoke({ projectId: requestedProjectId });
      if (projectIdRef.current !== requestedProjectId || requestGenerationRef.current !== generation) return;
      if (result.ok === true) {
        setState({
          status: 'succeeded',
          progress: 1,
          clipIndex: null,
          clipTotal: null,
          assetId: result.data.assetId,
          missingSceneIds: [...result.data.missingSceneIds],
          errorCode: null,
          errorMessageKey: null,
          busy: false,
        });
        return;
      }
      const errorMessageKey = isRenderErrorCode(result.error.code)
        ? RENDER_ERROR_MESSAGE_KEYS[result.error.code]
        : RENDER_ERROR_MESSAGE_KEYS.render_failed;
      setState((current) => ({
        ...current,
        status: result.error.code === 'cancelled' ? 'cancelled' : 'failed',
        assetId: null,
        errorCode: isRenderErrorCode(result.error.code) ? result.error.code : 'render_failed',
        errorMessageKey,
        busy: result.error.code === 'busy',
      }));
    } catch {
      if (projectIdRef.current !== requestedProjectId || requestGenerationRef.current !== generation) return;
      setState((current) => ({
        ...current,
        status: 'failed',
        assetId: null,
        errorCode: 'render_failed',
        errorMessageKey: RENDER_ERROR_MESSAGE_KEYS.render_failed,
        busy: false,
      }));
    } finally {
      if (projectIdRef.current === requestedProjectId && requestGenerationRef.current === generation) {
        renderInFlightRef.current = false;
      }
    }
  }, [projectId]);

  const cancel = useCallback(async (): Promise<void> => {
    if (projectId === undefined || !renderInFlightRef.current) return;
    try {
      const result = await ipcBridge.creativeStudio.cancelRender.invoke({ projectId });
      if (result.ok === false && projectIdRef.current === projectId) {
        setState((current) => ({
          ...current,
          status: 'failed',
          errorCode: 'render_failed',
          errorMessageKey: RENDER_ERROR_MESSAGE_KEYS.render_failed,
          busy: false,
        }));
      }
    } catch {
      if (projectIdRef.current === projectId) {
        setState((current) => ({
          ...current,
          status: 'failed',
          errorCode: 'render_failed',
          errorMessageKey: RENDER_ERROR_MESSAGE_KEYS.render_failed,
          busy: false,
        }));
      }
    }
  }, [projectId]);

  return { ...state, render, cancel };
};
