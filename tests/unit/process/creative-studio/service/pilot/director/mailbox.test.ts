/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STUDIO_PILOT_DIRECTOR_COMMAND_MAX_BYTES,
  STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  STUDIO_PILOT_DIRECTOR_RECEIPT_RETENTION_MS,
  type StudioPilotDirectorCommand,
  type StudioPilotDirectorReceipt,
} from '@process/services/creative-studio/service/pilot/director/contracts';
import { createStudioPilotDirectorMailbox } from '@process/services/creative-studio/service/pilot/director/mailbox';

const BASE_TIME = Date.parse('2026-09-01T00:00:00.000Z');

const command = (commandId = 'command_1'): StudioPilotDirectorCommand => ({
  schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  commandId,
  projectId: 'project_1',
  createdAt: new Date(BASE_TIME).toISOString(),
  deadlineAt: new Date(BASE_TIME + 60_000).toISOString(),
  policy: 'get_project_status',
});

const boardCommand = (commandId = 'command_board'): StudioPilotDirectorCommand => ({
  schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  commandId,
  projectId: 'project_1',
  createdAt: new Date(BASE_TIME).toISOString(),
  deadlineAt: new Date(BASE_TIME + 60_000).toISOString(),
  policy: 'propose_board',
  expectedAuthoringRevision: 3,
  handle: 'large_board',
  beats: [
    {
      title: 'Large Board',
      story: '',
      targetSeconds: null,
      shots: Array.from({ length: 10 }, (_, index) => ({
        shootingScript: `${index}`.padEnd(22_000, 'x'),
        durationSeconds: 5,
      })),
    },
  ],
});

const receipt = (input: StudioPilotDirectorCommand, decidedAt = BASE_TIME + 1_000): StudioPilotDirectorReceipt => ({
  schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  commandId: input.commandId,
  projectId: input.projectId,
  policy: 'get_project_status',
  expectedAuthoringRevision: null,
  decidedAt: new Date(decidedAt).toISOString(),
  status: 'succeeded',
  result: { status: 'supported' } as never,
});

describe('Pilot Director durable mailbox', () => {
  let root: string;
  let projectDirectory: string;
  let now: number;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'studio-pilot-director-')));
    projectDirectory = path.join(root, 'project_1');
    await fs.mkdir(projectDirectory);
    now = BASE_TIME;
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const createMailbox = () =>
    createStudioPilotDirectorMailbox({
      resolveVerifiedProjectDirectory: async (projectId) => (projectId === 'project_1' ? projectDirectory : null),
      now: () => now,
      createTemporaryId: (() => {
        let next = 0;
        return () => `temporary_${++next}`;
      })(),
    });

  it('publishes one immutable pending slot and reports status by reading records', async () => {
    const mailbox = createMailbox();
    const first = command();
    await mailbox.submit(first);

    await expect(mailbox.submit(command('command_2'))).rejects.toMatchObject({
      code: 'busy',
    });
    await expect(mailbox.readStatus('project_1', first.commandId)).resolves.toEqual({
      status: 'pending',
      command: first,
    });
    await expect(mailbox.readStatus('project_1', 'not_submitted')).resolves.toEqual({ status: 'missing' });
  });

  it('round-trips a 200–250 KiB Board command without widening the one-slot authority', async () => {
    const mailbox = createMailbox();
    const large = boardCommand();
    const byteLength = Buffer.byteLength(JSON.stringify(large), 'utf8');
    expect(byteLength).toBeGreaterThan(200 * 1024);
    expect(byteLength).toBeLessThan(250 * 1024);

    await expect(mailbox.submit(large)).resolves.toEqual(large);
    await expect(mailbox.readPending(large.projectId)).resolves.toMatchObject({ status: 'valid', command: large });
    await expect(mailbox.submit(boardCommand('command_second'))).rejects.toMatchObject({ code: 'busy' });
  });

  it('physically contains an oversized ordinary command without admitting it', async () => {
    const mailbox = createMailbox();
    const largeBoard = boardCommand();
    await mailbox.submit(largeBoard);
    const pendingFile = path.join(projectDirectory, '.director-v11', 'pending', 'command.json');
    await fs.rm(pendingFile);
    const oversizedOrdinary = { ...command(), padding: 'x'.repeat(STUDIO_PILOT_DIRECTOR_COMMAND_MAX_BYTES) };
    await fs.writeFile(pendingFile, JSON.stringify(oversizedOrdinary));

    await expect(mailbox.readPending('project_1')).resolves.toMatchObject({ status: 'invalid' });
    await expect(mailbox.readStatus('project_1', 'command_1')).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('reads an absent mailbox family without creating records', async () => {
    const mailbox = createMailbox();

    await expect(mailbox.readPending('project_1')).resolves.toBeNull();
    await expect(mailbox.readReceipt('project_1', 'command_1')).resolves.toBeNull();
    await expect(mailbox.readStatus('project_1', 'command_1')).resolves.toEqual({ status: 'missing' });
    await expect(mailbox.begin('project_1', 'processor_1')).resolves.toBeNull();
    await expect(mailbox.pruneReceipts('project_1')).resolves.toBe(0);
    await expect(fs.readdir(projectDirectory)).resolves.toEqual([]);
  });

  it('rejects malformed, future-authored, and unsafe status inputs before publication', async () => {
    const mailbox = createMailbox();

    await expect(mailbox.submit({ ...command(), schemaVersion: 12 })).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(
      mailbox.submit({ ...command(), createdAt: new Date(BASE_TIME + 30_001).toISOString() })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(mailbox.readStatus('../project', 'command_1')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(mailbox.readPending('../project')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(mailbox.begin('project_1', '../processor')).rejects.toMatchObject({ code: 'invalid_payload' });
    await mailbox.submit(command());
    await expect(mailbox.readReceipt('project_1', '../command')).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('keeps the first terminal receipt immutable and releases only its matching slot', async () => {
    const mailbox = createMailbox();
    const first = command();
    const terminal = receipt(first);
    await mailbox.submit(first);
    await mailbox.begin(first.projectId, 'processor_1');
    await mailbox.writeReceipt(first, terminal);

    await expect(mailbox.writeReceipt(first, terminal)).resolves.toBeUndefined();

    await expect(
      mailbox.writeReceipt(first, {
        ...terminal,
        result: { status: 'supported', summary: {} },
      } as never)
    ).rejects.toMatchObject({ code: 'storage_error' });
    await mailbox.finish(first);
    await expect(mailbox.readStatus(first.projectId, first.commandId)).resolves.toEqual({
      status: 'terminal',
      receipt: terminal,
    });
    await expect(mailbox.submit(command('command_2'))).resolves.toMatchObject({ commandId: 'command_2' });
  });

  it('requires a durable matching receipt before removing a pending slot', async () => {
    const mailbox = createMailbox();
    const first = command();
    await mailbox.submit(first);

    await expect(mailbox.finish(first)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(mailbox.readStatus(first.projectId, first.commandId)).resolves.toMatchObject({ status: 'pending' });
  });

  it('cleans a receipt-backed orphan claim before accepting the next command', async () => {
    const mailbox = createMailbox();
    const first = command();
    await mailbox.submit(first);
    await mailbox.begin(first.projectId, 'processor_1');
    await mailbox.writeReceipt(first, receipt(first));
    await fs.rm(path.join(projectDirectory, '.director-v11', 'pending', 'command.json'));

    await expect(mailbox.submit(command('command_2'))).resolves.toMatchObject({ commandId: 'command_2' });
    await expect(
      fs.lstat(path.join(projectDirectory, '.director-v11', 'processing', 'claim.json'))
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses command-id reuse while its immutable receipt is retained', async () => {
    const mailbox = createMailbox();
    const first = command();
    await mailbox.submit(first);
    await mailbox.writeReceipt(first, receipt(first));
    await mailbox.finish(first);

    await expect(mailbox.submit(first)).rejects.toMatchObject({ code: 'busy' });
  });

  it('retains recent receipts and prunes only records past the bounded window', async () => {
    const mailbox = createMailbox();
    const first = command();
    await mailbox.submit(first);
    await mailbox.writeReceipt(first, receipt(first));
    await mailbox.finish(first);

    now = BASE_TIME + STUDIO_PILOT_DIRECTOR_RECEIPT_RETENTION_MS;
    await expect(mailbox.pruneReceipts(first.projectId)).resolves.toBe(0);
    now += 1_001;
    await expect(mailbox.pruneReceipts(first.projectId)).resolves.toBe(1);
    await expect(mailbox.readStatus(first.projectId, first.commandId)).resolves.toEqual({ status: 'missing' });
  });

  it('fails closed when the command family is a symbolic link', async () => {
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(projectDirectory, '.director-v11'));
    const mailbox = createMailbox();

    await expect(mailbox.submit(command())).rejects.toMatchObject({ code: 'storage_error' });
    await expect(fs.readdir(outside)).resolves.toEqual([]);
  });

  it('classifies malformed pending, claim, and receipt files as storage failures', async () => {
    const mailbox = createMailbox();
    const first = command();
    await mailbox.submit(first);
    const family = path.join(projectDirectory, '.director-v11');
    const pendingFile = path.join(family, 'pending', 'command.json');
    await fs.rm(pendingFile);
    await fs.writeFile(pendingFile, '{');

    await expect(mailbox.readPending(first.projectId)).resolves.toMatchObject({ status: 'invalid' });
    await expect(mailbox.readStatus(first.projectId, first.commandId)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(mailbox.begin(first.projectId, 'processor_1')).rejects.toMatchObject({ code: 'storage_error' });

    await fs.rm(pendingFile);
    await fs.writeFile(pendingFile, `${JSON.stringify(first)}\n`);
    await fs.writeFile(path.join(family, 'processing', 'claim.json'), '{}');
    await expect(mailbox.begin(first.projectId, 'processor_1')).rejects.toMatchObject({ code: 'storage_error' });

    await fs.writeFile(path.join(family, 'receipts', 'malformed.json'), '{');
    await expect(mailbox.readReceipt(first.projectId, 'malformed')).resolves.toEqual({ status: 'invalid' });
    await expect(mailbox.readStatus(first.projectId, 'malformed')).rejects.toMatchObject({ code: 'storage_error' });
    await expect(mailbox.pruneReceipts(first.projectId)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('fails closed when its injected clock is not a safe timestamp', async () => {
    const mailbox = createStudioPilotDirectorMailbox({
      resolveVerifiedProjectDirectory: async () => projectDirectory,
      now: () => Number.NaN,
    });
    await expect(mailbox.submit(command())).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('uses bounded production clock and temporary-id defaults when test seams are omitted', async () => {
    const mailbox = createStudioPilotDirectorMailbox({
      resolveVerifiedProjectDirectory: async () => projectDirectory,
    });
    const currentTime = Date.now();
    const productionCommand: StudioPilotDirectorCommand = {
      ...command('command_defaults'),
      createdAt: new Date(currentTime).toISOString(),
      deadlineAt: new Date(currentTime + 60_000).toISOString(),
    };

    await expect(mailbox.submit(productionCommand)).resolves.toMatchObject({ commandId: 'command_defaults' });
  });

  it('detects project-directory substitution before publishing a pending record', async () => {
    const outside = path.join(root, 'replacement');
    await fs.mkdir(outside);
    let resolutions = 0;
    const mailbox = createStudioPilotDirectorMailbox({
      now: () => now,
      createTemporaryId: () => 'temporary_1',
      resolveVerifiedProjectDirectory: async () => {
        resolutions += 1;
        if (resolutions === 2) {
          await fs.rename(projectDirectory, `${projectDirectory}.original`);
          await fs.symlink(outside, projectDirectory);
        }
        return projectDirectory;
      },
    });

    await expect(mailbox.submit(command())).rejects.toMatchObject({ code: 'storage_error' });
    await expect(fs.readdir(outside)).resolves.toEqual([]);
  });

  it('refuses a missing schema-6 project directory without creating one', async () => {
    const mailbox = createMailbox();
    await expect(mailbox.submit({ ...command(), projectId: 'missing_project' })).rejects.toMatchObject({
      code: 'project_not_found',
    });
    await expect(fs.readdir(root)).resolves.toEqual(['project_1']);
  });
});
