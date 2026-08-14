/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { GenerationReviewRouteSnapshot } from '@renderer/pages/studio/components/Generation/generationRequests';
import {
  GenerationReviewModal,
  type GenerationReviewModalProps,
  type GenerationReviewScene,
} from '@renderer/pages/studio/components/Generation/GenerationReviewModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}:${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(',')}`
        : key,
  }),
}));

const route = (
  sceneId: string,
  kind: 'image' | 'video',
  providerId: string,
  choiceId: string,
  model: string
): GenerationReviewRouteSnapshot => ({
  sceneId,
  kind,
  providerId,
  choiceId,
  model,
});

const imageRoute = route('scene-image', 'image', 'provider_image', 'choice_image', 'image-model-v1');
const videoRoute = route('scene-video', 'video', 'provider_video', 'choice_video', 'seedance-1-5-pro');

const validReviewRoute = (
  snapshot: GenerationReviewRouteSnapshot,
  providerName: string,
  silentOutput: boolean
): GenerationReviewScene['route'] => ({ status: 'valid', snapshot, providerName, silentOutput });

const mixedScenes = (): GenerationReviewScene[] => [
  {
    id: 'scene-image',
    title: 'Opening image',
    mediaKind: 'image',
    outputRole: 'take',
    durationSeconds: 5,
    promptText: 'A paper airplane crossing a sunrise',
    route: validReviewRoute(imageRoute, 'Provider One', true),
  },
  {
    id: 'scene-video',
    title: 'Product motion',
    mediaKind: 'video',
    outputRole: 'take',
    durationSeconds: 7,
    promptText: 'A product turning slowly',
    route: validReviewRoute(videoRoute, 'Provider Two', false),
  },
];

const breach = { ruleId: 'rule_1', ruleText: 'No competitor logos.', scope: 'project' as const, matchedTerm: 'acme' };

const breachingScene = (): GenerationReviewScene => ({
  ...mixedScenes()[0]!,
  id: 'scene-image',
  title: 'Opening image',
  promptText: 'An ACME billboard at dusk',
});

const createProps = (overrides: Partial<GenerationReviewModalProps> = {}): GenerationReviewModalProps => ({
  visible: true,
  mode: 'batch',
  scenes: mixedScenes(),
  aspectRatio: '16:9',
  resolution: '720p',
  targetDurationSeconds: 12,
  selectedDurationSeconds: 12,
  projectDurationSeconds: 12,
  submitting: false,
  errorMessageKey: null,
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  ...overrides,
});

describe('GenerationReviewModal', () => {
  it('names the breached rule on the shot and blocks Confirm before anything is charged', () => {
    render(
      <GenerationReviewModal
        {...createProps({
          mode: 'single',
          scenes: [breachingScene()],
          ruleBreachesBySceneId: { 'scene-image': [breach] },
        })}
      />
    );

    expect(
      screen.getByText('conversation.creativeStudio.rules.breachScene:rule=No competitor logos.,term=acme')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.rules.breachBlockedConfirm')).toBeInTheDocument();
  });

  it('offers to hand the breach to the Director rather than leaving a dead end', () => {
    const onAskDirector = vi.fn();
    render(
      <GenerationReviewModal
        {...createProps({
          mode: 'single',
          scenes: [breachingScene()],
          ruleBreachesBySceneId: { 'scene-image': [breach] },
          onAskDirector,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.breachAskDirector' }));

    expect(onAskDirector).toHaveBeenCalledTimes(1);
  });

  it('hides the ask-the-Director affordance when the page cannot supply it', () => {
    render(
      <GenerationReviewModal
        {...createProps({
          mode: 'single',
          scenes: [breachingScene()],
          ruleBreachesBySceneId: { 'scene-image': [breach] },
        })}
      />
    );

    // Task 10 ships before Task 11 wires the sender, so `onAskDirector` is absent in between. A button
    // that does nothing is worse than no button.
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.rules.breachAskDirector' })
    ).not.toBeInTheDocument();
  });

  it('blocks Confirm for the whole batch when one shot breaches, and says so', () => {
    render(<GenerationReviewModal {...createProps({ ruleBreachesBySceneId: { 'scene-image': [breach] } })} />);

    // main aborts the entire submitScenes call on the first breach (jobManager.ts:1297), so a
    // per-shot reading of this copy would be wrong.
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.rules.breachBlockedConfirm')).toBeInTheDocument();
  });

  it('names the breached rule on a batch shot even when that media kind has no route', () => {
    const routelessVideo = {
      ...mixedScenes()[1]!,
      route: { status: 'missing' as const, snapshot: null, providerName: null },
    };
    render(
      <GenerationReviewModal
        {...createProps({
          scenes: [routelessVideo],
          ruleBreachesBySceneId: { 'scene-video': [breach] },
        })}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.review.missingRoute')).toBeInTheDocument();
    expect(
      screen.getByText('conversation.creativeStudio.rules.breachScene:rule=No competitor logos.,term=acme')
    ).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.rules.breachBlockedConfirm')).toBeInTheDocument();
  });

  it('leaves Confirm alone when no rule is breached', () => {
    render(<GenerationReviewModal {...createProps({ mode: 'single', scenes: [mixedScenes()[0]!] })} />);

    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeEnabled();
    expect(screen.queryByText(/rules\.breachScene/)).not.toBeInTheDocument();
  });

  it('discloses every exact mixed-media route and requested output setting', () => {
    render(<GenerationReviewModal {...createProps()} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Provider One')).toBeInTheDocument();
    expect(within(dialog).queryByText('provider_image')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('weprompt-image-v1')).not.toBeInTheDocument();
    expect(within(dialog).getByText('image-model-v1')).toBeInTheDocument();
    expect(within(dialog).getByText('Provider Two')).toBeInTheDocument();
    expect(within(dialog).queryByText('provider_video')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('byteplus-seedance-v1')).not.toBeInTheDocument();
    expect(within(dialog).getByText('seedance-1-5-pro')).toBeInTheDocument();
    expect(within(dialog).getByText('conversation.creativeStudio.review.sceneCount:count=2')).toBeInTheDocument();
    expect(within(dialog).getByText('conversation.creativeStudio.review.videoSeconds:seconds=7')).toBeInTheDocument();
    expect(
      within(dialog).getByText('conversation.creativeStudio.review.selectedDurationFull:count=12,seconds=12')
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('conversation.creativeStudio.review.targetDurationFull:count=12,seconds=12')
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'Opening image' })).getByText(
        'conversation.creativeStudio.scene.durationSeconds:count=5,seconds=5'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'Product motion' })).getByText(
        'conversation.creativeStudio.scene.durationSeconds:count=7,seconds=7'
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByText('16:9')).toBeInTheDocument();
    expect(within(dialog).getByText('720p')).toBeInTheDocument();
  });

  it('states that output is silent when every reviewed route disables audio', () => {
    render(<GenerationReviewModal {...createProps({ scenes: [mixedScenes()[0]!] })} />);

    expect(screen.getByText('conversation.creativeStudio.review.audioOff')).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.review.audioOn')).not.toBeInTheDocument();
  });

  it('does not claim silence when an audio-capable route is reviewed', () => {
    render(<GenerationReviewModal {...createProps({ scenes: [mixedScenes()[1]!] })} />);

    expect(screen.getByText('conversation.creativeStudio.review.audioOn')).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.review.audioOff')).not.toBeInTheDocument();
  });

  it('states that generated audio is included for a mixed silent and audio-capable batch', () => {
    render(<GenerationReviewModal {...createProps()} />);

    expect(screen.getByText('conversation.creativeStudio.review.audioOn')).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.review.audioOff')).not.toBeInTheDocument();
  });

  it('states the charge and watermark policy without inventing billing or audio controls', () => {
    render(<GenerationReviewModal {...createProps()} />);

    expect(screen.getByText('conversation.creativeStudio.review.chargeNotice')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.review.watermarkOff')).toBeInTheDocument();
    expect(screen.queryByText(/credits|estimated cost/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /audio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /audio/i })).not.toBeInTheDocument();
  });

  it('names a reference generation while keeping the charge disclosure visible', () => {
    render(
      <GenerationReviewModal
        {...createProps({
          mode: 'single',
          scenes: [{ ...mixedScenes()[0]!, outputRole: 'reference' }],
        })}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.reference.reviewTag')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.review.chargeNotice')).toBeInTheDocument();
  });

  it('keeps a mismatched batch advisory and submits after explicit confirmation', () => {
    const onConfirm = vi.fn();
    render(<GenerationReviewModal {...createProps({ projectDurationSeconds: 13, onConfirm })} />);

    expect(screen.getAllByText('conversation.creativeStudio.review.durationMismatch')).toHaveLength(1);
    const confirm = screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('allows a ready subset when the canonical full storyboard matches the target', () => {
    render(
      <GenerationReviewModal
        {...createProps({
          scenes: [{ ...mixedScenes()[0]! }, { ...mixedScenes()[1]!, durationSeconds: 5 }],
          selectedDurationSeconds: 10,
          projectDurationSeconds: 15,
          targetDurationSeconds: 15,
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeEnabled();
    expect(
      screen.getByText('conversation.creativeStudio.review.selectedDurationFull:count=10,seconds=10')
    ).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.review.durationMismatch')).not.toBeInTheDocument();
  });

  it('allows a batch when selected ready scenes total 15 seconds and the full storyboard totals 18', () => {
    render(
      <GenerationReviewModal
        {...createProps({
          scenes: [{ ...mixedScenes()[0]! }, { ...mixedScenes()[1]!, durationSeconds: 10 }],
          selectedDurationSeconds: 15,
          projectDurationSeconds: 18,
          targetDurationSeconds: 15,
        })}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.review.durationMismatch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeEnabled();
  });

  it('allows one valid scene despite a whole-storyboard mismatch and submits only after explicit confirmation', () => {
    const onConfirm = vi.fn();
    const props = createProps({
      mode: 'single',
      scenes: [mixedScenes()[1]!],
      targetDurationSeconds: 60,
      onConfirm,
    });
    render(<GenerationReviewModal {...props} />);

    expect(onConfirm).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', {
      name: 'conversation.creativeStudio.review.confirm',
    });
    expect(confirm).toBeEnabled();
    expect(screen.queryByText('conversation.creativeStudio.review.durationMismatch')).not.toBeInTheDocument();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      sceneIds: ['scene-video'],
      routes: [{ sceneId: 'scene-video', choiceId: 'choice_video', kind: 'video' }],
    });
  });

  it('claims nothing about audio when no reviewed route reports a policy', () => {
    render(
      <GenerationReviewModal
        {...createProps({
          scenes: [
            {
              ...mixedScenes()[0]!,
              route: { status: 'missing', snapshot: null, providerName: null },
            },
          ],
        })}
      />
    );

    // Silence is a claim too: with no known policy, assert neither message appears.
    expect(screen.queryByText('conversation.creativeStudio.review.audioOff')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.review.audioOn')).not.toBeInTheDocument();
  });

  it('keeps an invalid route visible while missing or invalid routes disable confirmation', () => {
    const staleRoute = route('scene-video', 'video', 'provider_stale', 'choice_stale', 'open-sora-stale');
    render(
      <GenerationReviewModal
        {...createProps({
          scenes: [
            {
              ...mixedScenes()[0]!,
              route: { status: 'missing', snapshot: null, providerName: null },
            },
            {
              ...mixedScenes()[1]!,
              route: { status: 'invalid', snapshot: staleRoute, providerName: 'Unavailable provider' },
            },
          ],
        })}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.review.missingRoute')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.review.invalidRoute')).toBeInTheDocument();
    expect(screen.getByText('Unavailable provider')).toBeInTheDocument();
    expect(screen.queryByText('provider_stale')).not.toBeInTheDocument();
    expect(screen.queryByText('weprompt-media-gateway-v1')).not.toBeInTheDocument();
    expect(screen.getByText('open-sora-stale')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.review.disabledMissingRoutes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeDisabled();
  });

  it('keeps confirmation blocked after a submission error until the parent supplies a refreshed review', () => {
    const onConfirm = vi.fn();
    render(
      <GenerationReviewModal
        {...createProps({
          submissionBlocked: true,
          errorMessageKey: 'conversation.creativeStudio.errors.invalidRoute',
          onConfirm,
        })}
      />
    );

    expect(
      screen.getByText('conversation.creativeStudio.errors.invalidRoute').closest('[role="alert"]')
    ).toHaveTextContent('conversation.creativeStudio.errors.invalidRoute');
    const confirm = screen.getByRole('button', {
      name: 'conversation.creativeStudio.review.confirm',
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.cancel' })).toBeEnabled();
  });
});
