/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { STUDIO_PILOT_ENV } from '@/common/types/project/creativeStudioPilotMcpEnv';
import {
  STUDIO_MAX_BEATS_PER_BOARD_V4,
  STUDIO_MAX_SHOTS_PER_BOARD_V4,
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MAX_STORY_LENGTH,
  STUDIO_MIN_SHOT_SECONDS,
} from '@/common/types/project/creativeStudioTypes';
import { BUILTIN_STUDIO_NAME } from './constants';
import { isCanonicalStudioPieceHandleV3 } from '@process/services/creative-studio/service/schema2/mutations/pieceHandles';
import {
  STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  STUDIO_PILOT_DIRECTOR_MAX_DEADLINE_MS,
  type StudioPilotDirectorCommand,
  type StudioPilotDirectorReceipt,
} from '@process/services/creative-studio/service/pilot/director/contracts';
import { createStudioPilotDirectorMailbox } from '@process/services/creative-studio/service/pilot/director/mailbox';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const RECEIPT_WAIT_MS = 5_000;
const POLL_MS = 50;

export type PilotStudioServerConfig = { projectId: string; projectDir: string };
export type PilotStudioToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
export type PilotStudioServerDependencies = {
  createMailbox?: typeof createStudioPilotDirectorMailbox;
  createCommandId?: () => string;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const MUTATING: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };

const BOARD_SHOT_SCHEMA = z
  .object({
    shooting_script: z.string().min(1).max(STUDIO_MAX_SHOOTING_SCRIPT_LENGTH),
    duration_seconds: z.number().int().min(STUDIO_MIN_SHOT_SECONDS).max(STUDIO_MAX_SHOT_SECONDS),
  })
  .strict();
const BOARD_BEAT_SCHEMA = z
  .object({
    title: z.string().min(1).max(256),
    story: z.string().max(STUDIO_MAX_STORY_LENGTH),
    target_seconds: z.number().int().min(1).max(1_440).nullable(),
    shots: z.array(BOARD_SHOT_SCHEMA).min(1).max(STUDIO_MAX_SHOTS_PER_BOARD_V4),
  })
  .strict();
const PROPOSE_BOARD_SCHEMA = z
  .object({
    expected_authoring_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    handle: z.string().refine(isCanonicalStudioPieceHandleV3),
    beats: z.array(BOARD_BEAT_SCHEMA).min(1).max(STUDIO_MAX_BEATS_PER_BOARD_V4),
  })
  .strict()
  .refine(
    (input) => input.beats.reduce((count, beat) => count + beat.shots.length, 0) <= STUDIO_MAX_SHOTS_PER_BOARD_V4,
    { message: 'A Board cannot contain more than the supported Shot limit', path: ['beats'] }
  );

const result = (value: unknown, isError = false): PilotStudioToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

export const parsePilotStudioServerEnv = (environment: NodeJS.ProcessEnv): PilotStudioServerConfig => {
  const projectId = environment[STUDIO_PILOT_ENV.projectId];
  const configuredDir = environment[STUDIO_PILOT_ENV.projectDir];
  if (
    projectId === undefined ||
    !SAFE_ID.test(projectId) ||
    configuredDir === undefined ||
    !path.isAbsolute(configuredDir)
  ) {
    throw new Error('Invalid Creative Studio Pilot environment');
  }
  const projectDir = path.resolve(configuredDir);
  if (projectDir !== configuredDir) throw new Error('Invalid Creative Studio Pilot directory');
  return { projectId, projectDir };
};

const verifiedProjectDirectory = async (config: PilotStudioServerConfig, projectId: string): Promise<string | null> => {
  if (projectId !== config.projectId) return null;
  const stats = await fs.lstat(config.projectDir);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(config.projectDir)) !== config.projectDir) {
    return null;
  }
  return config.projectDir;
};

const waitForReceipt = async (
  config: PilotStudioServerConfig,
  command: StudioPilotDirectorCommand,
  dependencies: PilotStudioServerDependencies
): Promise<PilotStudioToolResult> => {
  const mailbox = (dependencies.createMailbox ?? createStudioPilotDirectorMailbox)({
    resolveVerifiedProjectDirectory: (projectId) => verifiedProjectDirectory(config, projectId),
  });
  await mailbox.submit(command);
  const now = dependencies.now ?? Date.now;
  const sleep =
    dependencies.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const expires = now() + RECEIPT_WAIT_MS;
  while (now() < expires) {
    // eslint-disable-next-line no-await-in-loop
    const status = await mailbox.readStatus(command.projectId, command.commandId);
    if (status.status === 'terminal') {
      return result(status.receipt, status.receipt.status !== 'succeeded');
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(POLL_MS);
  }
  return result({ status: 'pending', commandId: command.commandId, projectId: command.projectId });
};

const commandBase = (
  config: PilotStudioServerConfig,
  policy: StudioPilotDirectorCommand['policy'],
  dependencies: PilotStudioServerDependencies
) => {
  const created = (dependencies.now ?? Date.now)();
  return {
    schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
    commandId: dependencies.createCommandId?.() ?? `command_${randomUUID().replaceAll('-', '')}`,
    projectId: config.projectId,
    createdAt: new Date(created).toISOString(),
    deadlineAt: new Date(created + STUDIO_PILOT_DIRECTOR_MAX_DEADLINE_MS).toISOString(),
    policy,
  };
};

export const registerPilotStudioTools = (
  server: McpServer,
  config: PilotStudioServerConfig,
  dependencies: PilotStudioServerDependencies = {}
): void => {
  server.registerTool(
    'studio_get_project_status',
    {
      description: 'Read the current schema-6 photo canvas. This never generates, authorizes, or spends.',
      inputSchema: z.object({}).strict(),
      annotations: READ_ONLY,
    },
    () =>
      waitForReceipt(
        config,
        { ...commandBase(config, 'get_project_status', dependencies), policy: 'get_project_status' },
        dependencies
      )
  );
  server.registerTool(
    'studio_prepare_photo',
    {
      description:
        'Prepare one quoted Piece from exact words and up to two current Piece references. This creates no authorization and cannot spend.',
      inputSchema: z
        .object({
          expected_authoring_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          words: z.string().min(1).max(16_000),
          aspect_ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']),
          resolution: z.enum(['720p', '1080p']),
          suggested_handle: z.string().min(1).max(256).nullable().optional(),
          reference_piece_ids: z.array(z.string().regex(SAFE_ID)).max(2).default([]),
        })
        .strict(),
      annotations: MUTATING,
    },
    (input) =>
      waitForReceipt(
        config,
        {
          ...commandBase(config, 'prepare_photo', dependencies),
          policy: 'prepare_photo',
          expectedAuthoringRevision: input.expected_authoring_revision,
          words: input.words,
          settings: { aspectRatio: input.aspect_ratio, resolution: input.resolution },
          suggestedHandle: input.suggested_handle ?? null,
          referencePieceIds: input.reference_piece_ids,
        },
        dependencies
      )
  );
  server.registerTool(
    'studio_propose_board',
    {
      description:
        'Record one Board draft for human review. This creates no Board, authorization, generation, or spend; only the renderer can accept or reject it.',
      inputSchema: PROPOSE_BOARD_SCHEMA,
      annotations: MUTATING,
    },
    (input) =>
      waitForReceipt(
        config,
        {
          ...commandBase(config, 'propose_board', dependencies),
          policy: 'propose_board',
          expectedAuthoringRevision: input.expected_authoring_revision,
          handle: input.handle,
          beats: input.beats.map((beat) => ({
            title: beat.title,
            story: beat.story,
            targetSeconds: beat.target_seconds,
            shots: beat.shots.map((shot) => ({
              shootingScript: shot.shooting_script,
              durationSeconds: shot.duration_seconds,
            })),
          })),
        },
        dependencies
      )
  );
  server.registerTool(
    'studio_rename_piece',
    {
      description: 'Rename one existing Piece at an exact authoring revision. This is free and cannot spend.',
      inputSchema: z
        .object({
          expected_authoring_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          piece_id: z.string().regex(SAFE_ID),
          handle: z.string().min(1).max(256),
        })
        .strict(),
      annotations: MUTATING,
    },
    (input) =>
      waitForReceipt(
        config,
        {
          ...commandBase(config, 'rename_piece', dependencies),
          policy: 'rename_piece',
          expectedAuthoringRevision: input.expected_authoring_revision,
          pieceId: input.piece_id,
          handle: input.handle,
        },
        dependencies
      )
  );
  server.registerTool(
    'studio_get_command_status',
    {
      description: 'Read one exact schema-13 command status. This never changes project state.',
      inputSchema: z.object({ command_id: z.string().regex(SAFE_ID) }).strict(),
      annotations: READ_ONLY,
    },
    async ({ command_id }) => {
      const mailbox = (dependencies.createMailbox ?? createStudioPilotDirectorMailbox)({
        resolveVerifiedProjectDirectory: (projectId) => verifiedProjectDirectory(config, projectId),
      });
      const status = await mailbox.readStatus(config.projectId, command_id);
      return result(status, status.status === 'terminal' && status.receipt.status !== 'succeeded');
    }
  );
};

/* v8 ignore next -- exercised by the bundled subprocess acceptance path */
async function main(): Promise<void> {
  const server = new McpServer({ name: BUILTIN_STUDIO_NAME, version: '2.0.0' });
  registerPilotStudioTools(server, parsePilotStudioServerEnv(process.env));
  await server.connect(new StdioServerTransport());
}

/* v8 ignore start -- exercised by the bundled subprocess acceptance path, not in-process unit tests */
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((error) => {
    console.error('[StudioPilotMCP] Fatal error:', error instanceof Error ? error.name : 'UnknownError');
    process.exit(1);
  });
}
/* v8 ignore stop */
