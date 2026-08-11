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
import { STUDIO_ENV } from '@/common/types/project/creativeStudioMcpEnv';
import type {
  StudioEditableScene,
  StudioProject,
  StudioRouteCatalog,
} from '@/common/types/project/creativeStudioTypes';
import { BUILTIN_STUDIO_NAME } from '@process/resources/builtinMcp/constants';
import { StudioProposalWriteError, writeProposalRecord } from '@process/resources/builtinMcp/studioProposalWriter';
import { writeReferenceRequestRecord } from '@process/resources/builtinMcp/studioReferenceRequestWriter';
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
  status?: 'queued_for_approval';
};

export type ProposeStoryboardInput = {
  base_revision: number;
  scene_order: string[];
  scenes: Record<string, StudioEditableScene>;
};

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

const editableSceneSchema = z
  .object({
    title: z.string().max(256),
    purpose: z.string().max(2048),
    visualPrompt: z.string().max(4096),
    narration: z.string().max(4096),
    onScreenText: z.string().max(1024),
    mediaKind: z.enum(['image', 'video']),
    durationSeconds: z.number().int().min(1).max(60),
    referenceAssetId: z.string().regex(SAFE_ID).nullable(),
  })
  .strict();

export function parseStudioServerEnv(env: Record<string, string | undefined>): StudioServerEnv | null {
  const projectId = env[STUDIO_ENV.projectId];
  const projectDir = env[STUDIO_ENV.projectDir];
  const pendingDir = env[STUDIO_ENV.pendingDir];
  const referencePendingDir = env[STUDIO_ENV.referencePendingDir];
  const serializedRouteCatalog = env[STUDIO_ENV.routeCatalog];
  if (!projectId || !projectDir || !pendingDir || !referencePendingDir) return null;
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

const readProject = async (config: StudioServerEnv): Promise<StudioProject> =>
  JSON.parse(await readFile(path.join(config.projectDir, 'project.json'), 'utf8')) as StudioProject;

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
                hasReference: scene.referenceAssetId !== null,
                hasSelectedTake: scene.selectedAssetId !== null,
              },
            ],
          ];
        })
      );
      const view = {
        revision: project.revision,
        name: project.name,
        brief: project.brief,
        aspectRatio: project.aspectRatio,
        targetDurationSeconds: project.targetDurationSeconds,
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

export function createRequestReferenceImagesHandler(
  config: StudioServerEnv | null
): (input: { sceneIds: string[] }) => Promise<StudioToolResult> {
  return async ({ sceneIds }) => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    if (
      !Array.isArray(sceneIds) ||
      sceneIds.length < 1 ||
      sceneIds.length > 24 ||
      sceneIds.some((sceneId) => !SAFE_ID.test(sceneId)) ||
      new Set(sceneIds).size !== sceneIds.length
    ) {
      return errorResult('Reference requests require between 1 and 24 unique scene ids.');
    }
    try {
      const project = await readProject(config);
      const unknownSceneId = sceneIds.find((sceneId) => project.scenes[sceneId] === undefined);
      if (unknownSceneId) return errorResult(`Unknown scene: ${unknownSceneId}`);
      await Promise.all(
        sceneIds.map((sceneId) =>
          writeReferenceRequestRecord({
            pendingDir: config.referencePendingDir,
            projectId: config.projectId,
            sceneId,
          })
        )
      );
      return {
        status: 'queued_for_approval',
        content: [
          {
            type: 'text',
            text: `${sceneIds.length} reference image request(s) queued for user approval; nothing was generated.`,
          },
        ],
      };
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
    "Read the Studio project's current script: revision, settings, and every scene's editable fields plus whether it has a reference image and a selected take. Always call this before proposing.",
    {},
    createReadStoryboardHandler(config)
  );
  server.tool(
    'studio_request_reference_images',
    'Request a supporting reference image for one or more scenes. This does NOT generate anything — it queues a request the user approves before any money is spent. One image per scene; do not request a scene that already has one unless the user asked you to replace it.',
    { sceneIds: z.array(z.string().regex(SAFE_ID)).min(1).max(24) },
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
      scene_order: z.array(z.string().regex(SAFE_ID)).min(1).max(24),
      scenes: z.record(z.string().regex(SAFE_ID), editableSceneSchema),
    },
    createProposeStoryboardHandler(config)
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
