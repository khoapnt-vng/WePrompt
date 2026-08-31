/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudioPlaybackAudioControl } from '@/renderer/pages/studio/components/PlaybackAudio';
import {
  readStudioPlaybackAudioPreference,
  StudioPlaybackAudioProvider,
  storeStudioPlaybackAudioPreference,
  studioPlaybackAudioStorageKey,
  useStudioPlaybackAudio,
} from '@/renderer/pages/studio/hooks/useStudioPlaybackAudio';

vi.mock('@arco-design/web-react', async () => {
  const ReactModule = await import('react');
  return {
    Button: ({ children, type: _type, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type='button' {...props}>
        {children}
      </button>
    ),
    Slider: ({
      onChange,
      value,
      ...props
    }: React.InputHTMLAttributes<HTMLInputElement> & { onChange: (value: number | number[]) => void }) => (
      <input
        {...props}
        onDoubleClick={() => onChange([25])}
        onChange={(event) => onChange(Number(event.target.value))}
        role='slider'
        type='range'
        value={value}
      />
    ),
    default: ReactModule,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.percent === undefined ? key : `${key}:${String(values.percent)}`,
  }),
}));

const Probe = (): React.ReactElement => {
  const audio = useStudioPlaybackAudio();
  return (
    <>
      <output data-testid='preference'>
        {audio.muted ? 'muted' : 'audible'}:{audio.volume}
      </output>
      <button aria-label='Sync media preference' onClick={() => audio.syncFromMedia({ muted: false, volume: 0.6 })}>
        Sync
      </button>
      <button aria-label='Repeat media preference' onClick={() => audio.syncFromMedia(audio)}>
        Repeat
      </button>
      <button aria-label='Clamp low volume' onClick={() => audio.setVolume(-1)}>
        Low
      </button>
      <button aria-label='Clamp high volume' onClick={() => audio.setVolume(2)}>
        High
      </button>
      <button aria-label='Reject invalid volume' onClick={() => audio.setVolume(Number.NaN)}>
        Invalid
      </button>
    </>
  );
};

const renderPreference = (projectId: string, storage: Storage | null = window.localStorage) =>
  render(
    <StudioPlaybackAudioProvider projectId={projectId} storage={storage}>
      <Probe />
      <StudioPlaybackAudioControl />
    </StudioPlaybackAudioProvider>
  );

describe('Studio playback audio preference', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults audible, persists owner mute and volume choices, and restores them for the project', () => {
    /*
     * Audible is the default because nothing here autoplays: playback is behind an explicit Play
     * press, so the browser constraint that makes muted-by-default correct on the web does not
     * apply, and a review tool that opens silent is not a review tool.
     */
    const first = renderPreference('project_1');
    expect(screen.getByTestId('preference')).toHaveTextContent('audible:1');

    fireEvent.click(screen.getByRole('button', { name: /playbackAudio\.mute$/ }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '35' } });
    expect(screen.getByTestId('preference')).toHaveTextContent('muted:0.35');
    expect(JSON.parse(window.localStorage.getItem(studioPlaybackAudioStorageKey('project_1'))!)).toEqual({
      muted: true,
      volume: 0.35,
    });

    first.unmount();
    renderPreference('project_1');
    expect(screen.getByTestId('preference')).toHaveTextContent('muted:0.35');
  });

  it('names the control by what pressing it does, not by the state it is in', () => {
    /*
     * The regression this guards: the visible word was the state ("Muted"/"Sound on") while only
     * the aria-label carried the action. A sighted reviewer saw a status word between a timecode
     * and a volume slider and never read it as pressable, so the shot audio looked missing.
     */
    renderPreference('project_1');
    // Selected by accessible name on purpose: that the name IS the action is the fix.
    const audible = screen.getByRole('button', { name: /playbackAudio\.mute$/ });
    expect(audible).toHaveTextContent('playbackAudio.mute');
    expect(audible).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(audible);
    const muted = screen.getByRole('button', { name: /playbackAudio\.unmute$/ });
    expect(muted).toHaveTextContent('playbackAudio.unmute');
    expect(muted).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches scope without exposing the previous project preference', () => {
    window.localStorage.setItem(
      studioPlaybackAudioStorageKey('project_1'),
      JSON.stringify({ muted: false, volume: 0.4 })
    );
    const view = render(
      <StudioPlaybackAudioProvider projectId='project_1'>
        <Probe />
      </StudioPlaybackAudioProvider>
    );
    expect(screen.getByTestId('preference')).toHaveTextContent('audible:0.4');

    view.rerender(
      <StudioPlaybackAudioProvider projectId='project_2'>
        <Probe />
      </StudioPlaybackAudioProvider>
    );
    expect(screen.getByTestId('preference')).toHaveTextContent('audible:1');
  });

  it('accepts the Slider range shape, normalizes media updates, and avoids redundant persistence', () => {
    renderPreference('project_1');
    const slider = screen.getByRole('slider');

    fireEvent.doubleClick(slider);
    expect(screen.getByTestId('preference')).toHaveTextContent('audible:0.25');
    fireEvent.click(screen.getByRole('button', { name: 'Sync media preference' }));
    expect(screen.getByTestId('preference')).toHaveTextContent('audible:0.6');

    const beforeRepeat = window.localStorage.getItem(studioPlaybackAudioStorageKey('project_1'));
    fireEvent.click(screen.getByRole('button', { name: 'Repeat media preference' }));
    expect(window.localStorage.getItem(studioPlaybackAudioStorageKey('project_1'))).toBe(beforeRepeat);

    fireEvent.click(screen.getByRole('button', { name: 'Clamp low volume' }));
    expect(screen.getByTestId('preference')).toHaveTextContent('audible:0');
    fireEvent.click(screen.getByRole('button', { name: 'Clamp high volume' }));
    expect(screen.getByTestId('preference')).toHaveTextContent('audible:1');
    fireEvent.click(screen.getByRole('button', { name: 'Reject invalid volume' }));
    expect(screen.getByTestId('preference')).toHaveTextContent('audible:1');
  });

  it('uses the default and no-ops when no preference storage is available', () => {
    expect(readStudioPlaybackAudioPreference('project_1', null)).toEqual({ muted: false, volume: 1 });
    expect(() => storeStudioPlaybackAudioPreference('project_1', { muted: false, volume: 0.5 }, null)).not.toThrow();
  });

  it.each([
    ['malformed JSON', '{'],
    ['wrong shape', JSON.stringify({ muted: 'false', volume: 1 })],
    ['out-of-range volume', JSON.stringify({ muted: false, volume: 2 })],
  ])('falls back to the default for %s', (_label, serialized) => {
    /*
     * "Fails closed" was the old framing, when the fallback was silence. The fallback is now the
     * ordinary default; what matters is that an unreadable preference is discarded rather than
     * partially believed.
     */
    window.localStorage.setItem(studioPlaybackAudioStorageKey('project_1'), serialized);
    expect(readStudioPlaybackAudioPreference('project_1')).toEqual({ muted: false, volume: 1 });
  });

  it('retains the in-memory owner choice when storage throws', () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    renderPreference('project_1', throwingStorage);
    expect(screen.getByTestId('preference')).toHaveTextContent('audible:1');
    fireEvent.click(screen.getByRole('button', { name: /playbackAudio\.mute$/ }));
    expect(screen.getByTestId('preference')).toHaveTextContent('muted:1');
  });
});
