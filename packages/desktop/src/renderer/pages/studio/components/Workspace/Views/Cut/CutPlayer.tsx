/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';
import type { WorkspaceProjection } from '../../workspaceProjection';
import {
  buildCutPlaybackSequence,
  cutPlaybackBeatJoins,
  formatCutPlaybackClock,
  resolveCutPlaybackLocation,
  type CutPlaybackSegment,
  type CutPlaybackSequence,
  type CutPlaybackVideoSegment,
  cutPlaybackShotsAwaitingTake,
} from './playbackSequence';
import styles from './Cut.module.css';

const PREVIEW_ROOT = 'conversation.creativeStudio.workspace.cut.preview';
const MEDIA_DURATION_EPSILON_SECONDS = 0.001;
const SLATE_CLOCK_INTERVAL_MS = 100;

export type CutPlayerProps = {
  onNavigationChange?: (navigation: CutPlaybackNavigation) => void;
  pending: boolean;
  projectId: string;
  projection: WorkspaceProjection;
};

export type CutPlaybackNavigation = {
  available: boolean;
  beatId: string | null;
  beatPosition: number | null;
  beatTitle: string | null;
  buffering: boolean;
  canStepNextJoin: boolean;
  canStepPreviousJoin: boolean;
  durationSeconds: number;
  failed: boolean;
  joinCount: number;
  loopJoinIndex: number | null;
  playing: boolean;
  positionSeconds: number;
};

export type CutPlayerHandle = {
  nudge: (deltaSeconds: number) => void;
  seek: (positionSeconds: number) => void;
  stepJoin: (direction: -1 | 1) => void;
  toggleJoinLoop: () => void;
  togglePlayback: () => void;
};

export const EMPTY_CUT_PLAYBACK_NAVIGATION: CutPlaybackNavigation = {
  available: false,
  beatId: null,
  beatPosition: null,
  beatTitle: null,
  buffering: false,
  canStepNextJoin: false,
  canStepPreviousJoin: false,
  durationSeconds: 0,
  failed: false,
  joinCount: 0,
  loopJoinIndex: null,
  playing: false,
  positionSeconds: 0,
};

type TransportState = {
  token: string;
  segmentIndex: number;
  mediaEpoch: number;
  positionSeconds: number;
  playing: boolean;
  buffering: boolean;
  failed: boolean;
  loopJoinIndex: number | null;
  slateEpoch: number;
};

type ReadyMedia = {
  token: string;
  segmentIndex: number;
  media: HTMLVideoElement;
};

type PendingMediaSeek = ReadyMedia & {
  sourceTimeSeconds: number;
};

type SlateClock = {
  token: string;
  segmentIndex: number;
  startPositionSeconds: number;
  startedAt: number;
};

type PlayAttempt = {
  id: number;
  token: string;
  segmentIndex: number;
  media: HTMLVideoElement;
};

type MediaBoundaryWatch = {
  token: string;
  segmentIndex: number;
  media: HTMLVideoElement;
  frameRequestId: number | null;
  timerId: number | null;
};

const initialTransportState = (token: string): TransportState => ({
  token,
  segmentIndex: 0,
  mediaEpoch: 0,
  positionSeconds: 0,
  playing: false,
  buffering: false,
  failed: false,
  loopJoinIndex: null,
  slateEpoch: 0,
});

const pauseMedia = (media: HTMLMediaElement | null): void => {
  if (media === null) return;
  try {
    media.pause();
  } catch {
    // A detached or failed native media element may reject pause. Reset still proceeds.
  }
};

const paddedPosition = (position: number): string => String(position).padStart(2, '0');

const beatTitle = (segment: CutPlaybackSegment): string => segment.beatTitle.trim() || segment.beatId;

const cutJoinLandingIndexes = (
  joins: readonly number[],
  positionSeconds: number
): { next: number | null; previous: number | null } => {
  let previous: number | null = null;
  let next: number | null = null;
  for (let index = 0; index < joins.length; index += 1) {
    const landingSeconds = Math.max(0, joins[index]! - 1.5);
    if (landingSeconds < positionSeconds - MEDIA_DURATION_EPSILON_SECONDS) previous = index;
    else if (next === null && landingSeconds > positionSeconds + MEDIA_DURATION_EPSILON_SECONDS) next = index;
  }
  return { next, previous };
};

/** A truthful picture-only preview of the exact selected-Take/slate sequence. */
export const CutPlayer = forwardRef<CutPlayerHandle, CutPlayerProps>(function CutPlayer(
  { onNavigationChange, pending, projectId, projection },
  ref
) {
  const { t } = useTranslation();
  const candidate = useMemo(() => buildCutPlaybackSequence(projection), [projection]);
  const sequence = candidate !== null && candidate.projectId === projectId ? candidate : null;
  const planToken = useMemo(() => JSON.stringify({ pending, projectId, sequence }), [pending, projectId, sequence]);
  const activeTokenRef = useRef(planToken);

  const [storedState, setStoredState] = useState<TransportState>(() => initialTransportState(planToken));
  const state = storedState.token === planToken ? storedState : initialTransportState(planToken);
  const stateRef = useRef(state);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playingMediaRef = useRef<HTMLVideoElement | null>(null);
  const readyMediaRef = useRef<ReadyMedia | null>(null);
  const pendingMediaSeekRef = useRef<PendingMediaSeek | null>(null);
  const slateClockRef = useRef<SlateClock | null>(null);
  const playAttemptIdRef = useRef(0);
  const playAttemptRef = useRef<PlayAttempt | null>(null);
  const mediaBoundaryWatchRef = useRef<MediaBoundaryWatch | null>(null);
  const appliedPlanTokenRef = useRef(planToken);

  const segment = sequence?.segments[state.segmentIndex] ?? null;
  const beatJoins = useMemo(() => (sequence === null ? [] : cutPlaybackBeatJoins(sequence)), [sequence]);

  useLayoutEffect(() => {
    activeTokenRef.current = planToken;
    stateRef.current = state;
  }, [planToken, state]);

  const invalidatePlayAttempt = useCallback((): void => {
    playAttemptIdRef.current += 1;
    playAttemptRef.current = null;
  }, []);

  const stopMediaBoundaryWatch = useCallback((): void => {
    const watch = mediaBoundaryWatchRef.current;
    if (watch === null) return;
    mediaBoundaryWatchRef.current = null;
    if (watch.frameRequestId !== null && typeof watch.media.cancelVideoFrameCallback === 'function') {
      try {
        watch.media.cancelVideoFrameCallback(watch.frameRequestId);
      } catch {
        // A detached native media element may already have discarded its callback queue.
      }
    }
    if (watch.timerId !== null) window.clearTimeout(watch.timerId);
  }, []);

  const updateCurrentState = useCallback(
    (token: string, segmentIndex: number, update: (current: TransportState) => TransportState): void => {
      setStoredState((previous) => {
        if (activeTokenRef.current !== token || previous.token !== token || previous.segmentIndex !== segmentIndex) {
          return previous;
        }
        const next = update(previous);
        stateRef.current = next;
        return next;
      });
    },
    []
  );

  const replaceCurrentState = useCallback(
    (token: string, update: (current: TransportState) => TransportState): void => {
      setStoredState((previous) => {
        if (activeTokenRef.current !== token || previous.token !== token) return previous;
        const next = update(previous);
        stateRef.current = next;
        return next;
      });
    },
    []
  );

  const isCurrentMedia = useCallback((token: string, segmentIndex: number, media: HTMLVideoElement): boolean => {
    const current = stateRef.current;
    return (
      activeTokenRef.current === token &&
      current.token === token &&
      current.segmentIndex === segmentIndex &&
      videoRef.current === media
    );
  }, []);

  const setVideoNode = useCallback(
    (node: HTMLVideoElement | null): void => {
      const previous = videoRef.current;
      if (previous !== null && previous !== node) {
        if (mediaBoundaryWatchRef.current?.media === previous) stopMediaBoundaryWatch();
        if (playingMediaRef.current === previous) pauseMedia(previous);
        if (playingMediaRef.current === previous) playingMediaRef.current = null;
        if (readyMediaRef.current?.media === previous) readyMediaRef.current = null;
        if (pendingMediaSeekRef.current?.media === previous) pendingMediaSeekRef.current = null;
        if (playAttemptRef.current?.media === previous) {
          playAttemptIdRef.current += 1;
          playAttemptRef.current = null;
        }
      }
      videoRef.current = node;
    },
    [stopMediaBoundaryWatch]
  );

  const failMedia = useCallback(
    (token: string, segmentIndex: number, media: HTMLVideoElement): void => {
      if (!isCurrentMedia(token, segmentIndex, media)) return;
      stopMediaBoundaryWatch();
      invalidatePlayAttempt();
      pauseMedia(media);
      if (playingMediaRef.current === media) playingMediaRef.current = null;
      readyMediaRef.current = null;
      pendingMediaSeekRef.current = null;
      updateCurrentState(token, segmentIndex, (current) => ({
        ...current,
        playing: false,
        buffering: false,
        failed: true,
      }));
    },
    [invalidatePlayAttempt, isCurrentMedia, stopMediaBoundaryWatch, updateCurrentState]
  );

  const playMedia = useCallback(
    (token: string, segmentIndex: number, media: HTMLVideoElement): void => {
      const ready = readyMediaRef.current;
      if (
        !isCurrentMedia(token, segmentIndex, media) ||
        stateRef.current.failed ||
        ready?.token !== token ||
        ready.segmentIndex !== segmentIndex ||
        ready.media !== media
      ) {
        return;
      }
      const attempt: PlayAttempt = {
        id: playAttemptIdRef.current + 1,
        token,
        segmentIndex,
        media,
      };
      playAttemptIdRef.current = attempt.id;
      playAttemptRef.current = attempt;
      playingMediaRef.current = media;
      let request: Promise<void> | undefined;
      try {
        request = media.play();
      } catch {
        if (playAttemptRef.current === attempt) failMedia(token, segmentIndex, media);
        return;
      }
      void Promise.resolve(request).then(
        () => {
          if (playAttemptRef.current === attempt) playAttemptRef.current = null;
        },
        () => {
          const current = stateRef.current;
          if (playAttemptRef.current === attempt && current.playing && isCurrentMedia(token, segmentIndex, media)) {
            failMedia(token, segmentIndex, media);
          }
        }
      );
    },
    [failMedia, isCurrentMedia]
  );

  const seekTo = useCallback(
    (requestedSeconds: number, loopJoinIndex?: number | null): void => {
      const currentSequence = sequence;
      const activeState = stateRef.current;
      if (
        currentSequence === null ||
        pending ||
        activeState.failed ||
        activeState.token !== planToken ||
        activeTokenRef.current !== planToken
      ) {
        return;
      }
      const location = resolveCutPlaybackLocation(currentSequence, requestedSeconds);
      if (location === null) return;
      const target = currentSequence.segments[location.segmentIndex];
      if (target === undefined) return;

      stopMediaBoundaryWatch();
      invalidatePlayAttempt();
      pauseMedia(videoRef.current);
      playingMediaRef.current = null;
      readyMediaRef.current = null;
      pendingMediaSeekRef.current = null;
      slateClockRef.current = null;
      replaceCurrentState(planToken, (current) => ({
        ...current,
        buffering: target.kind === 'video',
        loopJoinIndex: loopJoinIndex === undefined ? current.loopJoinIndex : loopJoinIndex,
        mediaEpoch: current.mediaEpoch + (target.kind === 'video' ? 1 : 0),
        playing: location.positionSeconds < currentSequence.durationSeconds && current.playing,
        positionSeconds: location.positionSeconds,
        segmentIndex: location.segmentIndex,
        slateEpoch: current.slateEpoch + 1,
      }));
    },
    [invalidatePlayAttempt, pending, planToken, replaceCurrentState, sequence, stopMediaBoundaryWatch]
  );

  const loopRange = useCallback(
    (current: TransportState): { endSeconds: number; startSeconds: number } | null => {
      if (sequence === null || current.loopJoinIndex === null) return null;
      const join = beatJoins[current.loopJoinIndex];
      if (join === undefined) return null;
      return {
        startSeconds: Math.max(0, join - 2),
        endSeconds: Math.min(sequence.durationSeconds, join + 2),
      };
    },
    [beatJoins, sequence]
  );

  const advanceSegment = useCallback(
    (token: string, segmentIndex: number, currentSequence: CutPlaybackSequence): void => {
      const activeState = stateRef.current;
      if (
        activeTokenRef.current !== token ||
        activeState.token !== token ||
        activeState.segmentIndex !== segmentIndex ||
        !activeState.playing ||
        activeState.failed
      ) {
        return;
      }
      stopMediaBoundaryWatch();
      invalidatePlayAttempt();
      const completed = currentSequence.segments[segmentIndex];
      const activeLoop = loopRange(activeState);
      if (completed !== undefined && activeLoop !== null && completed.filmEndSeconds >= activeLoop.endSeconds) {
        seekTo(activeLoop.startSeconds);
        return;
      }
      updateCurrentState(token, segmentIndex, (current) => {
        if (completed === undefined) return current;
        const nextIndex = segmentIndex + 1;
        if (nextIndex >= currentSequence.segments.length) {
          return {
            ...current,
            positionSeconds: currentSequence.durationSeconds,
            playing: false,
            buffering: false,
          };
        }
        readyMediaRef.current = null;
        pendingMediaSeekRef.current = null;
        return {
          ...current,
          segmentIndex: nextIndex,
          positionSeconds: completed.filmEndSeconds,
          buffering: false,
        };
      });
    },
    [invalidatePlayAttempt, loopRange, seekTo, stopMediaBoundaryWatch, updateCurrentState]
  );

  const startMediaBoundaryWatch = useCallback(
    (
      token: string,
      segmentIndex: number,
      media: HTMLVideoElement,
      videoSegment: CutPlaybackVideoSegment,
      currentSequence: CutPlaybackSequence
    ): void => {
      stopMediaBoundaryWatch();
      const watch: MediaBoundaryWatch = {
        token,
        segmentIndex,
        media,
        frameRequestId: null,
        timerId: null,
      };
      const ready = readyMediaRef.current;
      if (ready?.token !== token || ready.segmentIndex !== segmentIndex || ready.media !== media) return;
      mediaBoundaryWatchRef.current = watch;

      const schedule = (): void => {
        if (mediaBoundaryWatchRef.current !== watch) return;
        if (typeof media.requestVideoFrameCallback === 'function') {
          try {
            watch.frameRequestId = media.requestVideoFrameCallback((_now, metadata) => {
              watch.frameRequestId = null;
              checkBoundary(metadata.mediaTime);
            });
            return;
          } catch {
            watch.frameRequestId = null;
          }
        }
        watch.timerId = window.setTimeout(() => {
          watch.timerId = null;
          checkBoundary(media.currentTime);
        }, 16);
      };

      const checkBoundary = (frameTime: number): void => {
        const current = stateRef.current;
        if (mediaBoundaryWatchRef.current !== watch) return;
        if (
          !isCurrentMedia(token, segmentIndex, media) ||
          readyMediaRef.current?.media !== media ||
          !current.playing ||
          current.buffering ||
          current.failed
        ) {
          stopMediaBoundaryWatch();
          return;
        }
        const observedTime = Number.isFinite(frameTime) ? frameTime : media.currentTime;
        if (!Number.isFinite(observedTime)) {
          failMedia(token, segmentIndex, media);
          return;
        }
        if (observedTime >= videoSegment.sourceOutSeconds) {
          stopMediaBoundaryWatch();
          pauseMedia(media);
          if (playingMediaRef.current === media) playingMediaRef.current = null;
          advanceSegment(token, segmentIndex, currentSequence);
          return;
        }
        const segmentProgress = Math.max(0, observedTime - videoSegment.sourceInSeconds);
        const nextPosition = Math.min(videoSegment.filmEndSeconds, videoSegment.filmStartSeconds + segmentProgress);
        const activeLoop = loopRange(current);
        if (activeLoop !== null && nextPosition >= activeLoop.endSeconds) {
          stopMediaBoundaryWatch();
          pauseMedia(media);
          if (playingMediaRef.current === media) playingMediaRef.current = null;
          seekTo(activeLoop.startSeconds);
          return;
        }
        updateCurrentState(token, segmentIndex, (latest) => ({ ...latest, positionSeconds: nextPosition }));
        schedule();
      };

      schedule();
    },
    [advanceSegment, failMedia, isCurrentMedia, loopRange, seekTo, stopMediaBoundaryWatch, updateCurrentState]
  );

  useLayoutEffect(() => {
    if (appliedPlanTokenRef.current === planToken) return;
    appliedPlanTokenRef.current = planToken;
    invalidatePlayAttempt();
    stopMediaBoundaryWatch();
    pauseMedia(playingMediaRef.current);
    playingMediaRef.current = null;
    readyMediaRef.current = null;
    pendingMediaSeekRef.current = null;
    const reset = initialTransportState(planToken);
    stateRef.current = reset;
    setStoredState(reset);
  }, [invalidatePlayAttempt, planToken, stopMediaBoundaryWatch]);

  useEffect(() => {
    if (
      sequence === null ||
      segment?.kind !== 'slate' ||
      !state.playing ||
      state.failed ||
      state.buffering ||
      pending
    ) {
      return;
    }
    const token = planToken;
    const segmentIndex = state.segmentIndex;
    const startPosition = state.positionSeconds;
    const startedAt = performance.now();
    const slateClock: SlateClock = {
      token,
      segmentIndex,
      startPositionSeconds: startPosition,
      startedAt,
    };
    slateClockRef.current = slateClock;
    const timer = window.setInterval(() => {
      const activeState = stateRef.current;
      if (
        slateClockRef.current !== slateClock ||
        activeState.token !== token ||
        activeState.segmentIndex !== segmentIndex ||
        !activeState.playing ||
        activeState.buffering ||
        activeState.failed
      ) {
        return;
      }
      const elapsedSeconds = Math.max(0, (performance.now() - startedAt) / 1_000);
      const nextPosition = Math.min(segment.filmEndSeconds, startPosition + elapsedSeconds);
      const activeLoop = loopRange(activeState);
      if (activeLoop !== null && nextPosition >= activeLoop.endSeconds) {
        window.clearInterval(timer);
        if (slateClockRef.current === slateClock) slateClockRef.current = null;
        seekTo(activeLoop.startSeconds);
        return;
      }
      if (nextPosition >= segment.filmEndSeconds) {
        window.clearInterval(timer);
        if (slateClockRef.current === slateClock) slateClockRef.current = null;
        advanceSegment(token, segmentIndex, sequence);
        return;
      }
      updateCurrentState(token, segmentIndex, (current) => ({
        ...current,
        positionSeconds: nextPosition,
      }));
    }, SLATE_CLOCK_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      if (slateClockRef.current === slateClock) slateClockRef.current = null;
    };
  }, [
    advanceSegment,
    pending,
    planToken,
    loopRange,
    seekTo,
    segment,
    sequence,
    state.buffering,
    state.failed,
    state.playing,
    state.segmentIndex,
    state.slateEpoch,
    updateCurrentState,
  ]);

  const onLoadedMetadata = (media: HTMLVideoElement, videoSegment: CutPlaybackVideoSegment): void => {
    const token = planToken;
    const segmentIndex = state.segmentIndex;
    if (!isCurrentMedia(token, segmentIndex, media) || stateRef.current.failed) return;
    if (
      !Number.isFinite(media.duration) ||
      media.duration <= 0 ||
      media.duration + MEDIA_DURATION_EPSILON_SECONDS < videoSegment.sourceOutSeconds
    ) {
      failMedia(token, segmentIndex, media);
      return;
    }
    readyMediaRef.current = null;
    pendingMediaSeekRef.current = null;
    const activeState = stateRef.current;
    const sourceTimeSeconds = Math.min(
      videoSegment.sourceOutSeconds,
      videoSegment.sourceInSeconds + Math.max(0, activeState.positionSeconds - videoSegment.filmStartSeconds)
    );
    try {
      media.currentTime = sourceTimeSeconds;
    } catch {
      failMedia(token, segmentIndex, media);
      return;
    }
    const pendingSeek: PendingMediaSeek = {
      token,
      segmentIndex,
      media,
      sourceTimeSeconds,
    };
    pendingMediaSeekRef.current = pendingSeek;
    if (!media.seeking) {
      if (
        !Number.isFinite(media.currentTime) ||
        Math.abs(media.currentTime - sourceTimeSeconds) > MEDIA_DURATION_EPSILON_SECONDS
      ) {
        failMedia(token, segmentIndex, media);
        return;
      }
      pendingMediaSeekRef.current = null;
      readyMediaRef.current = { token, segmentIndex, media };
      updateCurrentState(token, segmentIndex, (current) => ({ ...current, buffering: false }));
      if (stateRef.current.playing) playMedia(token, segmentIndex, media);
    }
  };

  const onSeeked = (media: HTMLVideoElement): void => {
    const pendingSeek = pendingMediaSeekRef.current;
    if (
      pendingSeek === null ||
      pendingSeek.media !== media ||
      !isCurrentMedia(pendingSeek.token, pendingSeek.segmentIndex, media) ||
      stateRef.current.failed ||
      media.seeking
    ) {
      return;
    }
    if (
      !Number.isFinite(media.currentTime) ||
      Math.abs(media.currentTime - pendingSeek.sourceTimeSeconds) > MEDIA_DURATION_EPSILON_SECONDS
    ) {
      failMedia(pendingSeek.token, pendingSeek.segmentIndex, media);
      return;
    }
    pendingMediaSeekRef.current = null;
    readyMediaRef.current = {
      token: pendingSeek.token,
      segmentIndex: pendingSeek.segmentIndex,
      media,
    };
    updateCurrentState(pendingSeek.token, pendingSeek.segmentIndex, (current) => ({ ...current, buffering: false }));
    if (stateRef.current.playing) playMedia(pendingSeek.token, pendingSeek.segmentIndex, media);
  };

  const onTimeUpdate = (media: HTMLVideoElement, videoSegment: CutPlaybackVideoSegment): void => {
    const token = planToken;
    const segmentIndex = state.segmentIndex;
    const current = stateRef.current;
    const ready = readyMediaRef.current;
    if (
      !isCurrentMedia(token, segmentIndex, media) ||
      ready?.token !== token ||
      ready.segmentIndex !== segmentIndex ||
      ready.media !== media ||
      !current.playing ||
      current.buffering ||
      !Number.isFinite(media.currentTime)
    ) {
      return;
    }
    if (media.currentTime >= videoSegment.sourceOutSeconds) {
      stopMediaBoundaryWatch();
      pauseMedia(media);
      if (playingMediaRef.current === media) playingMediaRef.current = null;
      if (sequence !== null) advanceSegment(token, segmentIndex, sequence);
      return;
    }
    const segmentProgress = Math.max(0, media.currentTime - videoSegment.sourceInSeconds);
    const nextPosition = Math.min(videoSegment.filmEndSeconds, videoSegment.filmStartSeconds + segmentProgress);
    const activeLoop = loopRange(current);
    if (activeLoop !== null && nextPosition >= activeLoop.endSeconds) {
      stopMediaBoundaryWatch();
      pauseMedia(media);
      if (playingMediaRef.current === media) playingMediaRef.current = null;
      seekTo(activeLoop.startSeconds);
      return;
    }
    updateCurrentState(token, segmentIndex, (latest) => ({
      ...latest,
      positionSeconds: nextPosition,
    }));
  };

  const onEnded = (media: HTMLVideoElement, videoSegment: CutPlaybackVideoSegment): void => {
    const token = planToken;
    const segmentIndex = state.segmentIndex;
    const current = stateRef.current;
    const ready = readyMediaRef.current;
    if (
      !isCurrentMedia(token, segmentIndex, media) ||
      ready?.token !== token ||
      ready.segmentIndex !== segmentIndex ||
      ready.media !== media ||
      !current.playing ||
      current.failed ||
      !Number.isFinite(media.currentTime)
    ) {
      return;
    }
    if (media.currentTime + MEDIA_DURATION_EPSILON_SECONDS < videoSegment.sourceOutSeconds) {
      failMedia(token, segmentIndex, media);
      return;
    }
    if (sequence !== null) advanceSegment(token, segmentIndex, sequence);
  };

  const togglePlayback = (): void => {
    if (sequence === null || segment === null || pending || state.failed) return;
    const token = planToken;
    const segmentIndex = state.segmentIndex;
    if (state.playing) {
      invalidatePlayAttempt();
      stopMediaBoundaryWatch();
      pauseMedia(videoRef.current);
      playingMediaRef.current = null;
      const slateClock = slateClockRef.current;
      const pausedPosition =
        segment.kind === 'slate' && slateClock?.token === token && slateClock.segmentIndex === segmentIndex
          ? Math.min(
              segment.filmEndSeconds,
              slateClock.startPositionSeconds + Math.max(0, (performance.now() - slateClock.startedAt) / 1_000)
            )
          : segment.kind === 'video' &&
              !state.buffering &&
              videoRef.current !== null &&
              Number.isFinite(videoRef.current.currentTime)
            ? Math.min(
                segment.filmEndSeconds,
                segment.filmStartSeconds + Math.max(0, videoRef.current.currentTime - segment.sourceInSeconds)
              )
            : state.positionSeconds;
      slateClockRef.current = null;
      updateCurrentState(token, segmentIndex, (current) => ({
        ...current,
        positionSeconds: pausedPosition,
        playing: false,
        buffering: false,
      }));
      return;
    }
    if (state.positionSeconds >= sequence.durationSeconds) {
      invalidatePlayAttempt();
      readyMediaRef.current = null;
      pendingMediaSeekRef.current = null;
      updateCurrentState(token, segmentIndex, (current) => ({
        ...current,
        segmentIndex: 0,
        mediaEpoch: current.mediaEpoch + 1,
        positionSeconds: 0,
        playing: true,
        buffering: false,
      }));
      return;
    }
    updateCurrentState(token, segmentIndex, (current) => ({
      ...current,
      playing: true,
      buffering: current.buffering,
    }));
    const ready = readyMediaRef.current;
    if (
      segment.kind === 'video' &&
      ready?.token === token &&
      ready.segmentIndex === segmentIndex &&
      ready.media === videoRef.current
    ) {
      playMedia(token, segmentIndex, ready.media);
    }
  };

  const nudge = (deltaSeconds: number): void => {
    if (!Number.isFinite(deltaSeconds)) return;
    seekTo(stateRef.current.positionSeconds + deltaSeconds);
  };

  const stepJoin = (direction: -1 | 1): void => {
    if (beatJoins.length === 0) return;
    const indexes = cutJoinLandingIndexes(beatJoins, stateRef.current.positionSeconds);
    const targetIndex = direction > 0 ? indexes.next : indexes.previous;
    if (targetIndex === null) return;
    const join = beatJoins[targetIndex];
    if (join === undefined) return;
    seekTo(Math.max(0, join - 1.5), stateRef.current.loopJoinIndex === null ? undefined : targetIndex);
  };

  const toggleJoinLoop = (): void => {
    if (beatJoins.length === 0) return;
    const current = stateRef.current;
    if (current.loopJoinIndex !== null) {
      replaceCurrentState(planToken, (latest) => ({ ...latest, loopJoinIndex: null }));
      return;
    }
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < beatJoins.length; index += 1) {
      const distance = Math.abs(beatJoins[index]! - current.positionSeconds);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    seekTo(Math.max(0, beatJoins[nearestIndex]! - 2), nearestIndex);
  };

  useImperativeHandle(ref, () => ({
    nudge,
    seek: seekTo,
    stepJoin,
    toggleJoinLoop,
    togglePlayback,
  }));

  useEffect(() => {
    const joinLandingIndexes = cutJoinLandingIndexes(beatJoins, state.positionSeconds);
    onNavigationChange?.({
      available: sequence !== null && segment !== null && !pending,
      beatId: segment?.beatId ?? null,
      beatPosition: segment?.beatPosition ?? null,
      beatTitle: segment === null ? null : beatTitle(segment),
      buffering: state.buffering,
      canStepNextJoin: joinLandingIndexes.next !== null,
      canStepPreviousJoin: joinLandingIndexes.previous !== null,
      durationSeconds: sequence?.durationSeconds ?? 0,
      failed: state.failed,
      joinCount: beatJoins.length,
      loopJoinIndex: state.loopJoinIndex,
      playing: state.playing,
      positionSeconds: state.positionSeconds,
    });
  }, [beatJoins.length, onNavigationChange, pending, segment, sequence, state]);

  const totalClock = formatCutPlaybackClock(sequence?.durationSeconds ?? 0, sequence?.durationSeconds ?? 0) ?? '0:00';
  const currentClock = formatCutPlaybackClock(state.positionSeconds, sequence?.durationSeconds ?? 0) ?? '0:00';
  const positionCopy = t(`${PREVIEW_ROOT}.position`, { current: currentClock, total: totalClock });
  const segmentCopy =
    segment === null
      ? ''
      : segment.kind === 'video'
        ? t(`${PREVIEW_ROOT}.videoLabel`, {
            beatPosition: paddedPosition(segment.beatPosition),
            beatTitle: beatTitle(segment),
            shotPosition: paddedPosition(segment.shotPosition),
            shotTitle: segment.shotTitle,
          })
        : t(`${PREVIEW_ROOT}.slateLabel`, {
            beatPosition: paddedPosition(segment.beatPosition),
            beatTitle: beatTitle(segment),
          });
  const transitionCopy = state.failed ? t(`${PREVIEW_ROOT}.mediaError`) : segmentCopy;

  const mediaSource =
    sequence !== null && segment?.kind === 'video'
      ? createManagedStudioAssetUrl(sequence.projectId, segment.assetId)
      : null;
  const posterSource =
    sequence !== null && segment?.kind === 'video' && segment.posterAssetId !== null
      ? createManagedStudioAssetUrl(sequence.projectId, segment.posterAssetId)
      : null;
  const unavailable = sequence === null || segment === null || (segment.kind === 'video' && mediaSource === null);
  const buttonLabel = state.playing ? t(`${PREVIEW_ROOT}.pause`) : t(`${PREVIEW_ROOT}.play`);
  // A refusal with no stated reason is the same dead end whether the cause is a fault or a choice
  // nobody was asked to make. Only the latter is actionable, so only the latter is named.
  const awaitingTake = unavailable ? cutPlaybackShotsAwaitingTake(projection) : [];
  const unavailableReason =
    awaitingTake.length === 1
      ? t(`${PREVIEW_ROOT}.awaitingTakeOne`, {
          beatPosition: awaitingTake[0]!.beatPosition,
          shotPosition: awaitingTake[0]!.shotPosition,
        })
      : awaitingTake.length > 1
        ? t(`${PREVIEW_ROOT}.awaitingTakeMany`, { count: awaitingTake.length })
        : t(`${PREVIEW_ROOT}.noMedia`);

  return (
    <>
      <div
        aria-label={t(`${PREVIEW_ROOT}.label`)}
        className={styles.preview}
        data-cut-preview
        data-playback-kind={unavailable ? 'empty' : segment.kind}
        role='region'
      >
        {unavailable ? (
          <p className={styles.previewUnavailable} data-cut-preview-media data-media-kind='empty'>
            {unavailableReason}
          </p>
        ) : (
          <>
            <span className={styles.previewBadge} data-cut-preview-badge>
              <bdi dir='auto'>
                {t(`${PREVIEW_ROOT}.beatBadge`, {
                  position: paddedPosition(segment.beatPosition),
                  title: beatTitle(segment),
                })}
              </bdi>
            </span>
            {segment.kind === 'video' ? (
              <>
                <video
                  key={`${planToken}:${state.segmentIndex}:${state.mediaEpoch}:${segment.assetId}`}
                  ref={setVideoNode}
                  aria-label={segmentCopy}
                  className={styles.previewMedia}
                  data-cut-preview-media
                  data-media-kind='video'
                  muted
                  playsInline
                  poster={posterSource ?? undefined}
                  preload='metadata'
                  src={mediaSource ?? undefined}
                  tabIndex={-1}
                  onEnded={(event) => onEnded(event.currentTarget, segment)}
                  onError={(event) => failMedia(planToken, state.segmentIndex, event.currentTarget)}
                  onLoadedMetadata={(event) => onLoadedMetadata(event.currentTarget, segment)}
                  onPlaying={(event) => {
                    const media = event.currentTarget;
                    const token = planToken;
                    const segmentIndex = state.segmentIndex;
                    const current = stateRef.current;
                    const ready = readyMediaRef.current;
                    if (!isCurrentMedia(token, segmentIndex, media)) return;
                    if (
                      !current.playing ||
                      current.failed ||
                      ready?.token !== token ||
                      ready.segmentIndex !== segmentIndex ||
                      ready.media !== media
                    ) {
                      stopMediaBoundaryWatch();
                      pauseMedia(media);
                      if (playingMediaRef.current === media) playingMediaRef.current = null;
                      return;
                    }
                    updateCurrentState(token, segmentIndex, (latest) => ({ ...latest, buffering: false }));
                    if (sequence !== null) startMediaBoundaryWatch(token, segmentIndex, media, segment, sequence);
                  }}
                  onRateChange={(event) => {
                    const media = event.currentTarget;
                    const token = planToken;
                    const segmentIndex = state.segmentIndex;
                    const current = stateRef.current;
                    if (
                      sequence !== null &&
                      isCurrentMedia(token, segmentIndex, media) &&
                      current.playing &&
                      !current.buffering &&
                      !current.failed
                    ) {
                      startMediaBoundaryWatch(token, segmentIndex, media, segment, sequence);
                    }
                  }}
                  onSeeked={(event) => onSeeked(event.currentTarget)}
                  onTimeUpdate={(event) => onTimeUpdate(event.currentTarget, segment)}
                  onWaiting={(event) => {
                    const media = event.currentTarget;
                    const token = planToken;
                    const segmentIndex = state.segmentIndex;
                    const current = stateRef.current;
                    if (!isCurrentMedia(token, segmentIndex, media)) return;
                    stopMediaBoundaryWatch();
                    if (!current.playing || current.failed) return;
                    updateCurrentState(token, segmentIndex, (latest) => ({ ...latest, buffering: true }));
                  }}
                />
                {state.buffering ? (
                  <div className={styles.previewBuffering} data-cut-buffering role='status'>
                    {posterSource === null ? null : <img alt='' aria-hidden='true' src={posterSource} />}
                    <span>{t(`${PREVIEW_ROOT}.buffering`)}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <div
                aria-label={segmentCopy}
                className={styles.previewMedia}
                data-cut-preview-media
                data-media-kind='slate'
                role='img'
              >
                <strong>{t(`${PREVIEW_ROOT}.slate`)}</strong>
                <span>
                  {t(`${PREVIEW_ROOT}.slateHold`, {
                    clock:
                      formatCutPlaybackClock(segment.durationSeconds, segment.durationSeconds) ??
                      String(segment.durationSeconds),
                  })}
                </span>
              </div>
            )}
          </>
        )}
      </div>
      <div aria-label={t(`${PREVIEW_ROOT}.controlsLabel`)} className={styles.transport} data-cut-transport role='group'>
        <Button
          aria-disabled={state.failed ? true : undefined}
          aria-pressed={state.playing}
          className={styles.playButton}
          data-cut-play
          disabled={pending || unavailable}
          onClick={togglePlayback}
          type='primary'
        >
          {buttonLabel}
        </Button>
        <output aria-live='off' className={styles.transportTime} data-cut-time role='timer'>
          <bdi dir='auto'>{positionCopy}</bdi>
        </output>
        <span className={styles.pictureOnly}>{t(`${PREVIEW_ROOT}.pictureOnly`)}</span>
      </div>
      <p
        aria-atomic='true'
        aria-live='polite'
        className={state.failed ? styles.previewError : styles.srOnly}
        data-cut-preview-status
        role='status'
      >
        {transitionCopy}
      </p>
    </>
  );
});
