/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useLayoutEffect, useMemo, useState } from 'react';

export type StudioPlaybackAudioPreference = {
  muted: boolean;
  volume: number;
};

type StudioPlaybackAudioContextValue = StudioPlaybackAudioPreference & {
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  syncFromMedia: (preference: StudioPlaybackAudioPreference) => void;
};

const STORAGE_KEY_PREFIX = 'weprompt.creativeStudio.playbackAudio.v1.';
export const DEFAULT_STUDIO_PLAYBACK_AUDIO: StudioPlaybackAudioPreference = Object.freeze({
  muted: true,
  volume: 1,
});
const ignoreBooleanPreference = (_value: boolean): void => undefined;
const ignoreNumberPreference = (_value: number): void => undefined;
const ignoreMediaPreference = (_value: StudioPlaybackAudioPreference): void => undefined;

const StudioPlaybackAudioContext = createContext<StudioPlaybackAudioContextValue>({
  ...DEFAULT_STUDIO_PLAYBACK_AUDIO,
  setMuted: ignoreBooleanPreference,
  setVolume: ignoreNumberPreference,
  syncFromMedia: ignoreMediaPreference,
});

const browserStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const studioPlaybackAudioStorageKey = (projectId: string): string =>
  `${STORAGE_KEY_PREFIX}${encodeURIComponent(projectId)}`;

const validPreference = (value: unknown): StudioPlaybackAudioPreference | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const muted = Reflect.get(value, 'muted');
  const volume = Reflect.get(value, 'volume');
  return typeof muted === 'boolean' &&
    typeof volume === 'number' &&
    Number.isFinite(volume) &&
    volume >= 0 &&
    volume <= 1
    ? { muted, volume }
    : null;
};

export const readStudioPlaybackAudioPreference = (
  projectId: string,
  storage: Storage | null = browserStorage()
): StudioPlaybackAudioPreference => {
  if (storage === null) return { ...DEFAULT_STUDIO_PLAYBACK_AUDIO };
  try {
    const serialized = storage.getItem(studioPlaybackAudioStorageKey(projectId));
    if (serialized === null) return { ...DEFAULT_STUDIO_PLAYBACK_AUDIO };
    return validPreference(JSON.parse(serialized)) ?? { ...DEFAULT_STUDIO_PLAYBACK_AUDIO };
  } catch {
    return { ...DEFAULT_STUDIO_PLAYBACK_AUDIO };
  }
};

export const storeStudioPlaybackAudioPreference = (
  projectId: string,
  preference: StudioPlaybackAudioPreference,
  storage: Storage | null = browserStorage()
): void => {
  if (storage === null) return;
  try {
    storage.setItem(studioPlaybackAudioStorageKey(projectId), JSON.stringify(preference));
  } catch {
    // Playback remains controllable in memory when browser preference storage is unavailable.
  }
};

const normalizedVolume = (volume: number): number =>
  Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_STUDIO_PLAYBACK_AUDIO.volume;

export type StudioPlaybackAudioProviderProps = {
  children: React.ReactNode;
  projectId: string;
  /** Tests may inject unavailable or throwing storage without replacing the browser global. */
  storage?: Storage | null;
};

/** Renderer-only, project-scoped review-audio preference. It never mutates the project record. */
export const StudioPlaybackAudioProvider: React.FC<StudioPlaybackAudioProviderProps> = ({
  children,
  projectId,
  storage,
}) => {
  const resolvedStorage = storage === undefined ? browserStorage() : storage;
  const [stored, setStored] = useState(() => ({
    projectId,
    preference: readStudioPlaybackAudioPreference(projectId, resolvedStorage),
  }));
  const preference =
    stored.projectId === projectId ? stored.preference : readStudioPlaybackAudioPreference(projectId, resolvedStorage);

  useLayoutEffect(() => {
    setStored({
      projectId,
      preference: readStudioPlaybackAudioPreference(projectId, resolvedStorage),
    });
  }, [projectId, resolvedStorage]);

  const update = useCallback(
    (candidate: StudioPlaybackAudioPreference): void => {
      const next = { muted: candidate.muted, volume: normalizedVolume(candidate.volume) };
      setStored((current) => {
        const currentPreference =
          current.projectId === projectId
            ? current.preference
            : readStudioPlaybackAudioPreference(projectId, resolvedStorage);
        if (currentPreference.muted === next.muted && currentPreference.volume === next.volume) {
          return current.projectId === projectId ? current : { projectId, preference: currentPreference };
        }
        storeStudioPlaybackAudioPreference(projectId, next, resolvedStorage);
        return { projectId, preference: next };
      });
    },
    [projectId, resolvedStorage]
  );

  const setMuted = useCallback((muted: boolean): void => update({ ...preference, muted }), [preference, update]);
  const setVolume = useCallback((volume: number): void => update({ ...preference, volume }), [preference, update]);
  const syncFromMedia = useCallback(
    (next: StudioPlaybackAudioPreference): void => update({ muted: next.muted, volume: next.volume }),
    [update]
  );
  const value = useMemo<StudioPlaybackAudioContextValue>(
    () => ({ ...preference, setMuted, setVolume, syncFromMedia }),
    [preference, setMuted, setVolume, syncFromMedia]
  );

  return <StudioPlaybackAudioContext.Provider value={value}>{children}</StudioPlaybackAudioContext.Provider>;
};

export const useStudioPlaybackAudio = (): StudioPlaybackAudioContextValue => {
  return React.useContext(StudioPlaybackAudioContext);
};
