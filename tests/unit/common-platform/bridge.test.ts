/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TransportEmitter = {
  emit: (name: string, data: unknown) => unknown;
};

const loadLoopbackBridge = async () => {
  vi.resetModules();
  const { bridge } = await import('@/common/platform/bridge');
  let incoming: TransportEmitter | undefined;
  const outbound: Array<{ name: string; data: unknown }> = [];

  bridge.adapter({
    emit(name, data) {
      outbound.push({ name, data });
      return incoming?.emit(name, data);
    },
    on(emitter) {
      incoming = emitter;
    },
  });

  return { bridge, getIncoming: () => incoming, outbound };
};

/**
 * Loopback bridge that JSON round-trips every message, mirroring the real
 * Electron IPC / WebSocket transports (adapter/main.ts serializes with
 * JSON.stringify, which silently drops `undefined` values).
 */
const loadSerializingBridge = async () => {
  vi.resetModules();
  const { bridge } = await import('@/common/platform/bridge');
  let incoming: TransportEmitter | undefined;

  bridge.adapter({
    emit(name, data) {
      const wire = JSON.stringify({ name, data });
      const parsed = JSON.parse(wire) as { name: string; data: unknown };
      return incoming?.emit(parsed.name, parsed.data);
    },
    on(emitter) {
      incoming = emitter;
    },
  });

  return { bridge };
};

describe('local bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes provider requests and replies through the subscribe protocol', async () => {
    const { bridge, outbound } = await loadLoopbackBridge();
    const provider = bridge.buildProvider<string, { value: string }>('test.echo');
    provider.provider(({ value }) => value.toUpperCase());

    await expect(provider.invoke({ value: 'hello' })).resolves.toBe('HELLO');
    expect(outbound[0]?.name).toBe('subscribe-test.echo');
    expect(outbound[1]?.name).toMatch(/^subscribe\.callback-test\.echo/);
  });

  it('rejects an invoke and disposes its callback when the native transport rejects the request', async () => {
    vi.resetModules();
    const { bridge } = await import('@/common/platform/bridge');
    let incoming: TransportEmitter | undefined;
    let requestId = '';
    const transportError = new Error('invalid operation payload');
    bridge.adapter({
      emit(name, data) {
        requestId = (data as { id: string }).id;
        expect(name).toBe('subscribe-test.invalid-native-payload');
        return Promise.reject(transportError);
      },
      on(emitter) {
        incoming = emitter;
      },
    });
    const endpoint = bridge.buildProvider<string, { expectedRevision: number }>('test.invalid-native-payload');

    await expect(endpoint.invoke({ expectedRevision: undefined as unknown as number })).rejects.toBe(transportError);
    expect(incoming?.emit(`subscribe.callback-test.invalid-native-payload${requestId}`, 'too late')).toBe(false);
  });

  it('replaces the previous provider for the same key', async () => {
    const { bridge } = await loadLoopbackBridge();
    const endpoint = bridge.buildProvider<string, void>('test.replace');
    const first = vi.fn(() => 'first');
    endpoint.provider(first);
    endpoint.provider(() => 'second');

    await expect(endpoint.invoke()).resolves.toBe('second');
    expect(first).not.toHaveBeenCalled();
  });

  it('ignores malformed requests without invoking the provider', async () => {
    const { bridge, getIncoming } = await loadLoopbackBridge();
    const handler = vi.fn(() => 'unused');
    bridge.buildProvider<string, string>('test.invalid').provider(handler);

    getIncoming()?.emit('subscribe-test.invalid', { data: 'missing-id' });
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
  });

  // Regression: void-param invokes (e.g. window-controls:minimize) send
  // `data: undefined`, which JSON serialization strips from the wire payload.
  // The subscribe guard must not require the `data` key or those requests
  // are silently dropped after crossing a real IPC/WebSocket transport.
  it('handles void-param invokes across a JSON-serializing transport', async () => {
    const { bridge } = await loadSerializingBridge();
    const handler = vi.fn(() => undefined);
    const endpoint = bridge.buildProvider<void, void>('window-controls.test');
    endpoint.provider(handler);

    await expect(endpoint.invoke()).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('logs rejected providers without emitting a success callback', async () => {
    const { bridge, getIncoming, outbound } = await loadLoopbackBridge();
    const error = new Error('provider failed');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.buildProvider<string, void>('test.failure').provider(() => Promise.reject(error));

    getIncoming()?.emit('subscribe-test.failure', { id: 'request-1', data: undefined });
    await Promise.resolve();
    await Promise.resolve();

    expect(console.error).toHaveBeenCalledWith('[bridge] Provider "test.failure" failed:', error);
    expect(outbound.some(({ name }) => name === 'subscribe.callback-test.failurerequest-1')).toBe(false);
  });

  it('routes renderer-owned queries through the subscribe protocol', async () => {
    const { bridge, outbound } = await loadLoopbackBridge();
    const query = bridge.buildRendererQuery<{ dirtyDraftCount: number }>('test.renderer-query', {
      dirtyDraftCount: 24,
    });
    query.provider(() => ({ dirtyDraftCount: 3 }));

    await expect(query.invoke({ timeoutMs: 100 })).resolves.toEqual({ dirtyDraftCount: 3 });
    expect(outbound[0]?.name).toBe('subscribe-test.renderer-query');
    expect(outbound[1]?.name).toMatch(/^subscribe\.callback-test\.renderer-querytest\.renderer-query[a-f0-9]{8}$/);
  });

  it('returns the typed fallback when a renderer query provider rejects', async () => {
    const { bridge } = await loadLoopbackBridge();
    const error = new Error('renderer unavailable');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const query = bridge.buildRendererQuery<{ saved: boolean }>('test.renderer-failure', { saved: false });
    query.provider(() => Promise.reject(error));

    await expect(query.invoke({ timeoutMs: 100 })).resolves.toEqual({ saved: false });
    expect(console.error).toHaveBeenCalledWith(
      '[bridge] Renderer query provider "test.renderer-failure" failed:',
      error
    );
  });

  it('uses the bounded Creative Studio dirty-draft fallback when the renderer query rejects', async () => {
    await loadLoopbackBridge();
    const error = new Error('draft renderer unavailable');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { creativeStudio } = await import('@/common/adapter/ipcBridge');
    creativeStudio.hasUnsavedWork.provider(() => Promise.reject(error));

    await expect(creativeStudio.hasUnsavedWork.invoke({ timeoutMs: 100 })).resolves.toEqual({ dirtyDraftCount: 24 });
    expect(console.error).toHaveBeenCalledWith(
      '[bridge] Renderer query provider "creative-studio.has-unsaved-work" failed:',
      error
    );
  });

  it('preserves a Studio store rejection as invalid_payload across the V2 bridge', async () => {
    await loadLoopbackBridge();
    vi.doMock('@process/services/creative-studio/runtime', () => ({
      getCreativeStudioRuntime: vi.fn(),
      getCreativeStudioService: vi.fn(),
    }));
    const [{ creativeStudio }, { initCreativeStudioBridge }, { CreativeStudioStoreError }] = await Promise.all([
      import('@/common/adapter/ipcBridge'),
      import('@process/bridge/creativeStudioBridge'),
      import('@process/services/creative-studio/store'),
    ]);
    initCreativeStudioBridge({
      isFeatureEnabled: () => true,
      getService: () =>
        ({
          getProject: async () => {
            throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
          },
        }) as never,
    });

    await expect(creativeStudio.getProject.invoke({ projectId: 'project_1' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid_payload',
        messageKey: 'conversation.creativeStudio.errors.invalidPayload',
      },
    });
    vi.doUnmock('@process/services/creative-studio/runtime');
  });

  it('preserves only an allowlisted Studio pricing reason across the V2 IPC transport', async () => {
    await loadLoopbackBridge();
    vi.doMock('@process/services/creative-studio/runtime', () => ({
      getCreativeStudioRuntime: vi.fn(),
      getCreativeStudioService: vi.fn(),
    }));
    const [{ creativeStudio }, { initCreativeStudioBridge }, { StudioPricingErrorV2 }] = await Promise.all([
      import('@/common/adapter/ipcBridge'),
      import('@process/bridge/creativeStudioBridge'),
      import('@process/services/creative-studio/service/schema2/pricing/estimate'),
    ]);
    initCreativeStudioBridge({
      isFeatureEnabled: () => true,
      getService: () =>
        ({
          prepareSubmission: async () => {
            throw Object.assign(new StudioPricingErrorV2('missing_conditioning'), {
              body: 'private provider body',
              routeId: 'private_route_123',
              stack: 'private stack',
            });
          },
        }) as never,
    });

    const result = await creativeStudio.prepareSubmission.invoke({
      projectId: 'project_1',
      expectedRevision: 1,
      originReferenceHandoffId: null,
      baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' }],
      cascadeChoices: [],
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'pricing_refused',
        reason: 'missing_conditioning',
        details: null,
        messageKey: 'conversation.creativeStudio.errors.pricingRefused',
      },
    });
    expect(JSON.stringify(result)).not.toContain('private provider body');
    expect(JSON.stringify(result)).not.toContain('private_route_123');
    expect(JSON.stringify(result)).not.toContain('private stack');
    vi.doUnmock('@process/services/creative-studio/runtime');
  });

  it('disposes a renderer query callback listener when the invoke times out', async () => {
    vi.useFakeTimers();
    const { bridge, getIncoming, outbound } = await loadLoopbackBridge();
    const query = bridge.buildRendererQuery<{ saved: boolean }>('test.renderer-timeout', { saved: false });

    const pending = query.invoke({ timeoutMs: 25 });
    const request = outbound[0]?.data as { id: string };
    const callbackName = `subscribe.callback-test.renderer-timeout${request.id}`;
    const rejection = expect(pending).rejects.toThrow('timed out after 25ms');
    await vi.advanceTimersByTimeAsync(25);
    await rejection;

    expect(getIncoming()?.emit(callbackName, { saved: true })).toBe(false);
  });
});
