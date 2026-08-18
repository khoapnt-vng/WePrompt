/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Built-in MCP server for one Creative Studio project. This subprocess can
// read a bounded script view and write durable approval-queue records. It never
// writes project.json; the main-process store remains the sole project writer.

import { promises as nodeFs } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { z as z4 } from 'zod/v4';
import {
  hasRuleToken,
  resolveEffectiveStudioRules,
  STUDIO_RULE_LIMITS,
} from '@/common/types/project/creativeStudioRules';
import { STUDIO_ENV } from '@/common/types/project/creativeStudioMcpEnv';
import { resolveActiveStudioBriefReferences } from '@/common/types/project/creativeStudioManagedAssetCollections';
import {
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SHOT,
  STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SCENE,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_REFERENCE_REQUEST_SHOTS,
  STUDIO_MAX_REFERENCE_REQUEST_SCENES,
  STUDIO_MAX_SCENES,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_BIN_ITEMS,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_DIRECTOR_COMMAND_MAX_OPERATIONS,
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioAsset,
  type StudioAssetV2,
  type StudioShot,
  type StudioEditableScene,
  type StudioMutationOperationV2,
  type StudioProject,
  type StudioProjectV2,
  type StudioScene,
  type StudioRouteCatalog,
} from '@/common/types/project/creativeStudioTypes';
import {
  isCanonicalStudioGeneratedTake,
  isCanonicalStudioGeneratedTakeV2,
} from '@/common/types/project/creativeStudioCanonicalTake';
import { BUILTIN_STUDIO_NAME } from '@process/resources/builtinMcp/constants';
import {
  StudioProposalWriteError,
  writeProposalRecord,
  writeProposalRecordV2,
} from '@process/resources/builtinMcp/studioProposalWriter';
import {
  listPendingReferenceRequestShotIdsV2,
  listPendingReferenceRequestSceneIds,
  writeReferenceRequestRecord,
  writeReferenceRequestRecordV2,
} from '@process/resources/builtinMcp/studioReferenceRequestWriter';
import {
  assertPendingRecordProjectAuthorityV2,
  StudioPendingRecordWriteError,
  type StudioPendingProjectAuthorityV2,
} from '@process/resources/builtinMcp/studioPendingRecordWriter';
import {
  createStudioDirectorCommandWriter,
  createStudioDirectorCommandWriterV2,
  studioDirectorToolInputFitsDurableRecordV2,
  type StudioApplyEditsInput,
  type StudioApplyEditsInputV2,
  type StudioDirectorCommandWriterDeps,
  type StudioGetCommandStatusInput,
} from '@process/resources/builtinMcp/studioDirectorCommandWriter';
import { validateStudioProjectV2 } from '@process/services/creative-studio/service/schema2';
import {
  type RecordIoFileSystem,
  readBoundedRegularFileWithIdentity,
} from '@process/services/creative-studio/service/recordIo';

export type StudioServerEnv = {
  projectId: string;
  projectDir: string;
  pendingDir: string;
  referencePendingDir: string;
  routeCatalog?: StudioRouteCatalog | null;
  /** V2-only deterministic filesystem seam; environment parsing leaves it undefined. */
  fs?: RecordIoFileSystem;
};

export type StudioToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type ProposeStoryboardInput = {
  base_revision: number;
  scene_order: string[];
  scenes: Record<string, StudioEditableScene>;
};

export type ProposeBriefRuleInput = {
  base_revision: number;
  text: string;
  forbidden_terms: string[];
};

export type ProposeStoryboardInputV2 = {
  base_revision: number;
  operations: StudioMutationOperationV2[];
};

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const projectSceneTakes = (
  project: StudioProject,
  scene: StudioScene
): { selectedTakeId: string | null; availableTakeIds: string[] } => {
  const canonicalById = new Map<string, StudioAsset>();
  for (const assetId of scene.assetIds) {
    const asset = project.assets[assetId];
    if (asset !== undefined && asset.id === assetId && isCanonicalStudioGeneratedTake(asset, project.id, scene)) {
      canonicalById.set(assetId, asset);
    }
  }
  const selectedTakeId =
    scene.selectedAssetId !== null && canonicalById.has(scene.selectedAssetId) ? scene.selectedAssetId : null;
  const remaining = [...canonicalById.values()]
    .filter((asset) => asset.id !== selectedTakeId)
    .toSorted(
      (left, right) => compareCodeUnits(right.createdAt, left.createdAt) || compareCodeUnits(left.id, right.id)
    );
  return {
    selectedTakeId,
    availableTakeIds: [
      ...(selectedTakeId === null ? [] : [selectedTakeId]),
      ...remaining.map((asset) => asset.id),
    ].slice(0, STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SCENE),
  };
};

const projectShotTakesV2 = (
  project: StudioProjectV2,
  shot: StudioShot
): { selectedTakeId: string | null; availableTakeIds: string[] } => {
  const canonicalTakeIds: string[] = [];
  const seen = new Set<string>();
  for (const assetId of shot.assetIds) {
    if (seen.has(assetId)) continue;
    seen.add(assetId);
    const asset: StudioAssetV2 | undefined = Object.hasOwn(project.assets, assetId)
      ? project.assets[assetId]
      : undefined;
    if (asset !== undefined && asset.id === assetId && isCanonicalStudioGeneratedTakeV2(asset, project.id, shot)) {
      canonicalTakeIds.push(assetId);
    }
  }
  const selectedTakeId =
    shot.selectedAssetId !== null && canonicalTakeIds.includes(shot.selectedAssetId) ? shot.selectedAssetId : null;
  return {
    selectedTakeId,
    availableTakeIds: [
      ...(selectedTakeId === null ? [] : [selectedTakeId]),
      ...canonicalTakeIds.filter((assetId) => assetId !== selectedTakeId),
    ].slice(0, STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SHOT),
  };
};

/**
 * How long each editable field may be in a proposal this server records.
 *
 * These are not the tool's own preference. The proposal is written straight to the pending
 * directory and validated only when the store reads it back, so a field this schema admits and
 * `validateProposalScene` (store.ts) refuses is written to disk, reported to the Director as
 * "recorded for user review", and then dropped on read with nothing but a log line — no proposal
 * reaches the user and no error reaches the model. Every limit here must therefore be no looser
 * than the store's. `purpose` was 2048 against a store limit of 256 and lost proposals exactly
 * that way; since D10 this is the only route to a drafted storyboard, so it lost the only one.
 */
export const STUDIO_EDITABLE_SCENE_LIMITS = {
  title: 256,
  purpose: 256,
  visualPrompt: 4096,
  narration: 4096,
  onScreenText: 1024,
} as const;

export const editableSceneSchema = z
  .object({
    title: z.string().max(STUDIO_EDITABLE_SCENE_LIMITS.title),
    purpose: z.string().max(STUDIO_EDITABLE_SCENE_LIMITS.purpose),
    visualPrompt: z.string().max(STUDIO_EDITABLE_SCENE_LIMITS.visualPrompt),
    narration: z.string().max(STUDIO_EDITABLE_SCENE_LIMITS.narration),
    onScreenText: z.string().max(STUDIO_EDITABLE_SCENE_LIMITS.onScreenText),
    mediaKind: z.enum(['image', 'video']),
    durationSeconds: z.number().int().min(1).max(60),
    referenceAssetId: z.string().regex(SAFE_ID).nullable(),
  })
  .strict();

const studioDirectorIdSchema = z.string().min(1).max(256).regex(SAFE_ID);
const studioDirectorNewSceneSchema = z
  .object({
    title: z.string().max(256),
    purpose: z.string().max(256),
    visualPrompt: z.string().max(8 * 1024),
    narration: z.string().max(4 * 1024),
    onScreenText: z.string().max(1024),
    mediaKind: z.enum(['image', 'video']),
    durationSeconds: z.number().int().min(1).max(60),
  })
  .strict();
const studioDirectorEditChangesFields = {
  title: z.string().max(256),
  purpose: z.string().max(256),
  visualPrompt: z.string().max(8 * 1024),
  narration: z.string().max(4 * 1024),
  onScreenText: z.string().max(1024),
  durationSeconds: z.number().int().min(1).max(60),
};
const studioDirectorEditChangesSchema = z.union([
  z.object(studioDirectorEditChangesFields).partial().required({ title: true }).strict(),
  z.object(studioDirectorEditChangesFields).partial().required({ purpose: true }).strict(),
  z.object(studioDirectorEditChangesFields).partial().required({ visualPrompt: true }).strict(),
  z.object(studioDirectorEditChangesFields).partial().required({ narration: true }).strict(),
  z.object(studioDirectorEditChangesFields).partial().required({ onScreenText: true }).strict(),
  z.object(studioDirectorEditChangesFields).partial().required({ durationSeconds: true }).strict(),
]);
const studioDirectorOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set_brief'), brief: z.string().max(16 * 1024) }).strict(),
  z
    .object({
      kind: z.literal('add_scene'),
      scene: studioDirectorNewSceneSchema,
      beforeSceneId: studioDirectorIdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('edit_scene'),
      sceneId: studioDirectorIdSchema,
      changes: studioDirectorEditChangesSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reorder_scenes'),
      sceneOrder: z
        .array(studioDirectorIdSchema)
        .min(1)
        .max(STUDIO_MAX_SCENES)
        .refine((sceneOrder) => new Set(sceneOrder).size === sceneOrder.length, {
          message: 'sceneOrder must not contain duplicate ids.',
        }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('select_take'),
      sceneId: studioDirectorIdSchema,
      assetId: studioDirectorIdSchema,
    })
    .strict(),
]);

const studioDirectorOperationsSchema = z
  .array(studioDirectorOperationSchema)
  .min(1)
  .max(STUDIO_DIRECTOR_COMMAND_MAX_OPERATIONS)
  .refine(
    (operations) =>
      !(
        operations.some((operation) => operation.kind === 'add_scene') &&
        operations.some((operation) => operation.kind === 'reorder_scenes')
      ),
    { message: 'add_scene and reorder_scenes cannot be combined in one command.' }
  );

export const studioApplyEditsInputSchema = z
  .object({
    expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    operations: studioDirectorOperationsSchema,
  })
  .strict();

export const studioGetCommandStatusInputSchema = z
  .object({
    commandId: studioDirectorIdSchema,
  })
  .strict();

const studioDirectorIdSchemaV2 = z4.string().min(1).max(256).regex(SAFE_ID);
const videoDurationJsonSchemaV2 = {
  allOf: [
    {
      if: { properties: { mediaKind: { const: 'video' } }, required: ['mediaKind'] },
      then: {
        properties: {
          durationSeconds: {
            minimum: STUDIO_MIN_SHOT_SECONDS,
            maximum: STUDIO_MAX_SHOT_SECONDS,
          },
        },
      },
    },
  ],
};

const studioBeatInputSchemaV2 = z4
  .object({
    title: z4.string().max(256),
    storyLine: z4.string().max(4 * 1024),
    visualPrompt: z4.string().max(8 * 1024),
  })
  .strict();

const studioShotInputSchemaV2 = z4
  .object({
    shotPrompt: z4.string().max(8 * 1024),
    narration: z4.string().max(4 * 1024),
    onScreenText: z4.string().max(1024),
    mediaKind: z4.enum(['image', 'video']),
    durationSeconds: z4.number().int().min(1).max(60),
    referenceAssetId: studioDirectorIdSchemaV2.nullable(),
  })
  .strict()
  .superRefine((shot, context) => {
    if (
      shot.mediaKind === 'video' &&
      (shot.durationSeconds < STUDIO_MIN_SHOT_SECONDS || shot.durationSeconds > STUDIO_MAX_SHOT_SECONDS)
    ) {
      context.addIssue({ code: 'custom', path: ['durationSeconds'], message: 'Invalid video clip duration.' });
    }
  })
  .meta(videoDurationJsonSchemaV2);

const studioBeatChangesFieldsV2 = {
  title: z4.string().max(256),
  storyLine: z4.string().max(4 * 1024),
  visualPrompt: z4.string().max(8 * 1024),
};
const studioBeatChangesSchemaV2 = z4.union([
  z4.object(studioBeatChangesFieldsV2).partial().required({ title: true }).strict(),
  z4.object(studioBeatChangesFieldsV2).partial().required({ storyLine: true }).strict(),
  z4.object(studioBeatChangesFieldsV2).partial().required({ visualPrompt: true }).strict(),
]);

const studioShotChangesFieldsV2 = {
  shotPrompt: z4.string().max(8 * 1024),
  narration: z4.string().max(4 * 1024),
  onScreenText: z4.string().max(1024),
  mediaKind: z4.enum(['image', 'video']),
  durationSeconds: z4.number().int().min(1).max(60),
  referenceAssetId: studioDirectorIdSchemaV2.nullable(),
};
const studioShotChangesSchemaV2 = z4
  .union([
    z4.object(studioShotChangesFieldsV2).partial().required({ shotPrompt: true }).strict(),
    z4.object(studioShotChangesFieldsV2).partial().required({ narration: true }).strict(),
    z4.object(studioShotChangesFieldsV2).partial().required({ onScreenText: true }).strict(),
    z4.object(studioShotChangesFieldsV2).partial().required({ mediaKind: true }).strict(),
    z4.object(studioShotChangesFieldsV2).partial().required({ durationSeconds: true }).strict(),
    z4.object(studioShotChangesFieldsV2).partial().required({ referenceAssetId: true }).strict(),
  ])
  .superRefine((changes, context) => {
    if (
      changes.mediaKind === 'video' &&
      changes.durationSeconds !== undefined &&
      (changes.durationSeconds < STUDIO_MIN_SHOT_SECONDS || changes.durationSeconds > STUDIO_MAX_SHOT_SECONDS)
    ) {
      context.addIssue({ code: 'custom', path: ['durationSeconds'], message: 'Invalid video clip duration.' });
    }
  })
  .meta(videoDurationJsonSchemaV2);

const studioBinItemSchemaV2 = z4.discriminatedUnion('kind', [
  z4.object({ kind: z4.literal('section'), sectionId: studioDirectorIdSchemaV2 }).strict(),
  z4.object({ kind: z4.literal('asset'), assetId: studioDirectorIdSchemaV2 }).strict(),
]);

const uniqueStudioIdsSchema = (maximum: number) =>
  z4
    .array(studioDirectorIdSchemaV2)
    .max(maximum)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Ids must not repeat.' })
    .meta({ uniqueItems: true });

const studioMutationOperationSchemasV2 = {
  setBrief: z4.object({ kind: z4.literal('set_brief'), brief: z4.string().max(16 * 1024) }).strict(),
  addBeat: z4
    .object({
      kind: z4.literal('add_section'),
      sectionId: studioDirectorIdSchemaV2,
      section: studioBeatInputSchemaV2,
      firstClipId: studioDirectorIdSchemaV2,
      firstClip: studioShotInputSchemaV2,
      beforeSectionId: studioDirectorIdSchemaV2.nullable(),
    })
    .strict(),
  editBeat: z4
    .object({
      kind: z4.literal('edit_section'),
      sectionId: studioDirectorIdSchemaV2,
      changes: studioBeatChangesSchemaV2,
    })
    .strict(),
  reorderBeats: z4
    .object({ kind: z4.literal('reorder_sections'), sectionOrder: uniqueStudioIdsSchema(STUDIO_MAX_BEATS) })
    .strict(),
  parkBeat: z4.object({ kind: z4.literal('park_section'), sectionId: studioDirectorIdSchemaV2 }).strict(),
  restoreBeat: z4
    .object({
      kind: z4.literal('restore_section'),
      sectionId: studioDirectorIdSchemaV2,
      beforeSectionId: studioDirectorIdSchemaV2.nullable(),
    })
    .strict(),
  addShot: z4
    .object({
      kind: z4.literal('add_clip'),
      sectionId: studioDirectorIdSchemaV2,
      clipId: studioDirectorIdSchemaV2,
      clip: studioShotInputSchemaV2,
      beforeClipId: studioDirectorIdSchemaV2.nullable(),
    })
    .strict(),
  editShot: z4
    .object({ kind: z4.literal('edit_clip'), clipId: studioDirectorIdSchemaV2, changes: studioShotChangesSchemaV2 })
    .strict(),
  deleteShot: z4.object({ kind: z4.literal('delete_clip'), clipId: studioDirectorIdSchemaV2 }).strict(),
  reorderShots: z4
    .object({
      kind: z4.literal('reorder_clips'),
      sectionId: studioDirectorIdSchemaV2,
      clipOrder: uniqueStudioIdsSchema(STUDIO_MAX_SHOTS_PER_BEAT),
    })
    .strict(),
  parkTake: z4
    .object({ kind: z4.literal('park_take'), clipId: studioDirectorIdSchemaV2, assetId: studioDirectorIdSchemaV2 })
    .strict(),
  selectBinnedTake: z4
    .object({
      kind: z4.literal('select_shelved_take'),
      clipId: studioDirectorIdSchemaV2,
      assetId: studioDirectorIdSchemaV2,
    })
    .strict(),
  removeBinAlias: z4.object({ kind: z4.literal('remove_shelf_alias'), assetId: studioDirectorIdSchemaV2 }).strict(),
  reorderBin: z4
    .object({
      kind: z4.literal('reorder_shelf'),
      shelf: z4
        .array(studioBinItemSchemaV2)
        .max(STUDIO_MAX_BIN_ITEMS)
        .refine(
          (items) =>
            new Set(
              items.map((item) => (item.kind === 'section' ? `section:${item.sectionId}` : `asset:${item.assetId}`))
            ).size === items.length,
          { message: 'Shelf identities must not repeat.' }
        )
        .meta({ uniqueItems: true }),
    })
    .strict(),
  selectTake: z4
    .object({ kind: z4.literal('select_take'), clipId: studioDirectorIdSchemaV2, assetId: studioDirectorIdSchemaV2 })
    .strict(),
};

export const studioMutationOperationSchemaV2 = z4.discriminatedUnion('kind', [
  studioMutationOperationSchemasV2.setBrief,
  studioMutationOperationSchemasV2.addBeat,
  studioMutationOperationSchemasV2.editBeat,
  studioMutationOperationSchemasV2.reorderBeats,
  studioMutationOperationSchemasV2.parkBeat,
  studioMutationOperationSchemasV2.restoreBeat,
  studioMutationOperationSchemasV2.addShot,
  studioMutationOperationSchemasV2.editShot,
  studioMutationOperationSchemasV2.deleteShot,
  studioMutationOperationSchemasV2.reorderShots,
  studioMutationOperationSchemasV2.parkTake,
  studioMutationOperationSchemasV2.selectBinnedTake,
  studioMutationOperationSchemasV2.removeBinAlias,
  studioMutationOperationSchemasV2.reorderBin,
  studioMutationOperationSchemasV2.selectTake,
]);

export const studioDirectorOperationSchemaV2 = z4.discriminatedUnion('kind', [
  studioMutationOperationSchemasV2.setBrief,
  z4
    .object({
      kind: z4.literal('add_section'),
      section: studioBeatInputSchemaV2,
      firstClip: studioShotInputSchemaV2,
      beforeSectionId: studioDirectorIdSchemaV2.nullable(),
    })
    .strict(),
  studioMutationOperationSchemasV2.editBeat,
  studioMutationOperationSchemasV2.reorderBeats,
  studioMutationOperationSchemasV2.parkBeat,
  studioMutationOperationSchemasV2.restoreBeat,
  z4
    .object({
      kind: z4.literal('add_clip'),
      sectionId: studioDirectorIdSchemaV2,
      clip: studioShotInputSchemaV2,
      beforeClipId: studioDirectorIdSchemaV2.nullable(),
    })
    .strict(),
  studioMutationOperationSchemasV2.editShot,
  studioMutationOperationSchemasV2.deleteShot,
  studioMutationOperationSchemasV2.reorderShots,
  studioMutationOperationSchemasV2.parkTake,
  studioMutationOperationSchemasV2.selectBinnedTake,
  studioMutationOperationSchemasV2.removeBinAlias,
  studioMutationOperationSchemasV2.reorderBin,
  studioMutationOperationSchemasV2.selectTake,
]);

const studioDirectorOperationsSchemaV2 = z4
  .array(studioDirectorOperationSchemaV2)
  .min(1)
  .max(STUDIO_MAX_MUTATION_OPERATIONS)
  .refine(
    (operations) =>
      !(
        operations.some((operation) => operation.kind === 'add_section') &&
        operations.some((operation) => operation.kind === 'reorder_sections')
      ),
    { message: 'add_section and reorder_sections cannot be combined in one command.' }
  )
  .refine(
    (operations) =>
      !operations.some(
        (operation) =>
          operation.kind === 'add_clip' &&
          operations.some(
            (candidate) => candidate.kind === 'reorder_clips' && candidate.sectionId === operation.sectionId
          )
      ),
    { message: 'add_clip and reorder_clips cannot target the same section in one command.' }
  )
  .meta({
    not: {
      allOf: [
        {
          contains: {
            type: 'object',
            properties: { kind: { const: 'add_section' } },
            required: ['kind'],
          },
        },
        {
          contains: {
            type: 'object',
            properties: { kind: { const: 'reorder_sections' } },
            required: ['kind'],
          },
        },
      ],
    },
  });

const studioMutationOperationsSchemaV2 = z4
  .array(studioMutationOperationSchemaV2)
  .min(1)
  .max(STUDIO_MAX_MUTATION_OPERATIONS)
  .refine(
    (operations) =>
      !(
        operations.some((operation) => operation.kind === 'add_section') &&
        operations.some((operation) => operation.kind === 'reorder_sections')
      ),
    { message: 'add_section and reorder_sections cannot be combined in one proposal.' }
  )
  .refine(
    (operations) =>
      !operations.some(
        (operation) =>
          operation.kind === 'add_clip' &&
          operations.some(
            (candidate) => candidate.kind === 'reorder_clips' && candidate.sectionId === operation.sectionId
          )
      ),
    { message: 'add_clip and reorder_clips cannot target the same section in one proposal.' }
  )
  .meta({
    not: {
      allOf: [
        {
          contains: {
            type: 'object',
            properties: { kind: { const: 'add_section' } },
            required: ['kind'],
          },
        },
        {
          contains: {
            type: 'object',
            properties: { kind: { const: 'reorder_sections' } },
            required: ['kind'],
          },
        },
      ],
    },
  });

const proposalInputFitsDurableRecordV2 = (value: unknown): boolean => {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const input = value as { base_revision?: unknown; operations?: unknown };
    const preview = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      id: 'x'.repeat(256),
      projectId: 'x'.repeat(256),
      status: 'pending',
      baseRevision: input.base_revision,
      payload: { kind: 'mutation_batch', operations: input.operations },
      createdAt: '9999-12-31T23:59:59.999Z',
      decidedAt: null as null,
    };
    return Buffer.byteLength(JSON.stringify(preview), 'utf8') <= STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES;
  } catch {
    return false;
  }
};

export const studioApplyEditsInputSchemaV2 = z4
  .object({
    expectedRevision: z4.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    operations: studioDirectorOperationsSchemaV2,
  })
  .strict()
  .refine((input) => studioDirectorToolInputFitsDurableRecordV2(input as StudioApplyEditsInputV2), {
    message: 'Command input exceeds the durable record size cap.',
  });

export const studioGetCommandStatusInputSchemaV2 = z4.object({ commandId: studioDirectorIdSchemaV2 }).strict();

export const studioProposeStoryboardInputSchemaV2 = z4
  .object({
    base_revision: z4.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    operations: studioMutationOperationsSchemaV2,
  })
  .strict()
  .refine(proposalInputFitsDurableRecordV2, { message: 'Proposal input exceeds the durable record size cap.' });

export const studioRequestReferenceImagesInputSchemaV2 = z4
  .object({
    clipIds: z4
      .array(studioDirectorIdSchemaV2)
      .min(1)
      .max(STUDIO_MAX_REFERENCE_REQUEST_SHOTS)
      .refine((shotIds) => new Set(shotIds).size === shotIds.length, { message: 'Clip ids must not repeat.' })
      .meta({ uniqueItems: true }),
  })
  .strict();

export function parseStudioServerEnv(env: Record<string, string | undefined>): StudioServerEnv | null {
  const projectId = env[STUDIO_ENV.projectId];
  const projectDir = env[STUDIO_ENV.projectDir];
  const pendingDir = env[STUDIO_ENV.pendingDir];
  const referencePendingDir =
    env[STUDIO_ENV.referencePendingDir] ??
    (projectDir ? path.join(projectDir, 'reference-requests', 'pending') : undefined);
  const serializedRouteCatalog = env[STUDIO_ENV.routeCatalog];
  if (!projectId || !projectDir || !pendingDir) return null;
  let routeCatalog: StudioRouteCatalog | null = null;
  if (serializedRouteCatalog) {
    try {
      routeCatalog = JSON.parse(serializedRouteCatalog) as StudioRouteCatalog;
    } catch {
      routeCatalog = null;
    }
  }
  return { projectId, projectDir, pendingDir, referencePendingDir, routeCatalog };
}

const errorResult = (message: string): StudioToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

const describeError = (error: unknown): string => String(error).replace(/^Error:\s*/, '');

/**
 * The subprocess reads project.json raw: no migrateSchemaV1Project, no validateProject. Main's
 * `rules: []` default (`migrateSchemaV1Project`, store.ts:971-973, applied from `readProject` at
 * :1812) is in-memory only and nothing rewrites the manifest on open, so every project written
 * before rules existed still has no `rules` key on disk. Defaulting it here — once, at the single
 * read point every handler shares — is what stops `read_storyboard` and `propose_brief_rule`
 * throwing on `undefined` and reporting the project as unavailable. Doing it at the call sites
 * instead means every future handler has to remember.
 */
const readProject = async (config: StudioServerEnv): Promise<StudioProject> => {
  const raw = JSON.parse(await readFile(path.join(config.projectDir, 'project.json'), 'utf8')) as StudioProject;
  return Array.isArray(raw.rules) ? raw : { ...raw, rules: [] };
};

class StudioProjectReadErrorV2 extends Error {
  constructor(public readonly code: 'unsupported_prototype_schema' | 'invalid' | 'storage') {
    super(code === 'unsupported_prototype_schema' ? code : 'Invalid schema-2 Creative Studio project');
  }
}

type StudioProjectSnapshotV2 = {
  project: StudioProjectV2;
  canonicalRoot: string;
  rootIdentity: { dev: number; ino: number };
  fileIdentity: { dev: number; ino: number };
  bytes: string;
};

const pendingProjectAuthorityV2 = (snapshot: StudioProjectSnapshotV2): StudioPendingProjectAuthorityV2 => ({
  canonicalRoot: snapshot.canonicalRoot,
  rootIdentity: snapshot.rootIdentity,
});

const STUDIO_PROJECT_V2_MAX_RECORD_BYTES = 64 * 1024 * 1024;

const readProjectSnapshotV2 = async (config: StudioServerEnv): Promise<StudioProjectSnapshotV2> => {
  const recordFs = config.fs ?? nodeFs;
  const configuredRoot = path.resolve(config.projectDir);
  try {
    const configuredStats = await recordFs.lstat(configuredRoot);
    if (!configuredStats.isDirectory() || configuredStats.isSymbolicLink())
      throw new StudioProjectReadErrorV2('storage');
    const canonicalRoot = await recordFs.realpath(configuredRoot);
    const rootStats = await recordFs.lstat(canonicalRoot);
    if (
      !rootStats.isDirectory() ||
      rootStats.isSymbolicLink() ||
      rootStats.dev !== configuredStats.dev ||
      rootStats.ino !== configuredStats.ino
    ) {
      throw new StudioProjectReadErrorV2('storage');
    }
    const record = await readBoundedRegularFileWithIdentity({
      fs: recordFs,
      canonicalRoot,
      file: path.join(canonicalRoot, 'project.json'),
      maxBytes: STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
    });
    if (record === null) throw new StudioProjectReadErrorV2('storage');
    const finalRootStats = await recordFs.lstat(canonicalRoot);
    if (
      !finalRootStats.isDirectory() ||
      finalRootStats.isSymbolicLink() ||
      finalRootStats.dev !== rootStats.dev ||
      finalRootStats.ino !== rootStats.ino
    ) {
      throw new StudioProjectReadErrorV2('storage');
    }
    let raw: unknown;
    try {
      raw = JSON.parse(record.bytes) as unknown;
    } catch {
      throw new StudioProjectReadErrorV2('invalid');
    }
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, 'schemaVersion');
      if (descriptor !== undefined && 'value' in descriptor && descriptor.value === 1) {
        throw new StudioProjectReadErrorV2('unsupported_prototype_schema');
      }
    }
    if (!validateStudioProjectV2(raw) || raw.id !== config.projectId) {
      throw new StudioProjectReadErrorV2('invalid');
    }
    return {
      project: raw,
      canonicalRoot,
      rootIdentity: { dev: rootStats.dev, ino: rootStats.ino },
      fileIdentity: record.identity,
      bytes: record.bytes,
    };
  } catch (error) {
    if (error instanceof StudioProjectReadErrorV2) throw error;
    throw new StudioProjectReadErrorV2('storage');
  }
};

const reassertProjectSnapshotV2 = async (config: StudioServerEnv, snapshot: StudioProjectSnapshotV2): Promise<void> => {
  const recordFs = config.fs ?? nodeFs;
  try {
    const configuredRoot = path.resolve(config.projectDir);
    const configuredStats = await recordFs.lstat(configuredRoot);
    if (
      !configuredStats.isDirectory() ||
      configuredStats.isSymbolicLink() ||
      configuredStats.dev !== snapshot.rootIdentity.dev ||
      configuredStats.ino !== snapshot.rootIdentity.ino ||
      (await recordFs.realpath(configuredRoot)) !== snapshot.canonicalRoot
    ) {
      throw new StudioProjectReadErrorV2('storage');
    }
    const rootStats = await recordFs.lstat(snapshot.canonicalRoot);
    if (
      !rootStats.isDirectory() ||
      rootStats.isSymbolicLink() ||
      rootStats.dev !== snapshot.rootIdentity.dev ||
      rootStats.ino !== snapshot.rootIdentity.ino
    ) {
      throw new StudioProjectReadErrorV2('storage');
    }
    const record = await readBoundedRegularFileWithIdentity({
      fs: recordFs,
      canonicalRoot: snapshot.canonicalRoot,
      file: path.join(snapshot.canonicalRoot, 'project.json'),
      maxBytes: STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
    });
    if (
      record === null ||
      record.identity.dev !== snapshot.fileIdentity.dev ||
      record.identity.ino !== snapshot.fileIdentity.ino ||
      record.bytes !== snapshot.bytes
    ) {
      throw new StudioProjectReadErrorV2('storage');
    }
  } catch (error) {
    if (error instanceof StudioProjectReadErrorV2) throw error;
    throw new StudioProjectReadErrorV2('storage');
  }
};

const projectSnapshotStatusV2 = async (
  config: StudioServerEnv,
  snapshot: StudioProjectSnapshotV2
): Promise<'valid' | 'unsupported_prototype_schema' | 'invalid'> => {
  try {
    await reassertProjectSnapshotV2(config, snapshot);
    return 'valid';
  } catch {
    try {
      const current = await readProjectSnapshotV2(config);
      if (
        current.canonicalRoot !== snapshot.canonicalRoot ||
        current.rootIdentity.dev !== snapshot.rootIdentity.dev ||
        current.rootIdentity.ino !== snapshot.rootIdentity.ino
      ) {
        return 'invalid';
      }
      // A normal atomic V2 commit replaces project.json's inode. The queued record retains the
      // original base revision, so main's CAS remains the authority that rejects stale work.
      return current.project.revision >= snapshot.project.revision ? 'valid' : 'invalid';
    } catch (error) {
      return error instanceof StudioProjectReadErrorV2 && error.code === 'unsupported_prototype_schema'
        ? 'unsupported_prototype_schema'
        : 'invalid';
    }
  }
};

const assertProjectSnapshotStatusV2 = async (
  config: StudioServerEnv,
  snapshot: StudioProjectSnapshotV2
): Promise<void> => {
  const status = await projectSnapshotStatusV2(config, snapshot);
  if (status === 'valid') return;
  throw new StudioProjectReadErrorV2(status === 'unsupported_prototype_schema' ? status : 'invalid');
};

const readProjectV2 = async (config: StudioServerEnv): Promise<StudioProjectV2> =>
  (await readProjectSnapshotV2(config)).project;

export function createReadStoryboardHandler(
  config: StudioServerEnv | null
): (_input: Record<string, never>) => Promise<StudioToolResult> {
  return async () => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    try {
      const project = await readProject(config);
      const scenes = Object.fromEntries(
        project.sceneOrder.flatMap((sceneId) => {
          const scene = project.scenes[sceneId];
          if (!scene) return [];
          const takes = projectSceneTakes(project, scene);
          return [
            [
              sceneId,
              {
                title: scene.title,
                purpose: scene.purpose,
                visualPrompt: scene.visualPrompt,
                narration: scene.narration,
                onScreenText: scene.onScreenText,
                mediaKind: scene.mediaKind,
                durationSeconds: scene.durationSeconds,
                referenceAssetId: scene.referenceAssetId,
                hasReference: scene.referenceAssetId !== null,
                hasSelectedTake: takes.selectedTakeId !== null,
                selectedTakeId: takes.selectedTakeId,
                availableTakeIds: takes.availableTakeIds,
              },
            ],
          ];
        })
      );
      // Rule ids are not exposed: the Director never addresses a rule by id, and an id in the
      // context is one more thing it can hallucinate back at us. Text is the handle.
      const rules = resolveEffectiveStudioRules(project.rules).map((rule) => ({
        scope: rule.scope,
        text: rule.text,
        enforced: rule.predicate !== null,
        ...(rule.predicate === null ? {} : { forbiddenTerms: rule.predicate.terms }),
      }));
      const briefReferences = (resolveActiveStudioBriefReferences(project.assets) ?? []).map((asset) => ({
        id: asset.id,
        label: asset.briefReferenceLabel!,
        role: asset.briefReferenceRole!,
      }));
      const view = {
        revision: project.revision,
        name: project.name,
        brief: project.brief,
        briefReferences,
        rules,
        aspectRatio: project.aspectRatio,
        targetDurationSeconds: project.targetDurationSeconds,
        sceneCapacity: {
          current: project.sceneOrder.length,
          maximum: STUDIO_MAX_SCENES,
          remaining: Math.max(0, STUDIO_MAX_SCENES - project.sceneOrder.length),
          overCapacity: project.sceneOrder.length > STUDIO_MAX_SCENES,
        },
        sceneOrder: project.sceneOrder,
        scenes,
      };
      return { content: [{ type: 'text', text: JSON.stringify(view, null, 2) }] };
    } catch (error) {
      return errorResult(
        `Creative Studio project is unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

/** Staged Section/Clip projection; the registered schema-1 handler remains active through Gate 1. */
export function createReadStoryboardHandlerV2(
  config: StudioServerEnv | null
): (_input: Record<string, never>) => Promise<StudioToolResult> {
  return async () => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    try {
      const snapshot = await readProjectSnapshotV2(config);
      const project = snapshot.project;
      // readProjectV2 has already proved that every active id resolves to its exact own record.
      const beats = Object.fromEntries(
        project.sectionOrder.map((beatId) => {
          const beat = project.sections[beatId]!;
          return [
            beatId,
            {
              title: beat.title,
              storyLine: beat.storyLine,
              visualPrompt: beat.visualPrompt,
              clipOrder: [...beat.clipOrder],
            },
          ];
        })
      );
      const activeShotIds = project.sectionOrder.flatMap((beatId) => project.sections[beatId]!.clipOrder);
      const shots = Object.fromEntries(
        activeShotIds.map((shotId) => {
          const shot = project.clips[shotId]!;
          const takes = projectShotTakesV2(project, shot);
          return [
            shotId,
            {
              shotPrompt: shot.shotPrompt,
              narration: shot.narration,
              onScreenText: shot.onScreenText,
              mediaKind: shot.mediaKind,
              durationSeconds: shot.durationSeconds,
              referenceAssetId: shot.referenceAssetId,
              hasReference: shot.referenceAssetId !== null,
              hasSelectedTake: takes.selectedTakeId !== null,
              selectedTakeId: takes.selectedTakeId,
              availableTakeIds: takes.availableTakeIds,
            },
          ];
        })
      );
      const rules = resolveEffectiveStudioRules(project.rules).map((rule) => ({
        scope: rule.scope,
        text: rule.text,
        enforced: rule.predicate !== null,
        ...(rule.predicate === null ? {} : { forbiddenTerms: rule.predicate.terms }),
      }));
      const briefReferences = Object.values(project.assets)
        .filter(
          (asset) =>
            asset.clipId === null && asset.briefReferenceRole !== undefined && asset.briefReferenceLabel !== undefined
        )
        .toSorted(
          (left, right) =>
            Number(left.briefReferenceRole === 'look') - Number(right.briefReferenceRole === 'look') ||
            compareCodeUnits(left.createdAt, right.createdAt) ||
            compareCodeUnits(left.id, right.id)
        )
        .map((asset) => ({ id: asset.id, label: asset.briefReferenceLabel!, role: asset.briefReferenceRole! }));
      const beatCount = Object.keys(project.sections).length;
      const view = {
        revision: project.revision,
        name: project.name,
        brief: project.brief,
        briefReferences,
        rules,
        aspectRatio: project.aspectRatio,
        targetDurationSeconds: project.targetDurationSeconds,
        sectionCapacity: {
          current: beatCount,
          maximum: STUDIO_MAX_BEATS,
          remaining: Math.max(0, STUDIO_MAX_BEATS - beatCount),
          overCapacity: beatCount > STUDIO_MAX_BEATS,
        },
        sectionOrder: [...project.sectionOrder],
        sections: beats,
        clips: shots,
        shelf: project.shelf.map((item) => ({ ...item })),
      };
      return { content: [{ type: 'text', text: JSON.stringify(view, null, 2) }] };
    } catch (error) {
      return errorResult(`Creative Studio project is unavailable: ${describeError(error)}`);
    }
  };
}

export function createListRoutesHandler(
  config: StudioServerEnv | null
): (_input: Record<string, never>) => Promise<StudioToolResult> {
  return async () => {
    if (!config?.routeCatalog) return errorResult('Creative Studio route catalog is unavailable.');
    return { content: [{ type: 'text', text: JSON.stringify(config.routeCatalog, null, 2) }] };
  };
}

export function createProposeStoryboardHandler(
  config: StudioServerEnv | null
): (input: ProposeStoryboardInput) => Promise<StudioToolResult> {
  return async ({ base_revision, scene_order, scenes }) => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    const sceneIds = Object.keys(scenes);
    const orderSet = new Set(scene_order);
    if (scene_order.length > STUDIO_MAX_SCENES) {
      return errorResult(`At most ${STUDIO_MAX_SCENES} scenes may be proposed at once.`);
    }
    if (
      orderSet.size !== scene_order.length ||
      sceneIds.length !== scene_order.length ||
      !sceneIds.every((sceneId) => orderSet.has(sceneId))
    ) {
      return errorResult('scene_order and scenes must contain exactly the same unique scene ids.');
    }

    try {
      const project = await readProject(config);
      if (project.revision !== base_revision) {
        return errorResult(
          `The project is at revision ${project.revision}; you proposed against ${base_revision}. ` +
            'Call read_storyboard and redraft.'
        );
      }
      const record = await writeProposalRecord({
        pendingDir: config.pendingDir,
        projectId: config.projectId,
        baseRevision: base_revision,
        payload: { kind: 'replace_storyboard', sceneOrder: scene_order, scenes },
      });
      return {
        content: [
          {
            type: 'text',
            text: `Proposal ${record.id} recorded for user review; the user decides what happens next.`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof StudioProposalWriteError) return errorResult(error.message);
      return errorResult(
        `Creative Studio proposal could not be recorded: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

export function createProposeStoryboardHandlerV2(
  config: StudioServerEnv | null
): (input: ProposeStoryboardInputV2) => Promise<StudioToolResult> {
  return async ({ base_revision, operations }) => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    try {
      const snapshot = await readProjectSnapshotV2(config);
      const project = snapshot.project;
      if (project.revision !== base_revision) {
        return errorResult(
          `The project is at revision ${project.revision}; you proposed against ${base_revision}. ` +
            'Call read_storyboard and redraft.'
        );
      }
      await assertProjectSnapshotStatusV2(config, snapshot);
      const record = await writeProposalRecordV2({
        pendingDir: config.pendingDir,
        projectId: config.projectId,
        baseRevision: base_revision,
        payload: { kind: 'mutation_batch', operations },
        fs: config.fs,
        authorityFence: () => projectSnapshotStatusV2(config, snapshot),
        projectAuthority: pendingProjectAuthorityV2(snapshot),
      });
      return {
        content: [
          {
            type: 'text',
            text: `Proposal ${record.id} recorded for user review; the user decides what happens next.`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof StudioProposalWriteError) return errorResult(error.message);
      return errorResult(`Creative Studio proposal could not be recorded: ${describeError(error)}`);
    }
  };
}

/**
 * Records a rule for the user to pin. The tool never writes the project: main is the sole writer of
 * the CAS-guarded store, and the user decides.
 *
 * Every limit here is the store's limit, not this tool's preference. The record goes straight to the
 * pending directory and is validated only when the store reads it back, so a field this schema
 * admits and `validateBriefRulePredicate` refuses is written to disk, reported to the Director as
 * "recorded for user review", and then dropped on read with nothing but a log line — see the
 * warning above STUDIO_EDITABLE_SCENE_LIMITS, which `purpose` learned the hard way.
 */
export function createProposeBriefRuleHandler(
  config: StudioServerEnv | null
): (input: ProposeBriefRuleInput) => Promise<StudioToolResult> {
  return async ({ base_revision, text, forbidden_terms }) => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    const trimmed = text.trim();
    if (trimmed.length === 0) return errorResult('A rule needs text.');
    if (trimmed.length > STUDIO_RULE_LIMITS.text) {
      return errorResult(`A rule must be at most ${STUDIO_RULE_LIMITS.text} characters.`);
    }
    const terms = forbidden_terms.map((term) => term.trim()).filter((term) => term.length > 0);
    if (new Set(terms).size !== terms.length) return errorResult('forbidden_terms must not repeat a word.');
    const unenforceableTerm = terms.find((term) => !hasRuleToken(term));
    if (unenforceableTerm !== undefined) {
      return errorResult(`forbidden_terms contains an unenforceable term: "${unenforceableTerm}".`);
    }
    try {
      const project = await readProject(config);
      if (project.revision !== base_revision) {
        return errorResult(
          `The project is at revision ${project.revision}; you proposed against ${base_revision}. ` +
            'Call read_storyboard and redraft.'
        );
      }
      // `project.rules` is always an array here because Step 4.2 normalised it inside readProject.
      // Without that, a manifest written before rules existed throws on `.length` and this tool
      // reports the project as unavailable — do not reorder Task 4 after Task 6.
      if (project.rules.length >= STUDIO_RULE_LIMITS.maxRules) {
        return errorResult(`This project already holds the maximum of ${STUDIO_RULE_LIMITS.maxRules} rules.`);
      }
      const record = await writeProposalRecord({
        pendingDir: config.pendingDir,
        projectId: config.projectId,
        baseRevision: base_revision,
        payload: {
          kind: 'pin_rule',
          rule: { text: trimmed, predicate: terms.length === 0 ? null : { kind: 'forbidden_terms', terms } },
        },
      });
      return {
        content: [
          {
            type: 'text',
            text: `Rule ${record.id} recorded for user review; nothing is pinned until the user accepts it.`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof StudioProposalWriteError) return errorResult(error.message);
      return errorResult(
        `Creative Studio rule could not be recorded: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

export function createProposeBriefRuleHandlerV2(
  config: StudioServerEnv | null
): (input: ProposeBriefRuleInput) => Promise<StudioToolResult> {
  return async ({ base_revision, text, forbidden_terms }) => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    const trimmed = text.trim();
    if (trimmed.length === 0) return errorResult('A rule needs text.');
    if (trimmed.length > STUDIO_RULE_LIMITS.text) {
      return errorResult(`A rule must be at most ${STUDIO_RULE_LIMITS.text} characters.`);
    }
    const terms = forbidden_terms.map((term) => term.trim()).filter((term) => term.length > 0);
    if (new Set(terms).size !== terms.length) return errorResult('forbidden_terms must not repeat a word.');
    const unenforceableTerm = terms.find((term) => !hasRuleToken(term));
    if (unenforceableTerm !== undefined) {
      return errorResult(`forbidden_terms contains an unenforceable term: "${unenforceableTerm}".`);
    }
    try {
      const snapshot = await readProjectSnapshotV2(config);
      const project = snapshot.project;
      if (project.revision !== base_revision) {
        return errorResult(
          `The project is at revision ${project.revision}; you proposed against ${base_revision}. ` +
            'Call read_storyboard and redraft.'
        );
      }
      if (project.rules.length >= STUDIO_RULE_LIMITS.maxRules) {
        return errorResult(`This project already holds the maximum of ${STUDIO_RULE_LIMITS.maxRules} rules.`);
      }
      await assertProjectSnapshotStatusV2(config, snapshot);
      const record = await writeProposalRecordV2({
        pendingDir: config.pendingDir,
        projectId: config.projectId,
        baseRevision: base_revision,
        payload: {
          kind: 'pin_rule',
          rule: { text: trimmed, predicate: terms.length === 0 ? null : { kind: 'forbidden_terms', terms } },
        },
        fs: config.fs,
        authorityFence: () => projectSnapshotStatusV2(config, snapshot),
        projectAuthority: pendingProjectAuthorityV2(snapshot),
      });
      return {
        content: [
          {
            type: 'text',
            text: `Rule ${record.id} recorded for user review; nothing is pinned until the user accepts it.`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof StudioProposalWriteError) return errorResult(error.message);
      return errorResult(`Creative Studio rule could not be recorded: ${describeError(error)}`);
    }
  };
}

export function createRequestReferenceImagesHandler(
  config: StudioServerEnv | null
): (input: { sceneIds: string[] }) => Promise<StudioToolResult> {
  return async ({ sceneIds }) => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    if (!Array.isArray(sceneIds)) return errorResult('sceneIds must be an array.');
    if (sceneIds.length < 1) return errorResult('At least one scene id is required.');
    if (sceneIds.length > STUDIO_MAX_REFERENCE_REQUEST_SCENES) {
      return errorResult(`At most ${STUDIO_MAX_REFERENCE_REQUEST_SCENES} scene ids may be requested at once.`);
    }
    const invalidSceneIds = sceneIds.filter((sceneId) => !SAFE_ID.test(sceneId));
    if (invalidSceneIds.length > 0) return errorResult(`Invalid scene ids: ${invalidSceneIds.join(', ')}`);
    const duplicateSceneIds = sceneIds.filter((sceneId, index) => sceneIds.indexOf(sceneId) !== index);
    if (duplicateSceneIds.length > 0) {
      return errorResult(`Duplicate scene ids: ${[...new Set(duplicateSceneIds)].join(', ')}`);
    }
    try {
      const project = await readProject(config);
      const unknownSceneIds = sceneIds.filter((sceneId) => project.scenes[sceneId] === undefined);
      if (unknownSceneIds.length > 0) return errorResult(`Unknown scenes: ${unknownSceneIds.join(', ')}`);
      const pendingSceneIds = await listPendingReferenceRequestSceneIds(config.referencePendingDir, config.projectId);
      const alreadyQueued = sceneIds.filter((sceneId) => pendingSceneIds.has(sceneId));
      const scenesToQueue = sceneIds.filter((sceneId) => !pendingSceneIds.has(sceneId));
      const results = await Promise.allSettled(
        scenesToQueue.map((sceneId) =>
          writeReferenceRequestRecord({
            pendingDir: config.referencePendingDir,
            projectId: config.projectId,
            sceneId,
          })
        )
      );
      const queued = results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.flatMap((result, index) =>
        result.status === 'rejected'
          ? [
              `${scenesToQueue[index]} failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
            ]
          : []
      );
      const details = [
        `Queued ${queued} of ${sceneIds.length} reference image request(s) for user approval`,
        ...(alreadyQueued.length > 0 ? [`Already queued: ${alreadyQueued.join(', ')}`] : []),
        ...failed,
        'Nothing was generated',
      ];
      const result = { content: [{ type: 'text' as const, text: `${details.join('. ')}.` }] };
      return failed.length > 0 ? { ...result, isError: true } : result;
    } catch (error) {
      if (error instanceof StudioPendingRecordWriteError) return errorResult(error.message);
      return errorResult(
        `Reference requests could not be recorded: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

export function createRequestReferenceImagesHandlerV2(
  config: StudioServerEnv | null
): (input: { clipIds: string[] }) => Promise<StudioToolResult> {
  return async ({ clipIds: shotIds }) => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    if (!Array.isArray(shotIds)) return errorResult('clipIds must be an array.');
    if (shotIds.length < 1) return errorResult('At least one clip id is required.');
    if (shotIds.length > STUDIO_MAX_REFERENCE_REQUEST_SHOTS) {
      return errorResult(`At most ${STUDIO_MAX_REFERENCE_REQUEST_SHOTS} clip ids may be requested at once.`);
    }
    const invalidShotIds = shotIds.filter((shotId) => !studioDirectorIdSchema.safeParse(shotId).success);
    if (invalidShotIds.length > 0) return errorResult(`Invalid clip ids: ${invalidShotIds.join(', ')}`);
    const duplicateShotIds = shotIds.filter((shotId, index) => shotIds.indexOf(shotId) !== index);
    if (duplicateShotIds.length > 0) {
      return errorResult(`Duplicate clip ids: ${[...new Set(duplicateShotIds)].join(', ')}`);
    }
    try {
      const snapshot = await readProjectSnapshotV2(config);
      const project = snapshot.project;
      const activeShotIds = new Set(project.sectionOrder.flatMap((beatId) => project.sections[beatId]!.clipOrder));
      const unknownShotIds = shotIds.filter((shotId) => !activeShotIds.has(shotId));
      if (unknownShotIds.length > 0) return errorResult(`Unknown or inactive clips: ${unknownShotIds.join(', ')}`);
      const projectAuthority = pendingProjectAuthorityV2(snapshot);
      await assertPendingRecordProjectAuthorityV2({
        pendingDir: config.referencePendingDir,
        projectAuthority,
        fs: config.fs,
      });
      const pendingShotIds = await listPendingReferenceRequestShotIdsV2(
        config.referencePendingDir,
        config.projectId,
        config.fs,
        projectAuthority
      );
      const alreadyQueued = shotIds.filter((shotId) => pendingShotIds.has(shotId));
      const shotsToQueue = shotIds.filter((shotId) => !pendingShotIds.has(shotId));
      if (shotsToQueue.length > 0) {
        await assertProjectSnapshotStatusV2(config, snapshot);
        await writeReferenceRequestRecordV2({
          pendingDir: config.referencePendingDir,
          projectId: config.projectId,
          clipIds: shotsToQueue,
          fs: config.fs,
          authorityFence: () => projectSnapshotStatusV2(config, snapshot),
          projectAuthority,
        });
      }
      const details = [
        `Queued ${shotsToQueue.length} of ${shotIds.length} reference image request(s) for user approval`,
        ...(alreadyQueued.length > 0 ? [`Already queued: ${alreadyQueued.join(', ')}`] : []),
        'Nothing was generated',
      ];
      return { content: [{ type: 'text', text: `${details.join('. ')}.` }] };
    } catch (error) {
      if (error instanceof StudioPendingRecordWriteError) return errorResult(error.message);
      return errorResult(`Reference requests could not be recorded: ${describeError(error)}`);
    }
  };
}

const commandToolResult = (value: unknown): StudioToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

export function createStudioApplyEditsHandler(
  config: StudioServerEnv | null,
  deps: StudioDirectorCommandWriterDeps = {}
): (input: StudioApplyEditsInput) => Promise<StudioToolResult> {
  const writer = createStudioDirectorCommandWriter(
    config === null ? null : { projectId: config.projectId, projectDir: config.projectDir },
    deps
  );
  return async (input) => commandToolResult(await writer.apply(input));
}

export function createStudioGetCommandStatusHandler(
  config: StudioServerEnv | null,
  deps: StudioDirectorCommandWriterDeps = {}
): (input: StudioGetCommandStatusInput) => Promise<StudioToolResult> {
  const writer = createStudioDirectorCommandWriter(
    config === null ? null : { projectId: config.projectId, projectDir: config.projectDir },
    deps
  );
  return async (input) => commandToolResult(await writer.getStatus(input));
}

export function createStudioApplyEditsHandlerV2(
  config: StudioServerEnv | null,
  deps: StudioDirectorCommandWriterDeps = {}
): (input: StudioApplyEditsInputV2) => Promise<StudioToolResult> {
  const writer = createStudioDirectorCommandWriterV2(
    config === null ? null : { projectId: config.projectId, projectDir: config.projectDir },
    deps
  );
  return async (input) => commandToolResult(await writer.apply(input));
}

export function createStudioGetCommandStatusHandlerV2(
  config: StudioServerEnv | null,
  deps: StudioDirectorCommandWriterDeps = {}
): (input: StudioGetCommandStatusInput) => Promise<StudioToolResult> {
  const writer = createStudioDirectorCommandWriterV2(
    config === null ? null : { projectId: config.projectId, projectDir: config.projectDir },
    deps
  );
  return async (input) => commandToolResult(await writer.getStatus(input));
}

export function registerStudioTools(
  server: Pick<McpServer, 'tool' | 'registerTool'>,
  config: StudioServerEnv | null,
  writerDeps: StudioDirectorCommandWriterDeps = {}
): void {
  server.tool(
    'studio_list_routes',
    "Read the generation routes available to this project, with their constraints. Call this before proposing scene durations: a scene shorter than the video route's minDurationSeconds cannot be produced. Never assume a limit; read it.",
    {},
    createListRoutesHandler(config)
  );
  server.tool(
    'read_storyboard',
    "Read this project's brief, sanitized Cast/Look references, governing rules and current script: revision, settings, brief prose, pinned rules, and every scene's editable fields plus its concrete referenceAssetId and whether it has a selected take. Read this BEFORE you draft a script, critique one, propose any change, or answer any question about what this project may or may not show — do not answer from memory. The brief prose is not carried in your context; it lives here, and this call is the freshest and authoritative copy of both the brief and the rules. A rule marked enforced is checked against every visual prompt before anything is generated: a prompt that breaks one is refused and nothing is charged, so satisfy the rules while you write the prompt rather than after it is refused.",
    {},
    createReadStoryboardHandler(config)
  );
  server.tool(
    'studio_request_reference_images',
    'Request a supporting reference image for one or more scenes. This does NOT generate anything — it queues a request the user approves before any money is spent. One image per scene; do not request a scene that already has one unless the user asked you to replace it.',
    { sceneIds: z.array(z.string().regex(SAFE_ID)).min(1).max(STUDIO_MAX_REFERENCE_REQUEST_SCENES) },
    createRequestReferenceImagesHandler(config)
  );
  server.tool(
    'propose_storyboard',
    'Record a complete replacement script as a proposal the user reviews in Brief. Requires base_revision from your latest read_storyboard. The proposal is a whole-script replacement: include EVERY scene you want to keep, not only changes.',
    {
      base_revision: z
        .number()
        .int()
        .positive()
        .describe('The revision you saw in read_storyboard. Re-read if your last read is stale.'),
      scene_order: z.array(z.string().regex(SAFE_ID)).min(1).max(STUDIO_MAX_SCENES),
      scenes: z.record(z.string().regex(SAFE_ID), editableSceneSchema),
    },
    createProposeStoryboardHandler(config)
  );
  server.tool(
    'propose_brief_rule',
    'Record one project rule for the user to pin. Use it when the user states a standing constraint ("keep the kits generic", "never show a competitor logo") — offer to pin it, then call this. Requires base_revision from your latest read_storyboard. A rule with forbidden_terms is ENFORCED: main refuses any visual prompt containing one of those words before anything is generated, so only list words that must never appear. Leave forbidden_terms empty for a rule that is guidance you should follow but nothing can check. Offer ONE rule per turn: two rules recorded against the same base_revision cannot both be accepted, because accepting the first moves the project past the revision the second was drafted against. If the user states several constraints at once, record the most important one and offer the rest after they answer. This pins nothing on its own; the user decides.',
    {
      base_revision: z
        .number()
        .int()
        .positive()
        .describe('The revision you saw in read_storyboard. Re-read if your last read is stale.'),
      text: z
        .string()
        .min(1)
        .max(STUDIO_RULE_LIMITS.text)
        .describe('One sentence, in the user’s own words where possible.'),
      forbidden_terms: z
        .array(z.string().min(1).max(STUDIO_RULE_LIMITS.term))
        .max(STUDIO_RULE_LIMITS.maxTerms)
        .describe('Words that must never appear in a visual prompt. Empty for an unenforced rule.'),
    },
    createProposeBriefRuleHandler(config)
  );
  server.registerTool(
    'studio_apply_edits',
    {
      description:
        'Read the current revision first with read_storyboard, then apply one bounded ordered batch of free edits to that exact revision. Use this direct patch contract, not legacy whole-project base_revision/scene_order/scenes: {"expectedRevision":8,"operations":[{"kind":"set_brief","brief":"..."},{"kind":"edit_scene","sceneId":"scene_1","changes":{"title":"..."}},{"kind":"reorder_scenes","sceneOrder":["scene_2","scene_1"]}]}. This never starts paid generation. Validation errors and unconfirmed results must not be retried; for unconfirmed, call studio_get_command_status with the returned commandId.',
      inputSchema: studioApplyEditsInputSchema,
    },
    createStudioApplyEditsHandler(config, writerDeps)
  );
  server.registerTool(
    'studio_get_command_status',
    {
      description:
        'Read the exact durable or pending status for one commandId. Unconfirmed and indeterminate outcomes must not be retried. For indeterminate, reread canonical state, report uncertainty, and await explicit user direction.',
      inputSchema: studioGetCommandStatusInputSchema,
    },
    createStudioGetCommandStatusHandler(config, writerDeps)
  );
}

/**
 * Staged schema-2 tool set for direct contract tests. Gate 1 deliberately leaves `main()` registered
 * with `registerStudioTools`; Task 6 performs the atomic runtime cutover.
 */
export function registerStudioToolsV2(
  server: Pick<McpServer, 'registerTool'>,
  config: StudioServerEnv | null,
  writerDeps: StudioDirectorCommandWriterDeps = {}
): void {
  server.registerTool(
    'studio_list_routes',
    {
      description:
        'Read the generation routes available to this project and their constraints before drafting clip durations.',
      inputSchema: z.object({}).strict(),
    },
    createListRoutesHandler(config)
  );
  server.registerTool(
    'read_storyboard',
    {
      description:
        'Read the authoritative schema-2 Section/Clip storyboard, shelf, rules, references, selected takes, and bounded available take ids before proposing changes.',
      inputSchema: z.object({}).strict(),
    },
    createReadStoryboardHandlerV2(config)
  );
  server.registerTool(
    'studio_request_reference_images',
    {
      description:
        'Request supporting reference images for ordered active clip ids. This only records a request for user approval and never starts paid generation.',
      inputSchema: studioRequestReferenceImagesInputSchemaV2,
    },
    createRequestReferenceImagesHandlerV2(config)
  );
  server.registerTool(
    'propose_storyboard',
    {
      description:
        'Record one ordered schema-2 mutation batch for user review. Requires base_revision from read_storyboard and never applies or generates anything directly. Do not combine add_clip with reorder_clips for the same section (different-section pairs are valid), and keep the final serialized proposal record within 256 KiB; these two aggregate checks are enforced by the server before any ID or I/O because portable tools/list JSON Schema cannot encode them.',
      inputSchema: studioProposeStoryboardInputSchemaV2,
    },
    createProposeStoryboardHandlerV2(config)
  );
  server.registerTool(
    'propose_brief_rule',
    {
      description:
        'Record one project rule for user review against the latest base_revision. This does not mutate the project.',
      inputSchema: z
        .object({
          base_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          text: z.string().min(1).max(STUDIO_RULE_LIMITS.text),
          forbidden_terms: z.array(z.string().min(1).max(STUDIO_RULE_LIMITS.term)).max(STUDIO_RULE_LIMITS.maxTerms),
        })
        .strict(),
    },
    createProposeBriefRuleHandlerV2(config)
  );
  server.registerTool(
    'studio_apply_edits',
    {
      description:
        'Read the current revision first, then apply one bounded ordered batch of free Section/Clip edits to that exact revision. Canonical schema-2 batch: {"expectedRevision":8,"operations":[{"kind":"set_brief","brief":"..."},{"kind":"edit_section","sectionId":"section_1","changes":{"title":"..."}},{"kind":"edit_clip","clipId":"clip_1","changes":{"shotPrompt":"..."}},{"kind":"reorder_sections","sectionOrder":["section_2","section_1"]}]}. This never starts paid generation. Do not combine add_clip with reorder_clips for the same section (different-section pairs are valid), and keep the final serialized command record within 256 KiB; these two aggregate checks are enforced by the server before any ID or I/O because portable tools/list JSON Schema cannot encode them. Validation errors and unconfirmed results must not be retried; call studio_get_command_status for an unconfirmed commandId.',
      inputSchema: studioApplyEditsInputSchemaV2,
    },
    createStudioApplyEditsHandlerV2(config, writerDeps)
  );
  server.registerTool(
    'studio_get_command_status',
    {
      description:
        'Read the exact durable or pending schema-2 status for one commandId. Unsupported, unconfirmed, and indeterminate outcomes must not be retried.',
      inputSchema: studioGetCommandStatusInputSchemaV2,
    },
    createStudioGetCommandStatusHandlerV2(config, writerDeps)
  );
}

async function main() {
  const config = parseStudioServerEnv(process.env);
  const server = new McpServer({ name: BUILTIN_STUDIO_NAME, version: '1.0.0' });
  registerStudioTools(server, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only start the stdio loop when executed as the bundle entry, so importing
// handlers from tests does not boot a server. The typeof guard matters under
// vitest's ESM transform, where a bare `require` reference throws.
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((error) => {
    console.error('[StudioMCP] Fatal error:', error);
    process.exit(1);
  });
}
