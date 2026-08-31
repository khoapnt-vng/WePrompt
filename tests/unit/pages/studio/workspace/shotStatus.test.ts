/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  deriveWorkspaceShotStatus,
  WORKSPACE_SHOT_STATUS_WORDS,
  type WorkspaceShotStatusInput,
} from '@/renderer/pages/studio/components/Workspace/Views/shotStatus';

const picture: NonNullable<WorkspaceShotStatusInput['currentPicture']> = {
  assetId: 'asset_picture',
  sourceDurationSeconds: 4,
  posterAssetId: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  prompt: 'Recorded prompt.',
  promptChanged: false,
  firstFrameChanged: false,
};

const input = (overrides: Partial<WorkspaceShotStatusInput> = {}): WorkspaceShotStatusInput => ({
  segmentState: { kind: 'no_picture' },
  attentionJobs: [],
  videoGenerationInFlight: false,
  seedGenerationInFlight: false,
  currentPicture: null,
  dirtyCauses: [],
  latestVideoAttemptFailed: false,
  hasEffectiveSeed: false,
  ...overrides,
});

describe('shared Workspace Shot status', () => {
  it('owns exactly the six canonical status words', () => {
    expect(WORKSPACE_SHOT_STATUS_WORDS).toEqual(['notReady', 'ready', 'queued', 'rendering', 'rendered', 'failed']);
    expect(new Set(WORKSPACE_SHOT_STATUS_WORDS).size).toBe(6);
  });

  it.each([
    [
      'conditioning failure before every Shot fact',
      input({
        segmentState: { kind: 'rendering', progressPercent: 70, showingStill: false },
        videoGenerationInFlight: true,
        currentPicture: picture,
        hasEffectiveSeed: true,
      }),
      true,
      { word: 'rendered', stale: false, latestAttemptFailed: false },
    ],
    [
      'never-dispatched segment',
      input({ segmentState: { kind: 'never_dispatched' }, currentPicture: picture, hasEffectiveSeed: true }),
      false,
      { word: 'rendered', stale: false, latestAttemptFailed: false },
    ],
    [
      'unbilled failure segment',
      input({ segmentState: { kind: 'failed_unbilled' }, videoGenerationInFlight: true }),
      false,
      { word: 'failed', stale: false, latestAttemptFailed: false },
    ],
    [
      'attention segment',
      input({ segmentState: { kind: 'needs_attention' }, videoGenerationInFlight: true }),
      false,
      { word: 'failed', stale: false, latestAttemptFailed: false },
    ],
    [
      'attention job fallback',
      input({
        attentionJobs: [
          {
            id: 'job_attention',
            purpose: 'video_take',
            error: {
              code: 'provider_unavailable',
              messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
            },
            canCancel: false,
            canRetry: true,
          },
        ],
        currentPicture: picture,
      }),
      false,
      { word: 'rendered', stale: false, latestAttemptFailed: false },
    ],
    [
      'rendering segment',
      input({
        segmentState: { kind: 'rendering', progressPercent: null, showingStill: false },
        currentPicture: picture,
      }),
      false,
      { word: 'rendering', stale: false, latestAttemptFailed: false },
    ],
    [
      'queued segment',
      input({ segmentState: { kind: 'queued' }, currentPicture: picture }),
      false,
      { word: 'queued', stale: false, latestAttemptFailed: false },
    ],
    [
      'Shot dependency queue',
      input({ segmentState: { kind: 'waiting_on_shot', upstreamShotNumber: 1 }, currentPicture: picture }),
      false,
      { word: 'queued', stale: false, latestAttemptFailed: false },
    ],
    [
      'frame dependency queue',
      input({ segmentState: { kind: 'waiting_on_frame' }, currentPicture: picture }),
      false,
      { word: 'queued', stale: false, latestAttemptFailed: false },
    ],
    [
      'video in-flight fallback',
      input({
        segmentState: { kind: 'stale' },
        videoGenerationInFlight: true,
        currentPicture: picture,
      }),
      false,
      { word: 'rendering', stale: false, latestAttemptFailed: false },
    ],
    [
      'seed in-flight fallback',
      input({
        segmentState: { kind: 'needs_rerender' },
        seedGenerationInFlight: true,
        currentPicture: picture,
      }),
      false,
      { word: 'rendering', stale: false, latestAttemptFailed: false },
    ],
    [
      'stale continuity segment',
      input({ segmentState: { kind: 'stale' } }),
      false,
      { word: 'rendered', stale: true, latestAttemptFailed: false },
    ],
    [
      'out-of-date generation segment',
      input({ segmentState: { kind: 'needs_rerender' }, currentPicture: picture }),
      false,
      { word: 'rendered', stale: true, latestAttemptFailed: false },
    ],
    [
      'current picture',
      input({ currentPicture: picture }),
      false,
      { word: 'rendered', stale: false, latestAttemptFailed: false },
    ],
    [
      'effective seed',
      input({ hasEffectiveSeed: true }),
      false,
      { word: 'ready', stale: false, latestAttemptFailed: false },
    ],
    ['empty Shot', input(), false, { word: 'notReady', stale: false, latestAttemptFailed: false }],
  ] as const)('preserves priority for %s', (_case, shot, conditioningFailed, expected) => {
    expect(deriveWorkspaceShotStatus(shot, conditioningFailed)).toEqual(expected);
  });

  it('keeps usable footage rendered while qualifying an exact failed replacement', () => {
    expect(
      deriveWorkspaceShotStatus(
        input({
          segmentState: { kind: 'failed_unbilled' },
          currentPicture: picture,
          latestVideoAttemptFailed: true,
        }),
        false
      )
    ).toEqual({ word: 'rendered', stale: false, latestAttemptFailed: true });
  });

  it('reserves FAILED for a Shot without usable footage and does not turn its failure into a qualifier', () => {
    expect(
      deriveWorkspaceShotStatus(
        input({ segmentState: { kind: 'failed_unbilled' }, latestVideoAttemptFailed: true }),
        false
      )
    ).toEqual({ word: 'failed', stale: false, latestAttemptFailed: false });
  });

  it('keeps failure and staleness as independent qualifiers on usable footage', () => {
    expect(
      deriveWorkspaceShotStatus(
        input({
          segmentState: { kind: 'needs_attention' },
          currentPicture: picture,
          dirtyCauses: ['continuity_stale'],
          latestVideoAttemptFailed: true,
        }),
        false
      )
    ).toEqual({ word: 'rendered', stale: true, latestAttemptFailed: true });
  });

  it('does not let historical attention overwrite a current Shot or claim the latest attempt failed', () => {
    expect(
      deriveWorkspaceShotStatus(
        input({
          segmentState: { kind: 'rendered' },
          currentPicture: picture,
          attentionJobs: [
            {
              id: 'job_old_attention',
              purpose: 'video_take',
              error: {
                code: 'provider_unavailable',
                messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
              },
              canCancel: false,
              canRetry: true,
            },
          ],
        }),
        false
      )
    ).toEqual({ word: 'rendered', stale: false, latestAttemptFailed: false });
  });

  it('keeps an active replacement ahead of retained footage and terminal qualifiers', () => {
    expect(
      deriveWorkspaceShotStatus(
        input({
          segmentState: { kind: 'rendering', progressPercent: 50, showingStill: false },
          currentPicture: picture,
          dirtyCauses: ['continuity_stale'],
          latestVideoAttemptFailed: true,
          attentionJobs: [
            {
              id: 'job_old_attention',
              purpose: 'video_take',
              error: {
                code: 'provider_unavailable',
                messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
              },
              canCancel: false,
              canRetry: true,
            },
          ],
        }),
        false
      )
    ).toEqual({ word: 'rendering', stale: false, latestAttemptFailed: false });
  });
});
