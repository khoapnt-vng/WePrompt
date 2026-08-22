/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresentationTemplateService } from '@/process/services/presentation-template/PresentationTemplateService';

describe('PresentationTemplateService conversation identity', () => {
  let fixtureRoot: string;
  let templateRoot: string;
  let workspaceRoot: string;
  let candidatePath: string;
  let authorizeWorkspaceSourcePath: ReturnType<typeof vi.fn>;
  let service: PresentationTemplateService;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), 'presentation-template-service-'));
    templateRoot = path.join(fixtureRoot, 'templates');
    workspaceRoot = path.join(fixtureRoot, 'workspace');
    candidatePath = path.join(workspaceRoot, 'board-theme.md');
    await mkdir(workspaceRoot);
    await writeFile(candidatePath, '# Board Theme\n\nUse navy accents.\n', { mode: 0o600 });
    const [rootMetadata, sourceMetadata] = await Promise.all([
      lstat(workspaceRoot, { bigint: true }),
      lstat(candidatePath, { bigint: true }),
    ]);
    authorizeWorkspaceSourcePath = vi.fn(async () => ({
      allowedRootPath: workspaceRoot,
      allowedRootDev: rootMetadata.dev.toString(),
      allowedRootIno: rootMetadata.ino.toString(),
      canonicalSourcePath: candidatePath,
      sourceDev: sourceMetadata.dev.toString(),
      sourceIno: sourceMetadata.ino.toString(),
    }));
    service = new PresentationTemplateService({
      rootDir: templateRoot,
      builtinPacks: [],
      workspaceSourceAuthorizer: { authorizeWorkspaceSourcePath },
    });
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('shares one confirmation across uppercase and lowercase short conversation forms', async () => {
    const described = await service.describeThemeSpec({
      conversationId: 'D0921953',
      workspaceRoot,
      filePath: candidatePath,
    });

    await expect(
      service.importThemeSpecBound({
        conversationId: 'd0921953',
        workspaceRoot,
        filePath: candidatePath,
        expectedSha256: described.sha256,
      })
    ).resolves.toMatchObject({ manifest: { id: 'board-theme', source: 'user' } });
  });

  it('rejects whitespace and coercion before workspace authorization', async () => {
    await expect(
      service.describeThemeSpec({
        conversationId: ' d0921953',
        workspaceRoot,
        filePath: candidatePath,
      })
    ).rejects.toMatchObject({ code: 'CANDIDATE_OUTSIDE_WORKSPACE' });
    expect(authorizeWorkspaceSourcePath).not.toHaveBeenCalled();
  });
});
