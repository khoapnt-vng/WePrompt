import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = { isPackaged: false };
  const updateListener = { current: null as null | ((update: unknown) => void) };
  const entryPoint = {
    watchProjectUpdatesV3: vi.fn((listener: (update: unknown) => void) => {
      updateListener.current = listener;
      return vi.fn();
    }),
  };
  const runtime = {
    entryPoint,
    media: { resolveManagedAssetV3: vi.fn() },
    store: {
      inspectProjectsV3: vi.fn(async () => ({ healthyProjectIds: [] })),
      getVerifiedProjectDirectoryV3: vi.fn(async () => '/pilot-root/project_1'),
    },
    directorProcessor: { processProject: vi.fn(async () => undefined) },
    startV3: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const baseAdapter = { id: 'weprompt-image-v1' };
  const fakeAdapter = { id: 'fake-image' };
  const fake = {
    provider: { id: 'fake_provider' },
    connections: [
      { id: 'fake_image', adapterId: 'weprompt-image-v1' },
      { id: 'fake_video', adapterId: 'byteplus-seedance-v1' },
    ],
    adapters: new Map([['fake-image', fakeAdapter]]),
    dispose: vi.fn(async () => undefined),
  };
  const connection = { id: 'persisted', adapterId: 'weprompt-image-v1' };
  const videoConnection = { id: 'persisted_video', adapterId: 'byteplus-seedance-v1' };
  const store = {
    listConnections: vi.fn(async () => [connection, videoConnection]),
    saveConnection: vi.fn(),
    removeConnection: vi.fn(),
  };
  const resolver = { listGenerationRoutes: vi.fn() };
  const controller = { listImageBindings: vi.fn() };
  const installation = { dispose: vi.fn(async () => undefined) };
  return {
    state,
    updateListener,
    entryPoint,
    runtime,
    baseAdapter,
    fakeAdapter,
    fake,
    connection,
    videoConnection,
    store,
    resolver,
    controller,
    installation,
    runtimeDeps: null as null | Record<string, unknown>,
    resolverDeps: null as null | {
      listProviders: () => Promise<unknown[]>;
      listConnections: () => Promise<unknown[]>;
    },
    controllerDeps: null as null | Record<string, unknown>,
    showOpenDialog: vi.fn(),
    emit: vi.fn(),
    httpRequest: vi.fn(async () => [{ id: 'real_provider' }]),
    generatedResolver: vi.fn(),
    protocolHandle: vi.fn(),
    protocolUnhandle: vi.fn(),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: { creativeStudioPilot: { projectUpdated: { emit: mocks.emit } } },
}));
vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest: mocks.httpRequest }));
vi.mock('@/common/config/constants', () => ({ CREATIVE_STUDIO_ENABLED: true }));
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.state.isPackaged;
    },
  },
  BrowserWindow: { getFocusedWindow: vi.fn(() => undefined), getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  protocol: { handle: mocks.protocolHandle, unhandle: mocks.protocolUnhandle },
}));
vi.mock('@process/utils/initStorage', () => ({ getCreativeStudioRootDir: () => '/pilot-root' }));
vi.mock('@process/services/creative-studio/adapters', () => ({
  createGenerationProviderAdapterRegistry: vi.fn(() => new Map([['weprompt-image-v1', mocks.baseAdapter]])),
}));
vi.mock('@process/services/creative-studio/adapters/e2eFakeAdapter', () => ({
  createStudioE2EFakeBundle: vi.fn(() => mocks.fake),
}));
vi.mock('@process/services/creative-studio/store/connectionManifest', () => ({
  createStudioConnectionManifestV1: vi.fn(() => mocks.store),
}));
vi.mock('@process/services/creative-studio/connectionController', () => ({
  createStudioConnectionControllerV1: vi.fn((deps) => {
    mocks.controllerDeps = deps;
    return mocks.controller;
  }),
}));
vi.mock('@process/services/creative-studio/providerResolver', () => ({
  createStudioProviderResolver: vi.fn((deps) => {
    mocks.resolverDeps = deps;
    return mocks.resolver;
  }),
}));
vi.mock('@process/services/creative-studio/service/pilot/runtime/generatedUrlResolver', () => ({
  createStudioPilotGeneratedUrlResolverV3: vi.fn(() => mocks.generatedResolver),
}));
vi.mock('@process/services/creative-studio/service/pilot/runtime/factory', () => ({
  createCreativeStudioPilotRuntimeV3: vi.fn((deps) => {
    mocks.runtimeDeps = deps;
    return mocks.runtime;
  }),
}));
vi.mock('@process/services/creative-studio/mediaProtocol', () => ({
  installCreativeStudioProtocol: vi.fn((_installer, resolver) => {
    void resolver;
    return mocks.installation;
  }),
}));

const originalFakeFlags = {
  test: process.env.AIONUI_E2E_TEST,
  studio: process.env.AIONUI_E2E_STUDIO_FAKE,
};

describe('Creative Studio Pilot production defaults', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.runtimeDeps = null;
    mocks.resolverDeps = null;
    mocks.controllerDeps = null;
    mocks.updateListener.current = null;
    mocks.state.isPackaged = false;
    process.env.AIONUI_E2E_TEST = '1';
    process.env.AIONUI_E2E_STUDIO_FAKE = '1';
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/photos/Ảnh phố.png'] });
  });

  afterEach(() => {
    if (originalFakeFlags.test === undefined) delete process.env.AIONUI_E2E_TEST;
    else process.env.AIONUI_E2E_TEST = originalFakeFlags.test;
    if (originalFakeFlags.studio === undefined) delete process.env.AIONUI_E2E_STUDIO_FAKE;
    else process.env.AIONUI_E2E_STUDIO_FAKE = originalFakeFlags.studio;
  });

  it('composes the fake-enabled production graph, picker, resolver, protocol, updates, and disposal', async () => {
    const module = await import('@process/services/creative-studio/pilotProductionRuntime');
    const production = module.getCreativeStudioPilotProductionRuntimeV3();
    expect(module.getCreativeStudioPilotProductionRuntimeV3()).toBe(production);

    expect(await mocks.resolverDeps?.listProviders()).toEqual([{ id: 'real_provider' }, mocks.fake.provider]);
    expect(await mocks.resolverDeps?.listConnections()).toEqual([mocks.connection, mocks.fake.connections[0]]);
    expect(mocks.controllerDeps).toMatchObject({
      manifest: mocks.store,
      injectedBindings: [mocks.fake.connections[0]],
    });
    expect(production.connections).toBe(mocks.controller);
    expect(mocks.runtimeDeps?.adapters).toEqual(
      new Map([
        ['weprompt-image-v1', mocks.baseAdapter],
        ['fake-image', mocks.fakeAdapter],
      ])
    );
    const pickPhoto = mocks.runtimeDeps?.pickPhoto;
    expect(pickPhoto).toEqual(expect.any(Function));
    await expect((pickPhoto as () => Promise<unknown>)()).resolves.toEqual({
      path: '/photos/Ảnh phố.png',
      fileName: 'Ảnh phố.png',
    });
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect((pickPhoto as () => Promise<unknown>)()).resolves.toBeNull();

    await production.start();
    await production.onBackendReady();
    expect(mocks.runtime.startV3).toHaveBeenCalledOnce();
    mocks.updateListener.current?.({ source: 'prepared', projectId: 'project_1' });
    mocks.updateListener.current?.({ source: 'durable', facts: { projectId: 'project_2', revision: 2 } });
    expect(mocks.emit).toHaveBeenNthCalledWith(1, { source: 'prepared', projectId: 'project_1' });
    expect(mocks.emit).toHaveBeenNthCalledWith(2, { source: 'durable', facts: { projectId: 'project_2' } });

    const installedResolver = vi.mocked(await import('@process/services/creative-studio/mediaProtocol'))
      .installCreativeStudioProtocol.mock.calls[0]?.[1];
    await installedResolver?.resolveAsset('project_1', 'asset_1');
    expect(mocks.runtime.media.resolveManagedAssetV3).toHaveBeenCalledWith('project_1', 'asset_1');

    await module.disposeCreativeStudioPilotProductionRuntimeV3();
    expect(mocks.protocolUnhandle).toHaveBeenCalledWith('weprompt-studio');
    expect(mocks.installation.dispose).toHaveBeenCalledOnce();
    expect(mocks.fake.dispose).toHaveBeenCalledOnce();
  });

  it('uses the unfaked provider and adapter graph for packaged builds', async () => {
    mocks.state.isPackaged = true;
    const module = await import('@process/services/creative-studio/pilotProductionRuntime');
    module.getCreativeStudioPilotProductionRuntimeV3();

    expect(await mocks.resolverDeps?.listProviders()).toEqual([{ id: 'real_provider' }]);
    expect(await mocks.resolverDeps?.listConnections()).toEqual([mocks.connection]);
    expect(mocks.controllerDeps).toMatchObject({ injectedBindings: [] });
    expect(mocks.runtimeDeps?.adapters).toEqual(new Map([['weprompt-image-v1', mocks.baseAdapter]]));
  });
});
