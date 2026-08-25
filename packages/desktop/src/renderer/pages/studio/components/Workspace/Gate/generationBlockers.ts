/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioGenerationBlockV2,
  StudioGenerationCapabilityBlockGroupV2,
  StudioGenerationCapabilityItemV2,
  StudioGenerationCapabilityV2,
  StudioMediaKind,
  StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';

export type StudioGenerationBlockAction = 'routes' | 'duration' | 'references' | 'none';

export type StudioGenerationBlockMessage = {
  key: string;
  values?: Record<string, string | number>;
};

export const generationCapabilityIsCurrent = (
  project: StudioRendererProjectV2,
  capability: StudioGenerationCapabilityV2 | null | undefined
): capability is StudioGenerationCapabilityV2 =>
  capability != null && capability.projectId === project.id && capability.projectRevision === project.revision;

const sameCapabilityItem = (
  left: StudioGenerationCapabilityItemV2,
  right: StudioGenerationCapabilityItemV2
): boolean => {
  if (left.purpose !== right.purpose || left.target.kind !== right.target.kind) return false;
  return left.target.kind === 'shot' && right.target.kind === 'shot'
    ? left.target.shotId === right.target.shotId
    : left.target.kind === 'reference' && right.target.kind === 'reference'
      ? left.target.referenceId === right.target.referenceId
      : false;
};

/** Fails closed when the exact Main projection is absent, stale, duplicated, or incomplete. */
export const generationBlockForItem = (
  capability: StudioGenerationCapabilityV2 | null,
  item: StudioGenerationCapabilityItemV2
): StudioGenerationBlockV2 | null => {
  const role: StudioMediaKind = item.purpose === 'video_take' ? 'video' : 'image';
  if (capability === null) return { code: 'catalog_unloaded', role };
  const matchingBlocks = capability.blocks.flatMap((group) =>
    group.items.flatMap((candidate) => (sameCapabilityItem(candidate, item) ? [group.block] : []))
  );
  const supportedCount = capability.supportedItems.filter((candidate) => sameCapabilityItem(candidate, item)).length;
  if (matchingBlocks.length === 1 && supportedCount === 0) return matchingBlocks[0]!;
  if (matchingBlocks.length === 0 && supportedCount === 1) return null;
  return { code: 'catalog_unloaded', role };
};

const capabilityItemIdentity = (item: StudioGenerationCapabilityItemV2): string =>
  item.target.kind === 'shot'
    ? `shot\0${item.target.shotId}\0${item.purpose}`
    : `reference\0${item.target.referenceId}\0reference_image`;

const cloneCapabilityItem = (item: StudioGenerationCapabilityItemV2): StudioGenerationCapabilityItemV2 => {
  if (item.target.kind === 'reference') {
    return { target: { kind: 'reference', referenceId: item.target.referenceId }, purpose: 'reference_image' };
  }
  const shotId = item.target.shotId;
  switch (item.purpose) {
    case 'seed_still':
    case 'board_still':
    case 'video_take':
      return { target: { kind: 'shot', shotId }, purpose: item.purpose };
    case 'reference_image':
      throw new TypeError('Invalid Studio Shot capability purpose');
  }
};

/** Groups the exact blocked subset without widening or narrowing the caller's generation intent. */
export const generationBlockGroupsForItems = (
  capability: StudioGenerationCapabilityV2 | null,
  items: readonly StudioGenerationCapabilityItemV2[]
): StudioGenerationCapabilityBlockGroupV2[] => {
  const groups: StudioGenerationCapabilityBlockGroupV2[] = [];
  const groupByBlock = new Map<string, StudioGenerationCapabilityBlockGroupV2>();
  const seen = new Set<string>();
  for (const item of items) {
    const identity = capabilityItemIdentity(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const block = generationBlockForItem(capability, item);
    if (block === null) continue;
    const blockIdentity = JSON.stringify(block);
    const existing = groupByBlock.get(blockIdentity);
    if (existing !== undefined) {
      existing.items.push(cloneCapabilityItem(item));
      continue;
    }
    const group = { block, items: [cloneCapabilityItem(item)] };
    groups.push(group);
    groupByBlock.set(blockIdentity, group);
  }
  return groups;
};

export const generationBlockMessage = (block: StudioGenerationBlockV2): StudioGenerationBlockMessage => {
  switch (block.code) {
    case 'catalog_unloaded':
      return { key: 'conversation.creativeStudio.models.blocked.catalogUnloaded' };
    case 'no_engine':
      return { key: 'conversation.creativeStudio.models.blocked.noEngine' };
    case 'needs_setup':
      return { key: 'conversation.creativeStudio.models.blocked.needsSetup' };
    case 'health':
      return { key: 'conversation.creativeStudio.models.blocked.notAnswering' };
    case 'retired':
      return { key: 'conversation.creativeStudio.models.blocked.retired' };
    case 'frame':
      return { key: 'conversation.creativeStudio.models.blocked.frame', values: { ratio: block.ratio } };
    case 'resolution':
      return {
        key: 'conversation.creativeStudio.models.blocked.resolution',
        values: { resolution: block.resolution },
      };
    case 'duration':
      return { key: 'conversation.creativeStudio.models.blocked.duration', values: { seconds: block.seconds } };
    case 'first_frame':
      return { key: 'conversation.creativeStudio.models.blocked.firstFrame' };
    case 'reference_binding':
      return block.reason === 'unassigned'
        ? { key: 'conversation.creativeStudio.references.bindings.unassigned' }
        : block.reason === 'capacity_exceeded'
          ? {
              key: 'conversation.creativeStudio.references.bindings.capacity',
              values: { count: block.selectedCount, limit: block.limit },
            }
          : { key: 'conversation.creativeStudio.references.bindings.invalid' };
  }
};

export const generationBlockAction = (block: StudioGenerationBlockV2): StudioGenerationBlockAction => {
  switch (block.code) {
    case 'catalog_unloaded':
    case 'health':
      return 'none';
    case 'duration':
      return 'duration';
    case 'reference_binding':
      return 'references';
    case 'no_engine':
    case 'needs_setup':
    case 'retired':
    case 'frame':
    case 'resolution':
    case 'first_frame':
      return 'routes';
  }
};
