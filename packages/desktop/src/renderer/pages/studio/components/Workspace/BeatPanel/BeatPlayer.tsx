/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

import type { WorkspaceBeatProjection, WorkspaceProjection } from '../workspaceProjection';
import styles from './BeatPanel.module.css';
import {
  beatPlaybackJoins,
  buildBeatPlaybackSequence,
  formatBeatPlaybackClock,
  resolveBeatPlaybackLocation,
  type BeatPlaybackSequence,
  type BeatPlaybackVideoSegment,
} from './beatPlaybackSequence';

const PREVIEW_ROOT = 'conversation.creativeStudio.workspace.beatPanel.preview';
const JOIN_PREROLL_SECONDS = 1.5;
const JOIN_LOOP_RADIUS_SECONDS = 2;
const MEDIA_DURATION_EPSILON_SECONDS = 0.001;
const SLATE_CLOCK_INTERVAL_MS = 50;

export type BeatPlaybackControl = {
  available: boolean;
  durationSeconds: number;
  positionSeconds: number;
  onSeek: (positionSeconds: number) => void;
};

export type BeatPlayerProps = {
  beat: WorkspaceBeatProjection;
  children: (playback: BeatPlaybackControl) => React.ReactNode;
  inspector?: React.ReactNode;
  projectId: string;
  projection: WorkspaceProjection;
};

type TransportState = {
  token: string;
  segmentIndex: number;
  mediaEpoch: number;
  clockEpoch: number;
  positionSeconds: number;
  playing: boolean;
  buffering: boolean;
  seeking: boolean;
  failed: boolean;
  joinCursorIndex: number | null;
  loopJoinIndex: number | null;
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

type PlayAttempt = ReadyMedia & {
  id: number;
};

type MediaBoundaryWatch = ReadyMedia & {
  frameRequestId: number | null;
  timerId: number | null;
};

type PrewarmTarget = {
  token: string;
  segmentIndex: number;
  assetId: string;
  source: string;
};

const initialTransportState = (token: string): TransportState => ({
  token,
  segmentIndex: 0,
  mediaEpoch: 0,
  clockEpoch: 0,
  positionSeconds: 0,
  playing: false,
  buffering: false,
  seeking: false,
  failed: false,
  joinCursorIndex: null,
  loopJoinIndex: null,
});

const pauseMedia = (media: HTMLMediaElement | null): void => {
  if (media === null) return;
  try {
    media.pause();
  } catch {
    // Detached and failed native media can reject pause; transport invalidation still proceeds.
  }
};

const paddedPosition = (position: number): string => String(position).padStart(2, '0');

const isEditableDescendant = (target: EventTarget | null, root: HTMLElement): boolean => {
  if (!(target instanceof Element) || target === root) return false;
  return (
    target.closest(
      'input, textarea, select, button, video[controls], audio[controls], [role="slider"], [contenteditable="true"]'
    ) !== null
  );
};

/** Owns truthful current-picture/slate playback and exposes a controlled Beat seek position. */
export const BeatPlayer: React.FC<BeatPlayerProps> = ({ beat, children, inspector, projectId, projection }) => {
  const { t } = useTranslation();
  const keyboardGuidanceId = useId();
  const sequence = useMemo(() => buildBeatPlaybackSequence(projectId, beat, projection), [beat, projectId, projection]);
  const planToken = useMemo(() => JSON.stringify({ projectId, sequence }), [projectId, sequence]);
  const activeTokenRef = useRef(planToken);
  const [storedState, setStoredState] = useState<TransportState>(() => initialTransportState(planToken));
  const state = storedState.token === planToken ? storedState : initialTransportState(planToken);
  const [storedPrewarmTarget, setStoredPrewarmTarget] = useState<PrewarmTarget | null>(null);
  const prewarmTarget = storedPrewarmTarget?.token === planToken ? storedPrewarmTarget : null;
  const stateRef = useRef(state);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prewarmVideoRef = useRef<HTMLVideoElement | null>(null);
  const readyMediaRef = useRef<ReadyMedia | null>(null);
  const pendingMediaSeekRef = useRef<PendingMediaSeek | null>(null);
  const playingMediaRef = useRef<HTMLVideoElement | null>(null);
  const slateClockRef = useRef<SlateClock | null>(null);
  const playAttemptIdRef = useRef(0);
  const playAttemptRef = useRef<PlayAttempt | null>(null);
  const mediaBoundaryWatchRef = useRef<MediaBoundaryWatch | null>(null);
  const appliedPlanTokenRef = useRef(planToken);

  const segment = sequence?.segments[state.segmentIndex] ?? null;
  const joins = useMemo(() => (sequence === null ? [] : beatPlaybackJoins(sequence)), [sequence]);

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

  const releasePrewarmMedia = useCallback((media: HTMLVideoElement): void => {
    pauseMedia(media);
    media.removeAttribute('src');
    try {
      media.load();
    } catch {
      // Detached native media can reject load; its source authority is already removed.
    }
  }, []);

  const setPrewarmVideoNode = useCallback(
    (node: HTMLVideoElement | null): void => {
      const previous = prewarmVideoRef.current;
      if (previous === node) return;
      if (previous !== null) releasePrewarmMedia(previous);
      prewarmVideoRef.current = node;
      if (node === null) return;
      try {
        node.load();
      } catch {
        // `preload` is advisory, so request the warm-up explicitly and contain native refusal.
      }
    },
    [releasePrewarmMedia]
  );

  const clearPrewarm = useCallback((token: string): void => {
    if (activeTokenRef.current !== token) return;
    setStoredPrewarmTarget((current) => (current?.token === token ? null : current));
  }, []);

  const armPrewarm = useCallback(
    (token: string, segmentIndex: number, currentSequence: BeatPlaybackSequence): void => {
      if (activeTokenRef.current !== token) return;
      const nextVideoIndex = currentSequence.segments.findIndex(
        (candidate, index) => index > segmentIndex && candidate.kind === 'video'
      );
      const nextVideo = currentSequence.segments[nextVideoIndex];
      if (nextVideoIndex < 0 || nextVideo?.kind !== 'video') {
        clearPrewarm(token);
        return;
      }
      const source = createManagedStudioAssetUrl(currentSequence.projectId, nextVideo.assetId);
      if (source === null) {
        clearPrewarm(token);
        return;
      }
      setStoredPrewarmTarget((current) => {
        if (activeTokenRef.current !== token) return current;
        if (
          current?.token === token &&
          current.segmentIndex === nextVideoIndex &&
          current.assetId === nextVideo.assetId &&
          current.source === source
        ) {
          return current;
        }
        return { assetId: nextVideo.assetId, segmentIndex: nextVideoIndex, source, token };
      });
    },
    [clearPrewarm]
  );

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
        pauseMedia(previous);
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
      clearPrewarm(token);
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
        seeking: false,
        failed: true,
      }));
    },
    [clearPrewarm, invalidatePlayAttempt, isCurrentMedia, stopMediaBoundaryWatch, updateCurrentState]
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

  const loopRange = useCallback(
    (current: TransportState): { startSeconds: number; endSeconds: number } | null => {
      if (sequence === null || current.loopJoinIndex === null) return null;
      const join = joins[current.loopJoinIndex];
      if (join === undefined) return null;
      return {
        startSeconds: Math.max(0, join - JOIN_LOOP_RADIUS_SECONDS),
        endSeconds: Math.min(sequence.durationSeconds, join + JOIN_LOOP_RADIUS_SECONDS),
      };
    },
    [joins, sequence]
  );

  const seekTo = useCallback(
    (
      requestedSeconds: number,
      options: { joinCursorIndex?: number | null; loopJoinIndex?: number | null } = {}
    ): void => {
      const currentSequence = sequence;
      const activeState = stateRef.current;
      if (currentSequence === null || activeState.failed || activeTokenRef.current !== planToken) {
        return;
      }
      stopMediaBoundaryWatch();
      const location = resolveBeatPlaybackLocation(currentSequence, requestedSeconds);
      if (location === null) return;
      const target = currentSequence.segments[location.segmentIndex];
      if (target === undefined) return;

      if (location.segmentIndex !== activeState.segmentIndex) clearPrewarm(planToken);
      invalidatePlayAttempt();
      pauseMedia(videoRef.current);
      playingMediaRef.current = null;
      readyMediaRef.current = null;
      pendingMediaSeekRef.current = null;
      slateClockRef.current = null;
      replaceCurrentState(planToken, (current) => ({
        ...current,
        segmentIndex: location.segmentIndex,
        mediaEpoch: current.mediaEpoch + (target.kind === 'video' ? 1 : 0),
        clockEpoch: current.clockEpoch + 1,
        positionSeconds: location.positionSeconds,
        playing: current.playing && location.positionSeconds < currentSequence.durationSeconds,
        buffering: target.kind === 'video',
        seeking: target.kind === 'video',
        joinCursorIndex: options.joinCursorIndex === undefined ? current.joinCursorIndex : options.joinCursorIndex,
        loopJoinIndex: options.loopJoinIndex === undefined ? current.loopJoinIndex : options.loopJoinIndex,
      }));
    },
    [clearPrewarm, invalidatePlayAttempt, planToken, replaceCurrentState, sequence, stopMediaBoundaryWatch]
  );

  const advanceSegment = useCallback(
    (token: string, segmentIndex: number, currentSequence: BeatPlaybackSequence): void => {
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
      if (completed !== undefined && activeLoop !== null && completed.beatEndSeconds >= activeLoop.endSeconds) {
        seekTo(activeLoop.startSeconds, {
          joinCursorIndex: activeState.loopJoinIndex,
          loopJoinIndex: activeState.loopJoinIndex,
        });
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
            seeking: false,
          };
        }
        const next = currentSequence.segments[nextIndex]!;
        readyMediaRef.current = null;
        pendingMediaSeekRef.current = null;
        return {
          ...current,
          segmentIndex: nextIndex,
          mediaEpoch: current.mediaEpoch + (next.kind === 'video' ? 1 : 0),
          positionSeconds: completed.beatEndSeconds,
          buffering: next.kind === 'video',
          seeking: next.kind === 'video',
          joinCursorIndex: null,
        };
      });
    },
    [invalidatePlayAttempt, loopRange, seekTo, stopMediaBoundaryWatch, updateCurrentState]
  );

  useLayoutEffect(() => {
    if (appliedPlanTokenRef.current === planToken) return;
    appliedPlanTokenRef.current = planToken;
    invalidatePlayAttempt();
    stopMediaBoundaryWatch();
    pauseMedia(playingMediaRef.current);
    pauseMedia(videoRef.current);
    playingMediaRef.current = null;
    readyMediaRef.current = null;
    pendingMediaSeekRef.current = null;
    slateClockRef.current = null;
    setStoredPrewarmTarget(null);
    const reset = initialTransportState(planToken);
    stateRef.current = reset;
    setStoredState(reset);
  }, [invalidatePlayAttempt, planToken, stopMediaBoundaryWatch]);

  useEffect(
    () => () => {
      invalidatePlayAttempt();
      stopMediaBoundaryWatch();
      pauseMedia(playingMediaRef.current);
      pauseMedia(videoRef.current);
    },
    [invalidatePlayAttempt, stopMediaBoundaryWatch]
  );

  useEffect(() => {
    if (sequence === null || segment?.kind !== 'slate' || !state.playing || state.failed) return;
    const token = planToken;
    const segmentIndex = state.segmentIndex;
    const startPositionSeconds = stateRef.current.positionSeconds;
    const startedAt = performance.now();
    const slateClock: SlateClock = { token, segmentIndex, startPositionSeconds, startedAt };
    slateClockRef.current = slateClock;
    armPrewarm(token, segmentIndex, sequence);
    const timer = window.setInterval(() => {
      const current = stateRef.current;
      if (
        slateClockRef.current !== slateClock ||
        current.token !== token ||
        current.segmentIndex !== segmentIndex ||
        !current.playing ||
        current.buffering ||
        current.failed
      ) {
        return;
      }
      const elapsedSeconds = Math.max(0, (performance.now() - startedAt) / 1_000);
      const nextPosition = Math.min(segment.beatEndSeconds, startPositionSeconds + elapsedSeconds);
      const activeLoop = loopRange(current);
      if (activeLoop !== null && nextPosition >= activeLoop.endSeconds) {
        window.clearInterval(timer);
        if (slateClockRef.current === slateClock) slateClockRef.current = null;
        seekTo(activeLoop.startSeconds, {
          joinCursorIndex: current.loopJoinIndex,
          loopJoinIndex: current.loopJoinIndex,
        });
        return;
      }
      if (nextPosition >= segment.beatEndSeconds) {
        window.clearInterval(timer);
        if (slateClockRef.current === slateClock) slateClockRef.current = null;
        advanceSegment(token, segmentIndex, sequence);
        return;
      }
      updateCurrentState(token, segmentIndex, (latest) => ({ ...latest, positionSeconds: nextPosition }));
    }, SLATE_CLOCK_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      if (slateClockRef.current === slateClock) slateClockRef.current = null;
    };
  }, [
    advanceSegment,
    armPrewarm,
    loopRange,
    planToken,
    seekTo,
    segment,
    sequence,
    state.failed,
    state.clockEpoch,
    state.playing,
    state.segmentIndex,
    updateCurrentState,
  ]);

  const onLoadedMetadata = (media: HTMLVideoElement, videoSegment: BeatPlaybackVideoSegment): void => {
    const token = planToken;
    const segmentIndex = state.segmentIndex;
    if (!isCurrentMedia(token, segmentIndex, media) || stateRef.current.failed) return;
    stopMediaBoundaryWatch();
    if (
      !Number.isFinite(media.duration) ||
      media.duration <= 0 ||
      media.duration + MEDIA_DURATION_EPSILON_SECONDS < videoSegment.sourceOutSeconds
    ) {
      failMedia(token, segmentIndex, media);
      return;
    }
    const sourceTimeSeconds = Math.min(
      videoSegment.sourceOutSeconds,
      videoSegment.sourceInSeconds + Math.max(0, stateRef.current.positionSeconds - videoSegment.beatStartSeconds)
    );
    readyMediaRef.current = null;
    pendingMediaSeekRef.current = null;
    updateCurrentState(token, segmentIndex, (current) => ({ ...current, buffering: true, seeking: true }));
    try {
      media.currentTime = sourceTimeSeconds;
    } catch {
      failMedia(token, segmentIndex, media);
      return;
    }
    const pendingSeek: PendingMediaSeek = { token, segmentIndex, media, sourceTimeSeconds };
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
      updateCurrentState(token, segmentIndex, (current) => ({ ...current, buffering: false, seeking: false }));
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
    updateCurrentState(pendingSeek.token, pendingSeek.segmentIndex, (current) => ({
      ...current,
      buffering: false,
      seeking: false,
    }));
    if (stateRef.current.playing) playMedia(pendingSeek.token, pendingSeek.segmentIndex, media);
  };

  const observeVideoTime = (
    media: HTMLVideoElement,
    videoSegment: BeatPlaybackVideoSegment,
    observedTime = media.currentTime
  ): void => {
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
      current.failed ||
      current.seeking ||
      !Number.isFinite(observedTime)
    ) {
      return;
    }
    const nextPosition = Math.min(
      videoSegment.beatEndSeconds,
      videoSegment.beatStartSeconds + Math.max(0, observedTime - videoSegment.sourceInSeconds)
    );
    const activeLoop = loopRange(current);
    if (activeLoop !== null && nextPosition >= activeLoop.endSeconds) {
      stopMediaBoundaryWatch();
      pauseMedia(media);
      seekTo(activeLoop.startSeconds, {
        joinCursorIndex: current.loopJoinIndex,
        loopJoinIndex: current.loopJoinIndex,
      });
      return;
    }
    if (observedTime >= videoSegment.sourceOutSeconds) {
      stopMediaBoundaryWatch();
      pauseMedia(media);
      if (playingMediaRef.current === media) playingMediaRef.current = null;
      if (sequence !== null) advanceSegment(token, segmentIndex, sequence);
      return;
    }
    updateCurrentState(token, segmentIndex, (latest) => ({ ...latest, positionSeconds: nextPosition }));
  };

  const startMediaBoundaryWatch = (
    token: string,
    segmentIndex: number,
    media: HTMLVideoElement,
    videoSegment: BeatPlaybackVideoSegment
  ): void => {
    stopMediaBoundaryWatch();
    const ready = readyMediaRef.current;
    if (ready?.token !== token || ready.segmentIndex !== segmentIndex || ready.media !== media) return;
    const watch: MediaBoundaryWatch = {
      token,
      segmentIndex,
      media,
      frameRequestId: null,
      timerId: null,
    };
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
        current.failed ||
        current.seeking
      ) {
        stopMediaBoundaryWatch();
        return;
      }
      observeVideoTime(media, videoSegment, frameTime);
      schedule();
    };

    schedule();
  };

  const togglePlayback = (): void => {
    if (sequence === null || segment === null || state.failed) return;
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
              segment.beatEndSeconds,
              slateClock.startPositionSeconds + Math.max(0, (performance.now() - slateClock.startedAt) / 1_000)
            )
          : segment.kind === 'video' &&
              !state.seeking &&
              !state.buffering &&
              videoRef.current !== null &&
              Number.isFinite(videoRef.current.currentTime)
            ? Math.min(
                segment.beatEndSeconds,
                segment.beatStartSeconds + Math.max(0, videoRef.current.currentTime - segment.sourceInSeconds)
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
      seekTo(0, { joinCursorIndex: null, loopJoinIndex: null });
      replaceCurrentState(token, (current) => ({ ...current, playing: true }));
      return;
    }
    updateCurrentState(token, segmentIndex, (current) => ({
      ...current,
      playing: true,
      buffering: segment.kind === 'video' && readyMediaRef.current?.media !== videoRef.current,
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

  const stepJoin = (direction: -1 | 1): void => {
    if (sequence === null || joins.length === 0 || state.failed) return;
    const current = stateRef.current;
    let index: number;
    if (current.joinCursorIndex !== null) index = current.joinCursorIndex + direction;
    else if (direction === 1) index = joins.findIndex((join) => join > current.positionSeconds);
    else {
      index = -1;
      for (let candidate = joins.length - 1; candidate >= 0; candidate -= 1) {
        if (joins[candidate]! < current.positionSeconds) {
          index = candidate;
          break;
        }
      }
    }
    if (index < 0 || index >= joins.length) return;
    seekTo(Math.max(0, joins[index]! - JOIN_PREROLL_SECONDS), {
      joinCursorIndex: index,
      loopJoinIndex: null,
    });
  };

  const toggleJoinLoop = (): void => {
    if (sequence === null || joins.length === 0 || state.failed) return;
    const current = stateRef.current;
    if (current.loopJoinIndex !== null) {
      replaceCurrentState(planToken, (latest) => ({ ...latest, loopJoinIndex: null }));
      return;
    }
    let nearestIndex = 0;
    for (let index = 1; index < joins.length; index += 1) {
      if (
        Math.abs(joins[index]! - current.positionSeconds) < Math.abs(joins[nearestIndex]! - current.positionSeconds)
      ) {
        nearestIndex = index;
      }
    }
    seekTo(Math.max(0, joins[nearestIndex]! - JOIN_LOOP_RADIUS_SECONDS), {
      joinCursorIndex: nearestIndex,
      loopJoinIndex: nearestIndex,
    });
  };

  const mediaSource =
    sequence !== null && segment?.kind === 'video'
      ? createManagedStudioAssetUrl(sequence.projectId, segment.assetId)
      : null;
  const posterSource =
    sequence !== null && segment?.kind === 'video' && segment.posterAssetId !== null
      ? createManagedStudioAssetUrl(sequence.projectId, segment.posterAssetId)
      : null;
  const unavailable = sequence === null || segment === null || (segment.kind === 'video' && mediaSource === null);
  const available = !unavailable && !state.failed;
  const totalClock = formatBeatPlaybackClock(sequence?.durationSeconds ?? 0, sequence?.durationSeconds ?? 0) ?? '0:00';
  const currentClock = formatBeatPlaybackClock(state.positionSeconds, sequence?.durationSeconds ?? 0) ?? '0:00';
  const segmentCopy =
    segment === null
      ? ''
      : t(`${PREVIEW_ROOT}.${segment.kind === 'video' ? 'videoLabel' : 'slateLabel'}`, {
          position: paddedPosition(segment.shotPosition),
          line: segment.shotLine,
        });
  const previousJoinAvailable =
    joins.length > 0 &&
    (state.joinCursorIndex !== null ? state.joinCursorIndex > 0 : joins.some((join) => join < state.positionSeconds));
  const nextJoinAvailable =
    joins.length > 0 &&
    (state.joinCursorIndex !== null
      ? state.joinCursorIndex < joins.length - 1
      : joins.some((join) => join > state.positionSeconds));

  const handleKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (
      !available ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isEditableDescendant(event.target, event.currentTarget)
    ) {
      return;
    }
    if (event.key === ' ' || event.code === 'Space') togglePlayback();
    else if (event.key === 'ArrowRight')
      seekTo(stateRef.current.positionSeconds + (event.shiftKey ? 0.2 : 1), {
        joinCursorIndex: null,
        loopJoinIndex: null,
      });
    else if (event.key === 'ArrowLeft')
      seekTo(stateRef.current.positionSeconds - (event.shiftKey ? 0.2 : 1), {
        joinCursorIndex: null,
        loopJoinIndex: null,
      });
    else if (event.key === '[' || event.code === 'BracketLeft') stepJoin(-1);
    else if (event.key === ']' || event.code === 'BracketRight') stepJoin(1);
    else if (event.key.toLowerCase() === 'l') toggleJoinLoop();
    else return;
    event.preventDefault();
  };

  return (
    <div
      aria-describedby={keyboardGuidanceId}
      className={styles.beatPlayer}
      data-beat-player
      onKeyDown={handleKeyboard}
      tabIndex={available ? 0 : -1}
    >
      <div className={styles.workingRow} data-beat-working-row data-has-inspector={inspector !== undefined}>
        <div className={styles.previewColumn} data-beat-preview-column>
          <section
            aria-label={t(`${PREVIEW_ROOT}.label`)}
            className={styles.beatPreview}
            data-beat-preview
            data-playback-kind={unavailable ? 'empty' : segment.kind}
          >
            {unavailable ? (
              <p className={styles.previewUnavailable} data-beat-preview-media data-media-kind='empty'>
                {t(`${PREVIEW_ROOT}.noMedia`)}
              </p>
            ) : segment.kind === 'video' ? (
              <div className={styles.previewFrame}>
                <video
                  key={`${planToken}:${state.segmentIndex}:${state.mediaEpoch}:${segment.assetId}`}
                  ref={setVideoNode}
                  aria-label={segmentCopy}
                  className={styles.previewMedia}
                  data-beat-preview-media
                  data-media-kind='video'
                  muted
                  playsInline
                  poster={posterSource ?? undefined}
                  preload='metadata'
                  src={mediaSource ?? undefined}
                  tabIndex={-1}
                  onEnded={(event) => {
                    const media = event.currentTarget;
                    if (media.currentTime + MEDIA_DURATION_EPSILON_SECONDS < segment.sourceOutSeconds) {
                      failMedia(planToken, state.segmentIndex, media);
                      return;
                    }
                    observeVideoTime(media, segment, segment.sourceOutSeconds);
                  }}
                  onError={(event) => failMedia(planToken, state.segmentIndex, event.currentTarget)}
                  onLoadedMetadata={(event) => onLoadedMetadata(event.currentTarget, segment)}
                  onPlaying={(event) => {
                    const media = event.currentTarget;
                    const current = stateRef.current;
                    if (!isCurrentMedia(planToken, state.segmentIndex, media)) return;
                    if (!current.playing || current.failed || readyMediaRef.current?.media !== media) {
                      stopMediaBoundaryWatch();
                      pauseMedia(media);
                      return;
                    }
                    updateCurrentState(planToken, state.segmentIndex, (latest) => ({ ...latest, buffering: false }));
                    startMediaBoundaryWatch(planToken, state.segmentIndex, media, segment);
                    if (sequence !== null) armPrewarm(planToken, state.segmentIndex, sequence);
                  }}
                  onRateChange={(event) => {
                    const media = event.currentTarget;
                    const current = stateRef.current;
                    if (
                      isCurrentMedia(planToken, state.segmentIndex, media) &&
                      current.playing &&
                      !current.buffering &&
                      !current.failed &&
                      !current.seeking
                    ) {
                      startMediaBoundaryWatch(planToken, state.segmentIndex, media, segment);
                    }
                  }}
                  onSeeked={(event) => onSeeked(event.currentTarget)}
                  onTimeUpdate={(event) => observeVideoTime(event.currentTarget, segment)}
                  onWaiting={(event) => {
                    if (
                      !isCurrentMedia(planToken, state.segmentIndex, event.currentTarget) ||
                      !stateRef.current.playing
                    ) {
                      return;
                    }
                    stopMediaBoundaryWatch();
                    updateCurrentState(planToken, state.segmentIndex, (latest) => ({ ...latest, buffering: true }));
                  }}
                />
                {state.seeking ? (
                  posterSource === null ? (
                    <span aria-hidden='true' className={styles.previewSeekFallback} data-beat-seek-poster />
                  ) : (
                    <img
                      alt=''
                      aria-hidden='true'
                      className={styles.previewSeekPoster}
                      data-beat-seek-poster
                      src={posterSource}
                    />
                  )
                ) : null}
              </div>
            ) : (
              <div
                aria-label={segmentCopy}
                className={styles.previewMedia}
                data-beat-preview-media
                data-media-kind='slate'
                role='img'
              >
                <strong className={styles.previewSlateTitle}>{t(`${PREVIEW_ROOT}.slate`)}</strong>
                <span>
                  {t(`${PREVIEW_ROOT}.slateHold`, {
                    clock: formatBeatPlaybackClock(segment.durationSeconds, segment.durationSeconds) ?? '0:00',
                  })}
                </span>
              </div>
            )}
          </section>

          {prewarmTarget === null ? null : (
            <video
              key={`${prewarmTarget.token}:prewarm:${prewarmTarget.segmentIndex}:${prewarmTarget.assetId}`}
              ref={setPrewarmVideoNode}
              aria-hidden='true'
              className={styles.prewarmMedia}
              data-beat-prewarm-media
              muted
              playsInline
              preload='auto'
              src={prewarmTarget.source}
              tabIndex={-1}
            />
          )}

          <div
            aria-label={t(`${PREVIEW_ROOT}.controlsLabel`)}
            className={styles.beatTransport}
            data-beat-transport
            role='group'
          >
            <Button
              aria-pressed={state.playing}
              data-beat-play
              disabled={!available}
              onClick={togglePlayback}
              type='primary'
            >
              {t(`${PREVIEW_ROOT}.${state.playing ? 'pause' : 'play'}`)}
            </Button>
            <output aria-live='off' className={styles.transportTime} data-beat-time role='timer'>
              <bdi dir='auto'>{t(`${PREVIEW_ROOT}.position`, { current: currentClock, total: totalClock })}</bdi>
            </output>
            <span className={styles.pictureOnly}>{t(`${PREVIEW_ROOT}.pictureOnly`)}</span>
            <Button
              aria-label={t(`${PREVIEW_ROOT}.previousJoin`)}
              data-beat-previous-join
              disabled={!available || !previousJoinAvailable}
              onClick={() => stepJoin(-1)}
            >
              {t(`${PREVIEW_ROOT}.previousJoin`)}
            </Button>
            <Button
              aria-label={t(`${PREVIEW_ROOT}.nextJoin`)}
              data-beat-next-join
              disabled={!available || !nextJoinAvailable}
              onClick={() => stepJoin(1)}
            >
              {t(`${PREVIEW_ROOT}.nextJoin`)}
            </Button>
            <Button
              aria-label={t(`${PREVIEW_ROOT}.loopJoin`)}
              aria-pressed={state.loopJoinIndex !== null}
              data-beat-loop
              disabled={!available || joins.length === 0}
              onClick={toggleJoinLoop}
            >
              {t(`${PREVIEW_ROOT}.loopJoin`)}
            </Button>
          </div>
          <span className={styles.keyboardGuidance} id={keyboardGuidanceId}>
            {t(`${PREVIEW_ROOT}.keyboardGuidance`)}
          </span>

          <p
            aria-atomic='true'
            aria-live='polite'
            className={state.failed ? styles.previewError : styles.srOnly}
            data-beat-preview-status
            role='status'
          >
            {state.failed ? t(`${PREVIEW_ROOT}.mediaError`) : segmentCopy}
          </p>
        </div>
        {inspector}
      </div>

      {children({
        available,
        durationSeconds: sequence?.durationSeconds ?? 0,
        positionSeconds: state.positionSeconds,
        onSeek: (positionSeconds) => seekTo(positionSeconds, { joinCursorIndex: null, loopJoinIndex: null }),
      })}
    </div>
  );
};
