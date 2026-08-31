/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STUDIO_SHOT_AUDIO_ANALYSIS_PROFILE_V1,
  type StudioCommandResult,
  type StudioShotAudioAnalysisResultV2,
} from '@/common/types/project/creativeStudioTypes';

const mocks = vi.hoisted(() => ({ analyzeShotAudio: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: { creativeStudio: { analyzeShotAudio: { invoke: mocks.analyzeShotAudio } } },
}));

vi.mock('@arco-design/web-react', async () => {
  const ReactModule = await import('react');
  return {
    Button: ({ children }: { children?: React.ReactNode }) => <button type='button'>{children}</button>,
    Slider: () => <input readOnly type='range' />,
    default: ReactModule,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { StudioShotAudioStatus } from '@/renderer/pages/studio/components/PlaybackAudio';
import {
  StudioShotAudioAnalysisProvider,
  useStudioShotAudioAnalysis,
} from '@/renderer/pages/studio/hooks/useStudioShotAudioAnalysis';

type ShotBinding = { shotId: string; assetId: string };

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const ok = (result: StudioShotAudioAnalysisResultV2): StudioCommandResult<StudioShotAudioAnalysisResultV2> => ({
  ok: true,
  data: result,
});

const result = (
  projectRevision: number,
  shots: StudioShotAudioAnalysisResultV2['shots'],
  projectId = 'project_1'
): StudioShotAudioAnalysisResultV2 => ({
  projectId,
  projectRevision,
  profile: STUDIO_SHOT_AUDIO_ANALYSIS_PROFILE_V1,
  shots,
});

const AnalysisProbe: React.FC<{ assetId: string | null; shotId: string }> = ({ assetId, shotId }) => {
  const analysis = useStudioShotAudioAnalysis(shotId, assetId);
  return <span data-testid={`probe-${shotId}`}>{analysis === null ? 'none' : analysis.status}</span>;
};

const Harness: React.FC<{
  projectId?: string;
  projectRevision: number;
  shots: readonly ShotBinding[];
}> = ({ projectId = 'project_1', projectRevision, shots }) => (
  <StudioShotAudioAnalysisProvider projectId={projectId} projectRevision={projectRevision} shots={shots}>
    {shots.map(({ assetId, shotId }) => (
      <section data-testid={`status-${shotId}`} key={shotId}>
        <AnalysisProbe assetId={assetId} shotId={shotId} />
        <StudioShotAudioStatus assetId={assetId} shotId={shotId} />
      </section>
    ))}
    <section data-testid='status-without-current-take'>
      <AnalysisProbe assetId={null} shotId='shot_without_take' />
      <StudioShotAudioStatus assetId={null} shotId='shot_without_take' />
    </section>
  </StudioShotAudioAnalysisProvider>
);

describe('Studio Shot audio analysis provider', () => {
  beforeEach(() => mocks.analyzeShotAudio.mockReset());

  it('renders analyzing, then exact audible and effectively-silent facts for current takes', async () => {
    const request = deferred<StudioCommandResult<StudioShotAudioAnalysisResultV2>>();
    mocks.analyzeShotAudio.mockReturnValueOnce(request.promise);
    const shots = [
      { shotId: 'shot_audible', assetId: 'asset_audible' },
      { shotId: 'shot_silent', assetId: 'asset_silent' },
    ];

    render(<Harness projectRevision={7} shots={shots} />);

    expect(screen.getByTestId('probe-shot_audible')).toHaveTextContent('analyzing');
    expect(screen.getByTestId('probe-shot_silent')).toHaveTextContent('analyzing');
    expect(within(screen.getByTestId('status-without-current-take')).queryByRole('status')).toBeNull();
    await waitFor(() =>
      expect(mocks.analyzeShotAudio).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 7,
        shots,
      })
    );

    await act(async () => {
      request.resolve(
        ok(
          result(7, [
            {
              shotId: 'shot_audible',
              assetId: 'asset_audible',
              status: 'audible',
              meanVolumeDbfs: -18.6,
              peakVolumeDbfs: -4.9,
            },
            {
              shotId: 'shot_silent',
              assetId: 'asset_silent',
              status: 'effectively_silent',
              meanVolumeDbfs: -59.6,
              peakVolumeDbfs: -40.5,
            },
          ])
        )
      );
      await request.promise;
    });

    const audible = within(screen.getByTestId('status-shot_audible')).getByRole('status');
    expect(audible).toHaveAttribute('data-shot-audio-status', 'audible');
    expect(audible).toHaveAttribute('data-mean-volume-dbfs', '-18.6');
    expect(audible).toHaveAttribute('data-peak-volume-dbfs', '-4.9');
    const silent = within(screen.getByTestId('status-shot_silent')).getByRole('status');
    expect(silent).toHaveAttribute('data-shot-audio-status', 'effectively_silent');
    expect(silent).toHaveTextContent(
      'conversation.creativeStudio.workspace.playbackAudio.shotStatus.effectivelySilent'
    );
    expect(screen.getByTestId('probe-shot_audible')).toHaveTextContent('audible');
    expect(screen.getByTestId('probe-shot_silent')).toHaveTextContent('effectively_silent');
    expect(screen.getByTestId('probe-shot_without_take')).toHaveTextContent('none');
  });

  it('fails closed to unavailable when Main refuses the analysis', async () => {
    mocks.analyzeShotAudio.mockResolvedValueOnce({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.workspace.errors.storage' },
    });
    const shot = [{ shotId: 'shot_1', assetId: 'asset_1' }];

    render(<Harness projectRevision={7} shots={shot} />);
    await waitFor(() => expect(screen.getByTestId('probe-shot_1')).toHaveTextContent('unavailable'));
    expect(within(screen.getByTestId('status-shot_1')).getByRole('status')).toHaveAttribute(
      'data-shot-audio-status',
      'unavailable'
    );
  });

  it('fails closed to unavailable when the analysis bridge rejects', async () => {
    mocks.analyzeShotAudio.mockRejectedValueOnce(new Error('bridge unavailable'));
    const shot = [{ shotId: 'shot_1', assetId: 'asset_1' }];

    render(<Harness projectRevision={8} shots={shot} />);
    await waitFor(() => expect(screen.getByTestId('probe-shot_1')).toHaveTextContent('unavailable'));
    expect(mocks.analyzeShotAudio).toHaveBeenCalledTimes(1);
  });

  it('rejects a response that does not match the exact current project revision', async () => {
    mocks.analyzeShotAudio.mockResolvedValueOnce(
      ok(
        result(6, [
          {
            shotId: 'shot_1',
            assetId: 'asset_1',
            status: 'audible',
            meanVolumeDbfs: -12,
            peakVolumeDbfs: -2,
          },
        ])
      )
    );

    render(<Harness projectRevision={7} shots={[{ shotId: 'shot_1', assetId: 'asset_1' }]} />);

    await waitFor(() => expect(screen.getByTestId('probe-shot_1')).toHaveTextContent('unavailable'));
    expect(within(screen.getByTestId('status-shot_1')).getByRole('status')).not.toHaveAttribute(
      'data-mean-volume-dbfs'
    );
  });

  it('ignores an older request that resolves after a newer current-take analysis', async () => {
    const oldRequest = deferred<StudioCommandResult<StudioShotAudioAnalysisResultV2>>();
    const currentRequest = deferred<StudioCommandResult<StudioShotAudioAnalysisResultV2>>();
    mocks.analyzeShotAudio.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(currentRequest.promise);
    const view = render(<Harness projectRevision={7} shots={[{ shotId: 'shot_1', assetId: 'asset_old' }]} />);
    await waitFor(() => expect(mocks.analyzeShotAudio).toHaveBeenCalledTimes(1));

    view.rerender(<Harness projectRevision={8} shots={[{ shotId: 'shot_1', assetId: 'asset_current' }]} />);
    expect(screen.getByTestId('probe-shot_1')).toHaveTextContent('analyzing');
    await waitFor(() => expect(mocks.analyzeShotAudio).toHaveBeenCalledTimes(2));
    await act(async () => {
      currentRequest.resolve(
        ok(
          result(8, [
            {
              shotId: 'shot_1',
              assetId: 'asset_current',
              status: 'audible',
              meanVolumeDbfs: -16,
              peakVolumeDbfs: -3,
            },
          ])
        )
      );
      await currentRequest.promise;
    });
    expect(screen.getByTestId('probe-shot_1')).toHaveTextContent('audible');

    await act(async () => {
      oldRequest.resolve(
        ok(
          result(7, [
            {
              shotId: 'shot_1',
              assetId: 'asset_old',
              status: 'effectively_silent',
              meanVolumeDbfs: -60,
              peakVolumeDbfs: -42,
            },
          ])
        )
      );
      await oldRequest.promise;
    });

    const current = within(screen.getByTestId('status-shot_1')).getByRole('status');
    expect(current).toHaveAttribute('data-shot-audio-status', 'audible');
    expect(current).toHaveAttribute('data-mean-volume-dbfs', '-16');
  });

  it('does not ask Main to analyze an empty current-take set', async () => {
    render(<Harness projectRevision={7} shots={[]} />);
    await act(async () => Promise.resolve());
    expect(mocks.analyzeShotAudio).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe-shot_without_take')).toHaveTextContent('none');
  });
});
