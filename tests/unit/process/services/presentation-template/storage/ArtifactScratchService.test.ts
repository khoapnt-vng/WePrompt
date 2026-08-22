/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactScratchService } from '@/process/services/presentation-template/run/ArtifactScratchService';

const CONVERSATION_ID = 'd0921953';

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

describe('ArtifactScratchService', () => {
  let fixtureRoot: string;
  let scratchRoot: string;
  let customWorkspace: string;
  let service: ArtifactScratchService;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), 'artifact-scratch-test-'));
    scratchRoot = path.join(fixtureRoot, 'managed-runs');
    customWorkspace = path.join(fixtureRoot, 'custom-workspace');
    await mkdir(customWorkspace);
    service = new ArtifactScratchService({ rootDir: scratchRoot });
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('removes only its managed run after the delivery-ready gate exists', async () => {
    const sourcePath = path.join(customWorkspace, 'source.xlsx');
    const finalPath = path.join(customWorkspace, 'final.pptx');
    const recoveryPath = path.join(customWorkspace, 'final.recovery.pptx');
    await Promise.all([
      writeFile(sourcePath, 'source'),
      writeFile(finalPath, 'final'),
      writeFile(recoveryPath, 'recovery'),
    ]);

    const run = await service.allocate({ conversationId: CONVERSATION_ID, templateId: 'business-review' });
    await writeFile(path.join(run.directory, 'slide_01.png'), 'scratch');
    await writeFile(run.readyMarker, 'delivery gates passed\n');

    await expect(service.complete(run.runId)).resolves.toEqual({ status: 'cleaned' });
    await expect(exists(run.directory)).resolves.toBe(false);
    await expect(Promise.all([sourcePath, finalPath, recoveryPath].map(exists))).resolves.toEqual([true, true, true]);
  });

  it('retains failed and interrupted runs without a ready marker', async () => {
    const failed = await service.allocate({ conversationId: CONVERSATION_ID, templateId: 'business-review' });
    await writeFile(path.join(failed.directory, 'repair.ts'), 'scratch');

    await expect(service.complete(failed.runId)).resolves.toEqual({
      status: 'retained',
      directory: failed.directory,
      reason: 'delivery_not_ready',
    });
    await expect(service.retain(failed.runId, 'failed')).resolves.toEqual({
      status: 'retained',
      directory: failed.directory,
      reason: 'failed',
    });

    const manifest = JSON.parse(await readFile(path.join(failed.directory, 'manifest.json'), 'utf8')) as {
      status: string;
    };
    expect(manifest.status).toBe('failed');
    await expect(exists(failed.directory)).resolves.toBe(true);
  });

  it('keeps retried runs isolated and supports explicit cleanup of a retained run', async () => {
    const first = await service.allocate({ conversationId: CONVERSATION_ID, templateId: 'business-review' });
    const retry = await service.allocate({ conversationId: CONVERSATION_ID, templateId: 'business-review' });
    expect(retry.runId).not.toBe(first.runId);
    expect(retry.directory).not.toBe(first.directory);

    await writeFile(retry.readyMarker, 'delivery gates passed\n');
    await expect(service.complete(retry.runId)).resolves.toEqual({ status: 'cleaned' });
    await expect(exists(first.directory)).resolves.toBe(true);
    await expect(exists(retry.directory)).resolves.toBe(false);

    await expect(service.discard(first.runId)).resolves.toEqual({ status: 'cleaned' });
    await expect(exists(first.directory)).resolves.toBe(false);
  });

  it('rejects run identifiers that cannot resolve to one owned child directory', async () => {
    await expect(service.complete('../custom-workspace')).rejects.toThrow('Invalid artifact scratch run id');
    await expect(exists(customWorkspace)).resolves.toBe(true);
  });

  it('persists a canonical lowercase conversation id without trimming or coercion', async () => {
    const allocation = await service.allocate({ conversationId: 'D0921953', templateId: 'business-review' });
    const manifest = JSON.parse(await readFile(path.join(allocation.directory, 'manifest.json'), 'utf8')) as {
      conversationId: string;
    };

    expect(manifest.conversationId).toBe(CONVERSATION_ID);
    await expect(
      service.allocate({ conversationId: ` ${CONVERSATION_ID}`, templateId: 'business-review' })
    ).rejects.toThrow('Invalid artifact scratch conversation id');
  });

  it('refuses a scratch root redirected through a symbolic link', async () => {
    const redirectedRoot = path.join(fixtureRoot, 'redirected-root');
    await mkdir(redirectedRoot);
    await symlink(redirectedRoot, scratchRoot);

    await expect(service.allocate({ conversationId: CONVERSATION_ID, templateId: 'business-review' })).rejects.toThrow(
      'Artifact scratch root must be a real directory'
    );
    await expect(exists(redirectedRoot)).resolves.toBe(true);
  });
});
