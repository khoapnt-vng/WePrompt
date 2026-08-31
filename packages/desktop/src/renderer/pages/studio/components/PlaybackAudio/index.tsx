/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Slider } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useStudioPlaybackAudio } from '@/renderer/pages/studio/hooks/useStudioPlaybackAudio';
import { useStudioShotAudioAnalysis } from '@/renderer/pages/studio/hooks/useStudioShotAudioAnalysis';
import styles from './PlaybackAudio.module.css';

const KEY_ROOT = 'conversation.creativeStudio.workspace.playbackAudio';

/** One project-scoped control shared by the custom Beat and Cut transports. */
export const StudioPlaybackAudioControl: React.FC = () => {
  const { t } = useTranslation();
  const { muted, setMuted, setVolume, volume } = useStudioPlaybackAudio();
  const percent = Math.round(volume * 100);

  return (
    <span aria-label={t(`${KEY_ROOT}.label`)} className={styles.control} data-studio-playback-audio role='group'>
      {/*
       * The visible word is the action, not the state. Showing "Muted" between a timecode and a
       * volume slider reads as a caption rather than a control, so a reviewer never presses it and
       * reviews every take in silence -- which defeats the point of a sound-aware review. The
       * accessible name now comes from that same content, so aria-label would only duplicate it.
       * aria-pressed describes the state being toggled, matching the Play buttons in this group.
       */}
      <Button aria-pressed={muted} data-studio-playback-mute onClick={() => setMuted(!muted)} size='mini'>
        {t(`${KEY_ROOT}.${muted ? 'unmute' : 'mute'}`)}
      </Button>
      <Slider
        aria-label={t(`${KEY_ROOT}.volume`, { percent })}
        className={styles.slider}
        data-studio-playback-volume
        max={100}
        min={0}
        onChange={(value) => setVolume((Array.isArray(value) ? (value[0] ?? percent) : value) / 100)}
        showTicks={false}
        value={percent}
      />
      <span aria-hidden='true' className={styles.value}>
        <bdi>{percent}%</bdi>
      </span>
    </span>
  );
};

const SHOT_AUDIO_STATUS_KEYS = {
  analyzing: `${KEY_ROOT}.shotStatus.analyzing`,
  audible: `${KEY_ROOT}.shotStatus.audible`,
  effectively_silent: `${KEY_ROOT}.shotStatus.effectivelySilent`,
  no_audio_stream: `${KEY_ROOT}.shotStatus.noAudioStream`,
  unavailable: `${KEY_ROOT}.shotStatus.unavailable`,
} as const;

export type StudioShotAudioStatusProps = { shotId: string; assetId: string | null };

/** Exact current-take loudness fact; route capability is intentionally not used as a substitute. */
export const StudioShotAudioStatus: React.FC<StudioShotAudioStatusProps> = ({ shotId, assetId }) => {
  const { t } = useTranslation();
  const analysis = useStudioShotAudioAnalysis(shotId, assetId);
  if (analysis === null) return null;
  return (
    <span
      className={styles.status}
      data-mean-volume-dbfs={analysis.meanVolumeDbfs ?? undefined}
      data-peak-volume-dbfs={analysis.peakVolumeDbfs ?? undefined}
      data-shot-audio-status={analysis.status}
      role='status'
    >
      {t(SHOT_AUDIO_STATUS_KEYS[analysis.status])}
    </span>
  );
};
