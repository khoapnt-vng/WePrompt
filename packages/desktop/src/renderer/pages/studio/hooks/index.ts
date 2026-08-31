/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export { useStudioProject, type StudioProjectLoadState, type UseStudioProjectResult } from './useStudioProject';
export {
  DEFAULT_STUDIO_PLAYBACK_AUDIO,
  readStudioPlaybackAudioPreference,
  storeStudioPlaybackAudioPreference,
  StudioPlaybackAudioProvider,
  studioPlaybackAudioStorageKey,
  useStudioPlaybackAudio,
  type StudioPlaybackAudioPreference,
  type StudioPlaybackAudioProviderProps,
} from './useStudioPlaybackAudio';
export {
  StudioShotAudioAnalysisProvider,
  useStudioShotAudioAnalysis,
  type StudioShotAudioAnalysisProviderProps,
  type StudioShotAudioDisplayAnalysis,
} from './useStudioShotAudioAnalysis';
