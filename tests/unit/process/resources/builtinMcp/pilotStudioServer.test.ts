import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { STUDIO_PILOT_ENV } from '@/common/types/project/creativeStudioPilotMcpEnv';
import { parsePilotStudioServerEnv, registerPilotStudioTools } from '@process/resources/builtinMcp/pilotStudioServer';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('schema-11 Pilot Studio MCP server', () => {
  it('accepts only one safe project identity and absolute directory', () => {
    const projectDir = path.resolve('/tmp/studio-project');
    expect(
      parsePilotStudioServerEnv({
        [STUDIO_PILOT_ENV.projectId]: 'project_1',
        [STUDIO_PILOT_ENV.projectDir]: projectDir,
      })
    ).toEqual({ projectId: 'project_1', projectDir });
    expect(() =>
      parsePilotStudioServerEnv({
        [STUDIO_PILOT_ENV.projectId]: '../project',
        [STUDIO_PILOT_ENV.projectDir]: projectDir,
      })
    ).toThrow('Invalid Creative Studio Pilot environment');
    expect(() => parsePilotStudioServerEnv({ [STUDIO_PILOT_ENV.projectDir]: projectDir })).toThrow(
      'Invalid Creative Studio Pilot environment'
    );
    expect(() => parsePilotStudioServerEnv({ [STUDIO_PILOT_ENV.projectId]: 'project_1' })).toThrow(
      'Invalid Creative Studio Pilot environment'
    );
    expect(() =>
      parsePilotStudioServerEnv({
        [STUDIO_PILOT_ENV.projectId]: 'project_1',
        [STUDIO_PILOT_ENV.projectDir]: `${projectDir}${path.sep}..${path.sep}${path.basename(projectDir)}`,
      })
    ).toThrow('Invalid Creative Studio Pilot directory');
    expect(() =>
      parsePilotStudioServerEnv({
        [STUDIO_PILOT_ENV.projectId]: 'project_1',
        [STUDIO_PILOT_ENV.projectDir]: 'relative/project',
      })
    ).toThrow('Invalid Creative Studio Pilot environment');
  });

  it('registers exactly the two reads and two bounded direct operations', () => {
    const registered: Array<{ name: string; annotations: unknown }> = [];
    const server = {
      registerTool: vi.fn((name: string, definition: { annotations: unknown }) => {
        registered.push({ name, annotations: definition.annotations });
      }),
    };

    registerPilotStudioTools(server as never, { projectId: 'project_1', projectDir: '/tmp/project_1' });

    expect(registered).toEqual([
      {
        name: 'studio_get_project_status',
        annotations: expect.objectContaining({ readOnlyHint: true, destructiveHint: false }),
      },
      {
        name: 'studio_prepare_photo',
        annotations: expect.objectContaining({ readOnlyHint: false, destructiveHint: true }),
      },
      {
        name: 'studio_rename_piece',
        annotations: expect.objectContaining({ readOnlyHint: false, destructiveHint: true }),
      },
      {
        name: 'studio_get_command_status',
        annotations: expect.objectContaining({ readOnlyHint: true, destructiveHint: false }),
      },
    ]);
  });

  it('routes all four tools through the same typed mailbox without spend authority', async () => {
    const handlers = new Map<string, (input: never) => Promise<unknown>>();
    const submitted: unknown[] = [];
    const readStatus = vi.fn(async (_projectId: string, commandId: string) => ({
      status: 'terminal' as const,
      receipt: {
        schemaVersion: 11,
        commandId,
        projectId: 'project_1',
        status: 'succeeded' as const,
        completedAt: '2026-09-01T00:00:00.000Z',
        result: { status: 'prepared' },
      },
    }));
    const server = {
      registerTool: vi.fn((name: string, _definition: unknown, handler: (input: never) => Promise<unknown>) => {
        handlers.set(name, handler);
      }),
    };
    registerPilotStudioTools(
      server as never,
      { projectId: 'project_1', projectDir: '/tmp/project_1' },
      {
        createCommandId: () => 'command_fixed',
        now: () => Date.parse('2026-09-01T00:00:00.000Z'),
        createMailbox: (() => ({
          submit: async (command: unknown) => {
            submitted.push(command);
          },
          readStatus,
        })) as never,
      }
    );

    await handlers.get('studio_get_project_status')?.({} as never);
    await handlers.get('studio_prepare_photo')?.({
      expected_authoring_revision: 3,
      words: 'A lantern beside a quiet window.',
      aspect_ratio: '16:9',
      resolution: '1080p',
      suggested_handle: null,
    } as never);
    await handlers.get('studio_rename_piece')?.({
      expected_authoring_revision: 4,
      piece_id: 'piece_1',
      handle: 'lantern-window',
    } as never);
    await handlers.get('studio_get_command_status')?.({ command_id: 'command_fixed' } as never);

    expect(submitted).toEqual([
      expect.objectContaining({ policy: 'get_project_status', commandId: 'command_fixed' }),
      expect.objectContaining({
        policy: 'prepare_photo',
        expectedAuthoringRevision: 3,
        suggestedHandle: null,
      }),
      expect.objectContaining({
        policy: 'rename_piece',
        expectedAuthoringRevision: 4,
        pieceId: 'piece_1',
        handle: 'lantern-window',
      }),
    ]);
    expect(readStatus).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(submitted)).not.toContain('authorization');
  });

  it('returns bounded pending and rejected receipts', async () => {
    const handlers = new Map<
      string,
      (input: never) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>
    >();
    let time = 0;
    const server = {
      registerTool: vi.fn((name: string, _definition: unknown, handler: (input: never) => Promise<never>) => {
        handlers.set(name, handler);
      }),
    };
    const pendingMailbox = {
      submit: vi.fn(async () => undefined),
      readStatus: vi.fn(async () => ({ status: 'pending' as const })),
    };
    registerPilotStudioTools(
      server as never,
      { projectId: 'project_1', projectDir: '/tmp/project_1' },
      {
        createCommandId: () => 'command_pending',
        now: () => {
          time += 3_000;
          return time;
        },
        sleep: async () => undefined,
        createMailbox: (() => pendingMailbox) as never,
      }
    );
    const pending = await handlers.get('studio_get_project_status')?.({} as never);
    expect(JSON.parse(pending!.content[0]!.text)).toMatchObject({ status: 'pending', commandId: 'command_pending' });

    pendingMailbox.readStatus.mockResolvedValueOnce({
      status: 'terminal',
      receipt: { status: 'rejected', commandId: 'command_rejected' },
    } as never);
    const rejected = await handlers.get('studio_get_command_status')?.({ command_id: 'command_rejected' } as never);
    expect(rejected?.isError).toBe(true);
  });

  it('resolves only the configured real project directory for mailbox publication', async () => {
    const createdDir = await mkdtemp(path.join(os.tmpdir(), 'pilot-mcp-project-'));
    roots.push(createdDir);
    const projectDir = await realpath(createdDir);
    const otherPath = path.join(projectDir, 'not-a-directory');
    await writeFile(otherPath, 'file', 'utf8');
    const observed: Array<string | null> = [];
    const handlers = new Map<string, (input: never) => Promise<unknown>>();
    const server = {
      registerTool: vi.fn((name: string, _definition: unknown, handler: (input: never) => Promise<unknown>) => {
        handlers.set(name, handler);
      }),
    };
    registerPilotStudioTools(
      server as never,
      { projectId: 'project_1', projectDir },
      {
        createMailbox: ((options: { resolveVerifiedProjectDirectory(projectId: string): Promise<string | null> }) => ({
          submit: async () => {
            observed.push(await options.resolveVerifiedProjectDirectory('other_project'));
            observed.push(await options.resolveVerifiedProjectDirectory('project_1'));
          },
          readStatus: async () => ({
            status: 'terminal',
            receipt: { status: 'rejected', commandId: 'command_default_identity' },
          }),
        })) as never,
      }
    );

    const response = (await handlers.get('studio_prepare_photo')?.({
      expected_authoring_revision: 1,
      words: 'One photo.',
      aspect_ratio: '1:1',
      resolution: '720p',
      suggested_handle: 'one-photo',
    } as never)) as { isError?: boolean };
    expect(observed).toEqual([null, projectDir]);
    expect(response.isError).toBe(true);
  });
});
