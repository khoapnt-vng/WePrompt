/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type {
  StudioProjectStatusStageIdV2,
  StudioProjectStatusStageStateV2,
  StudioProjectStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  railCollapsedDefaultForView,
  railCollapsedForView,
  railPreferenceKey,
} from '@/renderer/pages/studio/components/Workspace/WorkspaceShell';
import {
  firstReadyStudioView,
  hasReadyStudioView,
  resolveStudioEntryView,
  studioViewReadiness,
  type StudioViewReadiness,
} from '@/renderer/pages/studio/studioPhaseRoute';

describe('the rail default follows the view', () => {
  it('opens the rail for References and the Table and shuts it in the Board and the Cut', () => {
    // References and the Table are pre-picture views. The Board and the Cut are judgements about
    // pixels and motion, which the Director cannot see.
    expect(railCollapsedDefaultForView('references')).toBe(false);
    expect(railCollapsedDefaultForView('table')).toBe(false);
    expect(railCollapsedDefaultForView('board')).toBe(true);
    expect(railCollapsedDefaultForView('cut')).toBe(true);
    expect(railCollapsedDefaultForView(null)).toBe(false);
  });

  it('lets a stored choice outrank the default in both directions', () => {
    expect(railCollapsedForView('table', true)).toBe(true);
    expect(railCollapsedForView('board', false)).toBe(false);
  });

  it('falls back to the default when nothing has been chosen for that view', () => {
    expect(railCollapsedForView('table', null)).toBe(false);
    expect(railCollapsedForView('cut', null)).toBe(true);
  });

  it('never re-opens a rail the person shut, which is the named failure mode', () => {
    // Shutting it in the Table is the case the default would otherwise fight on every visit.
    expect(railCollapsedForView('table', true)).toBe(true);
  });

  it('scopes the choice to one view of one project', () => {
    const a = railPreferenceKey('project_1', 'table');
    expect(a).not.toBe(railPreferenceKey('project_1', 'board'));
    expect(a).not.toBe(railPreferenceKey('project_2', 'table'));
    expect(a).not.toBe(railPreferenceKey('project_1', null));
    expect(railPreferenceKey('project_1', null)).toContain('.workspace');
    expect(a).toBe(railPreferenceKey('project_1', 'table'));
  });

  it('length-tags an opaque project id in the persisted key', () => {
    expect(railPreferenceKey('a.b', 'table')).toBe('aionui.studio.railCollapsed.3.a.b.table');
  });
});

type StageStates = Partial<Record<StudioProjectStatusStageIdV2, StudioProjectStatusStageStateV2>>;

const projectStatus = (states: StageStates = {}): StudioProjectStatusV2 => ({
  projectId: 'project_1',
  projectRevision: 3,
  catalogVersion: null,
  stages: [
    {
      id: 'brief',
      state: states.brief ?? 'not_started',
      summary: { stage: 'brief', hasBrief: false },
      blockers: [],
    },
    {
      id: 'engines',
      state: states.engines ?? 'not_started',
      summary: { stage: 'engines', image: 'ready', video: 'ready' },
      blockers: [],
    },
    {
      id: 'references',
      state: states.references ?? 'not_started',
      summary: { stage: 'references', plannedCount: 0, approvedCount: 0 },
      blockers: [],
    },
    {
      id: 'storyboard',
      state: states.storyboard ?? 'not_started',
      summary: {
        stage: 'storyboard',
        beatCount: 0,
        shotCount: 0,
        authoredShotCount: 0,
        plannedSeconds: 0,
        targetSeconds: 30,
      },
      blockers: [],
    },
    {
      id: 'bindings',
      state: states.bindings ?? 'not_started',
      summary: { stage: 'bindings', readyShotCount: 0, shotCount: 0, maxConditioningImages: null },
      blockers: [],
    },
    {
      id: 'production',
      state: states.production ?? 'not_started',
      summary: { stage: 'production', currentTakeCount: 0, shotCount: 0, activeJobCount: 0 },
      blockers: [],
    },
    {
      id: 'cut',
      state: states.cut ?? 'not_started',
      summary: {
        stage: 'cut',
        currentTakeCount: 0,
        shotCount: 0,
        durationSeconds: null,
        targetSeconds: 30,
        structurallyPlayable: false,
      },
      blockers: [],
    },
  ],
  blockerCount: 0,
  advisories: [],
  boards: { currentPictureCount: 0, shotCount: 0 },
  detail: null,
});

const readiness = (ready: Partial<StudioViewReadiness> = {}): StudioViewReadiness => ({
  references: false,
  table: false,
  board: false,
  cut: false,
  ...ready,
});

const storageReading = (value: string | null): Storage =>
  ({ getItem: () => value }) as Pick<Storage, 'getItem'> as Storage;

describe('Studio view readiness follows exact project stages', () => {
  it('keeps a project view-less when none of the four work areas has content', () => {
    const derived = studioViewReadiness(projectStatus());

    expect(derived).toEqual(readiness());
    expect(hasReadyStudioView(derived)).toBe(false);
    expect(firstReadyStudioView(derived)).toBeNull();
  });

  it('does not invent view content from Brief or engine setup', () => {
    expect(studioViewReadiness(projectStatus({ brief: 'complete', engines: 'blocked' }))).toEqual(readiness());
  });

  it.each(['in_progress', 'complete', 'blocked'] as const)('treats %s References work as content', (state) => {
    expect(studioViewReadiness(projectStatus({ references: state }))).toEqual(readiness({ references: true }));
  });

  it.each(['storyboard', 'bindings'] as const)('opens the Table when %s work exists', (stage) => {
    expect(studioViewReadiness(projectStatus({ [stage]: 'in_progress' }))).toEqual(readiness({ table: true }));
  });

  it.each([
    ['production', 'board'],
    ['cut', 'cut'],
  ] as const)('maps %s work only to the %s', (stage, view) => {
    expect(studioViewReadiness(projectStatus({ [stage]: 'complete' }))).toEqual(readiness({ [view]: true }));
  });

  it('uses the fixed References, Table, Board, Cut order', () => {
    expect(firstReadyStudioView(readiness({ references: true, table: true, board: true, cut: true }))).toBe(
      'references'
    );
    expect(firstReadyStudioView(readiness({ table: true, board: true, cut: true }))).toBe('table');
    expect(firstReadyStudioView(readiness({ board: true, cut: true }))).toBe('board');
  });
});

describe('the first project entry respects ready content and remembered choices', () => {
  it('keeps a remembered view when it is ready', () => {
    expect(
      resolveStudioEntryView('project_1', readiness({ references: true, board: true }), storageReading('board'))
    ).toBe('board');
  });

  it('keeps a remembered unready view so an explicit choice is never redirected', () => {
    expect(resolveStudioEntryView('project_1', readiness({ references: true }), storageReading('board'))).toBe('board');
  });

  it('falls back safely when the remembered value is invalid', () => {
    expect(resolveStudioEntryView('project_1', readiness({ table: true }), storageReading('write'))).toBe('table');
  });

  it('falls back safely when view storage cannot be read', () => {
    const storage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
    } as Pick<Storage, 'getItem'> as Storage;

    expect(resolveStudioEntryView('project_1', readiness({ cut: true }), storage)).toBe('cut');
  });

  it('does not invent an entry view when every view is unready and nothing was remembered', () => {
    expect(resolveStudioEntryView('project_1', readiness(), storageReading(null))).toBeNull();
  });
});
