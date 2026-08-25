/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCascadeProgressV2,
  StudioGenerationBlockV2,
  StudioRendererParkEligibilityV2,
} from '@/common/types/project/creativeStudioTypes';
import type {
  UseWorkspaceDraftsResult,
  WorkspaceDraftEntry,
} from '@/renderer/pages/studio/components/Workspace/useWorkspaceDrafts';
import type {
  WorkspaceBeatProjection,
  WorkspaceProjection,
  WorkspaceSeedStillProjection,
  WorkspaceShotProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';

const modalConfirm = vi.hoisted(() => vi.fn());

vi.mock('@arco-design/web-react', async () => {
  const ReactModule = await import('react');
  const Button = ReactModule.forwardRef<HTMLButtonElement, any>(
    (
      { children, icon, loading: _loading, shape: _shape, size: _size, status: _status, type: _type, ...props },
      ref
    ) => (
      <button ref={ref} {...props}>
        {icon}
        {children}
      </button>
    )
  );
  const TextArea = ({ autoSize, onChange, ...props }: any) => (
    <textarea
      {...props}
      data-max-rows={autoSize?.maxRows}
      data-min-rows={autoSize?.minRows}
      onChange={(event) => onChange?.(event.target.value)}
    />
  );
  const Input = Object.assign(
    ({ onChange, ...props }: any) => <input {...props} onChange={(event) => onChange?.(event.target.value)} />,
    { TextArea }
  );
  const InputNumber = ({ onChange, precision: _precision, ...props }: any) => (
    <input
      {...props}
      type='number'
      onChange={(event) => onChange?.(event.target.value === '' ? undefined : Number(event.target.value))}
    />
  );
  const optionText = (value: React.ReactNode): string =>
    ReactModule.Children.toArray(value)
      .map((child) => {
        if (typeof child === 'string' || typeof child === 'number') return String(child);
        if (!ReactModule.isValidElement(child)) return '';
        return optionText((child.props as { children?: React.ReactNode }).children);
      })
      .join('');
  const Select = Object.assign(
    ({ allowClear: _allowClear, children, onChange, placeholder, value, ...props }: any) => (
      <select {...props} onChange={(event) => onChange?.(event.target.value || undefined)} value={value ?? ''}>
        <option value=''>{placeholder}</option>
        {children}
      </select>
    ),
    {
      Option: ({ children, value }: any) => <option value={value}>{optionText(children)}</option>,
    }
  );
  const Checkbox = ({ checked, children, onChange, ...props }: any) => (
    <label>
      <input {...props} checked={checked} type='checkbox' onChange={(event) => onChange?.(event.target.checked)} />
      {children}
    </label>
  );
  type MockTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement>;
  type MockDropdownProps = {
    children: React.ReactElement<MockTriggerProps>;
    droplist: React.ReactNode;
    onVisibleChange?: (visible: boolean) => void;
    popupVisible?: boolean;
  };
  const Dropdown = ({ children, droplist, onVisibleChange, popupVisible }: MockDropdownProps) => {
    const visible = Boolean(popupVisible);
    const child = children.props;
    const trigger = ReactModule.cloneElement(children, {
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        child.onClick?.(event);
        if (!child.disabled) onVisibleChange?.(!visible);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        child.onKeyDown?.(event);
        if (!child.disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onVisibleChange?.(!visible);
        }
      },
    });
    return (
      <>
        {trigger}
        {visible ? droplist : null}
      </>
    );
  };
  type MockMenuProps = React.HTMLAttributes<HTMLDivElement>;
  type MockMenuItemProps = React.ButtonHTMLAttributes<HTMLButtonElement>;
  const Menu = Object.assign(
    ({ children, ...props }: MockMenuProps) => (
      <div role='menu' {...props}>
        {children}
      </div>
    ),
    {
      Item: ({ children, disabled, onClick, ...props }: MockMenuItemProps) => (
        <button disabled={disabled} onClick={onClick} role='menuitem' type='button' {...props}>
          {children}
        </button>
      ),
    }
  );
  const Modal = Object.assign(
    ({ children, closable, onCancel, title, visible }: any) =>
      visible ? (
        <div aria-label={String(title)} role='dialog'>
          {closable ? (
            <button aria-label='Close' onClick={onCancel} type='button'>
              ×
            </button>
          ) : null}
          {children}
        </div>
      ) : null,
    { confirm: modalConfirm }
  );
  const Popconfirm = ({ cancelText, children, content, disabled, okText, onCancel, onOk, title }: any) => {
    const childLabel = ReactModule.isValidElement(children)
      ? optionText((children.props as { children?: React.ReactNode }).children)
      : '';
    const trigger =
      childLabel === String(okText) && ReactModule.isValidElement(children)
        ? ReactModule.cloneElement(children, { disabled, onClick: () => onOk?.() } as any)
        : children;
    return (
      <section aria-label={String(title)} role='group'>
        {trigger}
        <p>{content}</p>
        {childLabel === String(okText) ? null : (
          <button disabled={disabled} onClick={() => onOk?.()} type='button'>
            {okText}
          </button>
        )}
        <button onClick={onCancel} type='button'>
          {cancelText}
        </button>
      </section>
    );
  };
  const Alert = ({ content, type }: any) => <div role={type === 'error' ? 'alert' : 'status'}>{content}</div>;
  return {
    Alert,
    Button,
    Checkbox,
    Dropdown,
    Input,
    InputNumber,
    Menu,
    Modal,
    Popconfirm,
    Select,
    default: ReactModule,
  };
});

vi.mock('@icon-park/react', () => ({
  FullScreen: (props: Record<string, unknown>) => <span data-icon='fullscreen' {...props} />,
  MoreOne: (props: Record<string, unknown>) => <span data-icon='more' {...props} />,
  Notes: (props: Record<string, unknown>) => <span data-icon='notes' {...props} />,
  OffScreen: (props: Record<string, unknown>) => <span data-icon='offscreen' {...props} />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const copy: Record<string, string> = {
        'common.collapse': 'Collapse',
        'common.expand': 'Expand',
        'common.more': 'More actions',
        'conversation.creativeStudio.workspace.beatPanel.beatFieldsLabel': 'Beat fields',
        'conversation.creativeStudio.workspace.beatPanel.blocker.statusUnavailable': 'Status unavailable',
        'conversation.creativeStudio.workspace.beatPanel.blocker.unsavedDrafts': 'Save or reset local edits first',
        'conversation.creativeStudio.workspace.beatPanel.chain.authorHardCut': 'Author hard cut',
        'conversation.creativeStudio.workspace.beatPanel.chain.continuous':
          'Continues from Shot {{position}}’s last frame',
        'conversation.creativeStudio.workspace.beatPanel.chain.hardCut': 'Hard cut',
        'conversation.creativeStudio.workspace.beatPanel.chain.hardCutState': 'Hard cut · Starts from the first frame',
        'conversation.creativeStudio.workspace.beatPanel.chain.hardCutUnavailable':
          'Hard-cut changes are temporarily unavailable. A reviewed estimate for the required replacement media must come first.',
        'conversation.creativeStudio.workspace.beatPanel.chain.reviewSever': 'Review hard cut…',
        'conversation.creativeStudio.workspace.beatPanel.chain.reviewRejoin': 'Review rejoin…',
        'conversation.creativeStudio.workspace.beatPanel.chain.generationOutOfDate': 'Generated work is out of date',
        'conversation.creativeStudio.workspace.beatPanel.chain.segmentHead':
          'Head of the chain · Starts from the first frame',
        'conversation.creativeStudio.workspace.beatPanel.chain.systemContinuityStale': 'System continuity is stale',
        'conversation.creativeStudio.workspace.beatPanel.common.cancel': 'Cancel',
        'conversation.creativeStudio.workspace.beatPanel.common.keepWaiting': 'Keep waiting',
        'conversation.creativeStudio.workspace.beatPanel.common.resetBeat': 'Reset Beat',
        'conversation.creativeStudio.workspace.beatPanel.common.resetShot': 'Reset Shot',
        'conversation.creativeStudio.workspace.beatPanel.common.saveBeat': 'Save Beat',
        'conversation.creativeStudio.workspace.beatPanel.common.saveShot': 'Save Shot',
        'conversation.creativeStudio.workspace.beatPanel.coverage.reviewResplit': 'Review re-split',
        'conversation.creativeStudio.workspace.beatPanel.fields.duration': 'Duration',
        'conversation.creativeStudio.workspace.beatPanel.fields.shootingScript': 'Shooting script',
        'conversation.creativeStudio.workspace.beatPanel.fields.story': 'Story',
        'conversation.creativeStudio.workspace.beatPanel.fields.targetSeconds': 'Beat target',
        'conversation.creativeStudio.workspace.beatPanel.generation.gateLocked': 'A confirmation is open',
        'conversation.creativeStudio.workspace.beatPanel.generation.generateSeed': 'Review first-frame generation',
        'conversation.creativeStudio.workspace.beatPanel.generation.noReference': 'No Brief reference',
        'conversation.creativeStudio.workspace.beatPanel.generation.purpose.seedStill': 'first frame',
        'conversation.creativeStudio.scene.video': 'Video',
        'conversation.creativeStudio.workspace.beatPanel.generation.renderVideo': 'Generate again',
        'conversation.creativeStudio.workspace.beatPanel.generation.reviewUnavailable':
          'Generation review is unavailable',
        'conversation.creativeStudio.models.blocked.catalogUnloaded': 'The engine list has not loaded yet.',
        'conversation.creativeStudio.models.blocked.duration': 'This engine cannot make a shot {{seconds}}s long.',
        'conversation.creativeStudio.models.blocked.notAnswering': 'The engine is not answering.',
        'conversation.creativeStudio.models.blocked.actionSetEngines': 'Set engines',
        'conversation.creativeStudio.models.blocked.actionShorten': 'Adjust shot length',
        'conversation.creativeStudio.references.bindings.unassigned': 'This Shot has no reference decision yet.',
        'conversation.creativeStudio.workspace.gate.reviewShotBinding': 'Review Shot binding',
        'conversation.creativeStudio.workspace.beatPanel.lift.beat': 'Move to Bin',
        'conversation.creativeStudio.workspace.beatPanel.lift.beatTitle': 'Move this Beat to the Bin?',
        'conversation.creativeStudio.workspace.beatPanel.lift.confirmBeat': 'Move to Bin',
        'conversation.creativeStudio.workspace.beatPanel.lift.confirmShot': 'Move to Bin',
        'conversation.creativeStudio.workspace.beatPanel.lift.shot': 'Move to Bin',
        'conversation.creativeStudio.workspace.beatPanel.lift.shotFailed': 'Shot was not moved to the Bin.',
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelBody': 'Cancel this waiting item only',
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelAndReviewRejoin': 'Cancel and review rejoin',
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelAndReviewRejoinBody':
          'Cancel the waiting authorized work, then review a fresh rejoin quote.',
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelAndReviewRejoinConfirm':
          'Confirm cancel and review',
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelAndReviewRejoinTitle':
          'Cancel authorized work and review rejoin?',
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelConfirm': 'Confirm cancel waiting',
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelTitle': 'Cancel waiting?',
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelWaiting': 'Cancel waiting',
        'conversation.creativeStudio.workspace.beatPanel.recovery.freshQuoteRequired': 'A fresh quote is required',
        'conversation.creativeStudio.workspace.beatPanel.recovery.label': 'Part done recovery',
        'conversation.creativeStudio.workspace.beatPanel.recovery.localConditioningFailure':
          'The local conditioning frame failed',
        'conversation.creativeStudio.workspace.beatPanel.recovery.retryFree': 'Retry conditioning free',
        'conversation.creativeStudio.workspace.beatPanel.recovery.title': 'Part done',
        'conversation.creativeStudio.workspace.beatPanel.reorder.nextShort': 'Down',
        'conversation.creativeStudio.workspace.beatPanel.reorder.previousShort': 'Up',
        'conversation.creativeStudio.workspace.beatPanel.seeds.clearPin': 'Clear first-frame pin',
        'conversation.creativeStudio.workspace.beatPanel.seeds.authorizationIncompatible':
          'Not available to authorized work',
        'conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked':
          'Authorized video work has locked this Shot’s first frame. Imported candidates remain stored, but cannot replace the seed in the reviewed quote.',
        'conversation.creativeStudio.workspace.beatPanel.seeds.empty': 'No first frames yet.',
        'conversation.creativeStudio.workspace.beatPanel.seeds.import': 'Import first frame',
        'conversation.creativeStudio.workspace.beatPanel.seeds.latestDefault':
          'The latest eligible image is the current first frame.',
        'conversation.creativeStudio.workspace.beatPanel.seeds.pending':
          'A first frame is required before video generation.',
        'conversation.creativeStudio.workspace.beatPanel.seeds.pin': 'Pin as first frame',
        'conversation.creativeStudio.workspace.beatPanel.seeds.pinned': 'A first frame is pinned.',
        'conversation.creativeStudio.workspace.beatPanel.seeds.title': 'First frames',
        'conversation.creativeStudio.workspace.beatPanel.seeds.effective': 'Current first frame',
        'conversation.creativeStudio.workspace.beatPanel.seeds.pinnedBadge': 'Pinned',
        'conversation.creativeStudio.workspace.beatPanel.shots.empty': 'No coverage yet',
        'conversation.creativeStudio.workspace.beatPanel.shots.label': 'Shots',
        'conversation.creativeStudio.workspace.beatPanel.picture.empty': 'Nothing rendered yet',
        'conversation.creativeStudio.workspace.beatPanel.picture.title': 'Current picture',
        'conversation.creativeStudio.workspace.beatPanel.picture.unavailable': 'Current picture unavailable',
        'conversation.creativeStudio.workspace.beatPanel.previousBeat': 'Previous Beat',
        'conversation.creativeStudio.workspace.beatPanel.previousBeatShort': 'Previous',
        'conversation.creativeStudio.workspace.beatPanel.nextBeat': 'Next Beat',
        'conversation.creativeStudio.workspace.beatPanel.nextBeatShort': 'Next',
        'conversation.creativeStudio.workspace.beatPanel.coverage.label': 'Coverage',
        'conversation.creativeStudio.workspace.beatPanel.coverage.empty': 'No shots to cover',
        'conversation.creativeStudio.workspace.beatPanel.coverage.unavailable': 'Coverage unavailable',
        'conversation.creativeStudio.workspace.beatPanel.coverage.playbackLane': 'Playback lane',
        'conversation.creativeStudio.workspace.beatPanel.coverage.planningLane': 'Planning lane',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.noPicture': 'No picture',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.queued': 'Queued',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.nextUp': 'Next up',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.waitingOnFrame': 'Waiting on the frame',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.rendering': 'Rendering',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.renderingStill':
          'Rendering · Showing the first frame',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.rendered': 'Rendered',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.untouched': 'Untouched',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.needsRerender': 'Needs a re-render',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.staleStillPlays': 'Stale · Still plays',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.failedNotBilled': 'Failed · Not billed',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.neverDispatched': 'Never dispatched',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.statusPending': 'Status unavailable',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.needsAttention': 'Needs attention',
        'conversation.creativeStudio.workspace.beatPanel.coverage.seekGuidance': 'Rail · Seek · Free',
        'conversation.creativeStudio.workspace.beatPanel.coverage.seekLane': 'Beat seek rail',
        'conversation.creativeStudio.workspace.beatPanel.preview.label': 'Beat preview',
        'conversation.creativeStudio.workspace.beatPanel.preview.noMedia': 'Beat preview unavailable',
        'conversation.creativeStudio.workspace.beatPanel.preview.mediaError':
          'The current picture could not be previewed.',
        'conversation.creativeStudio.workspace.beatPanel.preview.slate': 'Planning slate',
        'conversation.creativeStudio.workspace.beatPanel.preview.play': 'Play Beat',
        'conversation.creativeStudio.workspace.beatPanel.preview.pause': 'Pause Beat',
        'conversation.creativeStudio.workspace.beatPanel.preview.pictureOnly': 'Picture only',
        'conversation.creativeStudio.workspace.beatPanel.preview.controlsLabel': 'Beat transport',
        'conversation.creativeStudio.workspace.beatPanel.preview.previousJoin': 'Previous join',
        'conversation.creativeStudio.workspace.beatPanel.preview.nextJoin': 'Next join',
        'conversation.creativeStudio.workspace.beatPanel.preview.loopJoin': 'Loop nearest join',
        'conversation.creativeStudio.workspace.beatPanel.preview.keyboardGuidance':
          'Space play · Arrows seek · [ ] joins · L loop',
        'conversation.creativeStudio.workspace.beatPanel.fieldGuidance.story': 'Story · What happens in this Beat',
      };
      if (key.endsWith('.title') && key.includes('.beatPanel.title')) return `Edit ${String(values?.title)}`;
      if (key.endsWith('.label') && key.includes('.beatPanel.label')) return `Beat panel ${String(values?.title)}`;
      if (key.endsWith('.untitledBeat')) return `Untitled Beat ${String(values?.index)}`;
      if (key.endsWith('.beatPosition')) return `Beat ${String(values?.index)} of ${String(values?.total)}`;
      if (key.endsWith('.shots.heading')) return `Shot ${String(values?.index)}`;
      if (key.endsWith('.shots.position')) {
        return `Beat ${String(values?.beatIndex)}, Shot ${String(values?.shotIndex)}`;
      }
      if (key.endsWith('.chain.continuous')) {
        return `Continues from Shot ${String(values?.position)}’s last frame`;
      }
      if (key.endsWith('.chain.reviewSeverDescription')) {
        return `A hard cut makes Shot ${String(values?.shot)} start from an eligible first frame, creating one if needed. Confirming replaces this Shot and each continuous downstream Shot through the next hard cut.`;
      }
      if (key.endsWith('.chain.reviewRejoinDescription')) {
        return `Rejoining Shot ${String(values?.shot)} clears its first-frame selection and uses Shot ${String(values?.previous)}’s trim-aware last frame. After confirmation, free frame extraction may finish before this Shot and its continuous downstream Shots are dispatched through the next hard cut.`;
      }
      if (key.endsWith('.fields.shootingScriptFor')) return `Shooting script for Shot ${String(values?.index)}`;
      if (key.endsWith('.fields.durationFor')) return `Duration for Shot ${String(values?.index)}`;
      if (key.endsWith('For')) return `${key.split('.').at(-1)?.replace('For', '')} Shot ${String(values?.index)}`;
      if (key.endsWith('.reorder.previous')) return `Move Shot ${String(values?.index)} up`;
      if (key.endsWith('.reorder.next')) return `Move Shot ${String(values?.index)} down`;
      if (key.endsWith('.reorder.announcement')) {
        return `Moved Shot ${String(values?.from)} to ${String(values?.to)} of ${String(values?.total)}`;
      }
      if (key.endsWith('.seeds.label')) return `First frames for Shot ${String(values?.index)}`;
      if (key.endsWith('.picture.label')) return `Current picture for Shot ${String(values?.index)}`;
      if (key.endsWith('.picture.sourceDuration')) return `${String(values?.seconds)} seconds source`;
      if (key.endsWith('.picture.videoPreview')) return `Player · ${String(values?.label)}`;
      if (key.endsWith('.seeds.stillLabel')) {
        return `First frame ${String(values?.stillIndex)} for Shot ${String(values?.shotIndex)}`;
      }
      if (key.endsWith('.seeds.previewAlt')) return `Preview · ${String(values?.label)}`;
      if (key.endsWith('.preview.position')) return `${String(values?.current)} / ${String(values?.total)}`;
      if (key.endsWith('.preview.videoLabel')) {
        return `Shot ${String(values?.position)} video · ${String(values?.shootingScript)}`;
      }
      if (key.endsWith('.preview.slateLabel')) {
        return `Shot ${String(values?.position)} planning slate · ${String(values?.shootingScript)}`;
      }
      if (key.endsWith('.preview.slateHold')) return `Hold ${String(values?.clock)}`;
      if (key.endsWith('.coverage.seekValue')) {
        return `${String(values?.current)} of ${String(values?.total)}`;
      }
      if (key.endsWith('.segmentState.waitingOnShot')) return `Waiting on ${String(values?.position)}`;
      if (key.endsWith('.segmentState.renderingProgress')) return `Rendering · ${String(values?.progress)}%`;
      if (key.endsWith('.segmentState.shotKept')) return `Shot ${String(values?.position)} · Kept`;
      if (key.endsWith('.boundaryFrame.empty')) {
        return `Boundary after Shot ${String(values?.position)} · Waiting for continuity frame`;
      }
      if (key.endsWith('.boundaryFrame.ready')) {
        return `Boundary after Shot ${String(values?.position)} · Continuity frame ready`;
      }
      if (key.endsWith('.boundaryFrame.gone')) {
        return `Boundary after Shot ${String(values?.position)} · Continuity frame missing`;
      }
      if (key.endsWith('.boundaryFrame.stale')) {
        return `Boundary after Shot ${String(values?.position)} · Continuity frame is out of date`;
      }
      if (key.endsWith('.generation.choiceLabel')) {
        return `Beat ${String(values?.beatIndex)} Shot ${String(values?.shotIndex)} ${String(values?.purpose)}`;
      }
      if (key === 'conversation.creativeStudio.models.blocked.duration') {
        return `This engine cannot make a shot ${String(values?.seconds)}s long.`;
      }
      if (key.endsWith('.generation.referenceForChoice')) return `Brief reference for ${String(values?.choice)}`;
      if (key.endsWith('.lift.shotTitle')) return `Move Shot ${String(values?.index)} to the Bin?`;
      if (key.endsWith('.lift.shotBodyNoStale')) {
        return 'Authored and paid work stays with this Shot. Move it to the Bin?';
      }
      if (key.endsWith('.lift.shotBodyStale')) {
        return `Authored and paid work stays with this Shot. Moving it to the Bin makes ${String(values?.shots)} stale.`;
      }
      if (key.endsWith('.lift.beatBodyNoStale')) {
        return 'Every Shot and all authored and paid work stay with this Beat. Move it to the Bin?';
      }
      if (key.endsWith('.lift.beatBodyStale')) {
        return `Every Shot and all authored and paid work stay with this Beat. Moving it to the Bin makes ${String(values?.shots)} stale.`;
      }
      if (key.includes('.recovery.reason.')) return `Reason ${key.split('.').at(-1)}`;
      if (key.endsWith('.coverage.shotLabel')) return `Shot ${String(values?.index)}`;
      if (key.endsWith('.coverage.planningDuration')) return `${String(values?.seconds)}s plan`;
      if (key.endsWith('.coverage.sourceDuration')) return `${String(values?.seconds)}s source`;
      if (key.endsWith('.coverage.boundaryLabel')) return `Boundary after Shot ${String(values?.index)}`;
      if (key.endsWith('.coverage.boundaryValue')) return `${String(values?.seconds)}s left`;
      return copy[key] ?? key;
    },
  }),
}));

import {
  BeatPlayer,
  BeatPanel,
  beatPlaybackJoins,
  buildBeatPlaybackSequence,
  formatBeatPlaybackClock,
  resolveBeatPlaybackLocation,
  type BeatPanelActions,
  type BeatPanelProps,
  type BeatPanelReviewGraph,
} from '@/renderer/pages/studio/components/Workspace/BeatPanel';

class NoopResizeObserver implements ResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

const makeSeedStill = (
  assetId: string,
  overrides: Partial<WorkspaceSeedStillProjection> = {}
): WorkspaceSeedStillProjection => ({
  assetId,
  createdAt: '2026-08-20T00:00:00.000Z',
  explicitSeed: false,
  effectiveSeed: false,
  ...overrides,
});

const makeCurrentPicture = (assetId: string, sourceDurationSeconds = 8, posterAssetId: string | null = null) => ({
  assetId,
  sourceDurationSeconds,
  posterAssetId,
});

const makeShot = (
  id: string,
  index: number,
  overrides: Partial<WorkspaceShotProjection> = {}
): WorkspaceShotProjection => ({
  id,
  shootingScript: `Canonical shooting script ${index + 1}`,
  durationSeconds: 8,
  chainBreak: index === 0 ? 'none' : 'none',
  trimInSeconds: null,
  trimOutSeconds: null,
  currentPicture: null,
  playedDurationSeconds: 8,
  explicitSeedAssetId: null,
  effectiveSeedAssetId: null,
  segmentHead: index === 0,
  planningBoundary: { shotId: id, startSeconds: index * 8, endSeconds: (index + 1) * 8 },
  frameBoundary: null,
  segmentState:
    overrides.segmentState ??
    (overrides.currentPicture === undefined || overrides.currentPicture === null
      ? { kind: 'no_picture' }
      : { kind: 'rendered' }),
  dirtyCauses: [],
  downstreamShotIds: [],
  seedStills: [],
  coverAssetId: null,
  displayState: 'draft',
  retainedWork: false,
  videoGenerationInFlight: false,
  seedGenerationInFlight: false,
  videoGenerationBlocked: false,
  seedGenerationBlocked: false,
  seedAuthorityStatusReady: true,
  seedAuthorizationLock: null,
  attentionJobs: [],
  hasEffectiveSeed: false,
  ...overrides,
});

const makeBeat = (
  id = 'beat_1',
  shots: WorkspaceShotProjection[] = [makeShot('shot_1', 0), makeShot('shot_2', 1)],
  overrides: Partial<WorkspaceBeatProjection> = {}
): WorkspaceBeatProjection => ({
  id,
  title: 'Opening',
  story: 'Open the film',
  targetSeconds: shots.length * 8,
  actualSeconds: shots.length * 8,
  displayState: 'draft',
  shots,
  ...overrides,
});

const eligibilityFor = (beats: readonly WorkspaceBeatProjection[]): StudioRendererParkEligibilityV2[] =>
  beats.flatMap((beat) => [
    {
      subject: 'beat' as const,
      action: 'park' as const,
      beatId: beat.id,
      shotId: null,
      allowed: true,
      blockers: [],
    },
    ...beat.shots.flatMap((shot) => [
      {
        subject: 'shot' as const,
        action: 'park' as const,
        beatId: beat.id,
        shotId: shot.id,
        allowed: true,
        blockers: [],
      },
    ]),
  ]);

const makeProjection = (
  beats: WorkspaceBeatProjection[],
  overrides: Partial<WorkspaceProjection> = {}
): WorkspaceProjection => ({
  projectId: 'project_1',
  projectRevision: 3,
  activeBeats: beats,
  activeBeatIds: beats.map((beat) => beat.id),
  activeShotIds: beats.flatMap((beat) => beat.shots.map((shot) => shot.id)),
  coverageGapBeatIds: [],
  workspaceStatusReady: true,
  chainStatusReady: true,
  requestShapeLocked: false,
  bin: { items: [], beats: [], shots: [] },
  undoTop: null,
  dirtyShots: [],
  cascadeProgress: [],
  parkEligibility: eligibilityFor(beats),
  conditioningFailures: [],
  ...overrides,
});

const makeDrafts = (
  values: Record<string, string | number | boolean | null> = {},
  overrides: Partial<UseWorkspaceDraftsResult> = {}
) => {
  const entries = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { baseValue: null, value }])
  ) as Record<string, WorkspaceDraftEntry>;
  return {
    value: vi.fn((key: string) => entries[key]?.value),
    entries,
    dirtyKeys: Object.keys(entries),
    conflictKeys: [],
    dirtyCount: Object.keys(entries).length,
    staleRevision: false,
    setValue: vi.fn(),
    reset: vi.fn(),
    resetIfValue: vi.fn(),
    resetAll: vi.fn(),
    selection: { selectedBeatId: null, selectedShotIds: [], anchorShotId: null },
    selectBeat: vi.fn(),
    selectShot: vi.fn(),
    clearSelection: vi.fn(),
    ...overrides,
  } satisfies UseWorkspaceDraftsResult;
};

const makeActions = (overrides: Partial<BeatPanelActions> = {}) => ({
  saveBeat: vi.fn().mockResolvedValue(true),
  saveShot: vi.fn().mockResolvedValue(true),
  setSeedStill: vi.fn().mockResolvedValue(true),
  trimShot: vi.fn().mockResolvedValue(true),
  reorderShots: vi.fn().mockResolvedValue(true),
  importSeedStill: vi.fn().mockResolvedValue('cancelled' as const),
  parkShot: vi.fn().mockResolvedValue(true),
  parkBeat: vi.fn().mockResolvedValue(true),
  reviewShot: vi.fn(),
  reviewContinuity: vi.fn(),
  resolveGenerationBlock: vi.fn(),
  retryGenerationJob: vi.fn().mockResolvedValue(true),
  cancelGenerationJob: vi.fn().mockResolvedValue(true),
  retryConditioning: vi.fn().mockResolvedValue(true),
  cancelWaiting: vi.fn().mockResolvedValue(true),
  cancelAndReviewRejoin: vi.fn().mockResolvedValue(true),
  requestResplit: vi.fn(),
  ...overrides,
});

describe('BeatPanel generation recovery', () => {
  it('offers only projected job capabilities and requires duplicate-charge acknowledgement', async () => {
    const actions = makeActions();
    const shot = makeShot('shot_1', 0, {
      attentionJobs: [
        {
          id: 'job_remote',
          purpose: 'video_take',
          error: {
            code: 'provider_unavailable',
            messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
          },
          canCancel: true,
          canRetry: true,
        },
        {
          id: 'job_unknown',
          purpose: 'video_take',
          error: {
            code: 'submission_unknown',
            messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
          },
          canCancel: false,
          canRetry: true,
        },
      ],
      effectiveSeedAssetId: 'seed_existing',
      hasEffectiveSeed: true,
      videoGenerationBlocked: true,
    });
    const beat = makeBeat('beat_1', [shot]);
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), actions)} />);

    const remote = container.querySelector<HTMLElement>('[data-job-id="job_remote"]')!;
    expect(screen.getByRole('button', { name: 'Generate again' })).toBeDisabled();
    fireEvent.click(within(remote).getByRole('button', { name: 'conversation.creativeStudio.jobs.retry' }));
    await waitFor(() => expect(actions.retryGenerationJob).toHaveBeenCalledWith('job_remote', false));
    fireEvent.click(within(remote).getByRole('button', { name: 'conversation.creativeStudio.jobs.cancel' }));
    await waitFor(() => expect(actions.cancelGenerationJob).toHaveBeenCalledWith('job_remote'));

    const unknown = container.querySelector<HTMLElement>('[data-job-id="job_unknown"]')!;
    expect(within(unknown).queryByRole('button', { name: 'conversation.creativeStudio.jobs.cancel' })).toBeNull();
    fireEvent.click(
      within(unknown).getByRole('button', { name: 'conversation.creativeStudio.jobs.retryChargeConfirm' })
    );
    await waitFor(() => expect(actions.retryGenerationJob).toHaveBeenCalledWith('job_unknown', true));
  });
});

const panelProps = (
  beat: WorkspaceBeatProjection,
  drafts: UseWorkspaceDraftsResult,
  actions: BeatPanelActions,
  projection = makeProjection([beat]),
  overrides: Partial<BeatPanelProps> = {}
): BeatPanelProps => ({
  projectId: 'project_1',
  beat,
  beatIds: projection.activeBeatIds,
  beatIndex: projection.activeBeats.findIndex((row) => row.id === beat.id),
  projection,
  drafts,
  reviewGraphs: beat.shots.map(
    (shot): BeatPanelReviewGraph => ({
      triggerShotId: shot.id,
      choices: [
        {
          shotId: shot.id,
          purpose: shot.segmentHead && shot.effectiveSeedAssetId === null ? 'seed_still' : 'video_take',
        },
      ],
      block: null,
    })
  ),
  errorMessageKey: null,
  pending: false,
  gateLocked: false,
  reviewBlockedMessageKey: null,
  onSelectBeat: vi.fn(),
  onClose: vi.fn(),
  onParkShotSuccess: vi.fn(),
  actions,
  ...overrides,
});

const shotCard = (container: HTMLElement, shotId: string): HTMLElement => {
  const card = container.querySelector<HTMLElement>(`article[data-shot-id="${shotId}"]`);
  if (card === null) throw new Error(`Missing Shot card ${shotId}`);
  return card;
};

const assetCard = (container: HTMLElement, assetId: string): HTMLElement => {
  const card = container.querySelector<HTMLElement>(`[data-asset-id="${assetId}"]`);
  if (card === null) throw new Error(`Missing asset card ${assetId}`);
  return card;
};

const inspectShot = (container: HTMLElement, shotId: string): HTMLElement => {
  const selector = container.querySelector<HTMLButtonElement>(
    `[data-testid="studio-coverage-playback"] [data-shot-id="${shotId}"] [data-coverage-shot-selector]`
  );
  if (selector === null) throw new Error(`Missing Shot inspector selector ${shotId}`);
  fireEvent.click(selector);
  return shotCard(container, shotId);
};

type ModalConfirmOptions = {
  afterClose?: () => void;
  cancelText: React.ReactNode;
  content: React.ReactNode;
  okButtonProps?: { status?: string };
  okText: React.ReactNode;
  onCancel?: () => void;
  onOk: () => unknown;
  title: React.ReactNode;
};

const latestModalConfirmation = (): ModalConfirmOptions => {
  const options = modalConfirm.mock.calls.at(-1)?.[0] as ModalConfirmOptions | undefined;
  if (options === undefined) throw new Error('Expected an Arco Modal.confirm call');
  return options;
};

const cssRuleBody = (source: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? '';
};

const previewVideo = (): HTMLVideoElement => {
  const video = document.querySelector<HTMLVideoElement>('[data-beat-preview-media][data-media-kind="video"]');
  if (video === null) throw new Error('Expected Beat preview video');
  return video;
};

const installMediaFacts = (
  video: HTMLVideoElement,
  input: { currentTime?: number; duration?: number; seeking?: boolean } = {}
) => {
  let currentTime = input.currentTime ?? 0;
  let seeking = input.seeking ?? false;
  Object.defineProperty(video, 'duration', { configurable: true, value: input.duration ?? 10 });
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
    },
  });
  Object.defineProperty(video, 'seeking', { configurable: true, get: () => seeking });
  return {
    currentTime: () => currentTime,
    setCurrentTime: (value: number) => {
      currentTime = value;
    },
    setSeeking: (value: boolean) => {
      seeking = value;
    },
  };
};

describe('Beat playback sequence', () => {
  it('maps one exact current picture and one explicit planning slate onto the Beat clock', () => {
    const first = makeShot('shot_1', 0, {
      currentPicture: makeCurrentPicture('video_1', 10, 'poster_1'),
      playedDurationSeconds: 8,
      trimInSeconds: 1,
      trimOutSeconds: 1,
    });
    const second = makeShot('shot_2', 1, {
      durationSeconds: 6,
      playedDurationSeconds: 6,
      planningBoundary: { shotId: 'shot_2', startSeconds: 8, endSeconds: 14 },
    });
    const beat = makeBeat('beat_1', [first, second], { actualSeconds: 14 });

    expect(buildBeatPlaybackSequence('project_1', beat, makeProjection([beat]))).toEqual({
      projectId: 'project_1',
      projectRevision: 3,
      beatId: 'beat_1',
      durationSeconds: 14,
      segments: [
        {
          kind: 'video',
          shotId: 'shot_1',
          shotPosition: 1,
          shootingScript: 'Canonical shooting script 1',
          assetId: 'video_1',
          posterAssetId: 'poster_1',
          sourceDurationSeconds: 10,
          sourceInSeconds: 1,
          sourceOutSeconds: 9,
          durationSeconds: 8,
          beatStartSeconds: 0,
          beatEndSeconds: 8,
        },
        {
          kind: 'slate',
          shotId: 'shot_2',
          shotPosition: 2,
          shootingScript: 'Canonical shooting script 2',
          durationSeconds: 6,
          beatStartSeconds: 8,
          beatEndSeconds: 14,
        },
      ],
    });
  });

  it('fails the whole preview closed instead of degrading malformed picture authority to a slate', () => {
    const shot = makeShot('shot_1', 0, {
      currentPicture: makeCurrentPicture('../unsafe', 8),
    });
    const beat = makeBeat('beat_1', [shot]);

    expect(buildBeatPlaybackSequence('project_1', beat, makeProjection([beat]))).toBeNull();
  });

  it('maps Beat seeks to trim-relative source time and exposes only authored Shot joins', () => {
    const first = makeShot('shot_1', 0, {
      currentPicture: makeCurrentPicture('video_1', 10),
      playedDurationSeconds: 8,
      trimInSeconds: 1,
      trimOutSeconds: 1,
    });
    const second = makeShot('shot_2', 1);
    const beat = makeBeat('beat_1', [first, second]);
    const sequence = buildBeatPlaybackSequence('project_1', beat, makeProjection([beat]))!;

    expect(resolveBeatPlaybackLocation(sequence, 6.5)).toEqual({
      segmentIndex: 0,
      positionSeconds: 6.5,
      sourceTimeSeconds: 7.5,
    });
    expect(resolveBeatPlaybackLocation(sequence, 8)).toEqual({
      segmentIndex: 1,
      positionSeconds: 8,
      sourceTimeSeconds: null,
    });
    expect(beatPlaybackJoins(sequence)).toEqual([8]);
    expect(formatBeatPlaybackClock(65.9, 80)).toBe('1:05');
  });

  it('rejects duplicate active Shot identity and malformed planning authority', () => {
    const first = makeBeat('beat_1', [makeShot('shot_duplicate', 0)]);
    const second = makeBeat('beat_2', [makeShot('shot_duplicate', 0)]);
    expect(buildBeatPlaybackSequence('project_1', first, makeProjection([first, second]))).toBeNull();

    const malformedSlate = makeShot('shot_1', 0, { trimInSeconds: 0.5 });
    const beat = makeBeat('beat_1', [malformedSlate]);
    expect(buildBeatPlaybackSequence('project_1', beat, makeProjection([beat]))).toBeNull();

    const invalidPlan = makeShot('shot_1', 0, {
      currentPicture: makeCurrentPicture('video_1', 8),
      durationSeconds: 2,
      planningBoundary: { shotId: 'shot_1', startSeconds: 0, endSeconds: 2 },
    });
    const invalidPlanBeat = makeBeat('beat_1', [invalidPlan], { actualSeconds: 8 });
    expect(buildBeatPlaybackSequence('project_1', invalidPlanBeat, makeProjection([invalidPlanBeat]))).toBeNull();
  });
});

describe('BeatPlayer', () => {
  const playableBeat = (): WorkspaceBeatProjection => {
    return makeBeat(
      'beat_1',
      [
        makeShot('shot_1', 0, {
          currentPicture: makeCurrentPicture('video_1', 10, 'poster_1'),
          playedDurationSeconds: 8,
          trimInSeconds: 1,
          trimOutSeconds: 1,
        }),
        makeShot('shot_2', 1, {
          durationSeconds: 6,
          playedDurationSeconds: 6,
          planningBoundary: { shotId: 'shot_2', startSeconds: 8, endSeconds: 14 },
        }),
      ],
      { actualSeconds: 14 }
    );
  };

  const contiguousVideoBeat = (): WorkspaceBeatProjection =>
    makeBeat(
      'beat_video_run',
      [
        makeShot('shot_video_1', 0, {
          currentPicture: makeCurrentPicture('video_1', 10, 'poster_1'),
          durationSeconds: 8,
          playedDurationSeconds: 8,
          planningBoundary: { shotId: 'shot_video_1', startSeconds: 0, endSeconds: 8 },
          trimInSeconds: 1,
          trimOutSeconds: 1,
        }),
        makeShot('shot_video_2', 1, {
          currentPicture: makeCurrentPicture('video_2', 4, 'poster_2'),
          durationSeconds: 4,
          playedDurationSeconds: 4,
          planningBoundary: { shotId: 'shot_video_2', startSeconds: 8, endSeconds: 12 },
        }),
        makeShot('shot_video_3', 2, {
          currentPicture: makeCurrentPicture('video_3', 8, 'poster_3'),
          durationSeconds: 7,
          playedDurationSeconds: 7,
          planningBoundary: { shotId: 'shot_video_3', startSeconds: 12, endSeconds: 19 },
          trimInSeconds: 0.5,
          trimOutSeconds: 0.5,
        }),
      ],
      { actualSeconds: 19, targetSeconds: 19 }
    );

  it('arms from exact native playback, keeps one inert node stable, and cleans it on retarget, seek, and unmount', () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const beat = contiguousVideoBeat();
    const result = render(
      <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
        {(playback) => (
          <>
            <button onClick={() => playback.onSeek(0)} type='button'>
              Seek to Beat start
            </button>
            <output data-position={playback.positionSeconds} data-testid='prewarm-position' />
          </>
        )}
      </BeatPlayer>
    );
    let unmounted = false;

    try {
      expect(document.querySelector('[data-beat-prewarm-media]')).toBeNull();
      const first = previewVideo();
      const firstFacts = installMediaFacts(first, { duration: 10 });
      fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
      expect(document.querySelector('[data-beat-prewarm-media]')).toBeNull();
      fireEvent.loadedMetadata(first);
      expect(document.querySelector('[data-beat-prewarm-media]')).toBeNull();
      fireEvent.playing(first);

      const firstPrewarm = document.querySelector<HTMLVideoElement>('[data-beat-prewarm-media]')!;
      expect(firstPrewarm).toHaveAttribute('src', 'weprompt-studio://asset/project_1/video_2');
      expect(firstPrewarm).toHaveAttribute('preload', 'auto');
      expect(firstPrewarm).not.toHaveAttribute('hidden');
      expect(firstPrewarm).toHaveAttribute('aria-hidden', 'true');
      expect(firstPrewarm).toHaveProperty('muted', true);
      expect(firstPrewarm).toHaveProperty('autoplay', false);
      expect(firstPrewarm).not.toHaveAttribute('data-beat-preview-media');
      expect(firstPrewarm).not.toHaveAttribute('poster');
      expect(firstPrewarm.className).not.toBe('');
      expect(load.mock.contexts.filter((context) => context === firstPrewarm)).toHaveLength(1);
      expect(pause.mock.contexts.filter((context) => context === firstPrewarm)).toHaveLength(0);
      expect(play).toHaveBeenCalledTimes(1);

      fireEvent.loadedMetadata(firstPrewarm);
      fireEvent.playing(firstPrewarm);
      fireEvent.timeUpdate(firstPrewarm);
      fireEvent.waiting(firstPrewarm);
      fireEvent.ended(firstPrewarm);
      fireEvent.error(firstPrewarm);
      expect(previewVideo()).toBe(first);
      expect(screen.getByTestId('prewarm-position')).toHaveAttribute('data-position', '0');
      expect(screen.queryByText('The current picture could not be previewed.')).toBeNull();
      expect(play).toHaveBeenCalledTimes(1);

      firstFacts.setCurrentTime(2);
      fireEvent.timeUpdate(first);
      expect(document.querySelector('[data-beat-prewarm-media]')).toBe(firstPrewarm);
      fireEvent.click(screen.getByRole('button', { name: 'Pause Beat' }));
      expect(document.querySelector('[data-beat-prewarm-media]')).toBe(firstPrewarm);
      expect(firstPrewarm).toHaveAttribute('src', 'weprompt-studio://asset/project_1/video_2');
      expect(load.mock.contexts.filter((context) => context === firstPrewarm)).toHaveLength(1);
      expect(pause.mock.contexts.filter((context) => context === firstPrewarm)).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
      fireEvent.playing(first);
      expect(document.querySelector('[data-beat-prewarm-media]')).toBe(firstPrewarm);

      firstFacts.setCurrentTime(9);
      fireEvent.timeUpdate(first);
      const second = previewVideo();
      expect(second).not.toBe(first);
      expect(second).toHaveAttribute('src', 'weprompt-studio://asset/project_1/video_2');
      expect(document.querySelector('[data-beat-prewarm-media]')).toBe(firstPrewarm);

      installMediaFacts(second, { duration: 4 });
      fireEvent.loadedMetadata(second);
      fireEvent.playing(second);
      const secondPrewarm = document.querySelector<HTMLVideoElement>('[data-beat-prewarm-media]')!;
      expect(secondPrewarm).not.toBe(firstPrewarm);
      expect(secondPrewarm).toHaveAttribute('src', 'weprompt-studio://asset/project_1/video_3');
      expect(firstPrewarm).not.toHaveAttribute('src');
      expect(pause.mock.contexts.filter((context) => context === firstPrewarm)).toHaveLength(1);
      expect(load.mock.contexts.filter((context) => context === firstPrewarm)).toHaveLength(2);
      expect(load.mock.contexts.filter((context) => context === secondPrewarm)).toHaveLength(1);

      fireEvent.click(screen.getByRole('button', { name: 'Seek to Beat start' }));
      expect(document.querySelector('[data-beat-prewarm-media]')).toBeNull();
      expect(secondPrewarm).not.toHaveAttribute('src');
      expect(pause.mock.contexts.filter((context) => context === secondPrewarm)).toHaveLength(1);
      expect(load.mock.contexts.filter((context) => context === secondPrewarm)).toHaveLength(2);

      const soughtFirst = previewVideo();
      installMediaFacts(soughtFirst, { duration: 10 });
      fireEvent.loadedMetadata(soughtFirst);
      fireEvent.playing(soughtFirst);
      const finalPrewarm = document.querySelector<HTMLVideoElement>('[data-beat-prewarm-media]')!;
      expect(finalPrewarm).toHaveAttribute('src', 'weprompt-studio://asset/project_1/video_2');
      expect(finalPrewarm).not.toBe(firstPrewarm);

      result.unmount();
      unmounted = true;
      expect(finalPrewarm).not.toHaveAttribute('src');
      expect(pause.mock.contexts.filter((context) => context === finalPrewarm)).toHaveLength(1);
      expect(load.mock.contexts.filter((context) => context === finalPrewarm)).toHaveLength(2);
    } finally {
      if (!unmounted) result.unmount();
      load.mockRestore();
      pause.mockRestore();
      play.mockRestore();
    }
  });

  it('scans across a slate and retains the warmed video through that slate transition', () => {
    vi.useFakeTimers();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const beat = makeBeat(
      'beat_slate_boundary',
      [
        makeShot('shot_video', 0, {
          currentPicture: makeCurrentPicture('video_before_slate', 8),
          planningBoundary: { shotId: 'shot_video', startSeconds: 0, endSeconds: 8 },
        }),
        makeShot('shot_slate', 1, {
          durationSeconds: 6,
          playedDurationSeconds: 6,
          planningBoundary: { shotId: 'shot_slate', startSeconds: 8, endSeconds: 14 },
        }),
        makeShot('shot_after_slate', 2, {
          currentPicture: makeCurrentPicture('video_after_slate', 4),
          durationSeconds: 4,
          playedDurationSeconds: 4,
          planningBoundary: { shotId: 'shot_after_slate', startSeconds: 14, endSeconds: 18 },
        }),
      ],
      { actualSeconds: 18, targetSeconds: 18 }
    );
    const result = render(
      <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
        {(playback) => <output data-position={playback.positionSeconds} data-testid='slate-prewarm-position' />}
      </BeatPlayer>
    );

    try {
      const first = previewVideo();
      const firstFacts = installMediaFacts(first, { duration: 8 });
      fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
      expect(document.querySelector('[data-beat-prewarm-media]')).toBeNull();
      fireEvent.loadedMetadata(first);
      expect(document.querySelector('[data-beat-prewarm-media]')).toBeNull();
      fireEvent.playing(first);
      const prewarm = document.querySelector<HTMLVideoElement>('[data-beat-prewarm-media]')!;
      expect(prewarm).toHaveAttribute('src', 'weprompt-studio://asset/project_1/video_after_slate');

      firstFacts.setCurrentTime(8);
      fireEvent.timeUpdate(first);
      expect(document.querySelector('[data-beat-preview-media][data-media-kind="slate"]')).toBeInTheDocument();
      expect(document.querySelector('[data-beat-prewarm-media]')).toBe(prewarm);
      act(() => vi.advanceTimersByTime(100));
      expect(document.querySelector('[data-beat-prewarm-media]')).toBe(prewarm);
      act(() => vi.advanceTimersByTime(5_900));
      expect(previewVideo()).toHaveAttribute('src', 'weprompt-studio://asset/project_1/video_after_slate');
      expect(document.querySelector('[data-beat-prewarm-media]')).toBe(prewarm);

      const afterSlate = previewVideo();
      installMediaFacts(afterSlate, { duration: 4 });
      fireEvent.loadedMetadata(afterSlate);
      fireEvent.playing(afterSlate);
      expect(document.querySelector('[data-beat-prewarm-media]')).toBeNull();
      expect(prewarm).not.toHaveAttribute('src');
      expect(pause.mock.contexts.filter((context) => context === prewarm)).toHaveLength(1);
      expect(load.mock.contexts.filter((context) => context === prewarm)).toHaveLength(2);
    } finally {
      result.unmount();
      vi.useRealTimers();
      load.mockRestore();
      pause.mockRestore();
      play.mockRestore();
    }
  });

  it('arms the first future video when an opening slate clock starts', () => {
    vi.useFakeTimers();
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const beat = makeBeat(
      'beat_slate_first',
      [
        makeShot('shot_opening_slate', 0, {
          durationSeconds: 4,
          playedDurationSeconds: 4,
          planningBoundary: { shotId: 'shot_opening_slate', startSeconds: 0, endSeconds: 4 },
        }),
        makeShot('shot_opening_video', 1, {
          currentPicture: makeCurrentPicture('video_after_opening_slate', 4),
          durationSeconds: 4,
          playedDurationSeconds: 4,
          planningBoundary: { shotId: 'shot_opening_video', startSeconds: 4, endSeconds: 8 },
        }),
      ],
      { actualSeconds: 8, targetSeconds: 8 }
    );
    const result = render(
      <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
        {(playback) => <output>{playback.positionSeconds}</output>}
      </BeatPlayer>
    );

    try {
      expect(document.querySelector('[data-beat-prewarm-media]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
      expect(document.querySelector('[data-beat-prewarm-media]')).toHaveAttribute(
        'src',
        'weprompt-studio://asset/project_1/video_after_opening_slate'
      );
    } finally {
      result.unmount();
      vi.useRealTimers();
      load.mockRestore();
      pause.mockRestore();
    }
  });

  it('cleans the warmed target when authoritative current media fails', () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const beat = contiguousVideoBeat();
    const result = render(
      <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
        {(playback) => <output>{playback.positionSeconds}</output>}
      </BeatPlayer>
    );

    try {
      const current = previewVideo();
      installMediaFacts(current, { duration: 10 });
      fireEvent.loadedMetadata(current);
      fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
      fireEvent.playing(current);
      const prewarm = document.querySelector<HTMLVideoElement>('[data-beat-prewarm-media]')!;

      fireEvent.error(current);
      expect(document.querySelector('[data-beat-prewarm-media]')).toBeNull();
      expect(prewarm).not.toHaveAttribute('src');
      expect(pause.mock.contexts.filter((context) => context === prewarm)).toHaveLength(1);
      expect(load.mock.contexts.filter((context) => context === prewarm)).toHaveLength(2);
      expect(screen.getByText('The current picture could not be previewed.')).toBeVisible();
    } finally {
      result.unmount();
      load.mockRestore();
      pause.mockRestore();
      play.mockRestore();
    }
  });

  it.each(['plan', 'project', 'revision', 'order'] as const)(
    'drops the prewarm on a %s change and ignores detached prewarm events',
    (change) => {
      const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
      const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
      const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      const beat = contiguousVideoBeat();
      const projection = makeProjection([beat]);
      const result = render(
        <BeatPlayer beat={beat} projectId='project_1' projection={projection}>
          {(playback) => <output data-position={playback.positionSeconds} data-testid='prewarm-reset-position' />}
        </BeatPlayer>
      );

      try {
        const current = previewVideo();
        installMediaFacts(current, { duration: 10 });
        fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
        fireEvent.loadedMetadata(current);
        fireEvent.playing(current);
        const stalePrewarm = document.querySelector<HTMLVideoElement>('[data-beat-prewarm-media]')!;
        expect(stalePrewarm).toHaveAttribute('src', 'weprompt-studio://asset/project_1/video_2');

        let nextBeat = structuredClone(beat);
        let nextProjectId = 'project_1';
        let nextProjection = makeProjection([nextBeat]);
        if (change === 'plan') {
          nextBeat.shots[1]!.currentPicture!.assetId = 'video_2_replaced';
          nextProjection = makeProjection([nextBeat]);
        } else if (change === 'project') {
          nextProjectId = 'project_2';
          nextProjection = makeProjection([nextBeat], { projectId: nextProjectId });
        } else if (change === 'revision') {
          nextProjection = makeProjection([nextBeat], { projectRevision: projection.projectRevision + 1 });
        } else {
          const second = {
            ...nextBeat.shots[1]!,
            planningBoundary: { shotId: 'shot_video_2', startSeconds: 0, endSeconds: 4 },
          };
          const first = {
            ...nextBeat.shots[0]!,
            planningBoundary: { shotId: 'shot_video_1', startSeconds: 4, endSeconds: 12 },
          };
          const third = {
            ...nextBeat.shots[2]!,
            planningBoundary: { shotId: 'shot_video_3', startSeconds: 12, endSeconds: 19 },
          };
          nextBeat = { ...nextBeat, shots: [second, first, third] };
          nextProjection = makeProjection([nextBeat]);
        }
        result.rerender(
          <BeatPlayer beat={nextBeat} projectId={nextProjectId} projection={nextProjection}>
            {(playback) => <output data-position={playback.positionSeconds} data-testid='prewarm-reset-position' />}
          </BeatPlayer>
        );

        expect(document.querySelector('[data-beat-prewarm-media]')).toBeNull();
        expect(stalePrewarm).not.toHaveAttribute('src');
        expect(pause.mock.contexts.filter((context) => context === stalePrewarm)).toHaveLength(1);
        expect(load.mock.contexts.filter((context) => context === stalePrewarm)).toHaveLength(2);
        expect(screen.getByTestId('prewarm-reset-position')).toHaveAttribute('data-position', '0');
        expect(screen.getByRole('button', { name: 'Play Beat' })).toBeInTheDocument();
        fireEvent.loadedMetadata(stalePrewarm);
        fireEvent.playing(stalePrewarm);
        fireEvent.timeUpdate(stalePrewarm);
        fireEvent.ended(stalePrewarm);
        fireEvent.error(stalePrewarm);
        expect(screen.getByTestId('prewarm-reset-position')).toHaveAttribute('data-position', '0');
        expect(screen.queryByText('The current picture could not be previewed.')).toBeNull();
      } finally {
        result.unmount();
        load.mockRestore();
        pause.mockRestore();
        play.mockRestore();
      }
    }
  );

  it('plays only the exact picture trim, shows its poster during seek, and crosses into the planned slate', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const beat = playableBeat();
    const projection = makeProjection([beat]);
    const result = render(
      <BeatPlayer beat={beat} projectId='project_1' projection={projection}>
        {(playback) => <output data-testid='beat-position'>{playback.positionSeconds}</output>}
      </BeatPlayer>
    );

    const initial = screen.getByRole('region', { name: 'Beat preview' }).querySelector<HTMLVideoElement>('video')!;
    expect(initial).toHaveAttribute('src', 'weprompt-studio://asset/project_1/video_1');
    expect(initial).toHaveAttribute('poster', 'weprompt-studio://asset/project_1/poster_1');
    expect(initial).toHaveProperty('muted', true);
    expect(initial).toHaveProperty('controls', false);
    expect(screen.getByRole('timer')).toHaveTextContent('0:00 / 0:14');

    let currentTime = 0;
    Object.defineProperty(initial, 'duration', { configurable: true, value: 10 });
    Object.defineProperty(initial, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });
    fireEvent.loadedMetadata(initial);
    expect(currentTime).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
    fireEvent.playing(initial);
    currentTime = 2;
    fireEvent.timeUpdate(initial);
    expect(screen.getByTestId('beat-position')).toHaveTextContent('1');
    fireEvent.waiting(initial);
    currentTime = 5;
    fireEvent.click(screen.getByRole('button', { name: 'Pause Beat' }));
    expect(screen.getByTestId('beat-position')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Next join' }));
    expect(screen.getByTestId('beat-position')).toHaveTextContent('6.5');
    expect(document.querySelector('[data-beat-seek-poster]')).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project_1/poster_1'
    );

    const sought = screen.getByRole('region', { name: 'Beat preview' }).querySelector<HTMLVideoElement>('video')!;
    let soughtCurrentTime = 0;
    Object.defineProperty(sought, 'duration', { configurable: true, value: 10 });
    Object.defineProperty(sought, 'currentTime', {
      configurable: true,
      get: () => soughtCurrentTime,
      set: (value: number) => {
        soughtCurrentTime = value;
      },
    });
    fireEvent.loadedMetadata(sought);
    expect(soughtCurrentTime).toBe(7.5);
    expect(document.querySelector('[data-beat-seek-poster]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
    fireEvent.playing(sought);
    soughtCurrentTime = 9;
    fireEvent.timeUpdate(sought);
    expect(screen.getByRole('img', { name: /Shot 02 planning slate/ })).toBeInTheDocument();
    expect(screen.getByTestId('beat-position')).toHaveTextContent('8');
    expect(play).toHaveBeenCalled();

    result.unmount();
    pause.mockRestore();
    play.mockRestore();
  });

  it('keeps shortcuts scoped, seeks in coarse/fine steps, lands before joins, and arms the ±2 second loop', () => {
    const beat = makeBeat();
    const projection = makeProjection([beat]);
    render(
      <BeatPlayer beat={beat} projectId='project_1' projection={projection}>
        {(playback) => (
          <>
            <input aria-label='Nested editor' />
            <button aria-label='Nested slider' role='slider' type='button' />
            <button onClick={() => playback.onSeek(0)} type='button'>
              Reset position
            </button>
            <output data-position={playback.positionSeconds} data-testid='keyboard-position' />
          </>
        )}
      </BeatPlayer>
    );
    const player = document.querySelector<HTMLElement>('[data-beat-player]')!;

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nested editor' }), { key: ' ' });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Nested slider' }), { key: ' ' });
    expect(screen.getByRole('button', { name: 'Play Beat' })).toBeInTheDocument();

    fireEvent.keyDown(player, { code: 'Space', key: ' ' });
    expect(screen.getByRole('button', { name: 'Pause Beat' })).toBeInTheDocument();
    fireEvent.keyDown(player, { code: 'Space', key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset position' }));

    fireEvent.keyDown(player, { key: 'ArrowRight' });
    expect(screen.getByTestId('keyboard-position')).toHaveAttribute('data-position', '1');
    fireEvent.keyDown(player, { key: 'ArrowRight', shiftKey: true });
    expect(screen.getByTestId('keyboard-position')).toHaveAttribute('data-position', '1.2');
    fireEvent.keyDown(player, { code: 'BracketRight', key: ']' });
    expect(screen.getByTestId('keyboard-position')).toHaveAttribute('data-position', '6.5');
    fireEvent.keyDown(player, { key: 'l' });
    expect(screen.getByTestId('keyboard-position')).toHaveAttribute('data-position', '6');
    expect(screen.getByRole('button', { name: 'Loop nearest join' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('loops the exact four-second join window across adjacent slate segments', () => {
    vi.useFakeTimers();
    try {
      const beat = makeBeat();
      render(
        <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
          {(playback) => <output data-position={playback.positionSeconds} data-testid='loop-position' />}
        </BeatPlayer>
      );
      const player = document.querySelector<HTMLElement>('[data-beat-player]')!;
      fireEvent.keyDown(player, { key: 'l' });
      expect(screen.getByTestId('loop-position')).toHaveAttribute('data-position', '6');
      fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));

      act(() => vi.advanceTimersByTime(2_000));
      expect(Number(screen.getByTestId('loop-position').getAttribute('data-position'))).toBeGreaterThanOrEqual(8);
      act(() => vi.advanceTimersByTime(2_000));
      expect(screen.getByTestId('loop-position')).toHaveAttribute('data-position', '6');
      expect(screen.getByRole('button', { name: 'Loop nearest join' })).toHaveAttribute('aria-pressed', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('restarts the active slate clock after a same-segment keyboard seek', () => {
    vi.useFakeTimers();
    try {
      const beat = makeBeat('beat_1', [makeShot('shot_1', 0)]);
      render(
        <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
          {(playback) => <output data-position={playback.positionSeconds} data-testid='slate-seek-position' />}
        </BeatPlayer>
      );
      const player = document.querySelector<HTMLElement>('[data-beat-player]')!;
      fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.getByTestId('slate-seek-position')).toHaveAttribute('data-position', '1');

      fireEvent.keyDown(player, { key: 'ArrowRight' });
      expect(screen.getByTestId('slate-seek-position')).toHaveAttribute('data-position', '2');
      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.getByTestId('slate-seek-position')).toHaveAttribute('data-position', '3');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets on Beat/revision/order identity and ignores events from the detached video', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const first = playableBeat();
    const result = render(
      <BeatPlayer beat={first} projectId='project_1' projection={makeProjection([first])}>
        {(playback) => <output data-testid='reset-position'>{playback.positionSeconds}</output>}
      </BeatPlayer>
    );
    const staleVideo = document.querySelector<HTMLVideoElement>('[data-beat-preview-media][data-media-kind="video"]')!;

    const replacement = makeBeat('beat_2', [makeShot('shot_new', 0)]);
    result.rerender(
      <BeatPlayer beat={replacement} projectId='project_1' projection={makeProjection([replacement])}>
        {(playback) => <output data-testid='reset-position'>{playback.positionSeconds}</output>}
      </BeatPlayer>
    );
    expect(screen.getByTestId('reset-position')).toHaveTextContent('0');
    expect(document.querySelector('[data-beat-preview-media][data-media-kind="slate"]')).toBeInTheDocument();
    fireEvent.error(staleVideo);
    expect(screen.queryByText('The current picture could not be previewed.')).toBeNull();
    pause.mockRestore();
  });

  it('fails malformed current-picture authority closed instead of silently showing a planning slate', () => {
    const shot = makeShot('shot_1', 0, {
      currentPicture: makeCurrentPicture('../unsafe', 8),
    });
    const beat = makeBeat('beat_1', [shot]);
    render(
      <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
        {(playback) => <output data-available={playback.available} data-testid='malformed-available' />}
      </BeatPlayer>
    );

    expect(document.querySelector('[data-beat-preview-media][data-media-kind="empty"]')).toHaveTextContent(
      'Beat preview unavailable'
    );
    expect(screen.getByRole('button', { name: 'Play Beat' })).toBeDisabled();
    expect(screen.getByTestId('malformed-available')).toHaveAttribute('data-available', 'false');
  });

  it('completes an asynchronous trim seek, watches exact frames, cancels on waiting, and contains play rejection', async () => {
    let rejectPlay: ((reason?: unknown) => void) | null = null;
    const playRequest = new Promise<void>((_resolve, reject) => {
      rejectPlay = reject;
    });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValue(playRequest);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const beat = playableBeat();
    const result = render(
      <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
        {(playback) => <output data-position={playback.positionSeconds} data-testid='async-seek-position' />}
      </BeatPlayer>
    );
    const video = previewVideo();
    const media = installMediaFacts(video, { seeking: true });
    let frameCallback: Parameters<HTMLVideoElement['requestVideoFrameCallback']>[0] | null = null;
    const requestVideoFrameCallback = vi.fn(
      (callback: Parameters<HTMLVideoElement['requestVideoFrameCallback']>[0]) => {
        frameCallback = callback;
        return requestVideoFrameCallback.mock.calls.length;
      }
    );
    const cancelVideoFrameCallback = vi.fn();
    Object.assign(video, { cancelVideoFrameCallback, requestVideoFrameCallback });

    fireEvent.loadedMetadata(video);
    expect(media.currentTime()).toBe(1);
    expect(document.querySelector('[data-beat-seek-poster]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
    fireEvent.seeked(video);
    expect(play).not.toHaveBeenCalled();

    media.setSeeking(false);
    fireEvent.seeked(video);
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.playing(video);
    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(1);
    act(() => frameCallback?.(0, { mediaTime: 2 } as VideoFrameCallbackMetadata));
    expect(screen.getByTestId('async-seek-position')).toHaveAttribute('data-position', '1');
    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(2);

    fireEvent.rateChange(video);
    expect(cancelVideoFrameCallback).toHaveBeenCalled();
    fireEvent.waiting(video);
    const frozenPosition = screen.getByTestId('async-seek-position').getAttribute('data-position');
    media.setCurrentTime(5);
    fireEvent.timeUpdate(video);
    expect(screen.getByTestId('async-seek-position')).toHaveAttribute('data-position', frozenPosition!);

    await act(async () => {
      rejectPlay?.(new Error('decoder refused playback'));
      await playRequest.catch(() => undefined);
    });
    expect(screen.getByText('The current picture could not be previewed.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Play Beat' })).toBeDisabled();

    result.unmount();
    pause.mockRestore();
    play.mockRestore();
  });

  it('fails a premature native end and accepts an exact trim-out as terminal completion', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const beat = makeBeat('beat_1', [playableBeat().shots[0]!], { actualSeconds: 8, targetSeconds: 8 });
    const first = render(
      <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
        {(playback) => <output data-position={playback.positionSeconds} data-testid='ended-position' />}
      </BeatPlayer>
    );
    const earlyVideo = previewVideo();
    const early = installMediaFacts(earlyVideo);
    fireEvent.loadedMetadata(earlyVideo);
    fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
    early.setCurrentTime(5);
    fireEvent.ended(earlyVideo);
    expect(screen.getByText('The current picture could not be previewed.')).toBeVisible();
    first.unmount();

    const exactResult = render(
      <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
        {(playback) => <output data-position={playback.positionSeconds} data-testid='ended-position' />}
      </BeatPlayer>
    );
    const exactVideo = previewVideo();
    const exact = installMediaFacts(exactVideo);
    fireEvent.loadedMetadata(exactVideo);
    fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
    exact.setCurrentTime(9);
    fireEvent.ended(exactVideo);
    expect(screen.getByTestId('ended-position')).toHaveAttribute('data-position', '8');
    expect(screen.getByRole('button', { name: 'Play Beat' })).toBeEnabled();

    exactResult.unmount();
    pause.mockRestore();
    play.mockRestore();
  });

  it('completes playback when native media ends within the accepted trim-out epsilon', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const beat = makeBeat('beat_1', [playableBeat().shots[0]!], { actualSeconds: 8, targetSeconds: 8 });
    const result = render(
      <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
        {(playback) => <output data-position={playback.positionSeconds} data-testid='epsilon-ended-position' />}
      </BeatPlayer>
    );
    const video = previewVideo();
    const media = installMediaFacts(video);
    fireEvent.loadedMetadata(video);
    fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));

    media.setCurrentTime(8.9995);
    fireEvent.ended(video);

    expect(screen.getByTestId('epsilon-ended-position')).toHaveAttribute('data-position', '8');
    expect(screen.getByRole('button', { name: 'Play Beat' })).toBeEnabled();
    result.unmount();
    pause.mockRestore();
    play.mockRestore();
  });

  it('restarts from the end, navigates joins both ways, toggles looping off, and ignores modified keys', () => {
    const beat = makeBeat('beat_1', [makeShot('shot_1', 0), makeShot('shot_2', 1), makeShot('shot_3', 2)]);
    const result = render(
      <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
        {(playback) => (
          <>
            <button onClick={() => playback.onSeek(15)} type='button'>
              Seek middle
            </button>
            <button onClick={() => playback.onSeek(playback.durationSeconds)} type='button'>
              Seek end
            </button>
            <output data-position={playback.positionSeconds} data-testid='join-position' />
          </>
        )}
      </BeatPlayer>
    );
    const player = document.querySelector<HTMLElement>('[data-beat-player]')!;

    fireEvent.keyDown(player, { altKey: true, key: 'ArrowRight' });
    fireEvent.keyDown(player, { ctrlKey: true, key: 'ArrowRight' });
    fireEvent.keyDown(player, { key: 'Escape' });
    expect(screen.getByTestId('join-position')).toHaveAttribute('data-position', '0');

    fireEvent.click(screen.getByRole('button', { name: 'Seek middle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous join' }));
    expect(screen.getByTestId('join-position')).toHaveAttribute('data-position', '6.5');
    fireEvent.click(screen.getByRole('button', { name: 'Next join' }));
    expect(screen.getByTestId('join-position')).toHaveAttribute('data-position', '14.5');
    fireEvent.click(screen.getByRole('button', { name: 'Loop nearest join' }));
    expect(screen.getByRole('button', { name: 'Loop nearest join' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Loop nearest join' }));
    expect(screen.getByRole('button', { name: 'Loop nearest join' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Seek end' }));
    expect(screen.getByTestId('join-position')).toHaveAttribute('data-position', '24');
    fireEvent.click(screen.getByRole('button', { name: 'Play Beat' }));
    expect(screen.getByTestId('join-position')).toHaveAttribute('data-position', '0');
    expect(screen.getByRole('button', { name: 'Pause Beat' })).toBeInTheDocument();
    result.unmount();
  });

  it('shows the fallback seek cover and contains an active video error', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const shot = makeShot('shot_1', 0, {
      currentPicture: makeCurrentPicture('video_no_poster', 8),
    });
    const beat = makeBeat('beat_1', [shot]);
    const result = render(
      <BeatPlayer beat={beat} projectId='project_1' projection={makeProjection([beat])}>
        {(playback) => (
          <button onClick={() => playback.onSeek(2)} type='button'>
            Seek video
          </button>
        )}
      </BeatPlayer>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Seek video' }));
    expect(document.querySelector('[data-beat-seek-poster]')).toBeInTheDocument();
    expect(document.querySelector('[data-beat-seek-poster]')).not.toHaveAttribute('src');
    fireEvent.error(previewVideo());
    expect(screen.getByText('The current picture could not be previewed.')).toBeVisible();
    result.unmount();
    pause.mockRestore();
  });
});

describe('BeatPanel', () => {
  beforeEach(() => {
    modalConfirm.mockReset();
    modalConfirm.mockImplementation(() => ({ close: vi.fn(), update: vi.fn() }));
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
  });

  it('keeps chain authority and continuity warnings separate from the one Shooting script editor', () => {
    const image = makeSeedStill('asset_private_image', { effectiveSeed: true });
    const beat = makeBeat('beat_private', [
      makeShot('shot_private_1', 0, { seedStills: [image], segmentHead: true }),
      makeShot('shot_private_2', 1, {
        currentPicture: makeCurrentPicture('asset_private_video'),
        dirtyCauses: ['continuity_stale', 'generation_out_of_date'],
        segmentHead: false,
      }),
      makeShot('shot_private_3', 2, { segmentHead: true }),
      makeShot('shot_private_4', 3, {
        chainBreak: 'hard_cut',
        segmentHead: true,
      }),
      makeShot('shot_private_5', 4, {
        chainBreak: 'hard_cut',
        segmentHead: false,
      }),
    ]);
    const projection = makeProjection([beat]);
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), makeActions(), projection)} />);

    const naturalHead = shotCard(container, 'shot_private_1');
    const continuation = shotCard(container, 'shot_private_2');
    const laterNaturalHead = shotCard(container, 'shot_private_3');
    const authoredHead = shotCard(container, 'shot_private_4');
    const defensiveContinuation = shotCard(container, 'shot_private_5');
    const headCopy = 'Head of the chain · Starts from the first frame';

    expect(naturalHead.querySelector('[data-chain-state="segment_head"]')).toHaveTextContent(headCopy);
    expect(continuation.querySelector('[data-chain-state="continuous"]')).toHaveTextContent(
      'Continues from Shot 01’s last frame'
    );
    expect(laterNaturalHead.querySelector('[data-chain-state="segment_head"]')).toHaveTextContent(headCopy);
    expect(authoredHead.querySelector('[data-chain-state="hard_cut"]')).toHaveTextContent(
      'Hard cut · Starts from the first frame'
    );
    expect(defensiveContinuation.querySelector('[data-chain-state="continuous"]')).toHaveTextContent(
      'Continues from Shot 04’s last frame'
    );

    inspectShot(container, 'shot_private_2');
    const continuityWarning = within(continuation).getByText('System continuity is stale');
    const continuationState = continuation.querySelector<HTMLElement>('[data-chain-state="continuous"]');
    const chainChangeControl = continuation.querySelector<HTMLElement>('[data-chain-change-control]');
    expect(continuityWarning).toBeVisible();
    expect(continuationState).not.toContainElement(continuityWarning);
    expect(chainChangeControl).not.toContainElement(continuityWarning);
    expect(within(continuation).getByText('Generated work is out of date')).toBeVisible();

    inspectShot(container, 'shot_private_1');
    const shootingScript = within(naturalHead).getByRole('textbox', { name: 'Shooting script for Shot 1' });
    expect(shootingScript).toHaveValue('Canonical shooting script 1');
    expect(shootingScript).toHaveAttribute('data-min-rows', '3');
    expect(shootingScript).toHaveAttribute('data-max-rows', '6');
    expect(naturalHead.querySelectorAll('textarea')).toHaveLength(1);

    inspectShot(container, 'shot_private_4');
    expect(within(authoredHead).getByRole('button', { name: 'Review rejoin…' })).toHaveAttribute(
      'data-chain-change-intent',
      'rejoin'
    );
    inspectShot(container, 'shot_private_5');
    expect(within(defensiveContinuation).getByRole('button', { name: 'Review rejoin…' })).toHaveAttribute(
      'data-chain-change-intent',
      'rejoin'
    );
    expect(container.querySelector('video')).toHaveProperty('controls', true);
    expect(within(naturalHead).getByLabelText('First frame 1 for Shot 1')).toBeInTheDocument();
    expect(within(continuation).getByLabelText('Player · Current picture for Shot 2')).toBeInTheDocument();
    expect(container.textContent).not.toContain('asset_private');
    expect(container.textContent).not.toContain('shot_private');
  });

  it('presents a legacy hard-cut first Shot as the natural segment head without changing later hard cuts', () => {
    const beat = makeBeat('beat_1', [
      makeShot('shot_legacy_head', 0, { chainBreak: 'hard_cut', segmentHead: true }),
      makeShot('shot_later_hard_cut', 1, { chainBreak: 'hard_cut', segmentHead: true }),
    ]);
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), makeActions())} />);

    expect(
      shotCard(container, 'shot_legacy_head').querySelector('[data-chain-state="segment_head"]')
    ).toHaveTextContent('Head of the chain · Starts from the first frame');
    expect(shotCard(container, 'shot_later_hard_cut').querySelector('[data-chain-state="hard_cut"]')).toHaveTextContent(
      'Hard cut · Starts from the first frame'
    );
  });

  it('keeps canonical chain state while opening reviewed sever and rejoin without a free mutation path', () => {
    const actions = makeActions();
    const beat = makeBeat('beat_1', [
      makeShot('shot_natural_head', 0, { chainBreak: 'none', segmentHead: true }),
      makeShot('shot_continuous', 1, { chainBreak: 'none', segmentHead: false }),
      makeShot('shot_hard_cut', 2, { chainBreak: 'hard_cut', segmentHead: true }),
    ]);
    const props = panelProps(beat, makeDrafts(), actions, makeProjection([beat]));
    const { container, rerender } = render(<BeatPanel {...props} />);
    expect(shotCard(container, 'shot_natural_head').querySelector('[data-chain-change-trigger]')).toBeNull();
    inspectShot(container, 'shot_continuous');
    const continuousControl = within(shotCard(container, 'shot_continuous')).getByRole('button', {
      name: 'Review hard cut…',
    });
    inspectShot(container, 'shot_hard_cut');
    const hardCutControl = within(shotCard(container, 'shot_hard_cut')).getByRole('button', {
      name: 'Review rejoin…',
    });

    for (const control of [continuousControl, hardCutControl]) {
      expect(control).toBeEnabled();
      expect(control).toHaveAttribute('aria-haspopup', 'dialog');
      const descriptionId = control.getAttribute('aria-describedby');
      expect(descriptionId).not.toBeNull();
      const description = document.getElementById(descriptionId!);
      expect(description).toHaveTextContent(/Shot/);
    }
    fireEvent.click(continuousControl);
    fireEvent.click(hardCutControl);
    expect(actions.reviewContinuity).toHaveBeenNthCalledWith(1, 'shot_continuous', true);
    expect(actions.reviewContinuity).toHaveBeenNthCalledWith(2, 'shot_hard_cut', false);

    rerender(<BeatPanel {...props} />);
    expect(shotCard(container, 'shot_continuous')).toHaveTextContent('Continues from Shot 01’s last frame');
    expect(shotCard(container, 'shot_hard_cut')).toHaveTextContent('Hard cut · Starts from the first frame');
    expect(actions).not.toHaveProperty('setHardCut');
  });

  it('locks reviewed chain changes for stale, dirty, pending, and open-gate authority', () => {
    const beat = makeBeat('beat_1', [
      makeShot('shot_head', 0),
      makeShot('shot_continuous', 1, { chainBreak: 'none', segmentHead: false }),
    ]);
    const assertions = [
      panelProps(beat, makeDrafts({}, { staleRevision: true }), makeActions()),
      panelProps(
        beat,
        makeDrafts({ 'shot.shot_continuous.shootingScript': 'dirty' }),
        makeActions(),
        makeProjection([beat]),
        {
          reviewBlockedMessageKey: 'conversation.creativeStudio.workspace.controls.saveBeforeReview',
        }
      ),
      panelProps(beat, makeDrafts(), makeActions(), makeProjection([beat]), { pending: true }),
      panelProps(beat, makeDrafts(), makeActions(), makeProjection([beat]), { gateLocked: true }),
    ];

    for (const props of assertions) {
      const view = render(<BeatPanel {...props} />);
      inspectShot(view.container, 'shot_continuous');
      expect(
        within(shotCard(view.container, 'shot_continuous')).getByRole('button', { name: 'Review hard cut…' })
      ).toBeDisabled();
      view.unmount();
    }
  });

  /** Opens the Beat overflow menu and returns it. Save, Reset and re-split live there now. */
  const openBeatMenu = (container: HTMLElement): HTMLElement => {
    const trigger = container.querySelector<HTMLButtonElement>('[data-beat-overflow-trigger]');
    if (trigger === null) throw new Error('Missing Beat overflow trigger');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = container.querySelector<HTMLElement>('[data-beat-overflow-menu]');
    if (menu === null) throw new Error('Missing Beat overflow menu');
    return menu;
  };

  it('collapses Story and the Beat target behind header controls, leaving no editor by default', () => {
    const { container } = render(<BeatPanel {...panelProps(makeBeat(), makeDrafts(), makeActions())} />);

    // Nothing is authored on screen until asked for: no fields region, no inline action row.
    expect(screen.queryByRole('region', { name: 'Beat fields' })).toBeNull();
    expect(container.querySelector('[data-beat-editor-actions]')).toBeNull();
    expect(container.querySelector('[data-beat-field="story"]')).toBeNull();
    expect(container.querySelector('[data-beat-field="target"]')).toBeNull();

    // Story reads from the header control's title and opens the editor on click.
    const storyToggle = container.querySelector<HTMLButtonElement>('[data-beat-story-toggle]');
    if (storyToggle === null) throw new Error('Missing Story toggle');
    expect(storyToggle).toHaveAttribute('title', 'Open the film');
    fireEvent.click(storyToggle);
    const fields = screen.getByRole('region', { name: 'Beat fields' });
    const storyField = fields.querySelector<HTMLElement>('[data-beat-field="story"]');
    if (storyField === null) throw new Error('Story was not revealed');
    expect(storyField.tagName).toBe('LABEL');
    expect(within(storyField).getByRole('textbox', { name: 'Story' })).toBeVisible();
    expect(within(storyField).getByText('Story · What happens in this Beat', { exact: true })).toBeVisible();

    // The target is revealed from the overflow menu, not from the layout.
    fireEvent.click(within(openBeatMenu(document.body)).getByRole('menuitem', { name: 'Beat target' }));
    const revealed = container.querySelector<HTMLElement>('[data-beat-field="target"]');
    if (revealed === null) throw new Error('Beat target was not revealed from the menu');
    expect(within(revealed).getByRole('spinbutton', { name: 'Beat target' })).toBeVisible();
    expect(fields.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('saves only the changed Story field from the Beat editor', async () => {
    const story = 'Ming spots Mei beneath the dai-pai-dong awning.';
    const beat = makeBeat('beat_1', [makeShot('shot_1', 0)]);
    const drafts = makeDrafts({ 'beat.beat_1.story': story });
    const actions = makeActions();
    render(<BeatPanel {...panelProps(beat, drafts, actions)} />);

    const save = within(openBeatMenu(document.body)).getByRole('menuitem', { name: 'Save Beat' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(actions.saveBeat).toHaveBeenCalledWith('beat_1', { story }));
    expect(drafts.resetIfValue).toHaveBeenCalledWith('beat.beat_1.story', story);
    expect(drafts.resetIfValue).toHaveBeenCalledWith('beat.beat_1.targetSeconds', 8);
  });

  it('resets only the local Shot draft keys and invokes no semantic mutation', () => {
    const beat = makeBeat('beat_1', [makeShot('shot_1', 0)]);
    const drafts = makeDrafts({ 'shot.shot_1.shootingScript': 'Local shooting script' });
    const actions = makeActions();
    render(<BeatPanel {...panelProps(beat, drafts, actions)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset Shot' }));
    expect(drafts.reset.mock.calls.map(([key]) => key)).toEqual([
      'shot.shot_1.shootingScript',
      'shot.shot_1.durationSeconds',
    ]);
    expect(actions.saveShot).not.toHaveBeenCalled();
  });

  it('resets the submitted Shot snapshot through the latest draft owner after an edit-during-save race', async () => {
    let resolveSave: ((saved: boolean) => void) | null = null;
    const savePromise = new Promise<boolean>((resolve) => {
      resolveSave = resolve;
    });
    const saveShot = vi.fn(() => savePromise);
    const actions = makeActions({ saveShot });
    const beat = makeBeat('beat_1', [makeShot('shot_1', 0)]);
    const submittedDrafts = makeDrafts({ 'shot.shot_1.shootingScript': 'Submitted shooting script' });
    const newerDrafts = makeDrafts({ 'shot.shot_1.shootingScript': 'Newer local shooting script' });
    const result = render(<BeatPanel {...panelProps(beat, submittedDrafts, actions)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Shot' }));
    expect(saveShot).toHaveBeenCalledWith([
      { shotId: 'shot_1', changes: { shootingScript: 'Submitted shooting script' } },
    ]);
    result.rerender(<BeatPanel {...panelProps(beat, newerDrafts, actions)} />);
    await act(async () => resolveSave?.(true));

    await waitFor(() =>
      expect(newerDrafts.resetIfValue).toHaveBeenCalledWith('shot.shot_1.shootingScript', 'Submitted shooting script')
    );
    expect(submittedDrafts.resetIfValue).not.toHaveBeenCalled();
    expect(newerDrafts.resetIfValue).not.toHaveBeenCalledWith(
      'shot.shot_1.shootingScript',
      'Newer local shooting script'
    );
  });

  it('blocks stale authored saves and all project/draft controls while a gate owns the project', () => {
    const beat = makeBeat();
    const staleDrafts = makeDrafts(
      {
        'beat.beat_1.story': 'Stale Story',
        'shot.shot_1.shootingScript': 'Stale Shooting script',
      },
      { staleRevision: true }
    );
    const actions = makeActions();
    const stale = render(<BeatPanel {...panelProps(beat, staleDrafts, actions)} />);
    expect(within(openBeatMenu(document.body)).getByRole('menuitem', { name: 'Save Beat' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Save Shot' })[0]).toBeDisabled();

    stale.rerender(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, makeProjection([beat]), { gateLocked: true })} />
    );
    // Story reads while locked; opening it reveals an editor that refuses edits.
    fireEvent.click(stale.container.querySelector<HTMLButtonElement>('[data-beat-story-toggle]')!);
    expect(screen.getByRole('textbox', { name: 'Story' })).toBeDisabled();
    inspectShot(stale.container, 'shot_2');
    expect(
      within(shotCard(stale.container, 'shot_2')).getByRole('button', { name: 'Review hard cut…' })
    ).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Boundary after Shot 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Play Beat' })).toBeEnabled();
    expect(screen.getByRole('slider', { name: 'Beat seek rail' })).toBeEnabled();
    // Re-split moved into the Beat overflow menu, and a gate-locked project disables that trigger
    // outright — so the action is unreachable rather than merely inert.
    expect(stale.container.querySelector('[data-beat-overflow-trigger]')).toBeDisabled();
    expect(actions.requestResplit).not.toHaveBeenCalled();
  });

  it('exposes exactly one Shooting script editor and no retired prose workflows for a Shot', () => {
    const beat = makeBeat('beat_1', [makeShot('shot_1', 0)]);
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), makeActions())} />);
    const shot = within(shotCard(container, 'shot_1'));

    expect(shot.getAllByRole('textbox')).toHaveLength(1);
    expect(shot.getByRole('textbox', { name: 'Shooting script for Shot 1' })).toHaveValue(
      'Canonical shooting script 1'
    );
    expect(shot.queryByRole('button', { name: /detach|restore|re-derive/iu })).toBeNull();
  });

  it('shows one current picture with Generate again and no Take selection or overflow surface', () => {
    const shot = makeShot('shot_1', 0, {
      currentPicture: makeCurrentPicture('video_current', 10, 'poster_current'),
      effectiveSeedAssetId: 'seed_existing',
      hasEffectiveSeed: true,
    });
    const beat = makeBeat('beat_1', [shot]);
    const actions = makeActions();
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), actions)} />);

    const shotRegion = within(shotCard(container, shot.id));
    const picture = shotRegion.getByRole('region', { name: 'Current picture for Shot 1' });
    expect(within(picture).getByLabelText('Player · Current picture for Shot 1')).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project_1/video_current'
    );
    expect(container.querySelector('[data-asset-id="video_superseded"]')).toBeNull();
    expect(within(picture).queryByRole('button', { name: /Select Take|More actions/u })).toBeNull();
    expect(shotRegion.queryByRole('spinbutton', { name: /Generation count/u })).toBeNull();

    fireEvent.click(within(picture).getByRole('button', { name: 'Generate again' }));
    expect(actions.reviewShot).toHaveBeenCalledWith('shot_1', [{ shotId: 'shot_1', purpose: 'video_take' }]);
  });

  it('opens the Beat player, first-frame image, and current Shot video from their exact fullscreen frames', () => {
    const seed = makeSeedStill('image_current', { effectiveSeed: true });
    const shot = makeShot('shot_1', 0, {
      currentPicture: makeCurrentPicture('video_current', 8, 'poster_current'),
      effectiveSeedAssetId: seed.assetId,
      hasEffectiveSeed: true,
      seedStills: [seed],
      segmentHead: true,
    });
    const beat = makeBeat('beat_1', [shot]);
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), makeActions())} />);

    const beatPreview = screen.getByRole('region', { name: 'Beat preview' });
    const beatFrame = beatPreview.closest<HTMLElement>('[data-fullscreen-media-frame]');
    if (beatFrame === null) throw new Error('Missing Beat player fullscreen frame');
    const beatExpand = within(beatFrame).getByRole('button', { name: 'Expand' });
    const requestBeatFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(beatFrame, 'requestFullscreen', {
      configurable: true,
      value: requestBeatFullscreen,
    });
    fireEvent.click(beatExpand);
    expect(requestBeatFullscreen).toHaveBeenCalledTimes(1);
    expect(within(beatFrame).getByRole('group', { name: 'Beat transport' })).toBeInTheDocument();

    const seedCard = assetCard(container, seed.assetId);
    const seedExpand = within(seedCard).getByRole('button', { name: 'Expand' });
    const seedFrame = seedExpand.closest<HTMLElement>('[data-fullscreen-media-frame]');
    if (seedFrame === null) throw new Error('Missing first-frame image fullscreen frame');
    const requestSeedFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(seedFrame, 'requestFullscreen', {
      configurable: true,
      value: requestSeedFullscreen,
    });
    fireEvent.click(seedExpand);
    expect(requestSeedFullscreen).toHaveBeenCalledTimes(1);

    const picture = within(shotCard(container, shot.id)).getByRole('region', {
      name: 'Current picture for Shot 1',
    });
    const pictureExpand = within(picture).getByRole('button', { name: 'Expand' });
    const pictureFrame = pictureExpand.closest<HTMLElement>('[data-fullscreen-media-frame]');
    if (pictureFrame === null) throw new Error('Missing current Shot video fullscreen frame');
    const requestPictureFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(pictureFrame, 'requestFullscreen', {
      configurable: true,
      value: requestPictureFullscreen,
    });
    fireEvent.click(pictureExpand);
    expect(requestPictureFullscreen).toHaveBeenCalledTimes(1);
  });

  it('keeps seed still pinning reachable without any video selection or overflow surface', () => {
    const effective = makeSeedStill('image_1', { effectiveSeed: true });
    const pinned = makeSeedStill('image_2', { explicitSeed: true });
    const shot = makeShot('shot_1', 0, {
      seedStills: [effective, pinned],
      segmentHead: true,
    });
    const actions = makeActions();
    const { container } = render(<BeatPanel {...panelProps(makeBeat('beat_1', [shot]), makeDrafts(), actions)} />);

    fireEvent.click(
      within(assetCard(container, effective.assetId)).getByRole('button', { name: 'Pin as first frame' })
    );
    expect(actions.setSeedStill).toHaveBeenCalledWith('shot_1', effective.assetId);
    fireEvent.click(
      within(assetCard(container, pinned.assetId)).getByRole('button', { name: 'Clear first-frame pin' })
    );
    expect(actions.setSeedStill).toHaveBeenCalledWith('shot_1', null);
    expect(container.querySelector('[data-take-overflow-trigger]')).toBeNull();
    expect(container.querySelector('[data-take-overflow-menu]')).toBeNull();
  });

  it('closes and invalidates Beat confirmations on identity or project drift and owner unmount', async () => {
    const beatA = makeBeat('beat_a', [makeShot('shot_a', 0)]);
    const beatB = makeBeat('beat_b', [makeShot('shot_b', 0)]);
    const actions = makeActions();
    const closeA = vi.fn();
    modalConfirm.mockReturnValueOnce({ close: closeA, update: vi.fn() });
    const result = render(<BeatPanel {...panelProps(beatA, makeDrafts(), actions)} />);
    let trigger = result.container.querySelector<HTMLButtonElement>('[data-beat-overflow-trigger]');
    if (trigger === null) throw new Error('Missing Beat overflow trigger');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    let menu = result.container.querySelector<HTMLElement>('[data-beat-overflow-menu]');
    if (menu === null) throw new Error('Missing Beat overflow menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to Bin' }));
    const beatAConfirmation = latestModalConfirmation();

    result.rerender(<BeatPanel {...panelProps(beatB, makeDrafts(), actions)} />);
    expect(closeA).toHaveBeenCalledTimes(1);
    await act(async () => {
      await beatAConfirmation.onOk();
    });
    expect(actions.parkBeat).not.toHaveBeenCalled();

    const closeB = vi.fn();
    modalConfirm.mockReturnValueOnce({ close: closeB, update: vi.fn() });
    trigger = result.container.querySelector<HTMLButtonElement>('[data-beat-overflow-trigger]');
    if (trigger === null) throw new Error('Missing replacement Beat overflow trigger');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    menu = result.container.querySelector<HTMLElement>('[data-beat-overflow-menu]');
    if (menu === null) throw new Error('Missing replacement Beat overflow menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to Bin' }));
    const beatBConfirmation = latestModalConfirmation();
    result.rerender(
      <BeatPanel {...panelProps(beatB, makeDrafts(), actions, makeProjection([beatB]), { projectId: 'project_2' })} />
    );
    expect(closeB).toHaveBeenCalledTimes(1);
    await act(async () => {
      await beatBConfirmation.onOk();
    });
    expect(actions.parkBeat).not.toHaveBeenCalled();

    const closeProjectTwo = vi.fn();
    modalConfirm.mockReturnValueOnce({ close: closeProjectTwo, update: vi.fn() });
    trigger = result.container.querySelector<HTMLButtonElement>('[data-beat-overflow-trigger]');
    if (trigger === null) throw new Error('Missing project-switched Beat overflow trigger');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    menu = result.container.querySelector<HTMLElement>('[data-beat-overflow-menu]');
    if (menu === null) throw new Error('Missing project-switched Beat overflow menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to Bin' }));
    const projectTwoConfirmation = latestModalConfirmation();
    result.unmount();
    expect(closeProjectTwo).toHaveBeenCalledTimes(1);
    await act(async () => {
      await projectTwoConfirmation.onOk();
    });
    expect(actions.parkBeat).not.toHaveBeenCalled();
  });

  it('keeps retained seed stills reachable on continuity Shots without exposing seed controls', () => {
    const retainedSeed = makeSeedStill('image_continuity');
    const beat = makeBeat('beat_1', [
      makeShot('shot_1', 0),
      makeShot('shot_2', 1, { seedStills: [retainedSeed], segmentHead: false }),
    ]);
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), makeActions())} />);
    const card = within(inspectShot(container, 'shot_2')).getByLabelText('First frame 1 for Shot 2');

    expect(card).toBeVisible();
    expect(within(card).queryByRole('button', { name: 'Pin as first frame' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Clear first-frame pin' })).toBeNull();
  });

  it('reviews the complete ordered seed-and-video graph without the retired per-Shot reference picker', () => {
    const beat = makeBeat();
    const drafts = makeDrafts();
    const actions = makeActions();
    const reviewGraph: BeatPanelReviewGraph = {
      triggerShotId: 'shot_1',
      choices: [
        { shotId: 'shot_1', purpose: 'seed_still' },
        { shotId: 'shot_1', purpose: 'video_take' },
        { shotId: 'shot_2', purpose: 'video_take' },
      ],
      block: null,
    };
    const result = render(
      <BeatPanel
        {...panelProps(beat, drafts, actions, makeProjection([beat]), {
          reviewGraphs: [
            reviewGraph,
            {
              triggerShotId: 'shot_2',
              choices: [{ shotId: 'shot_2', purpose: 'video_take' }],
              block: null,
            },
          ],
        })}
      />
    );

    const triggerCard = within(shotCard(result.container, 'shot_1'));
    expect(triggerCard.queryByRole('spinbutton', { name: /Generation count/u })).toBeNull();
    expect(triggerCard.queryByRole('combobox', { name: /Brief reference/u })).toBeNull();

    fireEvent.click(triggerCard.getByRole('button', { name: 'Review first-frame generation' }));
    expect(actions.reviewShot).toHaveBeenCalledWith('shot_1', [
      { shotId: 'shot_1', purpose: 'seed_still' },
      { shotId: 'shot_1', purpose: 'video_take' },
      { shotId: 'shot_2', purpose: 'video_take' },
    ]);
    expect(drafts.setValue).not.toHaveBeenCalledWith('gate.choices', expect.any(String));
  });

  it('fails closed on a missing or duplicate reviewed graph instead of fabricating a payable choice', () => {
    const beat = makeBeat('beat_1', [makeShot('shot_1', 0)]);
    const actions = makeActions();
    render(
      <BeatPanel
        {...panelProps(beat, makeDrafts(), actions, makeProjection([beat]), {
          reviewGraphs: [],
        })}
      />
    );
    expect(screen.getByRole('button', { name: 'Review first-frame generation' })).toBeDisabled();
    expect(screen.getByText('Generation review is unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review first-frame generation' }));
    expect(actions.reviewShot).not.toHaveBeenCalled();
  });

  it('keeps a blocked Render visible and exposes the exact Main reason as its accessible description', () => {
    const shot = makeShot('shot_1', 0);
    const beat = makeBeat('beat_1', [shot]);
    const block: StudioGenerationBlockV2 = { code: 'duration', role: 'image', seconds: 8 };
    render(
      <BeatPanel
        {...panelProps(beat, makeDrafts(), makeActions(), makeProjection([beat]), {
          reviewGraphs: [
            {
              triggerShotId: shot.id,
              choices: [{ shotId: shot.id, purpose: 'seed_still' }],
              block: { item: { shotId: shot.id, purpose: 'seed_still' }, reason: block },
            },
          ],
        })}
      />
    );

    const renderButton = screen.getByRole('button', { name: 'Review first-frame generation' });
    expect(renderButton).toBeVisible();
    expect(renderButton).toBeDisabled();
    expect(renderButton).toHaveAccessibleDescription('This engine cannot make a shot 8s long.');
    expect(screen.getByText('This engine cannot make a shot 8s long.')).toHaveAttribute('role', 'status');
  });

  it('focuses an exact downstream duration field locally without delegating or opening paid review', () => {
    const shot1 = makeShot('shot_1', 0);
    const shot2 = makeShot('shot_2', 1);
    const beat = makeBeat('beat_1', [shot1, shot2]);
    const actions = makeActions();
    const { container } = render(
      <BeatPanel
        {...panelProps(beat, makeDrafts(), actions, makeProjection([beat]), {
          reviewGraphs: [
            {
              triggerShotId: shot1.id,
              choices: [
                { shotId: shot1.id, purpose: 'seed_still' },
                { shotId: shot2.id, purpose: 'video_take' },
              ],
              block: {
                item: { shotId: shot2.id, purpose: 'video_take' },
                reason: { code: 'duration', role: 'video', seconds: 8 },
              },
            },
            {
              triggerShotId: shot2.id,
              choices: [{ shotId: shot2.id, purpose: 'video_take' }],
              block: null,
            },
          ],
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Adjust shot length' }));
    const downstreamDuration = container.querySelector<HTMLInputElement>(
      '[data-shot-card][data-shot-id="shot_2"] [data-shot-duration-field] input'
    );
    expect(downstreamDuration).not.toBeNull();
    expect(downstreamDuration).toHaveFocus();
    expect(actions.resolveGenerationBlock).not.toHaveBeenCalled();
    expect(actions.reviewShot).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'reference binding',
      block: {
        code: 'reference_binding',
        role: 'image',
        reason: 'unassigned',
        selectedCount: 0,
        limit: 1,
      } satisfies StudioGenerationBlockV2,
      remedy: 'Review Shot binding',
    },
    {
      label: 'route selection',
      block: { code: 'no_engine', role: 'image' } satisfies StudioGenerationBlockV2,
      remedy: 'Set engines',
    },
  ])('delegates the exact $label blocker through its safe remedy', ({ block, remedy }) => {
    const shot = makeShot('shot_1', 0);
    const beat = makeBeat('beat_1', [shot]);
    const actions = makeActions();
    render(
      <BeatPanel
        {...panelProps(beat, makeDrafts(), actions, makeProjection([beat]), {
          reviewGraphs: [
            {
              triggerShotId: shot.id,
              choices: [{ shotId: shot.id, purpose: 'seed_still' }],
              block: { item: { shotId: shot.id, purpose: 'seed_still' }, reason: block },
            },
          ],
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: remedy }));
    expect(actions.resolveGenerationBlock).toHaveBeenCalledTimes(1);
    expect(actions.resolveGenerationBlock).toHaveBeenCalledWith(shot.id, block);
    expect(actions.reviewShot).not.toHaveBeenCalled();
  });

  it('routes a cascade blocker remedy to the exact downstream Shot reported by Main', () => {
    const shot1 = makeShot('shot_1', 0);
    const shot2 = makeShot('shot_2', 1);
    const beat = makeBeat('beat_1', [shot1, shot2]);
    const actions = makeActions();
    const reason = { code: 'no_engine', role: 'video' } satisfies StudioGenerationBlockV2;
    render(
      <BeatPanel
        {...panelProps(beat, makeDrafts(), actions, makeProjection([beat]), {
          reviewGraphs: [
            {
              triggerShotId: shot1.id,
              choices: [
                { shotId: shot1.id, purpose: 'seed_still' },
                { shotId: shot2.id, purpose: 'video_take' },
              ],
              block: { item: { shotId: shot2.id, purpose: 'video_take' }, reason },
            },
            {
              triggerShotId: shot2.id,
              choices: [{ shotId: shot2.id, purpose: 'video_take' }],
              block: null,
            },
          ],
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set engines' }));
    expect(actions.resolveGenerationBlock).toHaveBeenCalledWith(shot2.id, reason);
    expect(actions.reviewShot).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'unloaded catalog',
      block: { code: 'catalog_unloaded', role: 'image' } satisfies StudioGenerationBlockV2,
      reason: 'The engine list has not loaded yet.',
    },
    {
      label: 'unhealthy engine',
      block: { code: 'health', role: 'image' } satisfies StudioGenerationBlockV2,
      reason: 'The engine is not answering.',
    },
  ])('offers no unsafe action for an $label blocker', ({ block, reason }) => {
    const shot = makeShot('shot_1', 0);
    const beat = makeBeat('beat_1', [shot]);
    const actions = makeActions();
    render(
      <BeatPanel
        {...panelProps(beat, makeDrafts(), actions, makeProjection([beat]), {
          reviewGraphs: [
            {
              triggerShotId: shot.id,
              choices: [{ shotId: shot.id, purpose: 'seed_still' }],
              block: { item: { shotId: shot.id, purpose: 'seed_still' }, reason: block },
            },
          ],
        })}
      />
    );

    expect(screen.getByText(reason)).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Review first-frame generation' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Set engines' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adjust shot length' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review Shot binding' })).toBeNull();
    expect(actions.resolveGenerationBlock).not.toHaveBeenCalled();
    expect(actions.reviewShot).not.toHaveBeenCalled();
  });

  it('reorders Shots atomically in Beat scope and announces the resulting position', async () => {
    const beat = makeBeat();
    const actions = makeActions();
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), actions)} />);
    fireEvent.click(within(shotCard(container, 'shot_1')).getByRole('button', { name: 'Move Shot 1 down' }));
    await waitFor(() => expect(actions.reorderShots).toHaveBeenCalledWith('beat_1', ['shot_2', 'shot_1']));
    await waitFor(() => expect(screen.getByText('Moved Shot 1 to 2 of 2')).toBeInTheDocument());
  });

  it('places Shot and Beat removal in header overflows with exact downstream confirmations', async () => {
    const shot1 = makeShot('shot_1', 0, { downstreamShotIds: ['shot_2', 'shot_3'] });
    const shot2 = makeShot('shot_2', 1);
    const beat = makeBeat('beat_1', [shot1, shot2]);
    const nextBeat = makeBeat('beat_2', [makeShot('shot_3', 0)], { title: 'Close' });
    const projection = makeProjection([beat, nextBeat]);
    const actions = makeActions();
    const onParkShotSuccess = vi.fn();
    const result = render(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, projection, { onParkShotSuccess })} />
    );

    const firstShotCard = shotCard(result.container, 'shot_1');
    const shotHeader = firstShotCard.querySelector('header');
    const shotFooter = firstShotCard.querySelector<HTMLElement>('[data-shot-footer]');
    const shotOverflow = firstShotCard.querySelector<HTMLButtonElement>('[data-shot-overflow-trigger]');
    if (shotHeader === null || shotFooter === null || shotOverflow === null) {
      throw new Error('Missing Shot header overflow placement hooks');
    }
    expect(shotHeader).toContainElement(shotOverflow);
    expect(shotFooter.querySelector('[data-shot-overflow-trigger]')).toBeNull();
    expect(shotFooter.querySelector('[data-shot-move-to-bin]')).toBeNull();
    expect(shotOverflow).toHaveAccessibleName('More actions · Shot 1');
    expect(shotOverflow).toHaveAttribute('aria-haspopup', 'menu');
    act(() => shotOverflow.focus());
    fireEvent.keyDown(shotOverflow, { key: 'Enter' });
    const shotMenu = firstShotCard.querySelector<HTMLElement>('[data-shot-overflow-menu]');
    if (shotMenu === null) throw new Error('Missing Shot overflow menu');
    fireEvent.click(within(shotMenu).getByRole('menuitem', { name: 'Move to Bin' }));
    let confirmation = latestModalConfirmation();
    expect(confirmation).toMatchObject({
      cancelText: 'Cancel',
      content:
        'Authored and paid work stays with this Shot. Moving it to the Bin makes Beat 1, Shot 2, Beat 2, Shot 1 stale.',
      okButtonProps: { status: 'danger' },
      okText: 'Move to Bin',
      title: 'Move Shot 1 to the Bin?',
    });
    await act(async () => {
      await confirmation.onOk();
    });
    await waitFor(() => expect(actions.parkShot).toHaveBeenCalledWith('shot_1'));
    await waitFor(() => expect(onParkShotSuccess).toHaveBeenCalledWith('shot_1'));

    const panelHeader = result.container.querySelector<HTMLElement>('[data-panel-header]');
    const beatOverflow = result.container.querySelector<HTMLButtonElement>('[data-beat-overflow-trigger]');
    if (panelHeader === null || beatOverflow === null) throw new Error('Missing Beat header overflow placement hooks');
    expect(panelHeader).toContainElement(beatOverflow);
    expect(beatOverflow).toHaveAccessibleName('More actions · Opening');
    expect(result.container.querySelector('[data-panel-footer]')).toBeNull();
    fireEvent.keyDown(beatOverflow, { key: 'Enter' });
    const beatMenu = panelHeader.querySelector<HTMLElement>('[data-beat-overflow-menu]');
    if (beatMenu === null) throw new Error('Missing Beat overflow menu');
    fireEvent.click(within(beatMenu).getByRole('menuitem', { name: 'Move to Bin' }));
    confirmation = latestModalConfirmation();
    expect(confirmation).toMatchObject({
      cancelText: 'Cancel',
      content:
        'Every Shot and all authored and paid work stay with this Beat. Moving it to the Bin makes Beat 2, Shot 1 stale.',
      okButtonProps: { status: 'danger' },
      okText: 'Move to Bin',
      title: 'Move this Beat to the Bin?',
    });
    expect(String(confirmation.content)).not.toContain('Beat 1, Shot 2');
    act(() => screen.getByRole('button', { name: 'Close' }).focus());
    act(() => confirmation.onCancel?.());
    expect(beatOverflow).not.toHaveFocus();
    act(() => confirmation.afterClose?.());
    expect(beatOverflow).toHaveFocus();
    expect(actions.parkBeat).not.toHaveBeenCalled();

    result.rerender(
      <BeatPanel
        {...panelProps(beat, makeDrafts({ 'shot.shot_1.shootingScript': 'Unsaved local work' }), actions, projection)}
      />
    );
    // The trigger stays reachable because the menu also holds planned duration; lift alone is
    // refused while local edits are unsaved.
    const shotTrigger = shotCard(result.container, 'shot_1').querySelector<HTMLButtonElement>(
      '[data-shot-overflow-trigger]'
    );
    expect(shotTrigger).toBeEnabled();
    fireEvent.keyDown(shotTrigger!, { key: 'Enter' });
    const shotOverflowMenu = shotCard(result.container, 'shot_1').querySelector<HTMLElement>(
      '[data-shot-overflow-menu]'
    );
    expect(within(shotOverflowMenu!).getByRole('menuitem', { name: 'Move to Bin' })).toBeDisabled();
    expect(screen.getAllByText('Save or reset local edits first').length).toBeGreaterThan(0);
  });

  it('reports only a committed Shot lift to the Board handoff owner', async () => {
    const beat = makeBeat();
    const actions = makeActions();
    const onParkShotSuccess = vi.fn();
    const result = render(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, makeProjection([beat]), { onParkShotSuccess })} />
    );

    const card = shotCard(result.container, 'shot_1');
    const trigger = card.querySelector<HTMLButtonElement>('[data-shot-overflow-trigger]');
    if (trigger === null) throw new Error('Missing Shot overflow trigger');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = card.querySelector<HTMLElement>('[data-shot-overflow-menu]');
    if (menu === null) throw new Error('Missing Shot overflow menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to Bin' }));
    await act(async () => {
      await latestModalConfirmation().onOk();
    });

    await waitFor(() => expect(actions.parkShot).toHaveBeenCalledWith('shot_1'));
    await waitFor(() => expect(onParkShotSuccess).toHaveBeenCalledWith('shot_1'));
    expect(onParkShotSuccess).toHaveBeenCalledTimes(1);
  });

  it('restores the exact Shot overflow trigger after close on cancel or refusal and never starts a Bin handoff', async () => {
    const beat = makeBeat();
    const actions = makeActions({ parkShot: vi.fn().mockResolvedValue(false) });
    const onParkShotSuccess = vi.fn();
    const result = render(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, makeProjection([beat]), { onParkShotSuccess })} />
    );
    const card = shotCard(result.container, 'shot_1');
    const trigger = card.querySelector<HTMLButtonElement>('[data-shot-overflow-trigger]');
    if (trigger === null) throw new Error('Missing Shot overflow trigger');

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'Enter' });
    let menu = card.querySelector<HTMLElement>('[data-shot-overflow-menu]');
    if (menu === null) throw new Error('Missing Shot overflow menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to Bin' }));
    let confirmation = latestModalConfirmation();
    act(() => screen.getByRole('button', { name: 'Close' }).focus());
    act(() => confirmation.onCancel?.());
    expect(trigger).not.toHaveFocus();
    act(() => confirmation.afterClose?.());
    expect(trigger).toHaveFocus();
    expect(actions.parkShot).not.toHaveBeenCalled();

    fireEvent.keyDown(trigger, { key: 'Enter' });
    menu = card.querySelector<HTMLElement>('[data-shot-overflow-menu]');
    if (menu === null) throw new Error('Missing reopened Shot overflow menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to Bin' }));
    confirmation = latestModalConfirmation();
    act(() => screen.getByRole('button', { name: 'Close' }).focus());
    await act(async () => {
      await confirmation.onOk();
    });
    await waitFor(() => expect(actions.parkShot).toHaveBeenCalledWith('shot_1'));
    expect(trigger).not.toHaveFocus();
    act(() => confirmation.afterClose?.());
    expect(trigger).toHaveFocus();
    expect(screen.getByText('Shot was not moved to the Bin.')).toBeInTheDocument();
    expect(onParkShotSuccess).not.toHaveBeenCalled();
  });

  it('keeps incompatible imports outside an authorized seed and exposes one confirmed cancel-and-rejoin path', async () => {
    const authorized = makeSeedStill('image_authorized', {
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    const imported = makeSeedStill('image_imported_newer', {
      createdAt: '2026-08-21T00:00:00.000Z',
    });
    const upstream = makeShot('shot_1', 0, { currentPicture: makeCurrentPicture('video_1') });
    const locked = makeShot('shot_2', 1, {
      chainBreak: 'hard_cut',
      effectiveSeedAssetId: null,
      hasEffectiveSeed: false,
      seedAuthorizationLock: {
        compatibleAssetIds: [authorized.assetId],
        canCancelWaiting: true,
        waitingReason: 'choose_seed',
      },
      seedStills: [authorized, imported],
      segmentHead: true,
    });
    const beat = makeBeat('beat_1', [upstream, locked]);
    const row: StudioCascadeProgressV2 = {
      dependentShotId: locked.id,
      upstreamShotId: locked.id,
      eligiblePrimaryAssetIds: [authorized.assetId],
      canRetryConditioningFrame: false,
      canCancelWaiting: true,
      waitingReason: 'choose_seed',
    };
    const actions = makeActions();
    const { container } = render(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, makeProjection([beat], { cascadeProgress: [row] }))} />
    );

    const lockedCard = inspectShot(container, locked.id);
    const ordinaryRejoin = within(lockedCard).getByRole('button', { name: 'Review rejoin…' });
    const ordinaryGeneration = within(lockedCard).getByRole('button', {
      name: 'Review first-frame generation',
    });
    expect(ordinaryRejoin).toBeDisabled();
    expect(ordinaryGeneration).toBeDisabled();
    fireEvent.click(ordinaryRejoin);
    fireEvent.click(ordinaryGeneration);
    expect(actions.reviewContinuity).not.toHaveBeenCalled();
    expect(actions.reviewShot).not.toHaveBeenCalled();

    const importedCard = assetCard(container, imported.assetId);
    expect(importedCard).not.toHaveTextContent('Current first frame');
    expect(importedCard).toHaveTextContent('Not available to authorized work');
    expect(within(importedCard).queryByRole('button', { name: 'Pin as first frame' })).toBeNull();

    const authorizedCard = assetCard(container, authorized.assetId);
    fireEvent.click(within(authorizedCard).getByRole('button', { name: 'Pin as first frame' }));
    expect(actions.setSeedStill).toHaveBeenCalledWith(locked.id, authorized.assetId);
    expect(actions.setSeedStill).not.toHaveBeenCalledWith(locked.id, imported.assetId);

    expect(
      screen.getByText(
        'Authorized video work has locked this Shot’s first frame. Imported candidates remain stored, but cannot replace the seed in the reviewed quote.'
      )
    ).toBeVisible();
    expect(screen.queryByText('Creative Studio could not read or save this workspace.')).toBeNull();

    const boundedActions = screen.getAllByRole('button', { name: 'Cancel and review rejoin' });
    expect(boundedActions).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Cancel waiting' })).toBeNull();
    fireEvent.click(boundedActions[0]);
    expect(actions.cancelAndReviewRejoin).not.toHaveBeenCalled();

    const confirmation = screen.getByRole('group', {
      name: 'Cancel authorized work and review rejoin?',
    });
    expect(confirmation).toHaveTextContent('Cancel the waiting authorized work, then review a fresh rejoin quote.');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm cancel and review' }));
    await waitFor(() => expect(actions.cancelAndReviewRejoin).toHaveBeenCalledWith(locked.id));
    expect(actions.cancelWaiting).not.toHaveBeenCalled();
  });

  it('keeps generic confirmed cancellation for a first-Shot seed lock that cannot rejoin', async () => {
    const locked = makeShot('shot_1', 0, {
      seedAuthorizationLock: {
        compatibleAssetIds: ['image_authorized'],
        canCancelWaiting: true,
        waitingReason: 'choose_seed',
      },
      segmentHead: true,
    });
    const beat = makeBeat('beat_1', [locked]);
    const row: StudioCascadeProgressV2 = {
      dependentShotId: locked.id,
      upstreamShotId: locked.id,
      eligiblePrimaryAssetIds: ['image_authorized'],
      canRetryConditioningFrame: false,
      canCancelWaiting: true,
      waitingReason: 'choose_seed',
    };
    const actions = makeActions();
    render(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, makeProjection([beat], { cascadeProgress: [row] }))} />
    );

    expect(screen.queryByRole('button', { name: 'Cancel and review rejoin' })).toBeNull();
    const genericCancel = screen.getByRole('button', { name: 'Cancel waiting' });
    fireEvent.click(genericCancel);
    expect(actions.cancelWaiting).not.toHaveBeenCalled();

    const confirmation = screen.getByRole('group', { name: 'Cancel waiting?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm cancel waiting' }));
    await waitFor(() => expect(actions.cancelWaiting).toHaveBeenCalledWith(locked.id));
    expect(actions.cancelAndReviewRejoin).not.toHaveBeenCalled();
  });

  it('fails the bounded cancel-and-rejoin action closed while quote review is blocked', () => {
    const locked = makeShot('shot_2', 1, {
      chainBreak: 'hard_cut',
      seedAuthorizationLock: {
        compatibleAssetIds: ['image_authorized'],
        canCancelWaiting: true,
        waitingReason: 'choose_seed',
      },
      segmentHead: true,
    });
    const beat = makeBeat('beat_1', [makeShot('shot_1', 0), locked]);
    const row: StudioCascadeProgressV2 = {
      dependentShotId: locked.id,
      upstreamShotId: locked.id,
      eligiblePrimaryAssetIds: ['image_authorized'],
      canRetryConditioningFrame: false,
      canCancelWaiting: true,
      waitingReason: 'choose_seed',
    };
    const actions = makeActions();
    render(
      <BeatPanel
        {...panelProps(beat, makeDrafts(), actions, makeProjection([beat], { cascadeProgress: [row] }), {
          reviewBlockedMessageKey: 'conversation.creativeStudio.workspace.controls.saveBeforeReview',
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'Cancel and review rejoin' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm cancel and review' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel and review' }));
    expect(actions.cancelAndReviewRejoin).not.toHaveBeenCalled();
    expect(actions.cancelWaiting).not.toHaveBeenCalled();
  });

  it('offers free retry and cancellation only when projected flags permit them without asset-choice controls', () => {
    const upstream = makeShot('shot_1', 0, { currentPicture: makeCurrentPicture('video_1') });
    const dependent = makeShot('shot_2', 1);
    const beat = makeBeat('beat_1', [upstream, dependent]);
    const row: StudioCascadeProgressV2 = {
      dependentShotId: 'shot_2',
      upstreamShotId: 'shot_1',
      eligiblePrimaryAssetIds: ['video_1', 'video_2'],
      canRetryConditioningFrame: true,
      canCancelWaiting: true,
      waitingReason: 'conditioning_failed',
    };
    const projection = makeProjection([beat], { cascadeProgress: [row] });
    const actions = makeActions();
    const result = render(<BeatPanel {...panelProps(beat, makeDrafts(), actions, projection)} />);

    expect(screen.queryByRole('button', { name: /Use (image|video)/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry conditioning free' }));
    expect(actions.retryConditioning).toHaveBeenCalledWith('shot_2');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Cancel waiting?' })).getByRole('button', {
        name: 'Confirm cancel waiting',
      })
    );
    expect(actions.cancelWaiting).toHaveBeenCalledWith('shot_2');

    const running = {
      ...row,
      canRetryConditioningFrame: false,
      canCancelWaiting: false,
      waitingReason: 'upstream_running' as const,
    };
    result.rerender(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, makeProjection([beat], { cascadeProgress: [running] }))} />
    );
    expect(screen.queryByRole('button', { name: 'Retry conditioning free' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Cancel waiting?' })).toBeNull();
  });

  it('does not expose eligible asset IDs as choices and explains terminal states', () => {
    const beat = makeBeat();
    const row: StudioCascadeProgressV2 = {
      dependentShotId: 'shot_2',
      upstreamShotId: 'shot_1',
      eligiblePrimaryAssetIds: ['missing_asset'],
      canRetryConditioningFrame: false,
      canCancelWaiting: false,
      waitingReason: 'dependency_failed',
    };
    const projection = makeProjection([beat], { cascadeProgress: [row] });
    render(<BeatPanel {...panelProps(beat, makeDrafts(), makeActions(), projection)} />);
    expect(screen.queryByRole('button', { name: /Use (image|video)/ })).toBeNull();
    expect(screen.getByText('A fresh quote is required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry conditioning free' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Cancel waiting?' })).toBeNull();
  });

  it('keeps a free failed-frame retry reachable when a terminal cascade row shares the dependent Shot', () => {
    const beat = makeBeat();
    const row: StudioCascadeProgressV2 = {
      dependentShotId: 'shot_2',
      upstreamShotId: 'shot_1',
      eligiblePrimaryAssetIds: [],
      canRetryConditioningFrame: false,
      canCancelWaiting: false,
      waitingReason: 'cancelled',
    };
    const projection = makeProjection([beat], {
      cascadeProgress: [row],
      conditioningFailures: [{ dependentShotId: 'shot_2', reason: 'conditioning_failed', canRetry: true }],
    });
    const actions = makeActions();
    render(<BeatPanel {...panelProps(beat, makeDrafts(), actions, projection)} />);

    expect(screen.getByText('A fresh quote is required')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry conditioning free' }));
    expect(actions.retryConditioning).toHaveBeenCalledWith('shot_2');
  });

  it('shows native/CAS failures inside the modal instead of relying on obscured parent notice UI', () => {
    const beat = makeBeat();
    render(
      <BeatPanel
        {...panelProps(beat, makeDrafts(), makeActions(), makeProjection([beat]), {
          errorMessageKey: 'native.cas.failed',
        })}
      />
    );
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('native.cas.failed');
  });
});
