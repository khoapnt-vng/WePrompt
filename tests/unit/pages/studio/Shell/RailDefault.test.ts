/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  railCollapsedDefaultForView,
  railCollapsedForView,
  railPreferenceKey,
} from '@/renderer/pages/studio/components/Workspace/WorkspaceShell';
import { defaultStudioView, resolveStudioEntryView } from '@/renderer/pages/studio/studioPhaseRoute';

describe('the rail default follows the view', () => {
  it('opens the rail for References and the Table and shuts it in the Board and the Cut', () => {
    // References and the Table are pre-picture views. The Board and the Cut are judgements about
    // pixels and motion, which the Director cannot see.
    expect(railCollapsedDefaultForView('references')).toBe(false);
    expect(railCollapsedDefaultForView('table')).toBe(false);
    expect(railCollapsedDefaultForView('board')).toBe(true);
    expect(railCollapsedDefaultForView('cut')).toBe(true);
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
    expect(a).toBe(railPreferenceKey('project_1', 'table'));
  });

  it('length-tags an opaque project id in the persisted key', () => {
    expect(railPreferenceKey('a.b', 'table')).toBe('aionui.studio.railCollapsed.3.a.b.table');
  });
});

describe('the first project entry respects reference work without stealing later navigation', () => {
  it('opens first-time reference work before the Table', () => {
    expect(defaultStudioView(true)).toBe('references');
    expect(defaultStudioView(false)).toBe('table');
  });

  it('keeps a remembered later view when reference work exists', () => {
    const storage = { getItem: () => 'board' } as Pick<Storage, 'getItem'> as Storage;

    expect(resolveStudioEntryView('project_1', storage, true)).toBe('board');
  });
});
