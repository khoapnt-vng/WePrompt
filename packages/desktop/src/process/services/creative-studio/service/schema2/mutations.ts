/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import {
  STUDIO_MAX_CLIPS_PER_PROJECT,
  STUDIO_MAX_CLIPS_PER_SECTION,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_SECTIONS,
  STUDIO_MAX_SHELF_ITEMS,
  STUDIO_MAX_SHELF_SECTION_ITEMS,
  STUDIO_MAX_SHELF_TAKE_ALIASES,
  STUDIO_MAX_VIDEO_CLIP_SECONDS,
  STUDIO_MIN_VIDEO_CLIP_SECONDS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioClip,
  type StudioEditableClip,
  type StudioEditableClipChanges,
  type StudioEditableSection,
  type StudioEditableSectionChanges,
  type StudioJobV2,
  type StudioMutationBatchV2,
  type StudioMutationOperationV2,
  type StudioProjectV2,
  type StudioSection,
  type StudioShelfItem,
} from '@/common/types/project/creativeStudioTypes';
import { reconcileStudioCutsV2, studioClipHasCutDependencyV2, type StudioCutReconciliationScopeV2 } from './cuts';
import { validateStudioProjectV2 } from './validation';

export type StudioMutationReasonV2 =
  | 'section_capacity_reached'
  | 'section_clip_capacity_reached'
  | 'project_clip_capacity_reached'
  | 'invalid_clip_duration'
  | 'dependency_blocked'
  | 'identity_collision'
  | 'invalid_operation'
  | 'validation_failed';

export type StudioMutationApplyResultV2 = {
  project: StudioProjectV2;
  createdSectionIds: string[];
  createdClipIds: string[];
};

/** A bounded mutation failure safe for translation by the service boundary. */
export class StudioMutationErrorV2 extends Error {
  readonly reasonCode: StudioMutationReasonV2;

  constructor(reasonCode: StudioMutationReasonV2) {
    super(reasonCode);
    this.name = 'StudioMutationErrorV2';
    this.reasonCode = reasonCode;
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const MEDIA_KINDS = new Set(['image', 'video']);
const NONTERMINAL_JOB_STATUSES: ReadonlySet<StudioJobV2['status']> = new Set([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);
const BATCH_KEYS = new Set(['schemaVersion', 'projectId', 'expectedRevision', 'operations']);
const SECTION_INPUT_KEYS = new Set(['title', 'storyLine', 'visualPrompt']);
const SECTION_CHANGE_KEYS = new Set(['title', 'storyLine', 'visualPrompt']);
const CLIP_INPUT_KEYS = new Set([
  'shotPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
]);
const CLIP_CHANGE_KEYS = new Set([
  'shotPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
]);
const SHELF_SECTION_KEYS = new Set(['kind', 'sectionId']);
const SHELF_ASSET_KEYS = new Set(['kind', 'assetId']);
const OPERATION_KEYS: Readonly<Record<StudioMutationOperationV2['kind'], ReadonlySet<string>>> = {
  set_brief: new Set(['kind', 'brief']),
  add_section: new Set(['kind', 'sectionId', 'section', 'firstClipId', 'firstClip', 'beforeSectionId']),
  edit_section: new Set(['kind', 'sectionId', 'changes']),
  reorder_sections: new Set(['kind', 'sectionOrder']),
  park_section: new Set(['kind', 'sectionId']),
  restore_section: new Set(['kind', 'sectionId', 'beforeSectionId']),
  add_clip: new Set(['kind', 'sectionId', 'clipId', 'clip', 'beforeClipId']),
  edit_clip: new Set(['kind', 'clipId', 'changes']),
  delete_clip: new Set(['kind', 'clipId']),
  reorder_clips: new Set(['kind', 'sectionId', 'clipOrder']),
  park_take: new Set(['kind', 'clipId', 'assetId']),
  select_shelved_take: new Set(['kind', 'clipId', 'assetId']),
  remove_shelf_alias: new Set(['kind', 'assetId']),
  reorder_shelf: new Set(['kind', 'shelf']),
  select_take: new Set(['kind', 'clipId', 'assetId']),
};

const fail = (reasonCode: StudioMutationReasonV2): never => {
  throw new StudioMutationErrorV2(reasonCode);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean =>
  Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));

const ownValue = <T>(record: Record<string, T>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const defineOwn = <T>(record: Record<string, T>, id: string, value: T): void => {
  Object.defineProperty(record, id, {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
};

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);
const isStringWithin = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length <= maximum;
const isSafeAnchor = (value: unknown): value is string | null => value === null || isSafeId(value);
const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value);

const isDenseArray = (value: unknown, maximumLength: number): value is unknown[] => {
  try {
    if (!Array.isArray(value) || value.length > maximumLength || Reflect.ownKeys(value).length !== value.length + 1) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const hasOnlyDataPropertiesDeep = (value: unknown, seen = new Set<object>()): boolean => {
  if (typeof value !== 'object' || value === null) return true;
  if (seen.has(value)) return true;
  seen.add(value);

  try {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return false;
      if (!hasOnlyDataPropertiesDeep(descriptor.value, seen)) return false;
    }
  } catch {
    return false;
  }

  return true;
};

const isUniqueSafeIdArray = (value: unknown, maximumLength: number): value is string[] => {
  if (!isDenseArray(value, maximumLength)) return false;
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const id = value[index];
    if (!isSafeId(id) || ids.has(id)) return false;
    ids.add(id);
  }
  return true;
};

const isEditableSection = (value: unknown): value is StudioEditableSection =>
  isRecord(value) &&
  hasExactKeys(value, SECTION_INPUT_KEYS) &&
  isStringWithin(value.title, 256) &&
  isStringWithin(value.storyLine, 4 * 1024) &&
  isStringWithin(value.visualPrompt, 8 * 1024);

const isEditableSectionChanges = (value: unknown): value is StudioEditableSectionChanges => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => SECTION_CHANGE_KEYS.has(key)) &&
    (!Object.hasOwn(value, 'title') || isStringWithin(value.title, 256)) &&
    (!Object.hasOwn(value, 'storyLine') || isStringWithin(value.storyLine, 4 * 1024)) &&
    (!Object.hasOwn(value, 'visualPrompt') || isStringWithin(value.visualPrompt, 8 * 1024))
  );
};

const isEditableClipShape = (value: unknown): value is StudioEditableClip =>
  isRecord(value) &&
  hasExactKeys(value, CLIP_INPUT_KEYS) &&
  isStringWithin(value.shotPrompt, 8 * 1024) &&
  isStringWithin(value.narration, 4 * 1024) &&
  isStringWithin(value.onScreenText, 1024) &&
  typeof value.mediaKind === 'string' &&
  MEDIA_KINDS.has(value.mediaKind) &&
  Object.hasOwn(value, 'durationSeconds') &&
  (value.referenceAssetId === null || isSafeId(value.referenceAssetId));

const isEditableClipChangesShape = (value: unknown): value is StudioEditableClipChanges => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => CLIP_CHANGE_KEYS.has(key)) &&
    (!Object.hasOwn(value, 'shotPrompt') || isStringWithin(value.shotPrompt, 8 * 1024)) &&
    (!Object.hasOwn(value, 'narration') || isStringWithin(value.narration, 4 * 1024)) &&
    (!Object.hasOwn(value, 'onScreenText') || isStringWithin(value.onScreenText, 1024)) &&
    (!Object.hasOwn(value, 'mediaKind') || (typeof value.mediaKind === 'string' && MEDIA_KINDS.has(value.mediaKind))) &&
    (!Object.hasOwn(value, 'durationSeconds') || value.durationSeconds !== undefined) &&
    (!Object.hasOwn(value, 'referenceAssetId') || value.referenceAssetId === null || isSafeId(value.referenceAssetId))
  );
};

const isShelfItem = (value: unknown): value is StudioShelfItem => {
  if (!isRecord(value)) return false;
  if (value.kind === 'section') return hasExactKeys(value, SHELF_SECTION_KEYS) && isSafeId(value.sectionId);
  if (value.kind === 'asset') return hasExactKeys(value, SHELF_ASSET_KEYS) && isSafeId(value.assetId);
  return false;
};

const isShelfItemArray = (value: unknown): value is StudioShelfItem[] => {
  if (!isDenseArray(value, STUDIO_MAX_SHELF_ITEMS)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!isShelfItem(value[index])) return false;
  }
  return true;
};

const assertOperationShape: (value: unknown) => asserts value is StudioMutationOperationV2 = (value) => {
  if (!isRecord(value)) fail('invalid_operation');
  const operation = value as Record<string, unknown>;
  if (typeof operation.kind !== 'string' || !Object.hasOwn(OPERATION_KEYS, operation.kind)) {
    fail('invalid_operation');
  }
  const kind = operation.kind as StudioMutationOperationV2['kind'];
  if (!hasExactKeys(operation, OPERATION_KEYS[kind])) fail('invalid_operation');

  switch (kind) {
    case 'set_brief':
      if (!isStringWithin(operation.brief, 16 * 1024)) fail('invalid_operation');
      return;
    case 'add_section':
      if (
        !isSafeId(operation.sectionId) ||
        !isRecord(operation.section) ||
        !hasExactKeys(operation.section, SECTION_INPUT_KEYS) ||
        !isSafeId(operation.firstClipId) ||
        !isRecord(operation.firstClip) ||
        !hasExactKeys(operation.firstClip, CLIP_INPUT_KEYS) ||
        !isSafeAnchor(operation.beforeSectionId)
      ) {
        fail('invalid_operation');
      }
      return;
    case 'edit_section':
      if (!isSafeId(operation.sectionId) || !isEditableSectionChanges(operation.changes)) fail('invalid_operation');
      return;
    case 'reorder_sections':
      if (!isUniqueSafeIdArray(operation.sectionOrder, STUDIO_MAX_SECTIONS)) fail('invalid_operation');
      return;
    case 'park_section':
      if (!isSafeId(operation.sectionId)) fail('invalid_operation');
      return;
    case 'restore_section':
      if (!isSafeId(operation.sectionId) || !isSafeAnchor(operation.beforeSectionId)) fail('invalid_operation');
      return;
    case 'add_clip':
      if (
        !isSafeId(operation.sectionId) ||
        !isSafeId(operation.clipId) ||
        !isRecord(operation.clip) ||
        !hasExactKeys(operation.clip, CLIP_INPUT_KEYS) ||
        !isSafeAnchor(operation.beforeClipId)
      ) {
        fail('invalid_operation');
      }
      return;
    case 'edit_clip':
      if (!isSafeId(operation.clipId) || !isEditableClipChangesShape(operation.changes)) fail('invalid_operation');
      return;
    case 'delete_clip':
      if (!isSafeId(operation.clipId)) fail('invalid_operation');
      return;
    case 'reorder_clips':
      if (!isSafeId(operation.sectionId) || !isUniqueSafeIdArray(operation.clipOrder, STUDIO_MAX_CLIPS_PER_SECTION)) {
        fail('invalid_operation');
      }
      return;
    case 'park_take':
    case 'select_shelved_take':
    case 'select_take':
      if (!isSafeId(operation.clipId) || !isSafeId(operation.assetId)) fail('invalid_operation');
      return;
    case 'remove_shelf_alias':
      if (!isSafeId(operation.assetId)) fail('invalid_operation');
      return;
    case 'reorder_shelf':
      if (!isShelfItemArray(operation.shelf)) fail('invalid_operation');
      return;
  }
};

const assertBatchEnvelope = (project: StudioProjectV2, batch: unknown): unknown[] => {
  if (!isRecord(batch)) fail('invalid_operation');
  const envelope = batch as Record<string, unknown>;
  if (
    !hasExactKeys(envelope, BATCH_KEYS) ||
    envelope.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION ||
    envelope.projectId !== project.id ||
    envelope.expectedRevision !== project.revision ||
    !isInteger(envelope.expectedRevision) ||
    !isDenseArray(envelope.operations, STUDIO_MAX_MUTATION_OPERATIONS) ||
    envelope.operations.length < 1
  ) {
    fail('invalid_operation');
  }
  return envelope.operations as unknown[];
};

const assertClipDuration: (mediaKind: StudioClip['mediaKind'], value: unknown) => asserts value is number = (
  mediaKind,
  value
) => {
  const minimum = mediaKind === 'video' ? STUDIO_MIN_VIDEO_CLIP_SECONDS : 1;
  const maximum = mediaKind === 'video' ? STUDIO_MAX_VIDEO_CLIP_SECONDS : 60;
  if (!isInteger(value) || value < minimum || value > maximum) fail('invalid_clip_duration');
};

const insertBefore = (values: readonly string[], value: string, before: string | null): string[] => {
  if (before === null) return [...values, value];
  const index = values.indexOf(before);
  if (index < 0) fail('invalid_operation');
  return [...values.slice(0, index), value, ...values.slice(index)];
};

const isExactPermutation = <T>(current: readonly T[], next: readonly T[], identity: (value: T) => string): boolean => {
  if (current.length !== next.length) return false;
  const currentIdentities = new Set<string>();
  const nextIdentities = new Set<string>();
  for (let index = 0; index < current.length; index += 1) currentIdentities.add(identity(current[index]!));
  for (let index = 0; index < next.length; index += 1) {
    const nextIdentity = identity(next[index]!);
    if (nextIdentities.has(nextIdentity) || !currentIdentities.has(nextIdentity)) return false;
    nextIdentities.add(nextIdentity);
  }
  return true;
};

const copyArray = <T>(value: readonly T[]): T[] => {
  const result: T[] = [];
  for (let index = 0; index < value.length; index += 1) result.push(value[index]!);
  return result;
};

const shelfIdentity = (item: StudioShelfItem): string =>
  item.kind === 'section' ? `section:${item.sectionId}` : `asset:${item.assetId}`;

const findClipOwner = (project: StudioProjectV2, clipId: string): StudioSection | undefined =>
  Object.values(project.sections).find((section) => section.clipOrder.includes(clipId));

const assetHasCutDependency = (project: StudioProjectV2, assetId: string): boolean =>
  Object.values(project.cuts).some((cut) => Object.values(cut.clips).some((cutClip) => cutClip.assetId === assetId));

const shelfHasAsset = (project: StudioProjectV2, assetId: string): boolean =>
  project.shelf.some((item) => item.kind === 'asset' && item.assetId === assetId);

const assertCanonicalTake = (
  project: StudioProjectV2,
  clipId: string,
  assetId: string
): [StudioClip, StudioAssetV2] => {
  const clip = ownValue(project.clips, clipId);
  const asset = ownValue(project.assets, assetId);
  if (clip === undefined || asset === undefined || !isCanonicalStudioGeneratedTakeV2(asset, project.id, clip)) {
    fail('invalid_operation');
  }
  return [clip, asset];
};

const assertReferenceAsset = (project: StudioProjectV2, clip: StudioClip): void => {
  if (clip.referenceAssetId === null) return;
  const asset = ownValue(project.assets, clip.referenceAssetId);
  if (asset === undefined || asset.clipId !== clip.id || !clip.assetIds.includes(asset.id)) {
    fail('invalid_operation');
  }
};

const shelfCounts = (shelf: readonly StudioShelfItem[]): { sections: number; assets: number } => ({
  sections: shelf.filter((item) => item.kind === 'section').length,
  assets: shelf.filter((item) => item.kind === 'asset').length,
});

/**
 * Applies one ordered mutation batch to an isolated draft. Persistence owns CAS,
 * timestamps, revision advancement, and renderer projection.
 */
export const applyStudioMutationBatchV2 = (
  project: StudioProjectV2,
  batch: StudioMutationBatchV2
): StudioMutationApplyResultV2 => {
  if (!validateStudioProjectV2(project)) fail('validation_failed');
  let draft: StudioProjectV2;
  try {
    draft = structuredClone(project);
  } catch {
    fail('validation_failed');
  }
  if (!hasOnlyDataPropertiesDeep(batch)) fail('invalid_operation');
  let batchSnapshot: unknown;
  try {
    batchSnapshot = structuredClone(batch as unknown);
  } catch {
    fail('invalid_operation');
  }
  const operations = assertBatchEnvelope(draft, batchSnapshot);
  const knownSectionIds = new Set(Object.keys(draft.sections));
  const knownClipIds = new Set(Object.keys(draft.clips));
  const createdSectionIds: string[] = [];
  const createdClipIds: string[] = [];

  for (let operationIndex = 0; operationIndex < operations.length; operationIndex += 1) {
    const rawOperation = operations[operationIndex];
    assertOperationShape(rawOperation);
    const operation = rawOperation;
    let cutReconciliation: StudioCutReconciliationScopeV2 | null = null;

    switch (operation.kind) {
      case 'set_brief':
        draft.brief = operation.brief;
        break;

      case 'add_section': {
        if (operation.beforeSectionId !== null && !draft.sectionOrder.includes(operation.beforeSectionId)) {
          fail('invalid_operation');
        }
        if (Object.keys(draft.sections).length >= STUDIO_MAX_SECTIONS) fail('section_capacity_reached');
        if (Object.keys(draft.clips).length >= STUDIO_MAX_CLIPS_PER_PROJECT) fail('project_clip_capacity_reached');
        if (knownSectionIds.has(operation.sectionId) || knownClipIds.has(operation.firstClipId)) {
          fail('identity_collision');
        }
        if (!isEditableSection(operation.section) || !isEditableClipShape(operation.firstClip)) {
          fail('invalid_operation');
        }
        if (operation.firstClip.referenceAssetId !== null) fail('invalid_operation');
        assertClipDuration(operation.firstClip.mediaKind, operation.firstClip.durationSeconds);

        const section: StudioSection = {
          id: operation.sectionId,
          title: operation.section.title,
          storyLine: operation.section.storyLine,
          visualPrompt: operation.section.visualPrompt,
          clipOrder: [operation.firstClipId],
        };
        const clip: StudioClip = {
          id: operation.firstClipId,
          ...operation.firstClip,
          selectedAssetId: null,
          assetIds: [],
          jobIds: [],
        };
        defineOwn(draft.sections, section.id, section);
        defineOwn(draft.clips, clip.id, clip);
        draft.sectionOrder = insertBefore(draft.sectionOrder, section.id, operation.beforeSectionId);
        knownSectionIds.add(section.id);
        knownClipIds.add(clip.id);
        createdSectionIds.push(section.id);
        createdClipIds.push(clip.id);
        break;
      }

      case 'edit_section': {
        const section = ownValue(draft.sections, operation.sectionId);
        if (section === undefined) fail('invalid_operation');
        defineOwn(draft.sections, section.id, { ...section, ...operation.changes, id: section.id });
        break;
      }

      case 'reorder_sections':
        if (!isExactPermutation(draft.sectionOrder, operation.sectionOrder, (id) => id)) fail('invalid_operation');
        draft.sectionOrder = copyArray(operation.sectionOrder);
        cutReconciliation = { kind: 'structure' };
        break;

      case 'park_section': {
        const activeIndex = draft.sectionOrder.indexOf(operation.sectionId);
        if (activeIndex < 0 || ownValue(draft.sections, operation.sectionId) === undefined) fail('invalid_operation');
        const counts = shelfCounts(draft.shelf);
        if (draft.shelf.length >= STUDIO_MAX_SHELF_ITEMS || counts.sections >= STUDIO_MAX_SHELF_SECTION_ITEMS) {
          fail('validation_failed');
        }
        draft.sectionOrder = draft.sectionOrder.filter((sectionId) => sectionId !== operation.sectionId);
        draft.shelf = [...draft.shelf, { kind: 'section', sectionId: operation.sectionId }];
        cutReconciliation = { kind: 'structure' };
        break;
      }

      case 'restore_section': {
        const shelfIndex = draft.shelf.findIndex(
          (item) => item.kind === 'section' && item.sectionId === operation.sectionId
        );
        if (shelfIndex < 0 || ownValue(draft.sections, operation.sectionId) === undefined) fail('invalid_operation');
        if (operation.beforeSectionId !== null && !draft.sectionOrder.includes(operation.beforeSectionId)) {
          fail('invalid_operation');
        }
        draft.shelf = [...draft.shelf.slice(0, shelfIndex), ...draft.shelf.slice(shelfIndex + 1)];
        draft.sectionOrder = insertBefore(draft.sectionOrder, operation.sectionId, operation.beforeSectionId);
        cutReconciliation = { kind: 'structure' };
        break;
      }

      case 'add_clip': {
        const section = ownValue(draft.sections, operation.sectionId);
        if (section === undefined) fail('invalid_operation');
        if (operation.beforeClipId !== null && !section.clipOrder.includes(operation.beforeClipId)) {
          fail('invalid_operation');
        }
        if (section.clipOrder.length >= STUDIO_MAX_CLIPS_PER_SECTION) fail('section_clip_capacity_reached');
        if (Object.keys(draft.clips).length >= STUDIO_MAX_CLIPS_PER_PROJECT) fail('project_clip_capacity_reached');
        if (knownClipIds.has(operation.clipId)) fail('identity_collision');
        if (!isEditableClipShape(operation.clip)) fail('invalid_operation');
        if (operation.clip.referenceAssetId !== null) fail('invalid_operation');
        assertClipDuration(operation.clip.mediaKind, operation.clip.durationSeconds);

        const clip: StudioClip = {
          id: operation.clipId,
          ...operation.clip,
          selectedAssetId: null,
          assetIds: [],
          jobIds: [],
        };
        defineOwn(draft.clips, clip.id, clip);
        defineOwn(draft.sections, section.id, {
          ...section,
          clipOrder: insertBefore(section.clipOrder, clip.id, operation.beforeClipId),
        });
        knownClipIds.add(clip.id);
        createdClipIds.push(clip.id);
        break;
      }

      case 'edit_clip': {
        const current = ownValue(draft.clips, operation.clipId);
        if (current === undefined) fail('invalid_operation');
        const next: StudioClip = { ...current, ...operation.changes, id: current.id };
        assertClipDuration(next.mediaKind, next.durationSeconds);
        assertReferenceAsset(draft, next);
        const mediaKindChanged = current.mediaKind !== next.mediaKind;
        const hasShelvedTake = draft.shelf.some((item) => {
          if (item.kind !== 'asset') return false;
          return ownValue(draft.assets, item.assetId)?.clipId === current.id;
        });
        const hasNonterminalJob = current.jobIds.some((jobId) => {
          const job = ownValue(draft.jobs, jobId);
          return job !== undefined && NONTERMINAL_JOB_STATUSES.has(job.status);
        });
        if (
          mediaKindChanged &&
          (hasShelvedTake ||
            current.selectedAssetId !== null ||
            studioClipHasCutDependencyV2(draft, current.id) ||
            hasNonterminalJob)
        ) {
          fail('dependency_blocked');
        }
        defineOwn(draft.clips, next.id, next);
        break;
      }

      case 'delete_clip': {
        const clip = ownValue(draft.clips, operation.clipId);
        const owner = findClipOwner(draft, operation.clipId);
        if (clip === undefined || owner === undefined) fail('invalid_operation');
        const hasShelfAlias = draft.shelf.some((item) => {
          if (item.kind !== 'asset') return false;
          return ownValue(draft.assets, item.assetId)?.clipId === clip.id;
        });
        if (
          clip.assetIds.length > 0 ||
          clip.jobIds.length > 0 ||
          hasShelfAlias ||
          studioClipHasCutDependencyV2(draft, clip.id)
        ) {
          fail('dependency_blocked');
        }
        delete draft.clips[clip.id];
        defineOwn(draft.sections, owner.id, {
          ...owner,
          clipOrder: owner.clipOrder.filter((clipId) => clipId !== clip.id),
        });
        break;
      }

      case 'reorder_clips': {
        const section = ownValue(draft.sections, operation.sectionId);
        if (section === undefined || !isExactPermutation(section.clipOrder, operation.clipOrder, (id) => id)) {
          fail('invalid_operation');
        }
        defineOwn(draft.sections, section.id, { ...section, clipOrder: copyArray(operation.clipOrder) });
        cutReconciliation = { kind: 'structure' };
        break;
      }

      case 'park_take': {
        const [clip] = assertCanonicalTake(draft, operation.clipId, operation.assetId);
        if (shelfHasAsset(draft, operation.assetId)) fail('invalid_operation');
        if (clip.selectedAssetId === operation.assetId || assetHasCutDependency(draft, operation.assetId)) {
          fail('dependency_blocked');
        }
        const counts = shelfCounts(draft.shelf);
        if (draft.shelf.length >= STUDIO_MAX_SHELF_ITEMS || counts.assets >= STUDIO_MAX_SHELF_TAKE_ALIASES) {
          fail('validation_failed');
        }
        draft.shelf = [...draft.shelf, { kind: 'asset', assetId: operation.assetId }];
        break;
      }

      case 'select_shelved_take': {
        const [clip] = assertCanonicalTake(draft, operation.clipId, operation.assetId);
        const shelfIndex = draft.shelf.findIndex((item) => item.kind === 'asset' && item.assetId === operation.assetId);
        if (shelfIndex < 0) fail('invalid_operation');
        draft.shelf = [...draft.shelf.slice(0, shelfIndex), ...draft.shelf.slice(shelfIndex + 1)];
        defineOwn(draft.clips, clip.id, { ...clip, selectedAssetId: operation.assetId });
        cutReconciliation = { kind: 'selection', clipId: clip.id };
        break;
      }

      case 'remove_shelf_alias': {
        const shelfIndex = draft.shelf.findIndex((item) => item.kind === 'asset' && item.assetId === operation.assetId);
        if (shelfIndex < 0) fail('invalid_operation');
        const asset = ownValue(draft.assets, operation.assetId);
        const clip = asset?.clipId === null || asset === undefined ? undefined : ownValue(draft.clips, asset.clipId);
        if (clip?.selectedAssetId === operation.assetId || assetHasCutDependency(draft, operation.assetId)) {
          fail('dependency_blocked');
        }
        draft.shelf = [...draft.shelf.slice(0, shelfIndex), ...draft.shelf.slice(shelfIndex + 1)];
        break;
      }

      case 'reorder_shelf':
        if (!isExactPermutation(draft.shelf, operation.shelf, shelfIdentity)) fail('invalid_operation');
        draft.shelf = [];
        for (let index = 0; index < operation.shelf.length; index += 1) {
          draft.shelf.push({ ...operation.shelf[index]! });
        }
        break;

      case 'select_take': {
        const [clip] = assertCanonicalTake(draft, operation.clipId, operation.assetId);
        if (shelfHasAsset(draft, operation.assetId)) fail('invalid_operation');
        defineOwn(draft.clips, clip.id, { ...clip, selectedAssetId: operation.assetId });
        cutReconciliation = { kind: 'selection', clipId: clip.id };
        break;
      }
    }

    if (cutReconciliation !== null) draft = reconcileStudioCutsV2(draft, cutReconciliation);
  }

  if (!validateStudioProjectV2(draft)) fail('validation_failed');
  return { project: draft, createdSectionIds, createdClipIds };
};
