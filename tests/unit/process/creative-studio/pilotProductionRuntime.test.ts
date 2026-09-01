import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCreativeStudioPilotProductionRuntimeV3,
  resumeCreativeStudioPilotAfterBackendReadyV3,
} from '@process/services/creative-studio/pilotProductionRuntime';
import { installSessionMcpTrustKeyProvider } from '@process/backend/sessionMcpTrust';
import type { CreativeStudioPilotRuntimeV3 } from '@process/services/creative-studio/service/pilot/runtime/factory';

const roots: string[] = [];

const makeDeps = async (enabled = true) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'weprompt-pilot-production-'));
  roots.push(rootDir);
  const installation = { dispose: vi.fn(async () => undefined) };
  const protocol = {
    install: vi.fn(() => installation),
    uninstall: vi.fn(async (current) => current?.dispose()),
  };
  const disposeDependencies = vi.fn(async () => undefined);
  const onUpdate = vi.fn();
  const connections = {
    listConnectionCandidates: vi.fn(async () => []),
    listConnections: vi.fn(async () => ({ integrations: [], connections: [] })),
    listImageBindings: vi.fn(async () => []),
    validateConnection: vi.fn(),
    saveConnection: vi.fn(),
    removeConnection: vi.fn(),
  };
  return {
    rootDir,
    enabled,
    connections,
    providerResolver: {
      listGenerationRoutes: vi.fn(async () => ({ routes: [], diagnostics: [], generationCatalogVersion: 'empty' })),
    },
    adapters: new Map(),
    listProviders: vi.fn(async () => []),
    pickPhoto: vi.fn(async () => null),
    resolveGeneratedUrl: vi.fn(async () => {
      throw new Error('unused');
    }),
    protocol,
    disposeDependencies,
    onUpdate,
    installation,
  };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Creative Studio Pilot production lifecycle', () => {
  it('starts recovery and protocol exactly once, publishes durable updates, and disposes in bounds', async () => {
    const deps = await makeDeps();
    const runtime = createCreativeStudioPilotProductionRuntimeV3(deps);

    await Promise.all([runtime.start(), runtime.start(), runtime.onBackendReady()]);
    expect(deps.protocol.install).toHaveBeenCalledOnce();

    const created = await runtime.entryPoint.createProjectV3({ name: 'Pilot', brief: 'One photo' });
    expect(created.status).toBe('created');
    expect(deps.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'durable', facts: expect.objectContaining({ projectId: created.summary.id }) })
    );
    const authority = await runtime.getDirectorSessionAuthority(created.summary.id);
    expect(authority).toMatchObject({
      serverId: `studio-pilot-${created.summary.id}`,
      serverName: 'aionui-creative-studio',
      projectDir: expect.stringContaining(created.summary.id),
    });
    const removeTrustKey = installSessionMcpTrustKeyProvider(() => Buffer.alloc(32, 7).toString('base64url'));
    const session = await runtime.getDirectorSessionServer(created.summary.id);
    removeTrustKey();
    expect(session.server.transport).toMatchObject({
      type: 'stdio',
      env: {
        AIONUI_STUDIO_PROJECT_ID: created.summary.id,
        AIONUI_STUDIO_PROJECT_DIR: authority.projectDir,
      },
    });
    expect(session.serverFingerprint).toMatch(/^[a-f0-9]{64}$/);
    await expect(runtime.getDirectorSessionAuthority('missing_project')).rejects.toThrow('unavailable');

    await Promise.all([runtime.dispose(), runtime.dispose()]);
    expect(deps.protocol.uninstall).toHaveBeenCalledWith(deps.installation);
    expect(deps.installation.dispose).toHaveBeenCalledOnce();
    expect(deps.disposeDependencies).toHaveBeenCalledOnce();
  });

  it('does not activate protocol or recovery while Studio is disabled', async () => {
    const deps = await makeDeps(false);
    const runtime = createCreativeStudioPilotProductionRuntimeV3(deps);

    await runtime.start();
    expect(deps.protocol.install).not.toHaveBeenCalled();
    await runtime.dispose();
    expect(deps.protocol.uninstall).toHaveBeenCalledWith(null);
  });

  it('retries recovery after a transient first backend-ready failure', async () => {
    const deps = await makeDeps();
    const startV3 = vi.fn().mockRejectedValueOnce(new Error('temporary provider outage')).mockResolvedValue(undefined);
    const pilot = {
      entryPoint: { watchProjectUpdatesV3: vi.fn(() => vi.fn()) },
      store: { inspectProjectsV3: vi.fn(async () => ({ healthyProjectIds: [] })) },
      directorProcessor: { processProject: vi.fn(async () => undefined) },
      startV3,
      dispose: vi.fn(async () => undefined),
    } as unknown as CreativeStudioPilotRuntimeV3;
    const runtime = createCreativeStudioPilotProductionRuntimeV3({
      ...deps,
      createPilotRuntime: () => pilot,
    });

    await expect(runtime.onBackendReady()).rejects.toThrow('temporary provider outage');
    await expect(runtime.onBackendReady()).resolves.toBeUndefined();
    expect(startV3).toHaveBeenCalledTimes(2);
    await runtime.dispose();
  });

  it('reports a bounded backend-ready failure without awaiting the caller', async () => {
    const logError = vi.fn();
    const runtime = { onBackendReady: vi.fn(async () => Promise.reject(new TypeError('private details'))) };
    resumeCreativeStudioPilotAfterBackendReadyV3(runtime, logError);

    await vi.waitFor(() =>
      expect(logError).toHaveBeenCalledWith('[CreativeStudio] Failed to resume Pilot jobs:', 'TypeError')
    );
  });
});
