/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type {
  StudioGenerationBlockV2,
  StudioGenerationCapabilityItemV2,
  StudioGenerationCapabilityV2,
  StudioReferenceBindingFailureReasonV2,
  StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  generationBlockAction,
  generationBlockForItem,
  generationBlockGroupsForItems,
  generationBlockMessage,
  generationCapabilityIsCurrent,
  type StudioGenerationBlockAction,
  type StudioGenerationBlockMessage,
} from '@/renderer/pages/studio/components/Workspace/Gate/generationBlockers';

const project = { id: 'project_1', revision: 7 } as StudioRendererProjectV2;
const boardItem: StudioGenerationCapabilityItemV2 = {
  target: { kind: 'shot', shotId: 'shot_1' },
  purpose: 'board_still',
};
const videoItem: StudioGenerationCapabilityItemV2 = {
  target: { kind: 'shot', shotId: 'shot_1' },
  purpose: 'video_take',
};

const makeCapability = (overrides: Partial<StudioGenerationCapabilityV2> = {}): StudioGenerationCapabilityV2 => ({
  projectId: project.id,
  projectRevision: project.revision,
  catalogVersion: 'catalog_1',
  supportedItems: [],
  blocks: [],
  ...overrides,
});

describe('generation capability freshness', () => {
  it('accepts the exact project and revision', () => {
    expect(generationCapabilityIsCurrent(project, makeCapability())).toBe(true);
  });

  it.each([null, undefined])('rejects an absent projection (%s)', (capability) => {
    expect(generationCapabilityIsCurrent(project, capability)).toBe(false);
  });

  it('rejects a projection for another project', () => {
    expect(generationCapabilityIsCurrent(project, makeCapability({ projectId: 'project_2' }))).toBe(false);
  });

  it('rejects a stale project revision', () => {
    expect(generationCapabilityIsCurrent(project, makeCapability({ projectRevision: 6 }))).toBe(false);
  });
});

describe('generation item blockers', () => {
  it.each([
    [boardItem, { code: 'catalog_unloaded', role: 'image' }],
    [videoItem, { code: 'catalog_unloaded', role: 'video' }],
  ] as const)('fails closed with the correct role when the Main projection is absent', (item, expected) => {
    expect(generationBlockForItem(null, item)).toEqual(expected);
  });

  it('supports an item represented exactly once', () => {
    expect(generationBlockForItem(makeCapability({ supportedItems: [boardItem] }), boardItem)).toBeNull();
  });

  it('returns the exact Main-owned block represented once', () => {
    const block: StudioGenerationBlockV2 = { code: 'duration', role: 'image', seconds: 9 };
    const capability = makeCapability({ blocks: [{ block, items: [boardItem] }] });
    expect(generationBlockForItem(capability, boardItem)).toBe(block);
  });

  it('fails closed when a loaded projection omits the requested item', () => {
    const capability = makeCapability({
      supportedItems: [{ target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'board_still' }],
    });
    expect(generationBlockForItem(capability, boardItem)).toEqual({ code: 'catalog_unloaded', role: 'image' });
  });

  it('fails closed when the supported list duplicates the requested item', () => {
    const capability = makeCapability({ supportedItems: [boardItem, boardItem] });
    expect(generationBlockForItem(capability, boardItem)).toEqual({ code: 'catalog_unloaded', role: 'image' });
  });

  it('fails closed when one exclusion group duplicates the requested item', () => {
    const block: StudioGenerationBlockV2 = { code: 'duration', role: 'image', seconds: 9 };
    const capability = makeCapability({ blocks: [{ block, items: [boardItem, boardItem] }] });
    expect(generationBlockForItem(capability, boardItem)).toEqual({ code: 'catalog_unloaded', role: 'image' });
  });

  it('fails closed when multiple exclusion groups contain the requested item', () => {
    const capability = makeCapability({
      blocks: [
        { block: { code: 'duration', role: 'image', seconds: 9 }, items: [boardItem] },
        { block: { code: 'no_engine', role: 'image' }, items: [boardItem] },
      ],
    });
    expect(generationBlockForItem(capability, boardItem)).toEqual({ code: 'catalog_unloaded', role: 'image' });
  });

  it('fails closed when the requested item is both supported and blocked', () => {
    const capability = makeCapability({
      supportedItems: [videoItem],
      blocks: [{ block: { code: 'first_frame', role: 'video' }, items: [videoItem] }],
    });
    expect(generationBlockForItem(capability, videoItem)).toEqual({ code: 'catalog_unloaded', role: 'video' });
  });

  it('groups the exact blocked subset, deduplicates requests, and leaves supported items out', () => {
    const referenceItem: StudioGenerationCapabilityItemV2 = {
      target: { kind: 'reference', referenceId: 'reference_1' },
      purpose: 'reference_image',
    };
    const block: StudioGenerationBlockV2 = { code: 'duration', role: 'image', seconds: 4 };
    const capability = makeCapability({
      supportedItems: [videoItem],
      blocks: [{ block, items: [boardItem, referenceItem] }],
    });

    expect(generationBlockGroupsForItems(capability, [videoItem, boardItem, boardItem, referenceItem])).toEqual([
      { block, items: [boardItem, referenceItem] },
    ]);
  });
});

const messageCases: ReadonlyArray<readonly [StudioGenerationBlockV2, StudioGenerationBlockMessage]> = [
  [{ code: 'catalog_unloaded', role: 'image' }, { key: 'conversation.creativeStudio.models.blocked.catalogUnloaded' }],
  [{ code: 'no_engine', role: 'image' }, { key: 'conversation.creativeStudio.models.blocked.noEngine' }],
  [{ code: 'needs_setup', role: 'video' }, { key: 'conversation.creativeStudio.models.blocked.needsSetup' }],
  [{ code: 'health', role: 'image' }, { key: 'conversation.creativeStudio.models.blocked.notAnswering' }],
  [{ code: 'retired', role: 'video' }, { key: 'conversation.creativeStudio.models.blocked.retired' }],
  [
    { code: 'frame', role: 'image', ratio: '9:16' },
    { key: 'conversation.creativeStudio.models.blocked.frame', values: { ratio: '9:16' } },
  ],
  [
    { code: 'resolution', role: 'video', resolution: '1080p' },
    { key: 'conversation.creativeStudio.models.blocked.resolution', values: { resolution: '1080p' } },
  ],
  [
    { code: 'duration', role: 'video', seconds: 7.5 },
    { key: 'conversation.creativeStudio.models.blocked.duration', values: { seconds: 7.5 } },
  ],
  [{ code: 'first_frame', role: 'video' }, { key: 'conversation.creativeStudio.models.blocked.firstFrame' }],
  [
    {
      code: 'reference_binding',
      role: 'image',
      reason: 'unassigned',
      selectedCount: 0,
      limit: 3,
    },
    { key: 'conversation.creativeStudio.references.bindings.unassigned' },
  ],
  [
    {
      code: 'reference_binding',
      role: 'image',
      reason: 'capacity_exceeded',
      selectedCount: 5,
      limit: 4,
    },
    {
      key: 'conversation.creativeStudio.references.bindings.capacity',
      values: { count: 5, limit: 4 },
    },
  ],
];

describe('generation blocker messages', () => {
  it.each(messageCases)('maps each block code to renderer copy', (block, expected) => {
    expect(generationBlockMessage(block)).toEqual(expected);
  });

  it.each([
    'unknown_reference',
    'wrong_kind',
    'unapproved_reference',
    'missing_asset',
  ] satisfies StudioReferenceBindingFailureReasonV2[])(
    'maps %s binding failures to the invalid-binding copy',
    (reason) => {
      const block: StudioGenerationBlockV2 = {
        code: 'reference_binding',
        role: 'image',
        reason,
        selectedCount: 1,
        limit: 4,
      };
      expect(generationBlockMessage(block)).toEqual({
        key: 'conversation.creativeStudio.references.bindings.invalid',
      });
    }
  );
});

const actionCases: ReadonlyArray<readonly [StudioGenerationBlockV2, StudioGenerationBlockAction]> = [
  [{ code: 'catalog_unloaded', role: 'image' }, 'none'],
  [{ code: 'health', role: 'video' }, 'none'],
  [{ code: 'duration', role: 'video', seconds: 8 }, 'duration'],
  [
    {
      code: 'reference_binding',
      role: 'image',
      reason: 'unassigned',
      selectedCount: 0,
      limit: 4,
    },
    'references',
  ],
  [{ code: 'no_engine', role: 'image' }, 'routes'],
  [{ code: 'needs_setup', role: 'video' }, 'routes'],
  [{ code: 'retired', role: 'image' }, 'routes'],
  [{ code: 'frame', role: 'video', ratio: '16:9' }, 'routes'],
  [{ code: 'resolution', role: 'image', resolution: '720p' }, 'routes'],
  [{ code: 'first_frame', role: 'video' }, 'routes'],
];

describe('generation blocker remedies', () => {
  it.each(actionCases)('maps each block code to the safe remedy', (block, expected) => {
    expect(generationBlockAction(block)).toBe(expected);
  });
});
