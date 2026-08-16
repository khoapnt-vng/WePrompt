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
import { PRESENTATION_RUN_LIMITS } from '../../types/office/presentationRunPolicy';
import { STUDIO_RULE_LIMITS } from '../../types/project/creativeStudioRules';
import {
  STUDIO_MAX_CUT_PLACEMENT_SCENES,
  STUDIO_MAX_DIRTY_SCENES_REPORTED,
  STUDIO_MAX_GENERATION_SCENES_PER_REQUEST,
  STUDIO_MAX_SCENES,
  STUDIO_REFERENCE_PROMPT_MAX_LENGTH,
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
const presentationRevisionSchema = z
  .number()
  .finite()
  .int()
  .nonnegative()
  .refine((value) => Number.isSafeInteger(value));
const presentationGrantOwnerSchema = z.discriminatedUnion('owner_type', [
  z.object({ owner_type: z.literal('draft'), draft_id: presentationUuidSchema }).strict(),
  z.object({ owner_type: z.literal('conversation'), conversation_id: presentationUuidSchema }).strict(),
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
    conversation_id: presentationUuidSchema,
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
  z.object({ conversation_id: presentationUuidSchema, run_id: presentationUuidSchema }).strict(),
  z.object({ conversation_id: presentationUuidSchema, client_request_id: presentationUuidSchema }).strict(),
]);
const presentationRecoveryCursorSchema = z
  .string()
  .min(3)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

const studioExpectedRevisionSchema = z.number().finite().int().positive();
const studioProjectInputSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    brief: z.string().max(16 * 1024),
    forgeProjectId: safeIdSchema.optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']),
    targetDurationSeconds: z.number().finite().int().min(5).max(60),
    resolution: z.enum(['720p', '1080p']),
  })
  .strict();
const studioProjectRequestSchema = z.object({ projectId: safeIdSchema }).strict();
const studioCapturedPosterDataUrlMaxLength = Math.ceil((50 * 1024 * 1024) / 3) * 4 + 22;
const studioCapturedPosterSchema = z
  .object({
    projectId: safeIdSchema,
    sceneId: safeIdSchema,
    videoAssetId: safeIdSchema,
    dataUrl: z
      .string()
      .min(26)
      .max(studioCapturedPosterDataUrlMaxLength)
      .regex(/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    width: z.number().finite().int().min(1).max(16_384),
    height: z.number().finite().int().min(1).max(16_384),
  })
  .strict();
const isUnsafeStudioTextCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0)!;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff);
};
const studioModelSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim() && !Array.from(value).some(isUnsafeStudioTextCharacter));
const studioTextModelSelectionSchema = z
  .object({
    providerId: safeIdSchema,
    model: studioModelSchema,
  })
  .strict();
const studioMediaModelSelectionSchema = z.object({ choiceId: safeIdSchema }).strict();
const storyboardSelectionSchema = z
  .object({
    projectId: safeIdSchema,
    expectedRevision: studioExpectedRevisionSchema,
    role: z.literal('storyboard'),
    selection: studioTextModelSelectionSchema.nullable(),
  })
  .strict();
const imageSelectionSchema = z
  .object({
    projectId: safeIdSchema,
    expectedRevision: studioExpectedRevisionSchema,
    role: z.literal('image'),
    selection: studioMediaModelSelectionSchema.nullable(),
  })
  .strict();
const videoSelectionSchema = z
  .object({
    projectId: safeIdSchema,
    expectedRevision: studioExpectedRevisionSchema,
    role: z.literal('video'),
    selection: studioMediaModelSelectionSchema.nullable(),
  })
  .strict();
const studioUpdateModelSelectionSchema = z.discriminatedUnion('role', [
  storyboardSelectionSchema,
  imageSelectionSchema,
  videoSelectionSchema,
]);
const studioConnectionSchema = z
  .object({
    providerId: safeIdSchema,
    integrationId: safeIdSchema,
    model: z.string().trim().min(1).max(256),
  })
  .strict();
const studioSceneRouteSnapshotSchema = z
  .object({
    sceneId: safeIdSchema,
    choiceId: safeIdSchema,
    kind: z.enum(['image', 'video']),
  })
  .strict();
const studioSubmitScenesSchema = z
  .object({
    projectId: safeIdSchema,
    expectedRevision: studioExpectedRevisionSchema,
    mode: z.enum(['single', 'batch']),
    sceneIds: z
      .array(safeIdSchema)
      .min(1)
      .max(STUDIO_MAX_GENERATION_SCENES_PER_REQUEST)
      .refine((ids) => new Set(ids).size === ids.length),
    catalogVersion: z.string().regex(/^[a-f0-9]{16}$/),
    routes: z.array(studioSceneRouteSnapshotSchema).min(1).max(STUDIO_MAX_GENERATION_SCENES_PER_REQUEST),
    outputRole: z.enum(['take', 'reference']).optional(),
    referencePrompts: z
      .array(
        z
          .object({
            sceneId: safeIdSchema,
            prompt: z.string().trim().min(1).max(STUDIO_REFERENCE_PROMPT_MAX_LENGTH),
          })
          .strict()
      )
      .min(1)
      .max(STUDIO_MAX_GENERATION_SCENES_PER_REQUEST)
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === 'single' && input.sceneIds.length !== 1) {
      context.addIssue({ code: 'custom', message: 'single mode requires exactly one scene', path: ['sceneIds'] });
    }
    const routeSceneIds = input.routes.map((route) => route.sceneId);
    const selectedSceneIds = new Set(input.sceneIds);
    if (
      new Set(routeSceneIds).size !== routeSceneIds.length ||
      routeSceneIds.length !== input.sceneIds.length ||
      routeSceneIds.some((sceneId) => !selectedSceneIds.has(sceneId))
    ) {
      context.addIssue({ code: 'custom', message: 'routes must exactly match sceneIds', path: ['routes'] });
    }
    if (input.outputRole === 'reference') {
      // A reference plate without a prompt has nothing to paint, and a prompt that names no
      // submitted scene describes nothing. Both are refused here rather than at the provider.
      const promptSceneIds = (input.referencePrompts ?? []).map(({ sceneId }) => sceneId);
      if (
        promptSceneIds.length !== input.sceneIds.length ||
        new Set(promptSceneIds).size !== promptSceneIds.length ||
        promptSceneIds.some((sceneId) => !selectedSceneIds.has(sceneId))
      ) {
        context.addIssue({
          code: 'custom',
          message: 'reference submissions need exactly one referencePrompt per scene',
          path: ['referencePrompts'],
        });
      }
    } else if (input.referencePrompts !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'referencePrompts requires outputRole reference',
        path: ['referencePrompts'],
      });
    }
  });
const studioFitStoryboardSchema = z
  .object({
    projectId: safeIdSchema,
    expectedRevision: studioExpectedRevisionSchema,
    catalogVersion: z.string().regex(/^[a-f0-9]{16}$/),
  })
  .strict();
const studioJobRequestSchema = z
  .object({
    projectId: safeIdSchema,
    jobId: safeIdSchema,
    expectedRevision: studioExpectedRevisionSchema,
  })
  .strict();
const studioSceneSchema = z
  .object({
    title: z.string().trim().min(0).max(256),
    purpose: z.string().max(256),
    visualPrompt: z.string().max(8 * 1024),
    narration: z.string().max(4 * 1024),
    onScreenText: z.string().max(1024),
    mediaKind: z.enum(['image', 'video']),
    durationSeconds: z.number().finite().int().min(1).max(60),
    referenceAssetId: safeIdSchema.nullable(),
  })
  .strict();
const studioBriefRulePredicateSchema = z
  .object({
    kind: z.literal('forbidden_terms'),
    terms: z.array(z.string().trim().min(1).max(STUDIO_RULE_LIMITS.term)).min(1).max(STUDIO_RULE_LIMITS.maxTerms),
  })
  .strict();
const studioSetBriefRulesSchema = z
  .object({
    projectId: safeIdSchema,
    expectedRevision: studioExpectedRevisionSchema,
    rules: z
      .array(
        z
          .object({
            id: safeIdSchema,
            text: z.string().trim().min(1).max(STUDIO_RULE_LIMITS.text),
            predicate: studioBriefRulePredicateSchema.nullable(),
          })
          .strict()
      )
      .max(STUDIO_RULE_LIMITS.maxRules),
  })
  .strict();
const studioUpdateProjectSchema = z
  .object({
    projectId: safeIdSchema,
    expectedRevision: studioExpectedRevisionSchema,
    name: z.string().trim().min(1).max(256).optional(),
    brief: z
      .string()
      .max(16 * 1024)
      .optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']).optional(),
    targetDurationSeconds: z.number().finite().int().min(5).max(60).optional(),
    resolution: z.enum(['720p', '1080p']).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'projectId' && key !== 'expectedRevision'));
const studioNormalisedRectSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .strict()
  .refine((rect) => rect.x + rect.width <= 1 && rect.y + rect.height <= 1);
const studioCutFilterSchema = z
  .object({
    id: z.enum(['exposure', 'contrast', 'saturation', 'temperature']),
    amount: z.number().finite().min(-1).max(1),
  })
  .strict();
const studioEditableCutClipSchema = z
  .object({
    sourceInSeconds: z.number().finite().nonnegative().nullable(),
    sourceOutSeconds: z.number().finite().nonnegative().nullable(),
    crop: studioNormalisedRectSchema.nullable(),
    filters: z
      .array(studioCutFilterSchema)
      .refine((filters) => new Set(filters.map((filter) => filter.id)).size === filters.length),
  })
  .strict()
  .refine(
    (clip) =>
      clip.sourceInSeconds === null || clip.sourceOutSeconds === null || clip.sourceInSeconds < clip.sourceOutSeconds
  );
const studioEditableCutSchema = z
  .object({
    orderMode: z.enum(['storyboard', 'manual']),
    clipOrder: z.array(safeIdSchema).refine((ids) => new Set(ids).size === ids.length),
    clips: z.record(safeIdSchema, studioEditableCutClipSchema),
  })
  .strict()
  .refine(
    (cut) =>
      cut.clipOrder.length === Object.keys(cut.clips).length &&
      cut.clipOrder.every((clipId) => Object.hasOwn(cut.clips, clipId))
  );
const studioUpdateCutSchema = z
  .object({
    projectId: safeIdSchema,
    expectedRevision: studioExpectedRevisionSchema,
    cutId: safeIdSchema,
    cut: studioEditableCutSchema,
  })
  .strict();

export const INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE = '[adapter] Native IPC request rejected: invalid operation payload';
export const INVALID_RENDERER_BRIDGE_QUERY_PAYLOAD_MESSAGE =
  '[adapter] Renderer IPC query rejected: invalid operation payload';

export const rendererBridgeQuerySchemas = {
  'creative-studio.has-unsaved-work': {
    request: voidPayloadSchema,
    response: z
      .object({ dirtySceneCount: z.number().finite().int().min(0).max(STUDIO_MAX_DIRTY_SCENES_REPORTED) })
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
    .object({ conversation_id: presentationUuidSchema, file_path: pathSchema })
    .strict(),
  'presentation-templates.import-spec-bound': z
    .object({
      conversation_id: presentationUuidSchema,
      file_path: pathSchema,
      expected_sha256: presentationSha256Schema,
    })
    .strict(),
  'presentation-templates.remove': z.object({ id: identifierSchema }).strict(),
  'presentation-templates.scratch.allocate': z
    .object({ conversation_id: identifierSchema, template_id: identifierSchema })
    .strict(),
  'presentation-templates.scratch.complete': z.object({ run_id: z.string().uuid() }).strict(),
  'presentation-templates.scratch.retain': z
    .object({ run_id: z.string().uuid(), reason: z.enum(['failed', 'interrupted']) })
    .strict(),
  'presentation-templates.scratch.discard': z.object({ run_id: z.string().uuid() }).strict(),
  'presentation-sources.get-source-owner': z.object({ owner: presentationGrantOwnerSchema }).strict(),
  'presentation-sources.create-draft': z.object({ client_request_id: presentationUuidSchema }).strict(),
  'presentation-sources.bind-draft': z
    .object({
      draft_id: presentationUuidSchema,
      conversation_id: presentationUuidSchema,
      expected_revision: presentationRevisionSchema,
    })
    .strict(),
  'presentation-sources.pick-sources': z
    .object({ owner: presentationGrantOwnerSchema, expected_owner_revision: presentationRevisionSchema })
    .strict(),
  'presentation-sources.grant-workspace-source': z
    .object({
      conversation_id: presentationUuidSchema,
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
      conversation_id: presentationUuidSchema,
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
      conversation_id: presentationUuidSchema,
      run_id: presentationUuidSchema,
      expected_sha256: presentationSha256Schema,
    })
    .strict(),
  'presentation-runs.discard': z
    .object({
      conversation_id: presentationUuidSchema,
      run_id: presentationUuidSchema,
      expected_revision: presentationRevisionSchema,
    })
    .strict(),
  'presentation-runs.claim-initial-dispatch': z
    .object({
      conversation_id: presentationUuidSchema,
      run_id: presentationUuidSchema,
      holder_id: presentationUuidSchema,
      expected_revision: presentationRevisionSchema,
    })
    .strict(),
  'presentation-runs.renew-initial-dispatch': z
    .object({
      conversation_id: presentationUuidSchema,
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
      conversation_id: presentationUuidSchema,
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
  'creative-studio.create-project': studioProjectInputSchema,
  'creative-studio.get-project': studioProjectRequestSchema,
  'creative-studio.get-brief-session-server': studioProjectRequestSchema,
  'creative-studio.list-proposals': studioProjectRequestSchema,
  'creative-studio.list-pending-reference-requests': studioProjectRequestSchema,
  'creative-studio.dismiss-reference-requests': z
    .object({
      projectId: safeIdSchema,
      requestIds: z
        .array(safeIdSchema)
        .min(1)
        .max(50)
        .refine((ids) => new Set(ids).size === ids.length),
      expectedRevision: studioExpectedRevisionSchema.optional(),
      expectedRequests: z
        .array(z.object({ id: safeIdSchema, sceneId: safeIdSchema }).strict())
        .min(1)
        .max(50)
        .optional(),
    })
    .strict()
    .superRefine((value, context) => {
      const hasExpectedRevision = value.expectedRevision !== undefined;
      const hasExpectedRequests = value.expectedRequests !== undefined;
      if (hasExpectedRevision !== hasExpectedRequests) {
        context.addIssue({ code: 'custom', message: 'Checked consume authority must be paired' });
        return;
      }
      if (
        value.expectedRequests !== undefined &&
        (value.expectedRequests.length !== value.requestIds.length ||
          value.expectedRequests.some((request, index) => request.id !== value.requestIds[index]))
      ) {
        context.addIssue({ code: 'custom', message: 'Checked consume authority must match request order' });
      }
    }),
  'creative-studio.accept-proposal': z.object({ projectId: safeIdSchema, proposalId: safeIdSchema }).strict(),
  'creative-studio.reject-proposal': z.object({ projectId: safeIdSchema, proposalId: safeIdSchema }).strict(),
  'creative-studio.propose-storyboard': z
    .object({
      projectId: safeIdSchema,
      expectedRevision: studioExpectedRevisionSchema,
      replaceExisting: z.boolean(),
    })
    .strict(),
  'creative-studio.update-model-selection': studioUpdateModelSelectionSchema,
  'creative-studio.update-project': studioUpdateProjectSchema,
  'creative-studio.set-brief-rules': studioSetBriefRulesSchema,
  'creative-studio.undo-brief-rules': studioProjectRequestSchema,
  'creative-studio.bind-brief-conversation': z
    .object({
      projectId: safeIdSchema,
      expectedRevision: studioExpectedRevisionSchema,
      conversationId: safeIdSchema.nullable(),
    })
    .strict(),
  'creative-studio.update-cut': studioUpdateCutSchema,
  'creative-studio.place-cut-scenes': z
    .object({
      projectId: safeIdSchema,
      expectedRevision: studioExpectedRevisionSchema,
      cutId: safeIdSchema,
      sceneIds: z
        .array(safeIdSchema)
        .min(1)
        .max(STUDIO_MAX_CUT_PLACEMENT_SCENES)
        .refine((ids) => new Set(ids).size === ids.length),
      beforeClipId: safeIdSchema.nullable(),
    })
    .strict(),
  'creative-studio.delete-project': z
    .object({ projectId: safeIdSchema, expectedRevision: studioExpectedRevisionSchema })
    .strict(),
  'creative-studio.update-scene': z
    .object({
      projectId: safeIdSchema,
      expectedRevision: studioExpectedRevisionSchema,
      sceneId: safeIdSchema,
      scene: studioSceneSchema.nullable(),
    })
    .strict(),
  'creative-studio.reorder-scenes': z
    .object({
      projectId: safeIdSchema,
      expectedRevision: studioExpectedRevisionSchema,
      sceneOrder: z
        .array(safeIdSchema)
        .min(1)
        .max(STUDIO_MAX_SCENES)
        .refine((ids) => new Set(ids).size === ids.length),
    })
    .strict(),
  'creative-studio.select-asset': z
    .object({
      projectId: safeIdSchema,
      expectedRevision: studioExpectedRevisionSchema,
      sceneId: safeIdSchema,
      assetId: safeIdSchema,
    })
    .strict(),
  'creative-studio.persist-captured-poster': studioCapturedPosterSchema,
  'creative-studio.choose-and-import-reference': z
    .object({
      projectId: safeIdSchema,
      sceneId: safeIdSchema.optional(),
      briefReferenceRole: z.enum(['cast', 'look']).optional(),
      expectedRevision: studioExpectedRevisionSchema,
    })
    .strict()
    .refine((input) => input.sceneId === undefined || input.briefReferenceRole === undefined),
  'creative-studio.detach-brief-reference': z
    .object({
      projectId: safeIdSchema,
      assetId: safeIdSchema,
      expectedRevision: studioExpectedRevisionSchema,
    })
    .strict(),
  'creative-studio.choose-and-export-assets': z
    .object({ projectId: safeIdSchema, includeReferences: z.boolean() })
    .strict(),
  'creative-studio.get-latest-render': studioProjectRequestSchema,
  'creative-studio.render-cut': studioProjectRequestSchema,
  'creative-studio.cancel-render': studioProjectRequestSchema,
  'creative-studio.fit-storyboard': studioFitStoryboardSchema,
  'creative-studio.submit-scenes': studioSubmitScenesSchema,
  'creative-studio.cancel-job': studioJobRequestSchema,
  'creative-studio.retry-job': studioJobRequestSchema
    .extend({ acknowledgePossibleDuplicateCharge: z.boolean().optional() })
    .strict(),
  'creative-studio.retry-download': studioJobRequestSchema,
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
    throw new Error(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
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
