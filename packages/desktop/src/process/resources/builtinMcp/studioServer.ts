/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Built-in MCP server for one Creative Studio project. This subprocess can
// read a bounded script view and write durable approval-queue records. It never
// writes project.json; the main-process store remains the sole project writer.

import { promises as nodeFs } from 'node:fs';
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
import {
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SHOT,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_REFERENCE_REQUEST_SHOTS,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_BIN_BEAT_ITEMS,
  STUDIO_MAX_BIN_SHOT_ITEMS,
  STUDIO_MAX_BIN_TAKE_ITEMS,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_DIRECTOR_COMMAND_MAX_OPERATIONS,
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioDirectorOperationV2,
  type StudioShot,
  type StudioMutationOperationV2,
  type StudioProjectV2,
  type StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import { BUILTIN_STUDIO_NAME } from '@process/resources/builtinMcp/constants';
import { StudioProposalWriteError, writeProposalRecordV2 } from '@process/resources/builtinMcp/studioProposalWriter';
import {
  listPendingReferenceRequestShotIdsV2,
  writeReferenceRequestRecordV2,
} from '@process/resources/builtinMcp/studioReferenceRequestWriter';
import {
  assertPendingRecordProjectAuthorityV2,
  StudioPendingRecordWriteError,
  type StudioPendingProjectAuthorityV2,
} from '@process/resources/builtinMcp/studioPendingRecordWriter';
import {
  createStudioDirectorCommandWriterV2,
  studioDirectorToolInputFitsDurableRecordV2,
  type StudioApplyEditsInputV2,
  type StudioDirectorCommandWriterDeps,
  type StudioGetCommandStatusInput,
} from '@process/resources/builtinMcp/studioDirectorCommandWriter';
import { validateStudioProjectV2 } from '@process/services/creative-studio/service/schema2';
import {
  classifyStudioDirectorOperationV2,
  type StudioDirectorOperationDispositionV2,
} from '@process/services/creative-studio/service/directorCommandContracts';
import {
  type RecordIoFileSystem,
  readBoundedRegularFileWithIdentity,
} from '@process/services/creative-studio/service/recordIo';

export type StudioServerEnv = {
  projectId: string;
  projectDir: string;
  pendingDir: string;
  referencePendingDir: string;
  routeCatalog?: StudioRouteCatalogV2 | null;
  /** V2-only deterministic filesystem seam; environment parsing leaves it undefined. */
  fs?: RecordIoFileSystem;
};

export type StudioToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
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
    shot.selectedTakeId !== null && canonicalTakeIds.includes(shot.selectedTakeId) ? shot.selectedTakeId : null;
  return {
    selectedTakeId,
    availableTakeIds: [
      ...(selectedTakeId === null ? [] : [selectedTakeId]),
      ...canonicalTakeIds.filter((assetId) => assetId !== selectedTakeId),
    ].slice(0, STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SHOT),
  };
};

const studioDirectorIdSchemaV2 = z4.string().min(1).max(256).regex(SAFE_ID);
const studioProjectNameSchemaV2 = z4
  .string()
  .max(256)
  .refine((name) => name.trim().length > 0, { message: 'Project name must not be blank.' });
const studioEditableProjectChangesFieldsV2 = {
  name: studioProjectNameSchemaV2,
  aspectRatio: z4.enum(['16:9', '9:16', '1:1', '4:3', '3:4']),
  resolution: z4.enum(['720p', '1080p']),
  targetDurationSeconds: z4.number().int().min(5).max(1440),
};
const studioEditableProjectChangesSchemaV2 = z4.union([
  z4.object(studioEditableProjectChangesFieldsV2).partial().required({ name: true }).strict(),
  z4.object(studioEditableProjectChangesFieldsV2).partial().required({ aspectRatio: true }).strict(),
  z4.object(studioEditableProjectChangesFieldsV2).partial().required({ resolution: true }).strict(),
  z4.object(studioEditableProjectChangesFieldsV2).partial().required({ targetDurationSeconds: true }).strict(),
]);
const studioBeatInputSchemaV2 = z4
  .object({
    title: z4.string().max(256),
    action: z4.string().max(4 * 1024),
    look: z4.string().max(8 * 1024),
    targetSeconds: z4.number().int().min(1).max(1440).nullable(),
  })
  .strict();

const studioShotInputSchemaV2 = z4
  .object({
    line: z4.string().max(8 * 1024),
    narration: z4.string().max(4 * 1024),
    onScreenText: z4.string().max(1024),
    durationSeconds: z4.number().int().min(STUDIO_MIN_SHOT_SECONDS).max(STUDIO_MAX_SHOT_SECONDS),
  })
  .strict();

const studioBeatChangesFieldsV2 = {
  title: z4.string().max(256),
  action: z4.string().max(4 * 1024),
  look: z4.string().max(8 * 1024),
  targetSeconds: z4.number().int().min(1).max(1440).nullable(),
};
const studioBeatChangesSchemaV2 = z4.union([
  z4.object(studioBeatChangesFieldsV2).partial().required({ title: true }).strict(),
  z4.object(studioBeatChangesFieldsV2).partial().required({ action: true }).strict(),
  z4.object(studioBeatChangesFieldsV2).partial().required({ look: true }).strict(),
  z4.object(studioBeatChangesFieldsV2).partial().required({ targetSeconds: true }).strict(),
]);

const studioShotChangesFieldsV2 = {
  line: z4.string().max(8 * 1024),
  narration: z4.string().max(4 * 1024),
  onScreenText: z4.string().max(1024),
  durationSeconds: z4.number().int().min(STUDIO_MIN_SHOT_SECONDS).max(STUDIO_MAX_SHOT_SECONDS),
};
const studioShotChangesSchemaV2 = z4.union([
  z4.object(studioShotChangesFieldsV2).partial().required({ line: true }).strict(),
  z4.object(studioShotChangesFieldsV2).partial().required({ narration: true }).strict(),
  z4.object(studioShotChangesFieldsV2).partial().required({ onScreenText: true }).strict(),
  z4.object(studioShotChangesFieldsV2).partial().required({ durationSeconds: true }).strict(),
]);

const studioBinItemSchemaV2 = z4.discriminatedUnion('kind', [
  z4
    .object({
      kind: z4.literal('beat'),
      beatId: studioDirectorIdSchemaV2,
      reason: z4.enum(['lifted', 'alternate']),
    })
    .strict(),
  z4
    .object({
      kind: z4.literal('shot'),
      beatId: studioDirectorIdSchemaV2,
      shotId: studioDirectorIdSchemaV2,
      reason: z4.literal('lifted'),
    })
    .strict(),
  z4
    .object({
      kind: z4.literal('take'),
      assetId: studioDirectorIdSchemaV2,
      reason: z4.enum(['lifted', 'alternate']),
    })
    .strict(),
]);

const studioRuleTermSchemaV2 = z4
  .string()
  .max(STUDIO_RULE_LIMITS.term)
  .refine((term) => term.trim().length > 0 && hasRuleToken(term), {
    message: 'Rule terms must contain an enforceable token.',
  });
const studioRulePredicateSchemaV2 = z4
  .object({
    kind: z4.literal('forbidden_terms'),
    terms: z4
      .array(studioRuleTermSchemaV2)
      .min(1)
      .max(STUDIO_RULE_LIMITS.maxTerms)
      .refine((terms) => new Set(terms).size === terms.length, { message: 'Rule terms must not repeat.' })
      .meta({ uniqueItems: true }),
  })
  .strict();
const studioRuleDraftSchemaV2 = z4
  .object({
    id: studioDirectorIdSchemaV2,
    text: z4
      .string()
      .max(STUDIO_RULE_LIMITS.text)
      .refine((text) => text.trim().length > 0, { message: 'Rule text must not be blank.' }),
    predicate: studioRulePredicateSchemaV2.nullable(),
  })
  .strict();
const studioRuleDraftsSchemaV2 = z4
  .array(studioRuleDraftSchemaV2)
  .max(STUDIO_RULE_LIMITS.maxRules)
  .refine((rules) => new Set(rules.map((rule) => rule.id)).size === rules.length, {
    message: 'Rule ids must not repeat.',
  })
  .meta({ uniqueItems: true });

const STUDIO_FIXED_SHOT_REASONS_V2 = [
  'owned_asset',
  'owned_job',
  'selected_take',
  'seed_still',
  'conditioning_frame',
  'conditioning_input',
  'match_to',
  'narration',
  'on_screen_text',
] as const;
const studioProposedShotSchemaV2 = z4
  .object({
    shotId: studioDirectorIdSchemaV2,
    line: z4.string().max(8 * 1024),
    narration: z4.string().max(4 * 1024),
    onScreenText: z4.string().max(1024),
    durationSeconds: z4.number().int().min(STUDIO_MIN_SHOT_SECONDS).max(STUDIO_MAX_SHOT_SECONDS),
    chainBreak: z4.enum(['none', 'hard_cut']),
  })
  .strict();
const studioFixedShotReviewSchemaV2 = z4
  .object({
    shotId: studioDirectorIdSchemaV2,
    reasons: z4
      .array(z4.enum(STUDIO_FIXED_SHOT_REASONS_V2))
      .min(1)
      .max(STUDIO_FIXED_SHOT_REASONS_V2.length)
      .refine(
        (reasons) =>
          reasons.every(
            (reason, index) =>
              index === 0 ||
              STUDIO_FIXED_SHOT_REASONS_V2.indexOf(reasons[index - 1]!) < STUDIO_FIXED_SHOT_REASONS_V2.indexOf(reason)
          ),
        { message: 'Fixed-shot reasons must be unique and canonically ordered.' }
      ),
  })
  .strict();
const studioFixedShotReviewsSchemaV2 = z4
  .array(studioFixedShotReviewSchemaV2)
  .max(STUDIO_MAX_SHOTS_PER_PROJECT)
  .refine((rows) => new Set(rows.map((row) => row.shotId)).size === rows.length, {
    message: 'Fixed-shot rows must not repeat a shot id.',
  })
  .meta({ uniqueItems: true });

const studioTrimBoundarySchemaV2 = z4
  .number()
  .finite()
  .nonnegative()
  .refine((value) => !Object.is(value, -0), { message: 'Trim boundaries must not be negative zero.' });
const studioSpendPolicySchemaV2 = z4
  .object({
    currency: z4.string().regex(/^[A-Z]{3}$/),
    maxPerBatchMinorUnits: z4.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const uniqueStudioIdsSchema = (maximum: number) =>
  z4
    .array(studioDirectorIdSchemaV2)
    .max(maximum)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Ids must not repeat.' })
    .meta({ uniqueItems: true });

const studioMutationOperationSchemasV2 = {
  editProject: z4.object({ kind: z4.literal('edit_project'), changes: studioEditableProjectChangesSchemaV2 }).strict(),
  setBrief: z4.object({ kind: z4.literal('set_brief'), brief: z4.string().max(16 * 1024) }).strict(),
  setRules: z4.object({ kind: z4.literal('set_rules'), rules: studioRuleDraftsSchemaV2 }).strict(),
  addBeat: z4
    .object({
      kind: z4.literal('add_beat'),
      beatId: studioDirectorIdSchemaV2,
      beat: studioBeatInputSchemaV2,
      beforeBeatId: studioDirectorIdSchemaV2.nullable(),
    })
    .strict(),
  editBeat: z4
    .object({
      kind: z4.literal('edit_beat'),
      beatId: studioDirectorIdSchemaV2,
      changes: studioBeatChangesSchemaV2,
    })
    .strict(),
  reorderBeats: z4
    .object({ kind: z4.literal('reorder_beats'), beatOrder: uniqueStudioIdsSchema(STUDIO_MAX_BEATS) })
    .strict(),
  parkBeat: z4.object({ kind: z4.literal('park_beat'), beatId: studioDirectorIdSchemaV2 }).strict(),
  restoreBeat: z4
    .object({
      kind: z4.literal('restore_beat'),
      beatId: studioDirectorIdSchemaV2,
      beforeBeatId: studioDirectorIdSchemaV2.nullable(),
    })
    .strict(),
  addBinnedBeat: z4
    .object({ kind: z4.literal('add_binned_beat'), beatId: studioDirectorIdSchemaV2, beat: studioBeatInputSchemaV2 })
    .strict(),
  addShot: z4
    .object({
      kind: z4.literal('add_shot'),
      beatId: studioDirectorIdSchemaV2,
      shotId: studioDirectorIdSchemaV2,
      shot: studioShotInputSchemaV2,
      beforeShotId: studioDirectorIdSchemaV2.nullable(),
    })
    .strict(),
  editShot: z4
    .object({ kind: z4.literal('edit_shot'), shotId: studioDirectorIdSchemaV2, changes: studioShotChangesSchemaV2 })
    .strict(),
  deleteShot: z4.object({ kind: z4.literal('delete_shot'), shotId: studioDirectorIdSchemaV2 }).strict(),
  parkShot: z4.object({ kind: z4.literal('park_shot'), shotId: studioDirectorIdSchemaV2 }).strict(),
  restoreShot: z4
    .object({
      kind: z4.literal('restore_shot'),
      shotId: studioDirectorIdSchemaV2,
      beforeShotId: studioDirectorIdSchemaV2.nullable(),
    })
    .strict(),
  reorderShots: z4
    .object({
      kind: z4.literal('reorder_shots'),
      beatId: studioDirectorIdSchemaV2,
      shotOrder: uniqueStudioIdsSchema(STUDIO_MAX_SHOTS_PER_BEAT),
    })
    .strict(),
  applyCoverage: z4
    .object({
      kind: z4.literal('apply_coverage'),
      beatId: studioDirectorIdSchemaV2,
      shots: z4.array(studioProposedShotSchemaV2).max(STUDIO_MAX_SHOTS_PER_BEAT),
      fixedShots: studioFixedShotReviewsSchemaV2,
    })
    .strict(),
  setHardCut: z4
    .object({ kind: z4.literal('set_hard_cut'), shotId: studioDirectorIdSchemaV2, hardCut: z4.boolean() })
    .strict(),
  setSeedStill: z4
    .object({
      kind: z4.literal('set_seed_still'),
      shotId: studioDirectorIdSchemaV2,
      assetId: studioDirectorIdSchemaV2.nullable(),
    })
    .strict(),
  trimShot: z4
    .object({
      kind: z4.literal('trim_shot'),
      shotId: studioDirectorIdSchemaV2,
      trimInSeconds: studioTrimBoundarySchemaV2.nullable(),
      trimOutSeconds: studioTrimBoundarySchemaV2.nullable(),
    })
    .strict(),
  redetachLine: z4
    .object({ kind: z4.literal('redetach_line'), shotId: studioDirectorIdSchemaV2, line: z4.string().max(8 * 1024) })
    .strict(),
  rederiveLine: z4
    .object({
      kind: z4.literal('rederive_line'),
      shotId: studioDirectorIdSchemaV2,
      line: z4
        .string()
        .min(1)
        .max(8 * 1024),
    })
    .strict(),
  restoreLine: z4
    .object({
      kind: z4.literal('restore_line'),
      shotId: studioDirectorIdSchemaV2,
      historyEntryId: studioDirectorIdSchemaV2,
    })
    .strict(),
  parkTake: z4
    .object({ kind: z4.literal('park_take'), shotId: studioDirectorIdSchemaV2, assetId: studioDirectorIdSchemaV2 })
    .strict(),
  restoreTake: z4
    .object({
      kind: z4.literal('restore_take'),
      shotId: studioDirectorIdSchemaV2,
      assetId: studioDirectorIdSchemaV2,
    })
    .strict(),
  addAlternateTake: z4
    .object({
      kind: z4.literal('add_alternate_take'),
      shotId: studioDirectorIdSchemaV2,
      assetId: studioDirectorIdSchemaV2,
    })
    .strict(),
  reorderBin: z4
    .object({
      kind: z4.literal('reorder_bin'),
      bin: z4
        .array(studioBinItemSchemaV2)
        .max(STUDIO_MAX_BIN_BEAT_ITEMS + STUDIO_MAX_BIN_SHOT_ITEMS + STUDIO_MAX_BIN_TAKE_ITEMS)
        .refine(
          (items) =>
            new Set(
              items.map((item) =>
                item.kind === 'beat'
                  ? `beat:${item.beatId}`
                  : item.kind === 'shot'
                    ? `shot:${item.shotId}`
                    : `take:${item.assetId}`
              )
            ).size === items.length,
          { message: 'Bin identities must not repeat.' }
        )
        .refine((items) => items.filter((item) => item.kind === 'beat').length <= STUDIO_MAX_BIN_BEAT_ITEMS, {
          message: 'Beat bin capacity exceeded.',
        })
        .refine((items) => items.filter((item) => item.kind === 'shot').length <= STUDIO_MAX_BIN_SHOT_ITEMS, {
          message: 'Shot bin capacity exceeded.',
        })
        .refine((items) => items.filter((item) => item.kind === 'take').length <= STUDIO_MAX_BIN_TAKE_ITEMS, {
          message: 'Take bin capacity exceeded.',
        })
        .meta({ uniqueItems: true }),
    })
    .strict(),
  selectTake: z4
    .object({ kind: z4.literal('select_take'), shotId: studioDirectorIdSchemaV2, assetId: studioDirectorIdSchemaV2 })
    .strict(),
  setRoutes: z4
    .object({
      kind: z4.literal('set_routes'),
      imageRouteId: studioDirectorIdSchemaV2.nullable(),
      videoRouteId: studioDirectorIdSchemaV2.nullable(),
    })
    .strict(),
  setSpendPolicy: z4
    .object({ kind: z4.literal('set_spend_policy'), policy: studioSpendPolicySchemaV2.nullable() })
    .strict(),
  setMatchTo: z4.object({ kind: z4.literal('set_match_to'), shotId: studioDirectorIdSchemaV2.nullable() }).strict(),
  setBed: z4.object({ kind: z4.literal('set_bed'), assetId: studioDirectorIdSchemaV2.nullable() }).strict(),
  undoLast: z4.object({ kind: z4.literal('undo_last'), entryId: studioDirectorIdSchemaV2 }).strict(),
};

export const studioMutationOperationSchemaV2 = z4.discriminatedUnion('kind', [
  studioMutationOperationSchemasV2.editProject,
  studioMutationOperationSchemasV2.setBrief,
  studioMutationOperationSchemasV2.setRules,
  studioMutationOperationSchemasV2.addBeat,
  studioMutationOperationSchemasV2.editBeat,
  studioMutationOperationSchemasV2.reorderBeats,
  studioMutationOperationSchemasV2.parkBeat,
  studioMutationOperationSchemasV2.restoreBeat,
  studioMutationOperationSchemasV2.addBinnedBeat,
  studioMutationOperationSchemasV2.addShot,
  studioMutationOperationSchemasV2.editShot,
  studioMutationOperationSchemasV2.deleteShot,
  studioMutationOperationSchemasV2.parkShot,
  studioMutationOperationSchemasV2.restoreShot,
  studioMutationOperationSchemasV2.reorderShots,
  studioMutationOperationSchemasV2.applyCoverage,
  studioMutationOperationSchemasV2.setHardCut,
  studioMutationOperationSchemasV2.setSeedStill,
  studioMutationOperationSchemasV2.trimShot,
  studioMutationOperationSchemasV2.redetachLine,
  studioMutationOperationSchemasV2.rederiveLine,
  studioMutationOperationSchemasV2.restoreLine,
  studioMutationOperationSchemasV2.parkTake,
  studioMutationOperationSchemasV2.addAlternateTake,
  studioMutationOperationSchemasV2.restoreTake,
  studioMutationOperationSchemasV2.reorderBin,
  studioMutationOperationSchemasV2.selectTake,
  studioMutationOperationSchemasV2.setRoutes,
  studioMutationOperationSchemasV2.setSpendPolicy,
  studioMutationOperationSchemasV2.setMatchTo,
  studioMutationOperationSchemasV2.setBed,
  studioMutationOperationSchemasV2.undoLast,
]);

/** Kept as an export for callers that named the old staged schema; capability is a handler policy. */
export const studioDirectorOperationSchemaV2 = studioMutationOperationSchemaV2;

const studioMutationOperationsSchemaV2 = z4
  .array(studioMutationOperationSchemaV2)
  .min(1)
  .max(STUDIO_MAX_MUTATION_OPERATIONS);

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

export type StudioApplyEditsToolInputV2 = {
  expectedRevision: number;
  operations: StudioMutationOperationV2[];
};

export const studioApplyEditsInputSchemaV2 = z4
  .object({
    expectedRevision: z4.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    operations: studioMutationOperationsSchemaV2,
  })
  .strict();

export const studioGetCommandStatusInputSchemaV2 = z4.object({ commandId: studioDirectorIdSchemaV2 }).strict();

export const studioProposeStoryboardInputSchemaV2 = z4
  .object({
    base_revision: z4.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    operations: studioMutationOperationsSchemaV2,
  })
  .strict();

export const studioRequestReferenceImagesInputSchemaV2 = z4
  .object({
    shotIds: z4
      .array(studioDirectorIdSchemaV2)
      .min(1)
      .max(STUDIO_MAX_REFERENCE_REQUEST_SHOTS)
      .refine((shotIds) => new Set(shotIds).size === shotIds.length, { message: 'Shot ids must not repeat.' })
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
  let routeCatalog: StudioRouteCatalogV2 | null = null;
  if (serializedRouteCatalog) {
    try {
      routeCatalog = JSON.parse(serializedRouteCatalog) as StudioRouteCatalogV2;
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

type StudioApplyEditsRejectedOperationV2 = {
  index: number;
  kind: StudioMutationOperationV2['kind'];
  disposition: Exclude<StudioDirectorOperationDispositionV2, 'direct'>;
  reason: 'requires_user_review' | 'unavailable_to_director';
};

const studioApplyEditsCapabilityRejectionV2 = (
  operations: readonly StudioMutationOperationV2[]
): StudioToolResult | null => {
  const rejectedOperations: StudioApplyEditsRejectedOperationV2[] = [];
  const directCapableOperationIndexes: number[] = [];
  operations.forEach((operation, index) => {
    const disposition = classifyStudioDirectorOperationV2(operation.kind);
    if (disposition === 'direct') {
      directCapableOperationIndexes.push(index);
      return;
    }
    rejectedOperations.push({
      index,
      kind: operation.kind,
      disposition: disposition === 'proposal' ? 'proposal' : 'operation_not_permitted',
      reason: disposition === 'proposal' ? 'requires_user_review' : 'unavailable_to_director',
    });
  });
  if (rejectedOperations.length === 0) return null;
  return errorResult(
    JSON.stringify({
      code: 'operation_not_permitted',
      message:
        'studio_apply_edits rejected the batch at capability preflight; no operation reached command evaluation or was applied.',
      operationIndexBase: 0,
      rejectedOperations,
      directCapableOperationIndexes,
      guidance: {
        proposal:
          'After omitting unavailable operations, submit the full ordered direct-and-proposal-capable subset to propose_storyboard when it still expresses the intended atomic change.',
        unavailable:
          'Omit unavailable operations or ask the user to perform them manually in Creative Studio when supported.',
        direct:
          'Only if the direct-capable operations are independently valid, call read_storyboard and submit them in a new studio_apply_edits batch against the fresh revision.',
        retry: 'Do not retry this batch unchanged.',
      },
    })
  );
};

const operationBatchIsProposalCapableV2 = (operations: readonly StudioMutationOperationV2[]): boolean =>
  Array.isArray(operations) &&
  operations.every((operation) => {
    const disposition = classifyStudioDirectorOperationV2(operation?.kind);
    return disposition === 'direct' || disposition === 'proposal';
  });

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
      return current.project.revision > snapshot.project.revision ? 'valid' : 'invalid';
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
        project.beatOrder.map((beatId) => {
          const beat = project.beats[beatId]!;
          return [
            beatId,
            {
              title: beat.title,
              action: beat.action,
              look: beat.look,
              targetSeconds: beat.targetSeconds,
              shotOrder: [...beat.shotOrder],
            },
          ];
        })
      );
      const activeShotIds = project.beatOrder.flatMap((beatId) => project.beats[beatId]!.shotOrder);
      const shots = Object.fromEntries(
        activeShotIds.map((shotId) => {
          const shot = project.shots[shotId]!;
          const takes = projectShotTakesV2(project, shot);
          return [
            shotId,
            {
              line: shot.line,
              derivation: shot.derivation,
              narration: shot.narration,
              onScreenText: shot.onScreenText,
              durationSeconds: shot.durationSeconds,
              chainBreak: shot.chainBreak,
              hasSeedStill: shot.seedStillId !== null,
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
            asset.shotId === null && asset.briefReferenceRole !== undefined && asset.briefReferenceLabel !== undefined
        )
        .toSorted(
          (left, right) =>
            Number(left.briefReferenceRole === 'look') - Number(right.briefReferenceRole === 'look') ||
            compareCodeUnits(left.createdAt, right.createdAt) ||
            compareCodeUnits(left.id, right.id)
        )
        .map((asset) => ({ id: asset.id, label: asset.briefReferenceLabel!, role: asset.briefReferenceRole! }));
      const beatCount = Object.keys(project.beats).length;
      const view = {
        revision: project.revision,
        name: project.name,
        brief: project.brief,
        briefReferences,
        rules,
        aspectRatio: project.aspectRatio,
        targetDurationSeconds: project.targetDurationSeconds,
        beatCapacity: {
          current: beatCount,
          maximum: STUDIO_MAX_BEATS,
          remaining: Math.max(0, STUDIO_MAX_BEATS - beatCount),
          overCapacity: beatCount > STUDIO_MAX_BEATS,
        },
        beatOrder: [...project.beatOrder],
        beats,
        shots,
        bin: project.bin.map((item) => ({ ...item })),
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

export function createProposeStoryboardHandlerV2(
  config: StudioServerEnv | null
): (input: ProposeStoryboardInputV2) => Promise<StudioToolResult> {
  return async ({ base_revision, operations }) => {
    if (!operationBatchIsProposalCapableV2(operations)) return errorResult('operation_not_permitted');
    if (!proposalInputFitsDurableRecordV2({ base_revision, operations })) {
      return errorResult('Proposal input exceeds the durable record size cap.');
    }
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

export function createRequestReferenceImagesHandlerV2(
  config: StudioServerEnv | null
): (input: { shotIds: string[] }) => Promise<StudioToolResult> {
  return async ({ shotIds }) => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    if (!Array.isArray(shotIds)) return errorResult('shotIds must be an array.');
    if (shotIds.length < 1) return errorResult('At least one shot id is required.');
    if (shotIds.length > STUDIO_MAX_REFERENCE_REQUEST_SHOTS) {
      return errorResult(`At most ${STUDIO_MAX_REFERENCE_REQUEST_SHOTS} shot ids may be requested at once.`);
    }
    const invalidShotIds = shotIds.filter((shotId) => !studioDirectorIdSchemaV2.safeParse(shotId).success);
    if (invalidShotIds.length > 0) return errorResult(`Invalid shot ids: ${invalidShotIds.join(', ')}`);
    const duplicateShotIds = shotIds.filter((shotId, index) => shotIds.indexOf(shotId) !== index);
    if (duplicateShotIds.length > 0) {
      return errorResult(`Duplicate shot ids: ${[...new Set(duplicateShotIds)].join(', ')}`);
    }
    try {
      const snapshot = await readProjectSnapshotV2(config);
      const project = snapshot.project;
      const activeShotOrder = project.beatOrder.flatMap((beatId) => project.beats[beatId]!.shotOrder);
      const activeShotIds = new Set(activeShotOrder);
      const unknownShotIds = shotIds.filter((shotId) => !activeShotIds.has(shotId));
      if (unknownShotIds.length > 0) return errorResult(`Unknown or inactive shots: ${unknownShotIds.join(', ')}`);
      const activePositions = new Map(activeShotOrder.map((shotId, index) => [shotId, index] as const));
      if (
        shotIds.some(
          (shotId, index) => index > 0 && activePositions.get(shotId)! <= activePositions.get(shotIds[index - 1]!)!
        )
      ) {
        return errorResult('Shot ids must follow active film order.');
      }
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
          shotIds: shotsToQueue,
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

export function createStudioApplyEditsHandlerV2(
  config: StudioServerEnv | null,
  deps: StudioDirectorCommandWriterDeps = {}
): (input: StudioApplyEditsToolInputV2) => Promise<StudioToolResult> {
  const writer = createStudioDirectorCommandWriterV2(
    config === null ? null : { projectId: config.projectId, projectDir: config.projectDir },
    deps
  );
  return async (input) => {
    const capabilityRejection = studioApplyEditsCapabilityRejectionV2(input.operations);
    if (capabilityRejection !== null) return capabilityRejection;
    const directInput: StudioApplyEditsInputV2 = {
      expectedRevision: input.expectedRevision,
      operations: input.operations as StudioDirectorOperationV2[],
    };
    if (!studioDirectorToolInputFitsDurableRecordV2(directInput)) {
      return errorResult('Command input exceeds the durable record size cap.');
    }
    return commandToolResult(await writer.apply(directInput));
  };
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

/** Registers the sole production Beat/Shot catalog after the atomic Task 7 cutover. */
export function registerStudioToolsV2(
  server: Pick<McpServer, 'registerTool'>,
  config: StudioServerEnv | null,
  writerDeps: StudioDirectorCommandWriterDeps = {}
): void {
  server.registerTool(
    'studio_list_routes',
    {
      description:
        'Read the generation routes available to this project and their constraints before drafting shot durations.',
      inputSchema: z.object({}).strict(),
    },
    createListRoutesHandler(config)
  );
  server.registerTool(
    'read_storyboard',
    {
      description:
        'Read the authoritative schema-2 Beat/Shot storyboard, bin, rules, references, selected takes, and bounded available take ids before proposing changes.',
      inputSchema: z.object({}).strict(),
    },
    createReadStoryboardHandlerV2(config)
  );
  server.registerTool(
    'studio_request_reference_images',
    {
      description:
        'Request supporting reference images for ordered active shot ids. This only records a request for user approval and never starts paid generation.',
      inputSchema: studioRequestReferenceImagesInputSchemaV2,
    },
    createRequestReferenceImagesHandlerV2(config)
  );
  server.registerTool(
    'propose_storyboard',
    {
      description:
        'Record one ordered schema-2 direct- or proposal-capable mutation batch for user review. Requires base_revision from read_storyboard and never applies or generates anything directly. Unavailable operations return operation_not_permitted before any ID or I/O; the final serialized proposal record must fit within 256 KiB.',
      inputSchema: studioProposeStoryboardInputSchemaV2,
    },
    async (input) =>
      createProposeStoryboardHandlerV2(config)({
        base_revision: input.base_revision,
        operations: input.operations as StudioMutationOperationV2[],
      })
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
        'Read the current revision first, then apply one bounded ordered batch of direct-capable Beat/Shot edits to that exact revision. Canonical schema-2 batch: {"expectedRevision":8,"operations":[{"kind":"set_brief","brief":"..."},{"kind":"edit_beat","beatId":"beat_1","changes":{"title":"..."}},{"kind":"edit_shot","shotId":"shot_1","changes":{"line":"..."}},{"kind":"reorder_beats","beatOrder":["beat_2","beat_1"]}]}. Exact add_beat and add_shot variants require caller-provided beatId and shotId and never accept legacy firstShot fields. This never starts paid generation. A batch containing proposal-only or unavailable operations is rejected atomically at capability preflight before any ID or I/O: no operation reaches command evaluation or is applied, and the operation_not_permitted error names every rejected zero-based index, kind, disposition, and reason plus every direct-capable index. Omit unavailable operations or ask the user to perform them manually when supported. If the remaining ordered direct-and-proposal-capable subset still expresses the intended atomic change, send that whole subset to propose_storyboard for user review; resubmit a direct-only subset through studio_apply_edits only when it is independently valid and only after calling read_storyboard. Never retry a rejected batch unchanged. The final serialized command record must fit within 256 KiB. Validation errors and unconfirmed results must not be retried; call studio_get_command_status for an unconfirmed commandId.',
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
  registerStudioToolsV2(server, config);

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
