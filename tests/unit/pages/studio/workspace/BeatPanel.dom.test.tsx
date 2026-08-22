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
  StudioRendererParkEligibilityV2,
} from '@/common/types/project/creativeStudioTypes';
import type {
  UseWorkspaceDraftsResult,
  WorkspaceDraftEntry,
} from '@/renderer/pages/studio/components/Workspace/useWorkspaceDrafts';
import type {
  WorkspaceBeatProjection,
  WorkspaceProjection,
  WorkspaceShotProjection,
  WorkspaceTakeProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';

vi.mock('@arco-design/web-react', async () => {
  const ReactModule = await import('react');
  const Button = ReactModule.forwardRef<HTMLButtonElement, any>(
    ({ children, loading: _loading, size: _size, status: _status, type: _type, ...props }, ref) => (
      <button ref={ref} {...props}>
        {children}
      </button>
    )
  );
  const TextArea = ({ autoSize: _autoSize, onChange, ...props }: any) => (
    <textarea {...props} onChange={(event) => onChange?.(event.target.value)} />
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
  const Modal = ({ children, closable, onCancel, title, visible }: any) =>
    visible ? (
      <div aria-label={String(title)} role='dialog'>
        {closable ? (
          <button aria-label='Close' onClick={onCancel} type='button'>
            ×
          </button>
        ) : null}
        {children}
      </div>
    ) : null;
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
  return { Alert, Button, Checkbox, Input, InputNumber, Modal, Popconfirm, Select, default: ReactModule };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const copy: Record<string, string> = {
        'conversation.creativeStudio.workspace.beatPanel.beatFieldsLabel': 'Beat fields',
        'conversation.creativeStudio.workspace.beatPanel.blocker.statusUnavailable': 'Status unavailable',
        'conversation.creativeStudio.workspace.beatPanel.blocker.unsavedDrafts': 'Save or reset local edits first',
        'conversation.creativeStudio.workspace.beatPanel.chain.authorHardCut': 'Author hard cut',
        'conversation.creativeStudio.workspace.beatPanel.chain.continuous':
          'Continues from Shot {{position}}’s last frame',
        'conversation.creativeStudio.workspace.beatPanel.chain.hardCut': 'Hard cut',
        'conversation.creativeStudio.workspace.beatPanel.chain.hardCutUnavailable':
          'Hard-cut changes are temporarily unavailable. A reviewed estimate for the required replacement media must come first.',
        'conversation.creativeStudio.workspace.beatPanel.chain.generationOutOfDate': 'Generated work is out of date',
        'conversation.creativeStudio.workspace.beatPanel.chain.segmentHead':
          'Head of the chain · Starts from the still',
        'conversation.creativeStudio.workspace.beatPanel.chain.systemContinuityStale': 'System continuity is stale',
        'conversation.creativeStudio.workspace.beatPanel.common.cancel': 'Cancel',
        'conversation.creativeStudio.workspace.beatPanel.common.keepWaiting': 'Keep waiting',
        'conversation.creativeStudio.workspace.beatPanel.common.resetBeat': 'Reset Beat',
        'conversation.creativeStudio.workspace.beatPanel.common.resetShot': 'Reset Shot',
        'conversation.creativeStudio.workspace.beatPanel.common.saveBeat': 'Save Beat',
        'conversation.creativeStudio.workspace.beatPanel.common.saveShot': 'Save Shot',
        'conversation.creativeStudio.workspace.beatPanel.coverage.reviewResplit': 'Review re-split',
        'conversation.creativeStudio.workspace.beatPanel.derivation.derived': 'Derived from the action',
        'conversation.creativeStudio.workspace.beatPanel.derivation.detached': 'Detached · Yours',
        'conversation.creativeStudio.workspace.beatPanel.derivation.attachedLineGuidance':
          'Written from the action · Edit to detach',
        'conversation.creativeStudio.workspace.beatPanel.derivation.detachedLineGuidance':
          'Your words · No longer follows the action',
        'conversation.creativeStudio.workspace.beatPanel.derivation.detach': 'Detach line',
        'conversation.creativeStudio.workspace.beatPanel.derivation.rederiveReviewed': 'Review re-derive',
        'conversation.creativeStudio.workspace.beatPanel.derivation.restoreHistory': 'Restore history line',
        'conversation.creativeStudio.workspace.beatPanel.derivation.stale': 'Stale against Action',
        'conversation.creativeStudio.workspace.beatPanel.derivation.title': 'Line derivation',
        'conversation.creativeStudio.workspace.beatPanel.fields.action': 'Action',
        'conversation.creativeStudio.workspace.beatPanel.fields.duration': 'Duration',
        'conversation.creativeStudio.workspace.beatPanel.fields.line': 'Line',
        'conversation.creativeStudio.workspace.beatPanel.fields.look': 'Look',
        'conversation.creativeStudio.workspace.beatPanel.fields.narration': 'Narration',
        'conversation.creativeStudio.workspace.beatPanel.fields.onScreenText': 'On-screen text',
        'conversation.creativeStudio.workspace.beatPanel.fields.targetSeconds': 'Beat target',
        'conversation.creativeStudio.workspace.beatPanel.generation.gateLocked': 'A confirmation is open',
        'conversation.creativeStudio.workspace.beatPanel.generation.generateSeed': 'Generate seed',
        'conversation.creativeStudio.workspace.beatPanel.generation.noReference': 'No Brief reference',
        'conversation.creativeStudio.workspace.beatPanel.generation.purpose.seedStill': 'seed still',
        'conversation.creativeStudio.workspace.beatPanel.generation.purpose.videoTake': 'video take',
        'conversation.creativeStudio.workspace.beatPanel.generation.renderVideo': 'Render Shot',
        'conversation.creativeStudio.workspace.beatPanel.generation.reviewUnavailable':
          'Generation review is unavailable',
        'conversation.creativeStudio.workspace.beatPanel.lift.beat': 'Lift Beat',
        'conversation.creativeStudio.workspace.beatPanel.lift.beatTitle': 'Lift this Beat?',
        'conversation.creativeStudio.workspace.beatPanel.lift.confirmBeat': 'Confirm lift Beat',
        'conversation.creativeStudio.workspace.beatPanel.lift.confirmShot': 'Confirm lift Shot',
        'conversation.creativeStudio.workspace.beatPanel.lift.shot': 'Lift Shot',
        'conversation.creativeStudio.workspace.beatPanel.lift.shotFailed': 'Shot was not moved to the Bin.',
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelBody': 'Cancel this waiting item only',
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
        'conversation.creativeStudio.workspace.beatPanel.seeds.clearPin': 'Clear pin',
        'conversation.creativeStudio.workspace.beatPanel.seeds.empty': 'No image takes',
        'conversation.creativeStudio.workspace.beatPanel.seeds.import': 'Import seed still',
        'conversation.creativeStudio.workspace.beatPanel.seeds.imageTitle': 'Retained image takes',
        'conversation.creativeStudio.workspace.beatPanel.seeds.latestDefault': 'Latest image is the default',
        'conversation.creativeStudio.workspace.beatPanel.seeds.pending': 'Seed pending',
        'conversation.creativeStudio.workspace.beatPanel.seeds.pin': 'Pin seed',
        'conversation.creativeStudio.workspace.beatPanel.seeds.pinned': 'Seed pinned',
        'conversation.creativeStudio.workspace.beatPanel.seeds.title': 'Seed stills',
        'conversation.creativeStudio.workspace.beatPanel.shots.empty': 'No coverage yet',
        'conversation.creativeStudio.workspace.beatPanel.shots.label': 'Shots',
        'conversation.creativeStudio.workspace.beatPanel.takes.addAlternate': 'Add alternate',
        'conversation.creativeStudio.workspace.beatPanel.takes.alternateConfirmBody': 'Keep this as an alternate',
        'conversation.creativeStudio.workspace.beatPanel.takes.alternateConfirmTitle': 'Add alternate take?',
        'conversation.creativeStudio.workspace.beatPanel.takes.effectiveSeed': 'Effective seed',
        'conversation.creativeStudio.workspace.beatPanel.takes.empty': 'No video takes',
        'conversation.creativeStudio.workspace.beatPanel.takes.park': 'Park take',
        'conversation.creativeStudio.workspace.beatPanel.takes.parkConfirmBody': 'Paid work remains in the Bin',
        'conversation.creativeStudio.workspace.beatPanel.takes.parkConfirmTitle': 'Park this take?',
        'conversation.creativeStudio.workspace.beatPanel.takes.pinnedSeed': 'Pinned seed',
        'conversation.creativeStudio.workspace.beatPanel.takes.restore': 'Restore take',
        'conversation.creativeStudio.workspace.beatPanel.takes.select': 'Select take',
        'conversation.creativeStudio.workspace.beatPanel.takes.selected': 'Selected',
        'conversation.creativeStudio.workspace.beatPanel.takes.trimIncompatible': 'Current trims do not fit this take',
        'conversation.creativeStudio.workspace.beatPanel.takes.unavailable': 'Preview unavailable',
        'conversation.creativeStudio.workspace.beatPanel.takes.videoTitle': 'Video takes',
        'conversation.creativeStudio.workspace.beatPanel.previousBeat': 'Previous Beat',
        'conversation.creativeStudio.workspace.beatPanel.previousBeatShort': 'Previous',
        'conversation.creativeStudio.workspace.beatPanel.nextBeat': 'Next Beat',
        'conversation.creativeStudio.workspace.beatPanel.nextBeatShort': 'Next',
        'conversation.creativeStudio.workspace.beatPanel.coverage.label': 'Coverage',
        'conversation.creativeStudio.workspace.beatPanel.coverage.empty': 'No shots to cover',
        'conversation.creativeStudio.workspace.beatPanel.coverage.unavailable': 'Coverage unavailable',
        'conversation.creativeStudio.workspace.beatPanel.coverage.playbackLane': 'Playback lane',
        'conversation.creativeStudio.workspace.beatPanel.coverage.planningLane': 'Planning lane',
        'conversation.creativeStudio.workspace.beatPanel.fieldGuidance.action': 'Action · The one thing you write',
        'conversation.creativeStudio.workspace.beatPanel.fieldGuidance.look': 'Look · Every Shot inherits it',
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
      if (key.endsWith('.fields.lineFor')) return `Line for Shot ${String(values?.index)}`;
      if (key.endsWith('For')) return `${key.split('.').at(-1)?.replace('For', '')} Shot ${String(values?.index)}`;
      if (key.endsWith('.lookCounter')) return `${String(values?.count)} / 25 words`;
      if (key.endsWith('.reorder.previous')) return `Move Shot ${String(values?.index)} up`;
      if (key.endsWith('.reorder.next')) return `Move Shot ${String(values?.index)} down`;
      if (key.endsWith('.reorder.announcement')) {
        return `Moved Shot ${String(values?.from)} to ${String(values?.to)} of ${String(values?.total)}`;
      }
      if (key.endsWith('.derivation.label')) return `Derivation for Shot ${String(values?.index)}`;
      if (key.endsWith('.seeds.label')) return `Seed stills for Shot ${String(values?.index)}`;
      if (key.endsWith('.takes.videoLabel')) return `Video takes for Shot ${String(values?.index)}`;
      if (key.endsWith('.takes.imageTakeLabel')) {
        return `Shot ${String(values?.shotIndex)} image ${String(values?.takeIndex)}`;
      }
      if (key.endsWith('.takes.videoTakeLabel')) {
        return `Shot ${String(values?.shotIndex)} take ${String(values?.takeIndex)}`;
      }
      if (key.endsWith('.takes.previewAlt')) return `Preview ${String(values?.label)}`;
      if (key.endsWith('.takes.videoPreview')) return `Player ${String(values?.label)}`;
      if (key.endsWith('.takes.sourceDuration')) return `${String(values?.seconds)} seconds source`;
      if (key.endsWith('.generation.choiceLabel')) {
        return `Beat ${String(values?.beatIndex)} Shot ${String(values?.shotIndex)} ${String(values?.purpose)}`;
      }
      if (key.endsWith('.generation.countForChoice')) return `Generation count for ${String(values?.choice)}`;
      if (key.endsWith('.generation.referenceForChoice')) return `Brief reference for ${String(values?.choice)}`;
      if (key.endsWith('.takes.binReason.lifted')) return 'Lifted';
      if (key.endsWith('.takes.binReason.alternate')) return 'Alternate';
      if (key.endsWith('.lift.shotTitle')) return `Lift Shot ${String(values?.index)}?`;
      if (key.endsWith('.lift.shotBodyNoStale')) return 'Authored and paid work stays in the Bin';
      if (key.endsWith('.lift.shotBodyStale')) {
        return `Authored and paid work stays; downstream ${String(values?.shots)} becomes stale`;
      }
      if (key.endsWith('.lift.beatBodyNoStale')) return 'All authored and paid work stays in the Bin';
      if (key.endsWith('.lift.beatBodyStale')) {
        return `All authored and paid work stays; downstream ${String(values?.shots)} becomes stale`;
      }
      if (key.endsWith('.recovery.chooseImage')) {
        return `Use image Beat ${String(values?.beatIndex)} Shot ${String(values?.shotIndex)} Take ${String(values?.takeIndex)}`;
      }
      if (key.endsWith('.recovery.chooseVideo')) {
        return `Use video Beat ${String(values?.beatIndex)} Shot ${String(values?.shotIndex)} Take ${String(values?.takeIndex)}`;
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
  BeatPanel,
  type BeatPanelActions,
  type BeatPanelProps,
  type BeatPanelReviewGraph,
} from '@/renderer/pages/studio/components/Workspace/BeatPanel';

class NoopResizeObserver implements ResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

const makeTake = (
  assetId: string,
  mediaKind: WorkspaceTakeProjection['mediaKind'],
  overrides: Partial<WorkspaceTakeProjection> = {}
): WorkspaceTakeProjection => ({
  assetId,
  mediaKind,
  createdAt: '2026-08-20T00:00:00.000Z',
  selected: false,
  explicitSeed: false,
  effectiveSeed: false,
  binReason: null,
  sourceDurationSeconds: mediaKind === 'video' ? 8 : null,
  posterAssetId: null,
  ...overrides,
});

const makeShot = (
  id: string,
  index: number,
  overrides: Partial<WorkspaceShotProjection> = {}
): WorkspaceShotProjection => ({
  id,
  line: `Canonical line ${index + 1}`,
  narration: '',
  onScreenText: '',
  durationSeconds: 8,
  chainBreak: index === 0 ? 'none' : 'none',
  derivation: 'derived',
  derivedFromActionRevision: 1,
  derivationStale: false,
  trimInSeconds: null,
  trimOutSeconds: null,
  selectedTakeId: null,
  selectedTakeSourceDurationSeconds: null,
  playedDurationSeconds: 8,
  explicitSeedAssetId: null,
  effectiveSeedAssetId: null,
  segmentHead: index === 0,
  planningBoundary: { shotId: id, startSeconds: index * 8, endSeconds: (index + 1) * 8 },
  dirtyCauses: [],
  downstreamShotIds: [],
  imageTakes: [],
  videoTakes: [],
  coverAssetId: null,
  takeCount: 0,
  displayState: 'draft',
  retainedWork: false,
  videoGenerationInFlight: false,
  seedGenerationInFlight: false,
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
  action: 'Open the film',
  look: 'Warm practical light',
  actionRevision: 1,
  lineHistory: [],
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
      assetId: null,
      allowed: true,
      blockers: [],
    },
    ...beat.shots.flatMap((shot) => [
      {
        subject: 'shot' as const,
        action: 'park' as const,
        beatId: beat.id,
        shotId: shot.id,
        assetId: null,
        allowed: true,
        blockers: [],
      },
      ...[...shot.imageTakes, ...shot.videoTakes].map((take) => ({
        subject: 'take' as const,
        action: take.binReason === null ? ('park' as const) : ('restore' as const),
        beatId: beat.id,
        shotId: shot.id,
        assetId: take.assetId,
        allowed: true,
        blockers: [],
      })),
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
  bin: { beats: [], shots: [], takes: [] },
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
  redetachLine: vi.fn().mockResolvedValue(true),
  restoreLine: vi.fn().mockResolvedValue(true),
  importSeedStill: vi.fn().mockResolvedValue('cancelled' as const),
  selectTake: vi.fn().mockResolvedValue(true),
  parkTake: vi.fn().mockResolvedValue(true),
  addAlternateTake: vi.fn().mockResolvedValue(true),
  restoreTake: vi.fn().mockResolvedValue(true),
  parkShot: vi.fn().mockResolvedValue(true),
  parkBeat: vi.fn().mockResolvedValue(true),
  reviewShot: vi.fn(),
  chooseCascadeAsset: vi.fn().mockResolvedValue(true),
  retryConditioning: vi.fn().mockResolvedValue(true),
  cancelWaiting: vi.fn().mockResolvedValue(true),
  requestReviewedRederive: vi.fn(),
  requestResplit: vi.fn(),
  ...overrides,
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
  briefReferenceOptions: [],
  reviewGraphs: beat.shots.map(
    (shot): BeatPanelReviewGraph => ({
      triggerShotId: shot.id,
      choices: [
        {
          shotId: shot.id,
          purpose: shot.segmentHead && shot.effectiveSeedAssetId === null ? 'seed_still' : 'video_take',
        },
      ],
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

const takeCard = (container: HTMLElement, assetId: string): HTMLElement => {
  const card = container.querySelector<HTMLElement>(`[data-asset-id="${assetId}"]`);
  if (card === null) throw new Error(`Missing Take card ${assetId}`);
  return card;
};

const cssRuleBody = (source: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? '';
};

describe('BeatPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
  });

  it('states Shot chain and Line provenance without merging authored controls or continuity warnings', () => {
    const image = makeTake('asset_private_image', 'image', { effectiveSeed: true });
    const video = makeTake('asset_private_video', 'video');
    const beat = makeBeat('beat_private', [
      makeShot('shot_private_1', 0, { imageTakes: [image], segmentHead: true }),
      makeShot('shot_private_2', 1, {
        dirtyCauses: ['continuity_stale', 'generation_out_of_date'],
        segmentHead: false,
        videoTakes: [video],
      }),
      makeShot('shot_private_3', 2, {
        derivation: 'detached',
        segmentHead: true,
      }),
      makeShot('shot_private_4', 3, {
        chainBreak: 'hard_cut',
        derivation: 'detached',
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
    const headCopy = 'Head of the chain · Starts from the still';

    expect(naturalHead.querySelector('[data-chain-state="segment_head"]')).toHaveTextContent(headCopy);
    expect(continuation.querySelector('[data-chain-state="continuous"]')).toHaveTextContent(
      'Continues from Shot 01’s last frame'
    );
    expect(laterNaturalHead.querySelector('[data-chain-state="segment_head"]')).toHaveTextContent(headCopy);
    expect(authoredHead.querySelector('[data-chain-state="hard_cut"]')).toHaveTextContent(headCopy);
    expect(defensiveContinuation.querySelector('[data-chain-state="continuous"]')).toHaveTextContent(
      'Continues from Shot 04’s last frame'
    );

    const continuityWarning = within(continuation).getByText('System continuity is stale');
    const continuationState = continuation.querySelector<HTMLElement>('[data-chain-state="continuous"]');
    const hardCutGroup = within(continuation).getByRole('group', { name: 'Author hard cut' });
    expect(continuityWarning).toBeVisible();
    expect(continuationState).not.toContainElement(continuityWarning);
    expect(hardCutGroup).not.toContainElement(continuityWarning);
    expect(within(continuation).getByText('Generated work is out of date')).toBeVisible();

    const derivedGuidance = naturalHead.querySelector<HTMLElement>('[data-line-derivation="derived"]');
    const detachedGuidance = laterNaturalHead.querySelector<HTMLElement>('[data-line-derivation="detached"]');
    expect(derivedGuidance).toHaveTextContent('Written from the action · Edit to detach');
    expect(detachedGuidance).toHaveTextContent('Your words · No longer follows the action');
    const derivedLine = within(naturalHead).getByRole('textbox', { name: 'Line for Shot 1' });
    const detachedLine = within(laterNaturalHead).getByRole('textbox', { name: 'Line for Shot 3' });
    expect(derivedLine).toHaveAttribute('aria-describedby', derivedGuidance?.id);
    expect(derivedLine).toHaveAccessibleDescription('Written from the action · Edit to detach');
    expect(detachedLine).toHaveAttribute('aria-describedby', detachedGuidance?.id);
    expect(detachedLine).toHaveAccessibleDescription('Your words · No longer follows the action');

    expect(within(naturalHead).getByText('Derived from the action')).toBeVisible();
    expect(within(laterNaturalHead).getByText('Detached · Yours')).toBeVisible();
    expect(within(authoredHead).getByRole('checkbox', { name: 'Author hard cut' })).toBeChecked();
    expect(within(defensiveContinuation).getByRole('checkbox', { name: 'Author hard cut' })).toBeChecked();
    expect(container.querySelector('video')).toHaveProperty('controls', true);
    expect(container).toHaveTextContent('Shot 1 image 1');
    expect(container).toHaveTextContent('Shot 2 take 1');
    expect(container.textContent).not.toContain('asset_private');
    expect(container.textContent).not.toContain('shot_private');
  });

  it('retains canonical hard-cut state while containing every unavailable change attempt', () => {
    const actions = makeActions();
    const beat = makeBeat('beat_1', [
      makeShot('shot_continuous', 0, { chainBreak: 'none' }),
      makeShot('shot_hard_cut', 1, { chainBreak: 'hard_cut', segmentHead: true }),
    ]);
    const props = panelProps(beat, makeDrafts(), actions, makeProjection([beat]));
    const { container, rerender } = render(<BeatPanel {...props} />);
    const continuousGroup = within(shotCard(container, 'shot_continuous')).getByRole('group', {
      name: 'Author hard cut',
    });
    const hardCutGroup = within(shotCard(container, 'shot_hard_cut')).getByRole('group', {
      name: 'Author hard cut',
    });
    const continuousControl = within(continuousGroup).getByRole('checkbox', { name: 'Author hard cut' });
    const hardCutControl = within(hardCutGroup).getByRole('checkbox', { name: 'Author hard cut' });

    expect(continuousControl).not.toBeChecked();
    expect(hardCutControl).toBeChecked();
    for (const [group, control] of [
      [continuousGroup, continuousControl],
      [hardCutGroup, hardCutControl],
    ]) {
      expect(control).toBeDisabled();
      const descriptionId = group.getAttribute('aria-describedby');
      expect(descriptionId).not.toBeNull();
      expect(document.getElementById(descriptionId!)).toHaveTextContent(
        'Hard-cut changes are temporarily unavailable. A reviewed estimate for the required replacement media must come first.'
      );
      fireEvent.click(control);
      fireEvent.keyDown(control, { key: ' ' });
      fireEvent.change(control, { target: { checked: !control.hasAttribute('checked') } });
    }

    rerender(<BeatPanel {...props} />);
    expect(continuousControl).not.toBeChecked();
    expect(hardCutControl).toBeChecked();
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
    expect(actions).not.toHaveProperty('setHardCut');
  });

  it('keeps Action and Look as adjacent semantic groups above the target and actions band', () => {
    render(<BeatPanel {...panelProps(makeBeat(), makeDrafts(), makeActions())} />);

    const fields = screen.getByRole('region', { name: 'Beat fields' });
    const actionField = fields.querySelector<HTMLElement>('[data-beat-field="action"]');
    const lookField = fields.querySelector<HTMLElement>('[data-beat-field="look"]');
    const targetField = fields.querySelector<HTMLElement>('[data-beat-field="target"]');
    const metaRow = fields.querySelector<HTMLElement>('[data-beat-meta-row]');
    const editorActions = fields.querySelector<HTMLElement>('[data-beat-editor-actions]');
    if (
      actionField === null ||
      lookField === null ||
      targetField === null ||
      metaRow === null ||
      editorActions === null
    ) {
      throw new Error('Beat authoring field hooks are incomplete');
    }

    expect(actionField.tagName).toBe('LABEL');
    expect(within(actionField).getByRole('textbox', { name: 'Action' })).toBeVisible();
    expect(within(actionField).getByText('Action · The one thing you write', { exact: true })).toBeVisible();
    expect(actionField.nextElementSibling).toBe(lookField);
    expect(lookField.tagName).toBe('LABEL');
    expect(within(lookField).getByRole('textbox', { name: 'Look' })).toBeVisible();
    expect(within(lookField).getByText('Look · Every Shot inherits it', { exact: true })).toBeVisible();
    expect(lookField.nextElementSibling).toBe(metaRow);
    expect(metaRow).toContainElement(targetField);
    expect(metaRow).toContainElement(editorActions);
    expect(targetField.compareDocumentPosition(editorActions) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('pins the authoring band to the prototype grid without widening the existing modal', () => {
    const css = readFileSync(
      resolvePath(
        process.cwd(),
        'packages/desktop/src/renderer/pages/studio/components/Workspace/BeatPanel/BeatPanel.module.css'
      ),
      'utf8'
    );

    const modalRule = cssRuleBody(css, '.modal');
    expect(modalRule).toMatch(/inline-size:\s*min\(852px,\s*calc\(100vw\s*-\s*32px\)\)/);
    expect(modalRule).toMatch(/max-inline-size:\s*852px/);

    const wideRule = cssRuleBody(css, '.beatEditor');
    expect(wideRule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1\.25fr\)\s+minmax\(0,\s*1fr\)/);
    expect(wideRule).toMatch(/gap:\s*13px/);
    expect(cssRuleBody(css, '.beatMetaRow')).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(cssRuleBody(css, '.fieldGuidance')).toMatch(/text-transform:\s*uppercase/);
    expect(cssRuleBody(css, '.chainState')).toMatch(/text-transform:\s*uppercase/);
    expect(cssRuleBody(css, '.lineGuidance')).toMatch(/text-transform:\s*uppercase/);

    const compactStart = css.search(/@media\s*\(max-width:\s*760px\)/);
    expect(compactStart).toBeGreaterThanOrEqual(0);
    const compactRule = compactStart < 0 ? '' : cssRuleBody(css.slice(compactStart), '.beatEditor');
    expect(compactRule).toMatch(/grid-template-columns:\s*(?:minmax\(0,\s*1fr\)|1fr)/);
  });

  it('keeps the 25-word Look warning soft and saves only changed Beat fields', async () => {
    const look = Array.from({ length: 26 }, (_, index) => `word${index + 1}`).join(' ');
    const beat = makeBeat('beat_1', [makeShot('shot_1', 0)]);
    const drafts = makeDrafts({ 'beat.beat_1.look': look });
    const actions = makeActions();
    render(<BeatPanel {...panelProps(beat, drafts, actions)} />);

    expect(screen.getByText('26 / 25 words')).toHaveAttribute('data-look-warning', 'true');
    const save = screen.getByRole('button', { name: 'Save Beat' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(actions.saveBeat).toHaveBeenCalledWith('beat_1', { look }));
    expect(drafts.resetIfValue).toHaveBeenCalledWith('beat.beat_1.look', look);
    expect(drafts.resetIfValue).toHaveBeenCalledWith('beat.beat_1.action', 'Open the film');
    expect(drafts.resetIfValue).toHaveBeenCalledWith('beat.beat_1.targetSeconds', 8);
  });

  it('resets only the local Shot draft keys and invokes no semantic mutation', () => {
    const beat = makeBeat('beat_1', [makeShot('shot_1', 0)]);
    const drafts = makeDrafts({ 'shot.shot_1.line': 'Local line' });
    const actions = makeActions();
    render(<BeatPanel {...panelProps(beat, drafts, actions)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset Shot' }));
    expect(drafts.reset.mock.calls.map(([key]) => key)).toEqual([
      'shot.shot_1.line',
      'shot.shot_1.narration',
      'shot.shot_1.onScreenText',
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
    const submittedDrafts = makeDrafts({ 'shot.shot_1.line': 'Submitted line' });
    const newerDrafts = makeDrafts({ 'shot.shot_1.line': 'Newer local line' });
    const result = render(<BeatPanel {...panelProps(beat, submittedDrafts, actions)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Shot' }));
    expect(saveShot).toHaveBeenCalledWith([{ shotId: 'shot_1', changes: { line: 'Submitted line' } }]);
    result.rerender(<BeatPanel {...panelProps(beat, newerDrafts, actions)} />);
    await act(async () => resolveSave?.(true));

    await waitFor(() => expect(newerDrafts.resetIfValue).toHaveBeenCalledWith('shot.shot_1.line', 'Submitted line'));
    expect(submittedDrafts.resetIfValue).not.toHaveBeenCalled();
    expect(newerDrafts.resetIfValue).not.toHaveBeenCalledWith('shot.shot_1.line', 'Newer local line');
  });

  it('blocks stale authored saves and all project/draft controls while a gate owns the project', () => {
    const beat = makeBeat();
    const staleDrafts = makeDrafts(
      { 'beat.beat_1.look': 'Stale look', 'shot.shot_1.line': 'Stale line' },
      { staleRevision: true }
    );
    const actions = makeActions();
    const stale = render(<BeatPanel {...panelProps(beat, staleDrafts, actions)} />);
    expect(screen.getByRole('button', { name: 'Save Beat' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Save Shot' })[0]).toBeDisabled();

    stale.rerender(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, makeProjection([beat]), { gateLocked: true })} />
    );
    expect(screen.getByRole('textbox', { name: 'Action' })).toBeDisabled();
    expect(
      within(shotCard(stale.container, 'shot_1')).getByRole('checkbox', { name: 'Author hard cut' })
    ).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Boundary after Shot 1' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Review re-split' }));
    expect(actions.requestResplit).not.toHaveBeenCalled();
  });

  it('detaches only the canonical line after local edits are saved or reset and restores history non-consumingly', () => {
    const shot = makeShot('shot_1', 0);
    const beat = makeBeat('beat_1', [shot], {
      lineHistory: [{ id: 'history_1', shotOrdinal: 1, text: 'Earlier line', capturedAt: '2026-08-19T00:00:00.000Z' }],
    });
    const actions = makeActions();
    const dirty = render(
      <BeatPanel {...panelProps(beat, makeDrafts({ 'shot.shot_1.line': 'Unsaved line' }), actions)} />
    );
    expect(screen.getByRole('button', { name: 'Detach line' })).toBeDisabled();

    dirty.rerender(<BeatPanel {...panelProps(beat, makeDrafts(), actions)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Detach line' }));
    expect(actions.redetachLine).toHaveBeenCalledWith('shot_1', 'Canonical line 1');
    fireEvent.click(screen.getByRole('button', { name: 'Restore history line' }));
    expect(actions.restoreLine).toHaveBeenCalledWith('shot_1', 'history_1');
    fireEvent.click(screen.getByRole('button', { name: 'Review re-derive' }));
    expect(actions.requestReviewedRederive).toHaveBeenCalledWith('shot_1');
  });

  it('restores an out-of-range Beat history entry to the explicitly chosen current Shot', () => {
    const beat = makeBeat('beat_1', [makeShot('shot_1', 0), makeShot('shot_2', 1)], {
      lineHistory: [
        {
          id: 'history_out_of_range',
          shotOrdinal: 8,
          text: 'Preserved before re-split',
          capturedAt: '2026-08-19T00:00:00.000Z',
        },
      ],
    });
    const actions = makeActions();
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), actions)} />);
    const targetShot = within(shotCard(container, 'shot_2'));

    expect(targetShot.getByText('Preserved before re-split')).toBeVisible();
    fireEvent.click(targetShot.getByRole('button', { name: 'Restore history line' }));

    expect(actions.restoreLine).toHaveBeenCalledTimes(1);
    expect(actions.restoreLine).toHaveBeenCalledWith('shot_2', 'history_out_of_range');
    expect(targetShot.getByText('Preserved before re-split')).toBeVisible();
  });

  it('routes seed and Take gestures through exact semantic callbacks, including Bin restore and import cancel', async () => {
    const image = makeTake('image_1', 'image', { effectiveSeed: true });
    const selectedImage = makeTake('image_2', 'image', { explicitSeed: true });
    const video = makeTake('video_1', 'video');
    const binnedVideo = makeTake('video_2', 'video', { binReason: 'alternate' });
    const shot = makeShot('shot_1', 0, {
      imageTakes: [image, selectedImage],
      videoTakes: [video, binnedVideo],
      segmentHead: true,
    });
    const beat = makeBeat('beat_1', [shot]);
    const actions = makeActions();
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), actions)} />);

    fireEvent.click(within(takeCard(container, 'image_1')).getByRole('button', { name: 'Pin seed' }));
    expect(actions.setSeedStill).toHaveBeenCalledWith('shot_1', 'image_1');
    fireEvent.click(within(takeCard(container, 'image_2')).getByRole('button', { name: 'Clear pin' }));
    expect(actions.setSeedStill).toHaveBeenCalledWith('shot_1', null);
    fireEvent.click(within(takeCard(container, 'video_1')).getByRole('button', { name: 'Select take' }));
    expect(actions.selectTake).toHaveBeenCalledWith('shot_1', 'video_1');
    fireEvent.click(
      within(within(takeCard(container, 'video_1')).getByRole('group', { name: 'Park this take?' })).getByRole(
        'button',
        { name: 'Park take' }
      )
    );
    expect(actions.parkTake).toHaveBeenCalledWith('shot_1', 'video_1');
    fireEvent.click(within(takeCard(container, 'video_2')).getByRole('button', { name: 'Restore take' }));
    expect(actions.restoreTake).toHaveBeenCalledWith('shot_1', 'video_2');
    fireEvent.click(screen.getByRole('button', { name: 'Import seed still' }));
    await waitFor(() => expect(actions.importSeedStill).toHaveBeenCalledWith('shot_1'));
    expect(actions.saveBeat).not.toHaveBeenCalled();
    expect(actions.saveShot).not.toHaveBeenCalled();
  });

  it('disables an ordinary Take selection when retained trims leave less than the minimum played duration', () => {
    const shortVideo = makeTake('short_video', 'video', { sourceDurationSeconds: 9.5 });
    const shot = makeShot('shot_1', 0, {
      trimInSeconds: 4.5,
      trimOutSeconds: 4.5,
      videoTakes: [shortVideo],
    });
    const beat = makeBeat('beat_1', [shot]);
    const actions = makeActions();
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), actions)} />);
    const card = within(takeCard(container, 'short_video'));

    expect(card.getByRole('button', { name: 'Select take' })).toBeDisabled();
    expect(card.getByText('Current trims do not fit this take')).toBeVisible();
    fireEvent.click(card.getByRole('button', { name: 'Select take' }));
    expect(actions.selectTake).not.toHaveBeenCalled();
  });

  it('keeps retained image Takes reachable on continuity Shots without exposing invalid seed controls', () => {
    const retainedImage = makeTake('image_continuity', 'image');
    const beat = makeBeat('beat_1', [
      makeShot('shot_1', 0),
      makeShot('shot_2', 1, { imageTakes: [retainedImage], segmentHead: false }),
    ]);
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), makeActions())} />);
    const card = takeCard(container, 'image_continuity');
    expect(screen.getByText('Retained image takes')).toBeInTheDocument();
    expect(card).toHaveTextContent('Shot 2 image 1');
    expect(card).not.toHaveTextContent('Effective seed');
    expect(within(card).queryByRole('button', { name: 'Pin seed' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Clear pin' })).toBeNull();
    expect(within(card).getAllByRole('button', { name: 'Park take' })[0]).toBeEnabled();
  });

  it('reviews the complete ordered seed-and-video graph with bounded persisted preferences and safe Brief labels', () => {
    const beat = makeBeat();
    const gateChoices = {
      'shot_1:seed_still': { generationCount: 2, referenceAssetId: 'brief_ref' },
      'shot_1:video_take': { generationCount: 3, referenceAssetId: null },
      'shot_2:video_take': { generationCount: 4, referenceAssetId: null },
    };
    const drafts = makeDrafts({ 'gate.choices': JSON.stringify(gateChoices) });
    const actions = makeActions();
    const reviewGraph: BeatPanelReviewGraph = {
      triggerShotId: 'shot_1',
      choices: [
        { shotId: 'shot_1', purpose: 'seed_still' },
        { shotId: 'shot_1', purpose: 'video_take' },
        { shotId: 'shot_2', purpose: 'video_take' },
      ],
    };
    const result = render(
      <BeatPanel
        {...panelProps(beat, drafts, actions, makeProjection([beat]), {
          briefReferenceOptions: [
            { assetId: 'brief_ref', label: 'Hero portrait' },
            { assetId: 'duplicate_ref', label: 'Duplicate one' },
            { assetId: 'duplicate_ref', label: 'Duplicate two' },
            { assetId: 'blank_ref', label: '   ' },
          ],
          reviewGraphs: [
            reviewGraph,
            { triggerShotId: 'shot_2', choices: [{ shotId: 'shot_2', purpose: 'video_take' }] },
          ],
        })}
      />
    );

    const triggerCard = within(shotCard(result.container, 'shot_1'));
    expect(triggerCard.getByRole('spinbutton', { name: 'Generation count for Beat 1 Shot 1 seed still' })).toHaveValue(
      2
    );
    expect(triggerCard.getByRole('spinbutton', { name: 'Generation count for Beat 1 Shot 1 video take' })).toHaveValue(
      3
    );
    const downstreamCount = triggerCard.getByRole('spinbutton', {
      name: 'Generation count for Beat 1 Shot 2 video take',
    });
    expect(downstreamCount).toHaveValue(4);
    const reference = triggerCard.getByRole('combobox', {
      name: 'Brief reference for Beat 1 Shot 1 seed still',
    });
    expect(reference).toHaveValue('brief_ref');
    expect(within(reference).getByRole('option', { name: 'Hero portrait' })).toBeInTheDocument();
    expect(within(reference).queryByRole('option', { name: /Duplicate/ })).toBeNull();
    expect(result.container.textContent).not.toContain('brief_ref');

    fireEvent.change(downstreamCount, { target: { value: '2' } });
    const persisted = JSON.parse(String(drafts.setValue.mock.calls.at(-1)?.[1])) as Record<
      string,
      { generationCount: number }
    >;
    expect(drafts.setValue).toHaveBeenLastCalledWith('gate.choices', expect.any(String));
    expect(persisted['shot_2:video_take']?.generationCount).toBe(2);

    fireEvent.click(triggerCard.getByRole('button', { name: 'Generate seed' }));
    expect(actions.reviewShot).toHaveBeenCalledWith('shot_1', [
      { shotId: 'shot_1', purpose: 'seed_still', generationCount: 2, referenceAssetId: 'brief_ref' },
      { shotId: 'shot_1', purpose: 'video_take', generationCount: 3, referenceAssetId: null },
      { shotId: 'shot_2', purpose: 'video_take', generationCount: 4, referenceAssetId: null },
    ]);
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
    expect(screen.getByRole('button', { name: 'Generate seed' })).toBeDisabled();
    expect(screen.getByText('Generation review is unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate seed' }));
    expect(actions.reviewShot).not.toHaveBeenCalled();
  });

  it('fails closed when exact revision-matched Take eligibility is missing or blocked', () => {
    const video = makeTake('video_1', 'video');
    const shot = makeShot('shot_1', 0, { videoTakes: [video] });
    const beat = makeBeat('beat_1', [shot]);
    const projection = makeProjection([beat], {
      parkEligibility: [
        {
          subject: 'take',
          action: 'park',
          beatId: 'beat_1',
          shotId: 'shot_1',
          assetId: 'video_1',
          allowed: false,
          blockers: [{ shotId: 'shot_1', code: 'current_selected_take' }],
        },
      ],
    });
    const actions = makeActions();
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), actions, projection)} />);
    const park = within(takeCard(container, 'video_1')).getAllByRole('button', { name: 'Park take' });
    expect(park.every((button) => button.hasAttribute('disabled'))).toBe(true);
    fireEvent.click(park[0]!);
    expect(actions.parkTake).not.toHaveBeenCalled();
  });

  it('reorders Shots atomically in Beat scope and announces the resulting position', async () => {
    const beat = makeBeat();
    const actions = makeActions();
    const { container } = render(<BeatPanel {...panelProps(beat, makeDrafts(), actions)} />);
    fireEvent.click(within(shotCard(container, 'shot_1')).getByRole('button', { name: 'Move Shot 1 down' }));
    await waitFor(() => expect(actions.reorderShots).toHaveBeenCalledWith('beat_1', ['shot_2', 'shot_1']));
    expect(screen.getByText('Moved Shot 1 to 2 of 2')).toBeInTheDocument();
  });

  it('names only remaining downstream positions in lift confirmations and protects unsaved local work', async () => {
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

    const shotLift = within(shotCard(result.container, 'shot_1')).getByRole('group', { name: 'Lift Shot 1?' });
    expect(shotLift).toHaveTextContent('Beat 1, Shot 2');
    expect(shotLift).toHaveTextContent('Beat 2, Shot 1');
    fireEvent.click(within(shotLift).getByRole('button', { name: 'Confirm lift Shot' }));
    await waitFor(() => expect(actions.parkShot).toHaveBeenCalledWith('shot_1'));
    await waitFor(() => expect(onParkShotSuccess).toHaveBeenCalledWith('shot_1'));

    const beatLift = screen.getByRole('group', { name: 'Lift this Beat?' });
    expect(beatLift).toHaveTextContent('Beat 2, Shot 1');
    expect(beatLift).not.toHaveTextContent('Beat 1, Shot 2');
    fireEvent.click(within(beatLift).getByRole('button', { name: 'Cancel' }));
    expect(actions.parkBeat).not.toHaveBeenCalled();

    result.rerender(
      <BeatPanel {...panelProps(beat, makeDrafts({ 'shot.shot_1.line': 'Unsaved local work' }), actions, projection)} />
    );
    expect(
      within(shotCard(result.container, 'shot_1')).getAllByRole('button', { name: 'Lift Shot' })[0]
    ).toBeDisabled();
    expect(screen.getAllByText('Save or reset local edits first').length).toBeGreaterThan(0);
  });

  it('reports only a committed Shot lift to the Board handoff owner', async () => {
    const beat = makeBeat();
    const actions = makeActions();
    const onParkShotSuccess = vi.fn();
    const result = render(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, makeProjection([beat]), { onParkShotSuccess })} />
    );

    fireEvent.click(within(shotCard(result.container, 'shot_1')).getByRole('button', { name: 'Confirm lift Shot' }));

    await waitFor(() => expect(actions.parkShot).toHaveBeenCalledWith('shot_1'));
    await waitFor(() => expect(onParkShotSuccess).toHaveBeenCalledWith('shot_1'));
    expect(onParkShotSuccess).toHaveBeenCalledTimes(1);
  });

  it('restores the exact Lift Shot trigger after cancel or refusal and never starts a Bin handoff', async () => {
    const beat = makeBeat();
    const actions = makeActions({ parkShot: vi.fn().mockResolvedValue(false) });
    const onParkShotSuccess = vi.fn();
    const result = render(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, makeProjection([beat]), { onParkShotSuccess })} />
    );
    const card = shotCard(result.container, 'shot_1');
    const trigger = within(card).getByRole('button', { name: 'Lift Shot' });
    const confirmation = within(card).getByRole('group', { name: 'Lift Shot 1?' });

    act(() => trigger.focus());
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(trigger).toHaveFocus();
    expect(actions.parkShot).not.toHaveBeenCalled();

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm lift Shot' }));
    await waitFor(() => expect(actions.parkShot).toHaveBeenCalledWith('shot_1'));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByText('Shot was not moved to the Bin.')).toBeInTheDocument();
    expect(onParkShotSuccess).not.toHaveBeenCalled();
  });

  it('offers exact projected video choices, free retry, and cancellation only when projected flags permit them', () => {
    const upstream = makeShot('shot_1', 0, {
      videoTakes: [makeTake('video_1', 'video', { selected: true }), makeTake('video_2', 'video')],
    });
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

    expect(screen.queryByRole('button', { name: 'Use video Beat 1 Shot 1 Take 1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use video Beat 1 Shot 1 Take 2' }));
    expect(actions.chooseCascadeAsset).toHaveBeenCalledWith(row, 'video_2');
    fireEvent.click(screen.getByRole('button', { name: 'Retry conditioning free' }));
    expect(actions.retryConditioning).toHaveBeenCalledWith('shot_2');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Cancel waiting?' })).getByRole('button', {
        name: 'Confirm cancel waiting',
      })
    );
    expect(actions.cancelWaiting).toHaveBeenCalledWith('shot_2');

    const running = { ...row, waitingReason: 'upstream_running' as const };
    result.rerender(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, makeProjection([beat], { cascadeProgress: [running] }))} />
    );
    expect(screen.queryByRole('button', { name: 'Use video Beat 1 Shot 1 Take 2' })).toBeNull();
  });

  it('offers only video recovery choices that retain at least the minimum played duration', () => {
    const upstream = makeShot('shot_1', 0, {
      trimInSeconds: 4.5,
      trimOutSeconds: 4.5,
      videoTakes: [
        makeTake('selected_video', 'video', { selected: true, sourceDurationSeconds: 12 }),
        makeTake('short_video', 'video', { sourceDurationSeconds: 9.5 }),
        makeTake('valid_video', 'video', { sourceDurationSeconds: 10 }),
      ],
    });
    const dependent = makeShot('shot_2', 1);
    const beat = makeBeat('beat_1', [upstream, dependent]);
    const row: StudioCascadeProgressV2 = {
      dependentShotId: 'shot_2',
      upstreamShotId: 'shot_1',
      eligiblePrimaryAssetIds: ['selected_video', 'short_video', 'valid_video'],
      canRetryConditioningFrame: false,
      canCancelWaiting: false,
      waitingReason: 'conditioning_failed',
    };
    const actions = makeActions();
    render(
      <BeatPanel {...panelProps(beat, makeDrafts(), actions, makeProjection([beat], { cascadeProgress: [row] }))} />
    );

    expect(screen.queryByRole('button', { name: 'Use video Beat 1 Shot 1 Take 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use video Beat 1 Shot 1 Take 2' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use video Beat 1 Shot 1 Take 3' }));
    expect(actions.chooseCascadeAsset).toHaveBeenCalledWith(row, 'valid_video');
  });

  it('does not expose an eligible ID that has no exact active projected Take and explains terminal states', () => {
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
