/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type { StudioEditableScene, StudioProposalPayload } from '@/common/types/project/creativeStudioTypes';
import {
  computeStudioProposalDiff,
  type StudioProposalDiffSource,
} from '@/common/types/project/creativeStudioProposalDiff';

const scene = (overrides: Partial<StudioEditableScene> = {}): StudioEditableScene => ({
  title: 'Opening',
  purpose: 'Introduce the product',
  visualPrompt: 'A sunrise over the city',
  narration: 'Every morning starts the same way.',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  ...overrides,
});

const source = (scenes: StudioEditableScene[]): StudioProposalDiffSource => ({
  sceneOrder: scenes.map((_, index) => `current-${index + 1}`),
  scenes: Object.fromEntries(scenes.map((value, index) => [`current-${index + 1}`, value])),
});

const payload = (scenes: StudioEditableScene[]): StudioProposalPayload => ({
  kind: 'replace_storyboard',
  sceneOrder: scenes.map((_, index) => `proposed-${index + 1}`),
  scenes: Object.fromEntries(scenes.map((value, index) => [`proposed-${index + 1}`, value])),
});

describe('computeStudioProposalDiff', () => {
  it('reports a single narration edit as one changed shot even when every scene id is new', () => {
    const current = source([scene({ title: 'Opening' }), scene({ title: 'Finale', narration: 'Old narration' })]);
    const proposed = payload([scene({ title: 'Opening' }), scene({ title: 'Finale', narration: 'New narration' })]);

    expect(computeStudioProposalDiff(current, proposed)).toEqual({
      added: 0,
      removed: 0,
      changed: [{ position: 2, fields: ['narration'] }],
    });
  });

  it('reports every changed field of a shot in the declared field order', () => {
    const current = source([scene()]);
    const proposed = payload([scene({ title: 'Cold open', narration: 'Rewritten', durationSeconds: 8 })]);

    expect(computeStudioProposalDiff(current, proposed)).toEqual({
      added: 0,
      removed: 0,
      changed: [{ position: 1, fields: ['title', 'narration', 'durationSeconds'] }],
    });
  });

  it('reports an identical proposal as no change at all', () => {
    const current = source([scene(), scene({ title: 'Finale' })]);
    const proposed = payload([scene(), scene({ title: 'Finale' })]);

    expect(computeStudioProposalDiff(current, proposed)).toEqual({ added: 0, removed: 0, changed: [] });
  });

  it('counts trailing shots the proposal adds', () => {
    const current = source([scene()]);
    const proposed = payload([scene(), scene({ title: 'Finale' }), scene({ title: 'Tag' })]);

    expect(computeStudioProposalDiff(current, proposed)).toEqual({ added: 2, removed: 0, changed: [] });
  });

  it('counts trailing shots the proposal drops', () => {
    const current = source([scene(), scene({ title: 'Finale' }), scene({ title: 'Tag' })]);
    const proposed = payload([scene()]);

    expect(computeStudioProposalDiff(current, proposed)).toEqual({ added: 0, removed: 2, changed: [] });
  });

  it('pairs shots positionally, so a shorter proposal still reports the edits it makes', () => {
    const current = source([scene(), scene({ title: 'Finale', narration: 'Old' })]);
    const proposed = payload([scene({ purpose: 'Rewritten purpose' })]);

    expect(computeStudioProposalDiff(current, proposed)).toEqual({
      added: 0,
      removed: 1,
      changed: [{ position: 1, fields: ['purpose'] }],
    });
  });

  it('treats an empty current storyboard as an addition of every proposed shot', () => {
    expect(computeStudioProposalDiff(source([]), payload([scene(), scene({ title: 'Finale' })]))).toEqual({
      added: 2,
      removed: 0,
      changed: [],
    });
  });

  it('skips scenes named in the order but missing from the payload rather than counting them', () => {
    const current = source([scene()]);
    const proposed: StudioProposalPayload = {
      kind: 'replace_storyboard',
      sceneOrder: ['proposed-1', 'proposed-2'],
      scenes: { 'proposed-1': scene() },
    };

    expect(computeStudioProposalDiff(current, proposed)).toEqual({ added: 0, removed: 0, changed: [] });
  });
});
