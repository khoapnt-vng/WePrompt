/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizePresentationConversationId } from '@/common/types/office/presentationConversationId';
import type { ArtifactScratchAllocation, ArtifactScratchResult } from '@/common/types/office/presentationTemplate';

const MANIFEST_FILE = 'manifest.json';
const DELIVERY_READY_FILE = '.aionui-delivery-ready';
const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ArtifactScratchManifest = {
  version: 1;
  runId: string;
  conversationId: string;
  templateId: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'failed' | 'interrupted';
};

type ArtifactScratchServiceOptions = {
  rootDir: string;
};

/** Owns exact system-temp directories used by one Office artifact run. */
export class ArtifactScratchService {
  private readonly rootDir: string;

  constructor(options: ArtifactScratchServiceOptions) {
    this.rootDir = path.resolve(options.rootDir);
  }

  async allocate(input: { conversationId: string; templateId: string }): Promise<ArtifactScratchAllocation> {
    const conversationId = normalizePresentationConversationId(input.conversationId);
    if (conversationId === null) throw new Error('Invalid artifact scratch conversation id');
    await this.ensureRoot();
    const runId = randomUUID();
    const directory = this.resolveRunDirectory(runId);
    await mkdir(directory, { mode: 0o700 });
    const now = new Date().toISOString();
    await this.writeManifest(directory, {
      version: 1,
      runId,
      conversationId,
      templateId: input.templateId,
      createdAt: now,
      updatedAt: now,
      status: 'active',
    });
    return {
      runId,
      directory,
      readyMarker: path.join(directory, DELIVERY_READY_FILE),
    };
  }

  async complete(runId: string): Promise<ArtifactScratchResult> {
    await this.ensureRoot();
    const directory = this.resolveRunDirectory(runId);
    await this.readOwnedManifest(directory, runId);
    if (!(await this.isRegularReadyMarker(path.join(directory, DELIVERY_READY_FILE)))) {
      return { status: 'retained', directory, reason: 'delivery_not_ready' };
    }
    await rm(directory, { recursive: true });
    return { status: 'cleaned' };
  }

  async retain(runId: string, reason: 'failed' | 'interrupted'): Promise<ArtifactScratchResult> {
    await this.ensureRoot();
    const directory = this.resolveRunDirectory(runId);
    const manifest = await this.readOwnedManifest(directory, runId);
    await this.writeManifest(directory, {
      ...manifest,
      status: reason,
      updatedAt: new Date().toISOString(),
    });
    return { status: 'retained', directory, reason };
  }

  async discard(runId: string): Promise<ArtifactScratchResult> {
    await this.ensureRoot();
    const directory = this.resolveRunDirectory(runId);
    await this.readOwnedManifest(directory, runId);
    await rm(directory, { recursive: true });
    return { status: 'cleaned' };
  }

  private resolveRunDirectory(runId: string): string {
    if (!RUN_ID_RE.test(runId)) {
      throw new Error('Invalid artifact scratch run id');
    }
    return path.join(this.rootDir, runId);
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const root = await lstat(this.rootDir);
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (root.isSymbolicLink() || !root.isDirectory() || (currentUid !== undefined && root.uid !== currentUid)) {
      throw new Error('Artifact scratch root must be a real directory owned by the current user');
    }
    await chmod(this.rootDir, 0o700);
  }

  private async readOwnedManifest(directory: string, runId: string): Promise<ArtifactScratchManifest> {
    const value = JSON.parse(
      await readFile(path.join(directory, MANIFEST_FILE), 'utf8')
    ) as Partial<ArtifactScratchManifest>;
    const conversationId = normalizePresentationConversationId(value.conversationId);
    if (value.version !== 1 || value.runId !== runId || conversationId === null) {
      throw new Error('Artifact scratch manifest does not match the requested run');
    }
    return { ...(value as ArtifactScratchManifest), conversationId };
  }

  private async writeManifest(directory: string, manifest: ArtifactScratchManifest): Promise<void> {
    const manifestPath = path.join(directory, MANIFEST_FILE);
    const stagingPath = path.join(directory, `.manifest-${randomUUID()}.tmp`);
    await writeFile(stagingPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await rename(stagingPath, manifestPath);
  }

  private async isRegularReadyMarker(markerPath: string): Promise<boolean> {
    try {
      const marker = await lstat(markerPath);
      return marker.isFile() && !marker.isSymbolicLink();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
