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
      <Button
        aria-label={t(`${KEY_ROOT}.${muted ? 'unmute' : 'mute'}`)}
        aria-pressed={!muted}
        data-studio-playback-mute
        onClick={() => setMuted(!muted)}
        size='mini'
        type='text'
      >
        {t(`${KEY_ROOT}.${muted ? 'muted' : 'audible'}`)}
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
