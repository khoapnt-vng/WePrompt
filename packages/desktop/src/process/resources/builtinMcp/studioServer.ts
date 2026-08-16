/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Built-in MCP server for one Creative Studio project. This subprocess can
// read a bounded script view and write durable approval-queue records. It never
// writes project.json; the main-process store remains the sole project writer.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  hasRuleToken,
  resolveEffectiveStudioRules,
  STUDIO_RULE_LIMITS,
} from '@/common/types/project/creativeStudioRules';
import { STUDIO_ENV } from '@/common/types/project/creativeStudioMcpEnv';
import { resolveActiveStudioBriefReferences } from '@/common/types/project/creativeStudioManagedAssetCollections';
import {
  STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SCENE,
  STUDIO_MAX_REFERENCE_REQUEST_SCENES,
  STUDIO_MAX_SCENES,
  type StudioAsset,
  type StudioEditableScene,
  type StudioProject,
  type StudioScene,
  type StudioRouteCatalog,
} from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioGeneratedTake } from '@/common/types/project/creativeStudioCanonicalTake';
import { BUILTIN_STUDIO_NAME } from '@process/resources/builtinMcp/constants';
import { StudioProposalWriteError, writeProposalRecord } from '@process/resources/builtinMcp/studioProposalWriter';
import {
  listPendingReferenceRequestSceneIds,
  writeReferenceRequestRecord,
} from '@process/resources/builtinMcp/studioReferenceRequestWriter';
import { StudioPendingRecordWriteError } from '@process/resources/builtinMcp/studioPendingRecordWriter';

export type StudioServerEnv = {
  projectId: string;
  projectDir: string;
  pendingDir: string;
  referencePendingDir: string;
  routeCatalog?: StudioRouteCatalog | null;
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

export function registerStudioTools(server: Pick<McpServer, 'tool'>, config: StudioServerEnv | null): void {
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
