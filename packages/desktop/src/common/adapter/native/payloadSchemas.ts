/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  OFFICE_ARTIFACT_MAX_SELECTED_CELLS,
  OFFICE_ARTIFACT_MAX_SELECTION_MESSAGE_BYTES,
} from '../../types/office/artifactEditor';
import {
  PRESENTATION_CONVERSATION_ID_PATTERN,
  normalizePresentationConversationId,
  type PresentationConversationId,
} from '../../types/office/presentationConversationId';
import { PRESENTATION_RUN_LIMITS } from '../../types/office/presentationRunPolicy';
import { hasRuleToken, STUDIO_RULE_LIMITS } from '../../types/project/creativeStudioRules';
import {
  STUDIO_BOARD_STYLES_V2,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_BIN_BEAT_ITEMS,
  STUDIO_MAX_BIN_SHOT_ITEMS,
  STUDIO_MAX_DIRTY_DRAFTS_REPORTED,
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MAX_REFERENCE_LABEL_LENGTH,
  STUDIO_MAX_REFERENCE_PROMPT_LENGTH,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MAX_STORY_LENGTH,
  STUDIO_MIN_SHOT_SECONDS,
} from '../../types/project/creativeStudioTypes';
import type { NativeBridgeProviderKey, RendererBridgeQueryKey } from './constants';

const MAX_PATH_LENGTH = 4096;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_SHORT_TEXT_LENGTH = 256;
const MAX_TEXT_LENGTH = 64 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_THEME_CONTENT_LENGTH = 15 * 1024 * 1024;
const MAX_THEME_TOKEN_COUNT = 1024;
const MAX_CONTEXT_MARKDOWN_LENGTH = 24 * 1024;
const MAX_CONTEXT_PINS = 20;
const MAX_CONTEXT_PIN_LENGTH = 2_000;
const MAX_CONTEXT_SNAPSHOT_ITEMS = 256;
const MAX_PROJECT_KB_FILE_PATHS = 100;
const MAX_NATIVE_BRIDGE_DIAGNOSTIC_ISSUES = 8;
const MAX_NATIVE_BRIDGE_DIAGNOSTIC_PATH_SEGMENTS = 8;
const MAX_NATIVE_BRIDGE_DIAGNOSTIC_PATH_JSON_LENGTH = 256;
const MAX_NATIVE_BRIDGE_DIAGNOSTIC_PATH_SEGMENT_LENGTH = 64;

const voidPayloadSchema = z.undefined();
const pathSchema = z.string().min(1).max(MAX_PATH_LENGTH);
const identifierSchema = z.string().min(1).max(MAX_IDENTIFIER_LENGTH);
const shortTextSchema = z.string().min(1).max(MAX_SHORT_TEXT_LENGTH);
const textSchema = z.string().max(MAX_TEXT_LENGTH);
const urlSchema = z.string().max(MAX_URL_LENGTH).url();
const portSchema = z.number().finite().int().min(1).max(65535);
const booleanSettingSchema = z.object({ enabled: z.boolean() }).strict();

const dialogPropertySchema = z.enum([
  'openFile',
  'openDirectory',
  'multiSelections',
  'showHiddenFiles',
  'createDirectory',
  'promptToCreate',
  'noResolveAliases',
  'treatPackageAsDirectory',
  'dontAddToRecent',
]);

const dialogFilterSchema = z
  .object({
    name: shortTextSchema,
    extensions: z.array(z.string().min(1).max(32)).max(64),
  })
  .strict();

const themeTokensSchema = z
  .record(z.string().min(1).max(128), z.string().max(4096))
  .refine((tokens) => Object.keys(tokens).length <= MAX_THEME_TOKEN_COUNT);

const themeSchema = z
  .object({
    id: identifierSchema,
    name: shortTextSchema,
    cover: z.string().max(MAX_THEME_CONTENT_LENGTH).optional(),
    appearance: z.enum(['light', 'dark']),
    tokens: themeTokensSchema.optional(),
    css: z.string().max(MAX_THEME_CONTENT_LENGTH).optional(),
    builtin: z.boolean(),
    created_at: z.number().finite().int().nonnegative(),
    updated_at: z.number().finite().int().nonnegative(),
  })
  .strict();

const contextSnapshotItemSchema = z.string().max(MAX_TEXT_LENGTH);
const contextSnapshotItemsSchema = z.array(contextSnapshotItemSchema).max(MAX_CONTEXT_SNAPSHOT_ITEMS);
const contextSnapshotSchema = z
  .object({
    goal: contextSnapshotItemSchema,
    current_state: contextSnapshotItemsSchema,
    decisions: contextSnapshotItemsSchema,
    artifacts: contextSnapshotItemsSchema,
    user_preferences: contextSnapshotItemsSchema,
    open_questions: contextSnapshotItemsSchema,
    next_steps: contextSnapshotItemsSchema,
    do_not_forget: contextSnapshotItemsSchema,
  })
  .strict();
const contextPinSchema = z
  .object({
    id: identifierSchema,
    title: z.string().max(MAX_CONTEXT_PIN_LENGTH),
    content: z.string().max(MAX_CONTEXT_PIN_LENGTH),
    source: z.enum(['manual', 'context_md']),
    created_at: z.number().finite().int().nonnegative(),
    updated_at: z.number().finite().int().nonnegative(),
  })
  .strict();
const appOperationsContextCompactSchema = z
  .object({
    operation_id: identifierSchema,
    conversation_id: identifierSchema,
    trigger: z.enum(['auto', 'manual', 'handoff']),
    previous_snapshot: contextSnapshotSchema.optional(),
    previous_markdown: z.string().max(MAX_CONTEXT_MARKDOWN_LENGTH).optional(),
    pinned_context: z.array(contextPinSchema).max(MAX_CONTEXT_PINS).optional(),
    last_compacted_turn_id: identifierSchema.optional(),
    target_turn_id: identifierSchema.optional(),
  })
  .strict();

const officeArtifactRequestShape = {
  conversationId: identifierSchema.optional(),
  workspace: z.string().max(MAX_PATH_LENGTH),
  filePath: pathSchema,
};
const officeWordSelectionSchema = z
  .object({
    kind: z.literal('word'),
    path: pathSchema,
    paragraphText: z.string().max(OFFICE_ARTIFACT_MAX_SELECTION_MESSAGE_BYTES),
    selectedText: z.string().max(OFFICE_ARTIFACT_MAX_SELECTION_MESSAGE_BYTES),
    start: z.number().finite().int().nonnegative(),
    end: z.number().finite().int().nonnegative(),
  })
  .strict();
const officeExcelCellSchema = z
  .object({
    path: shortTextSchema,
    displayText: z.string().max(OFFICE_ARTIFACT_MAX_SELECTION_MESSAGE_BYTES),
  })
  .strict();
const officeExcelSelectionSchema = z
  .object({
    kind: z.literal('excel'),
    paths: z.array(shortTextSchema).max(OFFICE_ARTIFACT_MAX_SELECTED_CELLS),
    cells: z.array(officeExcelCellSchema).max(OFFICE_ARTIFACT_MAX_SELECTED_CELLS),
  })
  .strict();
const officeSelectionSchema = z.discriminatedUnion('kind', [officeWordSelectionSchema, officeExcelSelectionSchema]);
const officeEditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('replaceText'), value: textSchema }).strict(),
  z
    .object({
      kind: z.literal('formatText'),
      property: z.enum(['bold', 'italic', 'underline']),
      enabled: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('setCell'), input: textSchema }).strict(),
]);
const officeInspectRequestSchema = z
  .object({
    ...officeArtifactRequestShape,
    expectedVersion: identifierSchema,
    selection: officeSelectionSchema,
  })
  .strict();

// Project-knowledge ids are interpolated into filesystem paths by the main
// process, so restrict them to characters that cannot traverse or escape.
const safeIdSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);

const projectKnowledgeProjectIdSchema = z.object({ projectId: safeIdSchema }).strict();
const projectKnowledgeSourceRefSchema = z.object({ projectId: safeIdSchema, sourceId: safeIdSchema }).strict();
const projectKnowledgeFolderSchema = z.object({ projectId: safeIdSchema, workspace: pathSchema }).strict();
const presentationUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const presentationScratchRunIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const presentationConversationIdSchema = z
  .string()
  .regex(PRESENTATION_CONVERSATION_ID_PATTERN)
  .transform((value) => normalizePresentationConversationId(value) as PresentationConversationId);
const presentationRevisionSchema = z
  .number()
  .finite()
  .int()
  .nonnegative()
  .refine((value) => Number.isSafeInteger(value));
const presentationGrantOwnerSchema = z.discriminatedUnion('owner_type', [
  z.object({ owner_type: z.literal('draft'), draft_id: presentationUuidSchema }).strict(),
  z.object({ owner_type: z.literal('conversation'), conversation_id: presentationConversationIdSchema }).strict(),
]);
const presentationRelativePathSchema = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((value) => {
    if (
      value.includes('\0') ||
      value.includes('\\') ||
      value.startsWith('/') ||
      /^[A-Za-z]:/.test(value) ||
      value.endsWith('/')
    ) {
      return false;
    }

    const segments = value.split('/');
    return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  });
const presentationSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const presentationTemplateIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]+$/);
const presentationSourceRefSchema = z
  .object({
    grantId: presentationUuidSchema,
    expectedByteLength: z.number().finite().int().min(1).max(PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES),
    expectedSha256: presentationSha256Schema,
  })
  .strict();
const presentationQueuedSourceRefsSchema = z
  .array(presentationSourceRefSchema)
  .min(1)
  .max(PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN)
  .superRefine((sources, context) => {
    const grantIds = new Set(sources.map(({ grantId }) => grantId.toLowerCase()));
    const totalBytes = sources.reduce((total, source) => total + source.expectedByteLength, 0);
    if (grantIds.size !== sources.length) context.addIssue({ code: 'custom', message: 'duplicate source grant' });
    if (totalBytes > PRESENTATION_RUN_LIMITS.MAX_TOTAL_SOURCE_BYTES) {
      context.addIssue({ code: 'custom', message: 'aggregate source bytes exceeded' });
    }
  });
const startPresentationRunSchema = z
  .object({
    conversation_id: presentationConversationIdSchema,
    client_request_id: presentationUuidSchema,
    input: z
      .string()
      .min(1)
      .max(PRESENTATION_RUN_LIMITS.MAX_EXTRACTED_CHARS_PER_SOURCE)
      .refine((value) => value.trim().length > 0),
    selected_template_id: presentationTemplateIdSchema,
    sources: z.array(presentationSourceRefSchema).max(PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN),
  })
  .strict()
  .superRefine((request, context) => {
    const grantIds = new Set(request.sources.map(({ grantId }) => grantId.toLowerCase()));
    const totalBytes = request.sources.reduce((total, source) => total + source.expectedByteLength, 0);
    if (grantIds.size !== request.sources.length)
      context.addIssue({ code: 'custom', message: 'duplicate source grant' });
    if (totalBytes > PRESENTATION_RUN_LIMITS.MAX_TOTAL_SOURCE_BYTES) {
      context.addIssue({ code: 'custom', message: 'aggregate source bytes exceeded' });
    }
  });
const getPresentationRunSchema = z.union([
  z.object({ conversation_id: presentationConversationIdSchema, run_id: presentationUuidSchema }).strict(),
  z.object({ conversation_id: presentationConversationIdSchema, client_request_id: presentationUuidSchema }).strict(),
]);
const presentationRecoveryCursorSchema = z
  .string()
  .min(3)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

const studioExpectedRevisionSchema = z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER);
const studioCapturedPosterDataUrlMaxLength = Math.ceil((50 * 1024 * 1024) / 3) * 4 + 22;
const studioCapturedPosterDataUrlSchema = z
  .string()
  .min(26)
  .max(studioCapturedPosterDataUrlMaxLength)
  .regex(/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const studioConnectionSchema = z
  .object({
    providerId: safeIdSchema,
    integrationId: safeIdSchema,
    model: z.string().trim().min(1).max(256),
  })
  .strict();

// Renderer protocol V2 authority. The protocol version is independent from the schema-5 project cutover.
// These are deliberately separate from the full mutation catalog:
// the renderer may batch only the frozen authoring subset, while settings, rules, parking, media,
// Bin, cascade, and undo gestures cross their dedicated narrow providers below.
const studioV2ProjectInputSchema = z
  .object({
    name: z
      .string()
      .max(256)
      .refine((name) => name.trim().length > 0),
    brief: z.string().max(16 * 1024),
    forgeProjectId: safeIdSchema.optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']),
    targetDurationSeconds: z.number().finite().int().min(5).max(1440),
    resolution: z.enum(['720p', '1080p']),
  })
  .strict();
const studioV2ProjectRequestSchema = z.object({ projectId: safeIdSchema }).strict();
const studioV2MutationRequestShape = {
  projectId: safeIdSchema,
  expectedRevision: studioExpectedRevisionSchema,
};
const studioGenerationCapabilityItemSchema = z.union([
  z
    .object({
      target: z.object({ kind: z.literal('shot'), shotId: safeIdSchema }).strict(),
      purpose: z.enum(['seed_still', 'board_still', 'video_take']),
    })
    .strict(),
  z
    .object({
      target: z.object({ kind: z.literal('reference'), referenceId: safeIdSchema }).strict(),
      purpose: z.literal('reference_image'),
    })
    .strict(),
]);
const studioGenerationCapabilitySchema = z
  .object({
    ...studioV2MutationRequestShape,
    items: z
      .array(studioGenerationCapabilityItemSchema)
      .max(STUDIO_MAX_SHOTS_PER_PROJECT * 3 + STUDIO_MAX_PROJECT_REFERENCES)
      .refine(
        (items) =>
          new Set(items.map((item) => `${item.target.kind}\u0000${JSON.stringify(item.target)}\u0000${item.purpose}`))
            .size === items.length
      ),
  })
  .strict();
const studioV2EditableProjectChangesSchema = z
  .object({
    name: z
      .string()
      .max(256)
      .refine((name) => name.trim().length > 0)
      .optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']).optional(),
    resolution: z.enum(['720p', '1080p']).optional(),
    targetDurationSeconds: z.number().finite().int().min(5).max(1440).optional(),
    boardStyle: z.enum(STUDIO_BOARD_STYLES_V2).nullable().optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0);
const studioV2BeatSchema = z
  .object({
    title: z.string().max(256),
    story: z.string().max(STUDIO_MAX_STORY_LENGTH),
    targetSeconds: z.number().finite().int().min(1).max(1440).nullable(),
  })
  .strict();
const studioV2BeatChangesSchema = studioV2BeatSchema.partial().refine((changes) => Object.keys(changes).length > 0);
const studioV2ShotSchema = z
  .object({
    shootingScript: z.string().max(STUDIO_MAX_SHOOTING_SCRIPT_LENGTH),
    durationSeconds: z.number().finite().int().min(STUDIO_MIN_SHOT_SECONDS).max(STUDIO_MAX_SHOT_SECONDS),
  })
  .strict();
const studioV2ShotChangesSchema = studioV2ShotSchema.partial().refine((changes) => Object.keys(changes).length > 0);
const studioV2ReferenceDraftSchema = z
  .object({
    kind: z.enum(['character', 'background']),
    label: z
      .string()
      .min(1)
      .max(STUDIO_MAX_REFERENCE_LABEL_LENGTH)
      .refine((label) => label === label.trim()),
    prompt: z
      .string()
      .min(1)
      .max(STUDIO_MAX_REFERENCE_PROMPT_LENGTH)
      .refine((prompt) => prompt === prompt.trim()),
  })
  .strict();
const studioV2ReferencePlanSchema = z
  .array(studioV2ReferenceDraftSchema)
  .max(STUDIO_MAX_PROJECT_REFERENCES)
  .superRefine((references, context) => {
    const labels = new Set<string>();
    let sawBackground = false;
    references.forEach((reference, index) => {
      const labelIdentity = `${reference.kind}\0${reference.label}`;
      if (labels.has(labelIdentity)) {
        context.addIssue({ code: 'custom', message: 'duplicate reference label', path: [index] });
      }
      if (sawBackground && reference.kind === 'character') {
        context.addIssue({ code: 'custom', message: 'character reference after background', path: [index] });
      }
      labels.add(labelIdentity);
      if (reference.kind === 'background') sawBackground = true;
    });
  });
const studioV2ReferencePlanAdditionsSchema = z
  .array(studioV2ReferenceDraftSchema)
  .min(1)
  .max(STUDIO_MAX_PROJECT_REFERENCES)
  .superRefine((references, context) => {
    const labels = new Set<string>();
    references.forEach((reference, index) => {
      const labelIdentity = `${reference.kind}\0${reference.label}`;
      if (reference.kind !== 'background') {
        context.addIssue({ code: 'custom', message: 'only background references may be appended', path: [index] });
      }
      if (labels.has(labelIdentity)) {
        context.addIssue({ code: 'custom', message: 'duplicate reference label', path: [index] });
      }
      labels.add(labelIdentity);
    });
  });
const studioV2UniqueIdsSchema = (maximum: number) =>
  z
    .array(safeIdSchema)
    .max(maximum)
    .refine((ids) => new Set(ids).size === ids.length);
const studioV2RuleTermSchema = z
  .string()
  .max(STUDIO_RULE_LIMITS.term)
  .refine((term) => term.trim().length > 0 && hasRuleToken(term));
const studioV2RulePredicateSchema = z
  .object({
    kind: z.literal('forbidden_terms'),
    terms: z
      .array(studioV2RuleTermSchema)
      .min(1)
      .max(STUDIO_RULE_LIMITS.maxTerms)
      .refine((terms) => new Set(terms).size === terms.length),
  })
  .strict();
const studioV2RuleDraftSchema = z
  .object({
    id: safeIdSchema,
    text: z
      .string()
      .max(STUDIO_RULE_LIMITS.text)
      .refine((text) => text.trim().length > 0),
    predicate: studioV2RulePredicateSchema.nullable(),
  })
  .strict();
const studioV2RulesSchema = z
  .array(studioV2RuleDraftSchema)
  .max(STUDIO_RULE_LIMITS.maxRules)
  .refine((rules) => new Set(rules.map((rule) => rule.id)).size === rules.length);
const studioV2BinItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('beat'), beatId: safeIdSchema, reason: z.enum(['lifted', 'alternate']) }).strict(),
  z
    .object({ kind: z.literal('shot'), beatId: safeIdSchema, shotId: safeIdSchema, reason: z.literal('lifted') })
    .strict(),
]);
const studioV2BinSchema = z
  .array(studioV2BinItemSchema)
  .max(STUDIO_MAX_BIN_BEAT_ITEMS + STUDIO_MAX_BIN_SHOT_ITEMS)
  .refine(
    (items) =>
      new Set(items.map((item) => (item.kind === 'beat' ? `beat:${item.beatId}` : `shot:${item.shotId}`))).size ===
      items.length
  )
  .refine((items) => items.filter((item) => item.kind === 'beat').length <= STUDIO_MAX_BIN_BEAT_ITEMS)
  .refine((items) => items.filter((item) => item.kind === 'shot').length <= STUDIO_MAX_BIN_SHOT_ITEMS);
const studioV2TrimBoundarySchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => !Object.is(value, -0));
const studioV2SpendPolicySchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    maxPerBatchMinorUnits: z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const studioV2AuthoringOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set_brief'), brief: z.string().max(16 * 1024) }).strict(),
  z.object({ kind: z.literal('set_reference_plan'), references: studioV2ReferencePlanSchema }).strict(),
  z.object({ kind: z.literal('amend_reference_plan'), additions: studioV2ReferencePlanAdditionsSchema }).strict(),
  z
    .object({ kind: z.literal('approve_reference'), referenceId: safeIdSchema, candidateAssetId: safeIdSchema })
    .strict(),
  z
    .object({
      kind: z.literal('set_shot_reference_binding'),
      shotId: safeIdSchema,
      characterReferenceIds: studioV2UniqueIdsSchema(STUDIO_MAX_PROJECT_REFERENCES),
      backgroundReferenceId: safeIdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('add_beat'),
      beatId: safeIdSchema,
      beat: studioV2BeatSchema,
      beforeBeatId: safeIdSchema.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('edit_beat'), beatId: safeIdSchema, changes: studioV2BeatChangesSchema }).strict(),
  z.object({ kind: z.literal('reorder_beats'), beatOrder: studioV2UniqueIdsSchema(STUDIO_MAX_BEATS) }).strict(),
  z.object({ kind: z.literal('add_binned_beat'), beatId: safeIdSchema, beat: studioV2BeatSchema }).strict(),
  z
    .object({
      kind: z.literal('add_shot'),
      beatId: safeIdSchema,
      shotId: safeIdSchema,
      shot: studioV2ShotSchema,
      beforeShotId: safeIdSchema.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('edit_shot'), shotId: safeIdSchema, changes: studioV2ShotChangesSchema }).strict(),
  z.object({ kind: z.literal('delete_shot'), shotId: safeIdSchema }).strict(),
  z
    .object({
      kind: z.literal('reorder_shots'),
      beatId: safeIdSchema,
      shotOrder: studioV2UniqueIdsSchema(STUDIO_MAX_SHOTS_PER_BEAT),
    })
    .strict(),
  z.object({ kind: z.literal('set_hard_cut'), shotId: safeIdSchema, hardCut: z.boolean() }).strict(),
  z.object({ kind: z.literal('set_seed_still'), shotId: safeIdSchema, assetId: safeIdSchema.nullable() }).strict(),
  z.object({ kind: z.literal('promote_board_panel'), shotId: safeIdSchema, boardAssetId: safeIdSchema }).strict(),
  z
    .object({
      kind: z.literal('trim_shot'),
      shotId: safeIdSchema,
      trimInSeconds: studioV2TrimBoundarySchema.nullable(),
      trimOutSeconds: studioV2TrimBoundarySchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('set_routes'),
      imageRouteId: safeIdSchema.nullable(),
      videoRouteId: safeIdSchema.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('set_spend_policy'), policy: studioV2SpendPolicySchema.nullable() }).strict(),
]);
const studioV2ApplyAuthoringBatchSchema = z
  .object({
    ...studioV2MutationRequestShape,
    operations: z.array(studioV2AuthoringOperationSchema).min(1).max(STUDIO_MAX_MUTATION_OPERATIONS),
  })
  .strict();
const studioV2SetRulesSchema = z.object({ ...studioV2MutationRequestShape, rules: studioV2RulesSchema }).strict();
const studioV2CapturedPosterSchema = z
  .object({
    projectId: safeIdSchema,
    shotId: safeIdSchema,
    videoAssetId: safeIdSchema,
    dataUrl: studioCapturedPosterDataUrlSchema,
    width: z.number().finite().int().min(1).max(16_384),
    height: z.number().finite().int().min(1).max(16_384),
  })
  .strict();
const studioV2ReferenceDecisionSchema = z
  .object({
    ...studioV2MutationRequestShape,
    requestId: safeIdSchema,
    outcome: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('rejected') }).strict(),
      z.object({ kind: z.literal('generation_gate') }).strict(),
    ]),
  })
  .strict();
const studioV2PrepareProjectReferencesSchema = z
  .object({
    ...studioV2MutationRequestShape,
    referenceIds: z.array(safeIdSchema).min(1).max(STUDIO_MAX_PROJECT_REFERENCES),
  })
  .strict()
  .refine((request) => new Set(request.referenceIds).size === request.referenceIds.length, {
    message: 'duplicate project reference',
  });
const studioV2PrepareGenerationChoiceSchema = z
  .object({
    target: z.object({ kind: z.literal('shot'), shotId: safeIdSchema }).strict(),
    purpose: z.enum(['seed_still', 'board_still', 'video_take']),
  })
  .strict();
const studioV2OrdinaryPrepareSubmissionSchema = z
  .object({
    ...studioV2MutationRequestShape,
    originReferenceHandoffId: z.null(),
    baseChoices: z.array(studioV2PrepareGenerationChoiceSchema).min(1).max(STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST),
    cascadeChoices: z.array(studioV2PrepareGenerationChoiceSchema).max(STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST),
  })
  .strict();
const studioV2ContinuityPrepareSubmissionSchema = z
  .object({
    ...studioV2MutationRequestShape,
    originReferenceHandoffId: z.null(),
    baseChoices: z.array(studioV2PrepareGenerationChoiceSchema).length(0),
    cascadeChoices: z.array(studioV2PrepareGenerationChoiceSchema).length(0),
    continuityChange: z
      .object({
        shotId: safeIdSchema,
        hardCut: z.boolean(),
        requiresSeedGeneration: z.boolean(),
      })
      .strict(),
  })
  .strict();
const studioV2BoardPromotionPrepareSubmissionSchema = z
  .object({
    ...studioV2MutationRequestShape,
    originReferenceHandoffId: z.null(),
    baseChoices: z.array(studioV2PrepareGenerationChoiceSchema).length(0),
    cascadeChoices: z.array(studioV2PrepareGenerationChoiceSchema).length(0),
    boardPromotion: z
      .object({
        shotId: safeIdSchema,
        boardAssetId: safeIdSchema,
      })
      .strict(),
  })
  .strict();
const studioV2PrepareSubmissionSchema = z
  .union([
    studioV2OrdinaryPrepareSubmissionSchema,
    studioV2ContinuityPrepareSubmissionSchema,
    studioV2BoardPromotionPrepareSubmissionSchema,
  ])
  .superRefine((request, context) => {
    const choices = [...request.baseChoices, ...request.cascadeChoices];
    if (choices.length > STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST) {
      context.addIssue({ code: 'custom', message: 'generation item bound exceeded' });
    }
    if (new Set(choices.map((choice) => choice.target.shotId)).size > STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST) {
      context.addIssue({ code: 'custom', message: 'generation shot bound exceeded' });
    }
    if (new Set(choices.map((choice) => `${choice.target.shotId}:${choice.purpose}`)).size !== choices.length) {
      context.addIssue({ code: 'custom', message: 'duplicate generation choice' });
    }
    const boardChoiceCount = choices.filter((choice) => choice.purpose === 'board_still').length;
    if (
      boardChoiceCount > 0 &&
      (boardChoiceCount !== choices.length ||
        request.originReferenceHandoffId !== null ||
        request.cascadeChoices.length > 0)
    ) {
      context.addIssue({ code: 'custom', message: 'Board generation must be an isolated base batch' });
    }
  });

export const INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE = '[adapter] Native IPC request rejected: invalid operation payload';
export const INVALID_RENDERER_BRIDGE_QUERY_PAYLOAD_MESSAGE =
  '[adapter] Renderer IPC query rejected: invalid operation payload';

export type NativeBridgePayloadDiagnostic = Readonly<{
  providerKey: NativeBridgeProviderKey;
  issues: readonly Readonly<{ code: string; path: readonly (string | number)[] }>[];
}>;

const nativeBridgePayloadDiagnostics = new WeakMap<Error, NativeBridgePayloadDiagnostic>();

const sanitizeDiagnosticRootField = (field: string): string =>
  Array.from(field.slice(0, MAX_NATIVE_BRIDGE_DIAGNOSTIC_PATH_SEGMENT_LENGTH), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? '?' : character;
  }).join('');

const boundedDiagnosticPath = (path: readonly PropertyKey[]): readonly (string | number)[] => {
  const bounded: (string | number)[] = [];
  const [rootField, ...nestedPath] = path;
  if (typeof rootField === 'string') {
    bounded.push(sanitizeDiagnosticRootField(rootField));
  } else if (typeof rootField === 'number' && Number.isSafeInteger(rootField)) {
    bounded.push(rootField);
  }
  // Native payload schemas have fixed top-level fields, while nested records can
  // contribute payload-controlled string keys to Zod paths. Retain only numeric
  // array indexes below the root so diagnostic paths cannot copy those keys.
  for (const segment of nestedPath) {
    if (typeof segment !== 'number' || !Number.isSafeInteger(segment)) continue;
    if (bounded.length >= MAX_NATIVE_BRIDGE_DIAGNOSTIC_PATH_SEGMENTS) break;
    const candidate = [...bounded, segment];
    if (JSON.stringify(candidate).length > MAX_NATIVE_BRIDGE_DIAGNOSTIC_PATH_JSON_LENGTH) break;
    bounded.push(segment);
  }
  return Object.freeze(bounded);
};

const buildNativeBridgePayloadDiagnostic = (
  providerKey: NativeBridgeProviderKey,
  issues: readonly z.ZodIssue[]
): NativeBridgePayloadDiagnostic =>
  Object.freeze({
    providerKey,
    issues: Object.freeze(
      issues.slice(0, MAX_NATIVE_BRIDGE_DIAGNOSTIC_ISSUES).map((issue) =>
        Object.freeze({
          code: String(issue.code),
          path: boundedDiagnosticPath(issue.path),
        })
      )
    ),
  });

/** Returns only the bounded, payload-free diagnostic attached to a native payload rejection. */
export function getNativeBridgePayloadDiagnostic(error: unknown): NativeBridgePayloadDiagnostic | null {
  return error instanceof Error ? (nativeBridgePayloadDiagnostics.get(error) ?? null) : null;
}

export const rendererBridgeQuerySchemas = {
  'creative-studio.has-unsaved-work': {
    request: voidPayloadSchema,
    response: z
      .object({ dirtyDraftCount: z.number().finite().int().min(0).max(STUDIO_MAX_DIRTY_DRAFTS_REPORTED) })
      .strict(),
  },
  'creative-studio.flush-unsaved-work': {
    request: voidPayloadSchema,
    response: z.object({ saved: z.boolean() }).strict(),
  },
} satisfies Record<RendererBridgeQueryKey, { request: z.ZodTypeAny; response: z.ZodTypeAny }>;

export const nativeBridgePayloadSchemas = {
  'restart-app': voidPayloadSchema,
  'quit-app': voidPayloadSchema,
  'open-dev-tools': voidPayloadSchema,
  'is-dev-tools-opened': voidPayloadSchema,
  'app.get-path': z.object({ name: z.enum(['desktop', 'home', 'downloads']) }).strict(),
  'update-system-info': z.object({ cacheDir: pathSchema, workDir: pathSchema, logDir: pathSchema.optional() }).strict(),
  'app.get-zoom-factor': voidPayloadSchema,
  'app.set-zoom-factor': z.object({ factor: z.number().finite().min(0.8).max(1.3) }).strict(),
  'app.get-cdp-status': voidPayloadSchema,
  'app.update-cdp-config': z.object({ enabled: z.boolean().optional(), port: portSchema.optional() }).strict(),
  'app.get-start-on-boot-status': voidPayloadSchema,
  'app.set-start-on-boot': booleanSettingSchema,
  'app.get-gpu-status': voidPayloadSchema,
  'app.set-gpu-override': z.object({ override: z.enum(['force-on', 'force-off']).nullable() }).strict(),
  'app.write-renderer-log': z
    .object({
      level: z.enum(['debug', 'info', 'warn', 'error']),
      tag: z.string().min(1).max(128),
      message: textSchema,
      data: z.unknown().optional(),
    })
    .strict(),
  'update.check': z
    .object({
      includePrerelease: z.boolean().optional(),
      repo: z
        .string()
        .min(3)
        .max(200)
        .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
        .optional(),
    })
    .strict(),
  'update.installer-last-failure.consume': voidPayloadSchema,
  'update.download': z
    .object({
      downloadId: identifierSchema.optional(),
      url: urlSchema,
      fallbackUrl: urlSchema.optional(),
      file_name: z.string().min(1).max(255).optional(),
    })
    .strict(),
  'update.download.cancel': z.object({ downloadId: identifierSchema }).strict(),
  'auto-update.check': z.object({ includePrerelease: z.boolean().optional() }).strict(),
  'auto-update.restore-downloaded': voidPayloadSchema,
  'auto-update.download': voidPayloadSchema,
  'auto-update.download.cancel': voidPayloadSchema,
  'auto-update.quit-and-install': voidPayloadSchema,
  'show-open': z
    .object({
      defaultPath: pathSchema.optional(),
      properties: z.array(dialogPropertySchema).max(9).optional(),
      filters: z.array(dialogFilterSchema).max(32).optional(),
    })
    .strict()
    .optional(),
  'presentation-templates.list': voidPayloadSchema,
  'presentation-templates.import-spec': z.object({ file_path: pathSchema }).strict(),
  'presentation-templates.describe-spec': z
    .object({ conversation_id: presentationConversationIdSchema, file_path: pathSchema })
    .strict(),
  'presentation-templates.import-spec-bound': z
    .object({
      conversation_id: presentationConversationIdSchema,
      file_path: pathSchema,
      expected_sha256: presentationSha256Schema,
    })
    .strict(),
  'presentation-templates.remove': z.object({ id: identifierSchema }).strict(),
  'presentation-templates.scratch.allocate': z
    .object({ conversation_id: presentationConversationIdSchema, template_id: identifierSchema })
    .strict(),
  'presentation-templates.scratch.complete': z.object({ run_id: presentationScratchRunIdSchema }).strict(),
  'presentation-templates.scratch.retain': z
    .object({ run_id: presentationScratchRunIdSchema, reason: z.enum(['failed', 'interrupted']) })
    .strict(),
  'presentation-templates.scratch.discard': z.object({ run_id: presentationScratchRunIdSchema }).strict(),
  'presentation-sources.get-source-owner': z.object({ owner: presentationGrantOwnerSchema }).strict(),
  'presentation-sources.create-draft': z.object({ client_request_id: presentationUuidSchema }).strict(),
  'presentation-sources.bind-draft': z
    .object({
      draft_id: presentationUuidSchema,
      conversation_id: presentationConversationIdSchema,
      expected_revision: presentationRevisionSchema,
    })
    .strict(),
  'presentation-sources.pick-sources': z
    .object({ owner: presentationGrantOwnerSchema, expected_owner_revision: presentationRevisionSchema })
    .strict(),
  'presentation-sources.grant-workspace-source': z
    .object({
      conversation_id: presentationConversationIdSchema,
      relative_path: presentationRelativePathSchema,
      expected_owner_revision: presentationRevisionSchema,
    })
    .strict(),
  'presentation-sources.revoke': z
    .object({
      owner: presentationGrantOwnerSchema,
      grant_id: presentationUuidSchema,
      expected_owner_revision: presentationRevisionSchema,
    })
    .strict(),
  'presentation-sources.confirm-queued': z
    .object({
      owner: presentationGrantOwnerSchema,
      queue_item_id: presentationUuidSchema,
      sources: presentationQueuedSourceRefsSchema,
      expected_owner_revision: presentationRevisionSchema,
    })
    .strict(),
  'presentation-runs.start': startPresentationRunSchema,
  'presentation-runs.get': getPresentationRunSchema,
  'presentation-runs.list-recoverable': z
    .object({
      conversation_id: presentationConversationIdSchema,
      cursor: presentationRecoveryCursorSchema.optional(),
      limit: z
        .number()
        .finite()
        .int()
        .min(PRESENTATION_RUN_LIMITS.RECOVERABLE_LIST_MIN_LIMIT)
        .max(PRESENTATION_RUN_LIMITS.RECOVERABLE_LIST_MAX_LIMIT)
        .optional(),
    })
    .strict(),
  'presentation-runs.open-recovery': z
    .object({
      conversation_id: presentationConversationIdSchema,
      run_id: presentationUuidSchema,
      expected_sha256: presentationSha256Schema,
    })
    .strict(),
  'presentation-runs.discard': z
    .object({
      conversation_id: presentationConversationIdSchema,
      run_id: presentationUuidSchema,
      expected_revision: presentationRevisionSchema,
    })
    .strict(),
  'presentation-runs.claim-initial-dispatch': z
    .object({
      conversation_id: presentationConversationIdSchema,
      run_id: presentationUuidSchema,
      holder_id: presentationUuidSchema,
      expected_revision: presentationRevisionSchema,
    })
    .strict(),
  'presentation-runs.renew-initial-dispatch': z
    .object({
      conversation_id: presentationConversationIdSchema,
      run_id: presentationUuidSchema,
      lease_token: z
        .string()
        .min(32)
        .max(256)
        .regex(/^[A-Za-z0-9_-]+$/),
      expected_revision: presentationRevisionSchema,
    })
    .strict(),
  'presentation-runs.dispatch': z
    .object({
      conversation_id: presentationConversationIdSchema,
      run_id: presentationUuidSchema,
      lease_token: z
        .string()
        .min(32)
        .max(256)
        .regex(/^[A-Za-z0-9_-]+$/),
      expected_revision: presentationRevisionSchema,
    })
    .strict(),
  'app-operations.context-compact': appOperationsContextCompactSchema,
  'app-operations.cancel': z.object({ operation_id: identifierSchema }).strict(),
  'project-knowledge.list-sources': projectKnowledgeProjectIdSchema,
  'project-knowledge.add-sources': z
    .object({
      projectId: safeIdSchema,
      filePaths: z.array(pathSchema).max(MAX_PROJECT_KB_FILE_PATHS),
      workspace: pathSchema,
    })
    .strict(),
  'project-knowledge.remove-source': z
    .object({ projectId: safeIdSchema, sourceId: safeIdSchema, workspace: pathSchema })
    .strict(),
  'project-knowledge.get-source-text': projectKnowledgeSourceRefSchema,
  'project-knowledge.retry-source': z
    .object({ projectId: safeIdSchema, sourceId: safeIdSchema, workspace: pathSchema })
    .strict(),
  'project-knowledge.sync-folder': projectKnowledgeFolderSchema,
  'project-knowledge.watch-folder': projectKnowledgeFolderSchema,
  'project-knowledge.unwatch-folder': projectKnowledgeProjectIdSchema,
  'project-knowledge.remove-store': projectKnowledgeProjectIdSchema,
  'project-knowledge.get-session-mcp-server': projectKnowledgeProjectIdSchema,
  'creative-studio.list-projects': voidPayloadSchema,
  'creative-studio.create-project': studioV2ProjectInputSchema,
  'creative-studio.get-project': studioV2ProjectRequestSchema,
  'creative-studio.get-brief-session-server': studioV2ProjectRequestSchema,
  'creative-studio.get-director-session-authority': studioV2ProjectRequestSchema,
  'creative-studio.bind-director-conversation': z
    .object({ ...studioV2MutationRequestShape, conversationId: safeIdSchema })
    .strict(),
  'creative-studio.list-proposals': studioV2ProjectRequestSchema,
  'creative-studio.accept-proposal': z.object({ projectId: safeIdSchema, proposalId: safeIdSchema }).strict(),
  'creative-studio.reject-proposal': z.object({ projectId: safeIdSchema, proposalId: safeIdSchema }).strict(),
  'creative-studio.list-reference-requests': studioV2ProjectRequestSchema,
  'creative-studio.decide-reference-request': studioV2ReferenceDecisionSchema,
  'creative-studio.list-reference-generation-handoffs': studioV2ProjectRequestSchema,
  'creative-studio.get-generation-capability': studioGenerationCapabilitySchema,
  'creative-studio.prepare-project-references': studioV2PrepareProjectReferencesSchema,
  'creative-studio.prepare-submission': studioV2PrepareSubmissionSchema,
  'creative-studio.confirm-submission': z.object({ ...studioV2MutationRequestShape, quoteId: safeIdSchema }).strict(),
  'creative-studio.cancel-job': z.object({ ...studioV2MutationRequestShape, jobId: safeIdSchema }).strict(),
  'creative-studio.retry-job': z
    .object({
      ...studioV2MutationRequestShape,
      jobId: safeIdSchema,
      acknowledgePossibleDuplicateCharge: z.boolean().optional(),
    })
    .strict(),
  'creative-studio.retry-job-download': z.object({ ...studioV2MutationRequestShape, jobId: safeIdSchema }).strict(),
  'creative-studio.dismiss-reference-generation-handoff': z
    .object({ ...studioV2MutationRequestShape, handoffId: safeIdSchema })
    .strict(),
  'creative-studio.apply-authoring-batch': studioV2ApplyAuthoringBatchSchema,
  'creative-studio.undo-last': z.object({ ...studioV2MutationRequestShape, entryId: safeIdSchema }).strict(),
  'creative-studio.get-project-workspace': studioV2ProjectRequestSchema,
  'creative-studio.retry-conditioning-frame': z
    .object({ ...studioV2MutationRequestShape, dependentShotId: safeIdSchema })
    .strict(),
  'creative-studio.cancel-waiting-cascade': z
    .object({ ...studioV2MutationRequestShape, dependentShotId: safeIdSchema })
    .strict(),
  'creative-studio.edit-project': z
    .object({ ...studioV2MutationRequestShape, changes: studioV2EditableProjectChangesSchema })
    .strict(),
  'creative-studio.set-rules': studioV2SetRulesSchema,
  'creative-studio.park-beat': z.object({ ...studioV2MutationRequestShape, beatId: safeIdSchema }).strict(),
  'creative-studio.restore-beat': z
    .object({ ...studioV2MutationRequestShape, beatId: safeIdSchema, beforeBeatId: safeIdSchema.nullable() })
    .strict(),
  'creative-studio.park-shot': z.object({ ...studioV2MutationRequestShape, shotId: safeIdSchema }).strict(),
  'creative-studio.restore-shot': z
    .object({ ...studioV2MutationRequestShape, shotId: safeIdSchema, beforeShotId: safeIdSchema.nullable() })
    .strict(),
  'creative-studio.reorder-bin': z.object({ ...studioV2MutationRequestShape, bin: studioV2BinSchema }).strict(),
  'creative-studio.delete-project': z.object(studioV2MutationRequestShape).strict(),
  'creative-studio.persist-captured-poster': studioV2CapturedPosterSchema,
  'creative-studio.import-seed-still': z.object({ ...studioV2MutationRequestShape, shotId: safeIdSchema }).strict(),
  'creative-studio.import-bed-audio': z.object(studioV2MutationRequestShape).strict(),
  'creative-studio.detach-bed-audio': z.object({ ...studioV2MutationRequestShape, assetId: safeIdSchema }).strict(),
  'creative-studio.set-bed': z.object({ ...studioV2MutationRequestShape, assetId: safeIdSchema.nullable() }).strict(),
  'creative-studio.create-export': z.discriminatedUnion('shape', [
    z
      .object({
        ...studioV2MutationRequestShape,
        expectedCatalogRevision: studioExpectedRevisionSchema,
        shape: z.literal('editor_folder'),
      })
      .strict(),
    z
      .object({
        ...studioV2MutationRequestShape,
        expectedCatalogRevision: studioExpectedRevisionSchema,
        shape: z.literal('still'),
        shotId: safeIdSchema,
      })
      .strict(),
    z
      .object({
        ...studioV2MutationRequestShape,
        expectedCatalogRevision: studioExpectedRevisionSchema,
        shape: z.literal('script'),
      })
      .strict(),
  ]),
  'creative-studio.list-exports': studioV2ProjectRequestSchema,
  'creative-studio.copy-export': z
    .object({
      projectId: safeIdSchema,
      expectedCatalogRevision: studioExpectedRevisionSchema,
      artifactId: safeIdSchema,
    })
    .strict(),
  'creative-studio.reveal-export': z
    .object({
      projectId: safeIdSchema,
      expectedCatalogRevision: studioExpectedRevisionSchema,
      artifactId: safeIdSchema,
    })
    .strict(),
  'creative-studio.list-connection-candidates': voidPayloadSchema,
  'creative-studio.list-connections': voidPayloadSchema,
  'creative-studio.validate-connection': studioConnectionSchema,
  'creative-studio.save-connection': studioConnectionSchema,
  'creative-studio.remove-connection': z.object({ bindingId: safeIdSchema }).strict(),
  'creative-studio.list-routes': z.object({ projectId: safeIdSchema.optional() }).strict().optional(),
  'office-artifact.get-state': z.object(officeArtifactRequestShape).strict(),
  'office-artifact.prepare-preview': z.object(officeArtifactRequestShape).strict(),
  'office-artifact.start-preview': z.object({ leaseId: identifierSchema, url: urlSchema.optional() }).strict(),
  'office-artifact.release-preview': z.object({ leaseId: identifierSchema }).strict(),
  'office-artifact.inspect': officeInspectRequestSchema,
  'office-artifact.apply': z
    .object({
      ...officeArtifactRequestShape,
      expectedVersion: identifierSchema,
      selection: officeSelectionSchema,
      edit: officeEditSchema,
    })
    .strict(),
  'office-artifact.undo': z.object({ ...officeArtifactRequestShape, expectedVersion: identifierSchema }).strict(),
  'window-controls:minimize': voidPayloadSchema,
  'window-controls:maximize': voidPayloadSchema,
  'window-controls:unmaximize': voidPayloadSchema,
  'window-controls:close': voidPayloadSchema,
  'window-controls:is-maximized': voidPayloadSchema,
  'theme:set-active': themeSchema,
  'theme:request-current': voidPayloadSchema,
  'system-settings:get-close-to-tray': voidPayloadSchema,
  'system-settings:set-close-to-tray': booleanSettingSchema,
  'system-settings:get-pet-enabled': voidPayloadSchema,
  'system-settings:set-pet-enabled': booleanSettingSchema,
  'system-settings:get-pet-size': voidPayloadSchema,
  'system-settings:set-pet-size': z
    .object({ size: z.union([z.literal(200), z.literal(280), z.literal(360)]) })
    .strict(),
  'system-settings:get-pet-dnd': voidPayloadSchema,
  'system-settings:set-pet-dnd': z.object({ dnd: z.boolean() }).strict(),
  'system-settings:get-pet-confirm-enabled': voidPayloadSchema,
  'system-settings:set-pet-confirm-enabled': booleanSettingSchema,
  'notification.show': z
    .object({
      title: shortTextSchema,
      body: z.string().max(4096),
      icon: pathSchema.optional(),
      conversation_id: identifierSchema.optional(),
    })
    .strict(),
  'webui.get-status': voidPayloadSchema,
  'webui.start': z.object({ port: portSchema.optional(), allowRemote: z.boolean().optional() }).strict(),
  'webui.stop': voidPayloadSchema,
} satisfies Record<NativeBridgeProviderKey, z.ZodTypeAny>;

export function parseNativeBridgePayload(providerKey: NativeBridgeProviderKey, payload: unknown): unknown {
  const result = nativeBridgePayloadSchemas[providerKey].safeParse(payload);
  if (!result.success) {
    const error = new Error(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
    try {
      nativeBridgePayloadDiagnostics.set(error, buildNativeBridgePayloadDiagnostic(providerKey, result.error.issues));
    } catch {
      // Diagnostic construction must never replace the generic IPC rejection.
    }
    throw error;
  }
  return result.data;
}

export function parseRendererBridgeQueryRequest(queryKey: RendererBridgeQueryKey, payload: unknown): unknown {
  const result = rendererBridgeQuerySchemas[queryKey].request.safeParse(payload);
  if (!result.success) {
    throw new Error(INVALID_RENDERER_BRIDGE_QUERY_PAYLOAD_MESSAGE);
  }
  return result.data;
}

export function parseRendererBridgeQueryResponse(queryKey: RendererBridgeQueryKey, payload: unknown): unknown {
  const result = rendererBridgeQuerySchemas[queryKey].response.safeParse(payload);
  if (!result.success) {
    throw new Error(INVALID_RENDERER_BRIDGE_QUERY_PAYLOAD_MESSAGE);
  }
  return result.data;
}
