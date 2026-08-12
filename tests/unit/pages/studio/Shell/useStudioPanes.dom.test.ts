/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  STUDIO_DIRECTOR_COLLAPSED_STORAGE_KEY,
  useStudioPanes,
} from '@renderer/pages/studio/components/Shell/useStudioPanes';

afterEach(() => {
  localStorage.clear();
});

describe('useStudioPanes', () => {
  it('defaults to an expanded Director pane', () => {
    const { result } = renderHook(() => useStudioPanes('inline'));

    expect(result.current.directorPreference).toBe('expanded');
    expect(result.current.directorEffective).toBe('expanded');
  });

  it('persists an explicit collapse so it survives a remount', () => {
    const first = renderHook(() => useStudioPanes('inline'));
    act(() => first.result.current.setDirectorPreference('collapsed'));
    expect(localStorage.getItem(STUDIO_DIRECTOR_COLLAPSED_STORAGE_KEY)).toBe('1');

    const second = renderHook(() => useStudioPanes('inline'));
    expect(second.result.current.directorPreference).toBe('collapsed');
    expect(second.result.current.directorEffective).toBe('collapsed');
  });

  /**
   * The property this hook exists for.
   *
   * Width-driven collapse is a presentation override, not a change of intent. If narrowing the
   * window wrote `collapsed` into storage, widening it again would leave the pane shut and the
   * user's choice would be silently destroyed — worse than having no control at all. The app
   * sidebar already draws this distinction (`Layout.tsx`: "narrowing the window never writes a
   * collapsed preference"), and this follows it.
   */
  it('keeps the stored preference when width forces the pane shut', () => {
    const { result, rerender } = renderHook(({ mode }) => useStudioPanes(mode), {
      initialProps: { mode: 'inline' as const },
    });
    act(() => result.current.setDirectorPreference('expanded'));

    rerender({ mode: 'drawer' as const });
    expect(result.current.directorEffective).toBe('collapsed');
    expect(result.current.directorPreference).toBe('expanded');
    expect(localStorage.getItem(STUDIO_DIRECTOR_COLLAPSED_STORAGE_KEY)).toBe('0');

    rerender({ mode: 'inline' as const });
    expect(result.current.directorEffective).toBe('expanded');
  });

  it('forces the pane shut at compact as well as drawer', () => {
    const { result, rerender } = renderHook(({ mode }) => useStudioPanes(mode), {
      initialProps: { mode: 'compact' as const },
    });
    expect(result.current.directorEffective).toBe('collapsed');

    rerender({ mode: 'drawer' as const });
    expect(result.current.directorEffective).toBe('collapsed');
    expect(result.current.directorPreference).toBe('expanded');
  });

  it('keeps an explicit collapse collapsed when the window widens', () => {
    const { result, rerender } = renderHook(({ mode }) => useStudioPanes(mode), {
      initialProps: { mode: 'compact' as const },
    });
    act(() => result.current.setDirectorPreference('collapsed'));

    rerender({ mode: 'inline' as const });
    expect(result.current.directorEffective).toBe('collapsed');
  });

  /**
   * A reveal asked for by a work-panel control is the same kind of thing as a width override: it
   * changes what is on screen right now, not what the user chose. Writing `expanded` here would
   * destroy a collapse they made deliberately at full width — the very failure the split above
   * exists to prevent, arriving through the other door.
   */
  describe('transient reveal', () => {
    it('opens a collapsed pane without writing the stored preference', () => {
      localStorage.setItem(STUDIO_DIRECTOR_COLLAPSED_STORAGE_KEY, '1');
      const { result } = renderHook(() => useStudioPanes('inline'));
      expect(result.current.directorEffective).toBe('collapsed');

      act(() => result.current.revealDirectorTransiently());

      expect(result.current.directorEffective).toBe('expanded');
      expect(result.current.directorPreference).toBe('collapsed');
      expect(localStorage.getItem(STUDIO_DIRECTOR_COLLAPSED_STORAGE_KEY)).toBe('1');
    });

    it('leaves the collapse in force on the next load', () => {
      localStorage.setItem(STUDIO_DIRECTOR_COLLAPSED_STORAGE_KEY, '1');
      const first = renderHook(() => useStudioPanes('inline'));
      act(() => first.result.current.revealDirectorTransiently());

      const second = renderHook(() => useStudioPanes('inline'));
      expect(second.result.current.directorPreference).toBe('collapsed');
      expect(second.result.current.directorEffective).toBe('collapsed');
    });

    /**
     * Width still wins. Below `inline` the pane cannot sit beside the work panel at all, so an
     * override that opened it there would not reveal anything — it would break the layout. The
     * shell reveals the overlay instead in that mode.
     */
    it('cannot force the pane open below inline width', () => {
      const { result, rerender } = renderHook(({ mode }) => useStudioPanes(mode), {
        initialProps: { mode: 'inline' as const },
      });
      act(() => result.current.revealDirectorTransiently());
      expect(result.current.directorEffective).toBe('expanded');

      rerender({ mode: 'drawer' as const });

      expect(result.current.directorEffective).toBe('collapsed');
    });

    /** The shell's own toggle stays authoritative: an explicit collapse closes a revealed pane. */
    it('yields to an explicit collapse from the toggle', () => {
      localStorage.setItem(STUDIO_DIRECTOR_COLLAPSED_STORAGE_KEY, '1');
      const { result } = renderHook(() => useStudioPanes('inline'));
      act(() => result.current.revealDirectorTransiently());

      act(() => result.current.setDirectorPreference('collapsed'));

      expect(result.current.directorEffective).toBe('collapsed');
      expect(localStorage.getItem(STUDIO_DIRECTOR_COLLAPSED_STORAGE_KEY)).toBe('1');
    });
  });

  it('survives storage that throws', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      const { result } = renderHook(() => useStudioPanes('inline'));
      act(() => result.current.setDirectorPreference('collapsed'));
      expect(result.current.directorPreference).toBe('collapsed');
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
