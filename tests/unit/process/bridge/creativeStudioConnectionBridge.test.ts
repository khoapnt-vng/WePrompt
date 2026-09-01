import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (input: never) => Promise<unknown>>();
  const provider = (name: string) => ({
    provider: vi.fn((handler: (input: never) => Promise<unknown>) => {
      handlers.set(name, handler);
      return vi.fn();
    }),
  });
  return {
    handlers,
    bridge: {
      listConnectionCandidates: provider('listConnectionCandidates'),
      listConnections: provider('listConnections'),
      validateConnection: provider('validateConnection'),
      saveConnection: provider('saveConnection'),
      removeConnection: provider('removeConnection'),
      listProjects: provider('legacy-listProjects'),
    },
  };
});

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: mocks.bridge } }));
vi.mock('@process/services/creative-studio/pilotProductionRuntime', () => ({
  getCreativeStudioPilotProductionRuntimeV3: vi.fn(),
}));

import { initCreativeStudioConnectionBridgeV1 } from '@process/bridge/creativeStudioConnectionBridge';
import {
  CreativeStudioServiceError,
  StudioConnectionValidationError,
} from '@process/services/creative-studio/service/projectMutations';
import { CreativeStudioStoreError } from '@process/services/creative-studio/store/contracts';

const makeController = () => ({
  listConnectionCandidates: vi.fn(async () => []),
  listConnections: vi.fn(async () => ({ integrations: [], connections: [] })),
  listImageBindings: vi.fn(async () => []),
  validateConnection: vi.fn(),
  saveConnection: vi.fn(),
  removeConnection: vi.fn(),
});

describe('Creative Studio image connection bridge', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
  });

  it('registers exactly the five project-independent settings operations', async () => {
    const controller = makeController();
    initCreativeStudioConnectionBridgeV1({ isFeatureEnabled: () => true, getController: () => controller });

    expect([...mocks.handlers.keys()]).toEqual([
      'listConnectionCandidates',
      'listConnections',
      'validateConnection',
      'saveConnection',
      'removeConnection',
    ]);
    await expect(mocks.handlers.get('listConnections')?.(undefined as never)).resolves.toEqual({
      ok: true,
      data: { integrations: [], connections: [] },
    });
    expect(controller.listConnections).toHaveBeenCalledOnce();
    expect(mocks.bridge.listProjects.provider).not.toHaveBeenCalled();
  });

  it('preserves bounded validation and route errors without private details', async () => {
    const controller = makeController();
    controller.saveConnection.mockRejectedValueOnce(
      Object.assign(new StudioConnectionValidationError('auth'), { providerBody: 'private' })
    );
    controller.validateConnection.mockRejectedValueOnce(
      Object.assign(new CreativeStudioServiceError('invalid_route'), { apiKey: 'private' })
    );
    initCreativeStudioConnectionBridgeV1({ isFeatureEnabled: () => true, getController: () => controller });

    await expect(mocks.handlers.get('saveConnection')?.({} as never)).resolves.toEqual({
      ok: false,
      error: {
        code: 'connection_validation_failed',
        reason: 'auth',
        messageKey: 'settings.mediaModels.validationFailure.auth',
      },
    });
    await expect(mocks.handlers.get('validateConnection')?.({} as never)).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid_route',
        messageKey: 'conversation.creativeStudio.errors.invalidRoute',
      },
    });
  });

  it('does not instantiate the production controller while Studio is disabled', async () => {
    const controller = makeController();
    const getController = vi.fn(() => controller);
    initCreativeStudioConnectionBridgeV1({ isFeatureEnabled: () => false, getController });

    await expect(mocks.handlers.get('listConnections')?.(undefined as never)).resolves.toMatchObject({
      ok: false,
      error: { code: 'feature_disabled' },
    });
    expect(getController).not.toHaveBeenCalled();
  });

  it('registers every operation and bounds invalid, provider, and unknown failures', async () => {
    const controller = makeController();
    controller.listConnectionCandidates.mockResolvedValueOnce([{ providerId: 'provider_1' }] as never);
    controller.validateConnection.mockRejectedValueOnce(new CreativeStudioStoreError('invalid_payload'));
    controller.saveConnection.mockRejectedValueOnce(new CreativeStudioServiceError('provider_error'));
    controller.removeConnection.mockRejectedValueOnce(new Error('private filesystem path'));
    initCreativeStudioConnectionBridgeV1({ isFeatureEnabled: () => true, getController: () => controller });

    await expect(mocks.handlers.get('listConnectionCandidates')?.(undefined as never)).resolves.toMatchObject({
      ok: true,
      data: [{ providerId: 'provider_1' }],
    });
    await expect(mocks.handlers.get('validateConnection')?.({} as never)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
    await expect(mocks.handlers.get('saveConnection')?.({} as never)).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_error' },
    });
    await expect(mocks.handlers.get('removeConnection')?.({} as never)).resolves.toMatchObject({
      ok: false,
      error: { code: 'storage_error' },
    });
  });
});
