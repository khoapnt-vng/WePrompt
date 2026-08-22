/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';
import type { WorkspaceProjection } from '../../workspaceProjection';
import {
  buildCutPlaybackSequence,
  formatCutPlaybackClock,
  type CutPlaybackSegment,
  type CutPlaybackSequence,
  type CutPlaybackVideoSegment,
} from './playbackSequence';
import styles from './Cut.module.css';

const PREVIEW_ROOT = 'conversation.creativeStudio.workspace.cut.preview';
const MEDIA_DURATION_EPSILON_SECONDS = 0.001;
const SLATE_CLOCK_INTERVAL_MS = 100;

export type CutPlayerProps = {
  pending: boolean;
  projectId: string;
  projection: WorkspaceProjection;
};

type TransportState = {
  token: string;
  segmentIndex: number;
  mediaEpoch: number;
  positionSeconds: number;
  playing: boolean;
  buffering: boolean;
  failed: boolean;
};

type ReadyMedia = {
  token: string;
  segmentIndex: number;
  media: HTMLVideoElement;
};

type PendingMediaSeek = ReadyMedia & {
  sourceInSeconds: number;
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

/** A truthful picture-only preview of the exact selected-Take/slate sequence. */
export const CutPlayer: React.FC<CutPlayerProps> = ({ pending, projectId, projection }) => {
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
      updateCurrentState(token, segmentIndex, (current) => {
        const completed = currentSequence.segments[segmentIndex];
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
    [invalidatePlayAttempt, stopMediaBoundaryWatch, updateCurrentState]
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
        updateCurrentState(token, segmentIndex, (latest) =>
          Math.floor(latest.positionSeconds) === Math.floor(nextPosition)
            ? latest
            : { ...latest, positionSeconds: nextPosition }
        );
        schedule();
      };

      schedule();
    },
    [advanceSegment, failMedia, isCurrentMedia, stopMediaBoundaryWatch, updateCurrentState]
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
    segment,
    sequence,
    state.buffering,
    state.failed,
    state.playing,
    state.segmentIndex,
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
    try {
      media.currentTime = videoSegment.sourceInSeconds;
    } catch {
      failMedia(token, segmentIndex, media);
      return;
    }
    const pendingSeek: PendingMediaSeek = {
      token,
      segmentIndex,
      media,
      sourceInSeconds: videoSegment.sourceInSeconds,
    };
    pendingMediaSeekRef.current = pendingSeek;
    if (!media.seeking) {
      if (
        !Number.isFinite(media.currentTime) ||
        Math.abs(media.currentTime - videoSegment.sourceInSeconds) > MEDIA_DURATION_EPSILON_SECONDS
      ) {
        failMedia(token, segmentIndex, media);
        return;
      }
      pendingMediaSeekRef.current = null;
      readyMediaRef.current = { token, segmentIndex, media };
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
      Math.abs(media.currentTime - pendingSeek.sourceInSeconds) > MEDIA_DURATION_EPSILON_SECONDS
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
    updateCurrentState(token, segmentIndex, (latest) => ({
      ...latest,
      positionSeconds: Math.min(videoSegment.filmEndSeconds, videoSegment.filmStartSeconds + segmentProgress),
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
      buffering: false,
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
            {t(`${PREVIEW_ROOT}.noMedia`)}
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
};
