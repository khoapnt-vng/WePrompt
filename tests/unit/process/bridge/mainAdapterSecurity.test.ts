/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPTER_BRIDGE_EVENT_KEY, type RendererBridgeQueryKey } from '@/common/adapter/native/constants';
import { INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE } from '@/common/adapter/native/payloadSchemas';
import { initMainAdapterWithWindow } from '@/common/adapter/main';

type FakeWebContents = {
  isDestroyed: () => boolean;
  send: ReturnType<typeof vi.fn>;
};

type FakeBrowserWindow = {
  isDestroyed: () => boolean;
  on: ReturnType<typeof vi.fn>;
  webContents: FakeWebContents;
};

type InvokeEvent = {
  sender: FakeWebContents;
};

type InvokeHandler = (event: InvokeEvent, info: unknown) => unknown;

const mocks = vi.hoisted(() => ({
  bridgeEmitter: {
    emit: vi.fn(),
  },
  hasListener: vi.fn(),
  handlers: new Map<string, InvokeHandler>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));

vi.mock('@/common/platform/bridge', () => ({
  bridge: {
    hasListener: mocks.hasListener,
    adapter: (config: { on: (emitter: typeof mocks.bridgeEmitter) => void }) => {
      config.on(mocks.bridgeEmitter);
    },
  },
}));

const registeredWindowDisposers: Array<() => void> = [];

function createRegisteredSender(): FakeWebContents {
  const webContents: FakeWebContents = {
    isDestroyed: () => false,
    send: vi.fn(),
  };
  const window: FakeBrowserWindow = {
    isDestroyed: () => false,
    on: vi.fn(),
    webContents,
  };
  registeredWindowDisposers.push(initMainAdapterWithWindow(window as never));
  return webContents;
}

function getInvokeHandler(): InvokeHandler {
  const handler = mocks.handlers.get(ADAPTER_BRIDGE_EVENT_KEY);
  expect(handler).toBeDefined();
  return handler!;
}

function createRequest(name: string, data: unknown = undefined): string {
  return JSON.stringify({
    name,
    data: {
      id: 'request-1234',
      data,
    },
  });
}

function createRendererQueryResponse(key: RendererBridgeQueryKey, data: unknown, suffix = 'a1b2c3d4'): string {
  const name = `subscribe.callback-${key}${key}${suffix}`;
  return JSON.stringify({ name, data });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.bridgeEmitter.emit.mockReset();
  mocks.hasListener.mockReset();
  mocks.hasListener.mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  while (registeredWindowDisposers.length > 0) {
    registeredWindowDisposers.pop()?.();
  }
});

describe('main adapter IPC security boundary', () => {
  it('allows a registered window to invoke a manifested native provider', async () => {
    const sender = createRegisteredSender();
    const request = createRequest('subscribe-webui.start', { port: 25808 });

    await getInvokeHandler()({ sender }, request);

    expect(mocks.bridgeEmitter.emit).toHaveBeenCalledWith('subscribe-webui.start', {
      id: 'request-1234',
      data: { port: 25808 },
    });
  });

  it('allows only the strict Task 7 authoring request through the native manifest', async () => {
    const sender = createRegisteredSender();
    const data = {
      projectId: 'project_1',
      expectedRevision: 3,
      operations: [{ kind: 'set_brief', brief: 'Revised' }],
    };

    await getInvokeHandler()({ sender }, createRequest('subscribe-creative-studio.apply-authoring-batch', data));

    expect(mocks.bridgeEmitter.emit).toHaveBeenCalledWith('subscribe-creative-studio.apply-authoring-batch', {
      id: 'request-1234',
      data,
    });
  });

  it.each([
    [
      'prepare-submission',
      {
        projectId: 'project_1',
        expectedRevision: 3,
        originReferenceHandoffId: null,
        baseChoices: [{ shotId: 'shot_1', purpose: 'seed_still', referenceAssetId: null }],
        cascadeChoices: [],
      },
    ],
    ['confirm-submission', { projectId: 'project_1', expectedRevision: 3, quoteId: 'quote_1' }],
    ['dismiss-reference-generation-handoff', { projectId: 'project_1', expectedRevision: 3, handoffId: 'handoff_1' }],
  ] as const)(
    'allows the strict Task 8 Creative Studio provider %s through the native manifest',
    async (name, data) => {
      const sender = createRegisteredSender();

      await getInvokeHandler()({ sender }, createRequest(`subscribe-creative-studio.${name}`, data));

      expect(mocks.bridgeEmitter.emit).toHaveBeenCalledWith(`subscribe-creative-studio.${name}`, {
        id: 'request-1234',
        data,
      });
    }
  );

  it.each(['prepare-submission', 'confirm-submission', 'dismiss-reference-generation-handoff'])(
    'rejects a malformed Task 8 Creative Studio provider %s payload before dispatch',
    async (providerName) => {
      const sender = createRegisteredSender();
      await expect(
        getInvokeHandler()(
          { sender },
          createRequest(`subscribe-creative-studio.${providerName}`, { projectId: 'project_1' })
        )
      ).rejects.toThrow(/invalid operation payload/i);
      expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
    }
  );

  it('allows only the strict Task 9 Director conversation binding through the native manifest', async () => {
    const sender = createRegisteredSender();
    const data = { projectId: 'project_1', expectedRevision: 3, conversationId: 'conversation_1' };

    await getInvokeHandler()({ sender }, createRequest('subscribe-creative-studio.bind-director-conversation', data));

    expect(mocks.bridgeEmitter.emit).toHaveBeenCalledWith('subscribe-creative-studio.bind-director-conversation', {
      id: 'request-1234',
      data,
    });
  });

  it('allows only the strict Task 9 Director session authority request through the native manifest', async () => {
    const sender = createRegisteredSender();
    const data = { projectId: 'project_1' };

    await getInvokeHandler()(
      { sender },
      createRequest('subscribe-creative-studio.get-director-session-authority', data)
    );

    expect(mocks.bridgeEmitter.emit).toHaveBeenCalledWith('subscribe-creative-studio.get-director-session-authority', {
      id: 'request-1234',
      data,
    });
  });

  it.each([
    ['unknown field', { projectId: 'project_1', extra: true }],
    ['traversing project id', { projectId: '../project_1' }],
    ['overlong project id', { projectId: 'p'.repeat(257) }],
  ] as const)('rejects a Director session authority request with %s before dispatch', async (_label, data) => {
    const sender = createRegisteredSender();

    await expect(
      getInvokeHandler()({ sender }, createRequest('subscribe-creative-studio.get-director-session-authority', data))
    ).rejects.toThrow(/invalid operation payload/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it.each([
    ['missing conversation id', { projectId: 'project_1', expectedRevision: 3 }],
    ['null conversation id', { projectId: 'project_1', expectedRevision: 3, conversationId: null }],
    ['unknown field', { projectId: 'project_1', expectedRevision: 3, conversationId: 'conversation_1', extra: true }],
    ['traversing project id', { projectId: '../project_1', expectedRevision: 3, conversationId: 'conversation_1' }],
    ['overlong project id', { projectId: 'p'.repeat(257), expectedRevision: 3, conversationId: 'conversation_1' }],
    [
      'traversing conversation id',
      { projectId: 'project_1', expectedRevision: 3, conversationId: '../conversation_1' },
    ],
    ['overlong conversation id', { projectId: 'project_1', expectedRevision: 3, conversationId: 'c'.repeat(257) }],
    ['zero revision', { projectId: 'project_1', expectedRevision: 0, conversationId: 'conversation_1' }],
    ['fractional revision', { projectId: 'project_1', expectedRevision: 1.5, conversationId: 'conversation_1' }],
    [
      'unsafe integer revision',
      { projectId: 'project_1', expectedRevision: Number.MAX_SAFE_INTEGER + 1, conversationId: 'conversation_1' },
    ],
    ['infinite revision', { projectId: 'project_1', expectedRevision: Infinity, conversationId: 'conversation_1' }],
    ['string revision', { projectId: 'project_1', expectedRevision: '3', conversationId: 'conversation_1' }],
  ] as const)('rejects a Task 9 Director conversation binding with %s before dispatch', async (_label, data) => {
    const sender = createRegisteredSender();

    await expect(
      getInvokeHandler()({ sender }, createRequest('subscribe-creative-studio.bind-director-conversation', data))
    ).rejects.toThrow(/invalid operation payload/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects magic-key Director payload authority without polluting prototypes or dispatching', async () => {
    const sender = createRegisteredSender();
    const request =
      '{"name":"subscribe-creative-studio.bind-director-conversation","data":{"id":"request-1234","data":{"projectId":"project_1","expectedRevision":3,"conversationId":"conversation_1","__proto__":{"paidAuthority":true}}}}';

    await expect(getInvokeHandler()({ sender }, request)).rejects.toThrow(/invalid operation payload/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
    expect(({} as { paidAuthority?: boolean }).paidAuthority).toBeUndefined();
  });

  it('sanitizes inert magic and symbol envelope baggage before Director binding dispatch', async () => {
    const sender = createRegisteredSender();
    const envelope = JSON.parse(
      '{"name":"subscribe-creative-studio.bind-director-conversation","__proto__":{"paidAuthority":true},"data":{"id":"request-1234","__proto__":{"paidAuthority":true},"data":{"projectId":"project_1","expectedRevision":3,"conversationId":"conversation_1"}}}'
    ) as { data: { data: Record<string | symbol, unknown> } };
    envelope.data.data[Symbol('private-authority')] = true;
    const request = JSON.stringify(envelope);

    await getInvokeHandler()({ sender }, request);

    expect(mocks.bridgeEmitter.emit).toHaveBeenCalledWith('subscribe-creative-studio.bind-director-conversation', {
      id: 'request-1234',
      data: { projectId: 'project_1', expectedRevision: 3, conversationId: 'conversation_1' },
    });
    expect(({} as { paidAuthority?: boolean }).paidAuthority).toBeUndefined();
  });

  it('accepts a strict has-unsaved-work response for an outstanding renderer query', async () => {
    const sender = createRegisteredSender();
    const response = createRendererQueryResponse('creative-studio.has-unsaved-work', { dirtyDraftCount: 3 });
    mocks.hasListener.mockReturnValue(true);

    await getInvokeHandler()({ sender }, response);

    expect(mocks.bridgeEmitter.emit).toHaveBeenCalledWith(
      'subscribe.callback-creative-studio.has-unsaved-workcreative-studio.has-unsaved-worka1b2c3d4',
      { dirtyDraftCount: 3 }
    );
  });

  it('accepts a strict flush response for an outstanding renderer query', async () => {
    const sender = createRegisteredSender();
    const response = createRendererQueryResponse('creative-studio.flush-unsaved-work', { saved: false });
    mocks.hasListener.mockReturnValue(true);

    await getInvokeHandler()({ sender }, response);

    expect(mocks.bridgeEmitter.emit).toHaveBeenCalledWith(
      'subscribe.callback-creative-studio.flush-unsaved-workcreative-studio.flush-unsaved-worka1b2c3d4',
      { saved: false }
    );
  });

  it('rejects calls from a renderer that is not registered with the adapter', async () => {
    const sender: FakeWebContents = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    await expect(getInvokeHandler()({ sender }, createRequest('subscribe-webui.start'))).rejects.toThrow(
      /sender is not registered/i
    );
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects renderer query responses from an unregistered renderer', async () => {
    const sender: FakeWebContents = {
      isDestroyed: () => false,
      send: vi.fn(),
    };
    mocks.hasListener.mockReturnValue(true);

    await expect(
      getInvokeHandler()(
        { sender },
        createRendererQueryResponse('creative-studio.has-unsaved-work', { dirtyDraftCount: 1 })
      )
    ).rejects.toThrow(/sender is not registered/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects provider names that are absent from the native channel manifest', async () => {
    const sender = createRegisteredSender();

    await expect(getInvokeHandler()({ sender }, createRequest('subscribe-unknown.privileged-action'))).rejects.toThrow(
      /operation is not allowed/i
    );
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects a renderer attempting to invoke a renderer-owned query', async () => {
    const sender = createRegisteredSender();

    await expect(
      getInvokeHandler()({ sender }, createRequest('subscribe-creative-studio.has-unsaved-work'))
    ).rejects.toThrow(/operation is not allowed/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects a renderer query response without an exact outstanding callback listener', async () => {
    const sender = createRegisteredSender();

    await expect(
      getInvokeHandler()(
        { sender },
        createRendererQueryResponse('creative-studio.has-unsaved-work', { dirtyDraftCount: 2 })
      )
    ).rejects.toThrow(/operation is not allowed/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects a renderer query response whose callback id is not an eight-character lowercase hex suffix', async () => {
    const sender = createRegisteredSender();
    mocks.hasListener.mockReturnValue(true);

    await expect(
      getInvokeHandler()(
        { sender },
        createRendererQueryResponse('creative-studio.has-unsaved-work', { dirtyDraftCount: 2 }, 'NOT-HEX')
      )
    ).rejects.toThrow(/operation is not allowed/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects unknown renderer query callback names', async () => {
    const sender = createRegisteredSender();
    mocks.hasListener.mockReturnValue(true);
    const response = JSON.stringify({
      name: 'subscribe.callback-creative-studio.unknowncreative-studio.unknowna1b2c3d4',
      data: { dirtyDraftCount: 2 },
    });

    await expect(getInvokeHandler()({ sender }, response)).rejects.toThrow(/operation is not allowed/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects malformed renderer query response data', async () => {
    const sender = createRegisteredSender();
    mocks.hasListener.mockReturnValue(true);

    await expect(
      getInvokeHandler()(
        { sender },
        createRendererQueryResponse('creative-studio.has-unsaved-work', { dirtyDraftCount: '2' })
      )
    ).rejects.toThrow(/invalid operation payload/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects unknown fields in renderer query response data', async () => {
    const sender = createRegisteredSender();
    mocks.hasListener.mockReturnValue(true);

    await expect(
      getInvokeHandler()(
        { sender },
        createRendererQueryResponse('creative-studio.flush-unsaved-work', { saved: true, token: 'secret' })
      )
    ).rejects.toThrow(/invalid operation payload/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without dispatching an event', async () => {
    const sender = createRegisteredSender();

    await expect(getInvokeHandler()({ sender }, '{broken')).rejects.toThrow(/malformed json/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects an envelope without a request id', async () => {
    const sender = createRegisteredSender();
    const request = JSON.stringify({
      name: 'subscribe-webui.start',
      data: { data: { port: 25808 } },
    });

    await expect(getInvokeHandler()({ sender }, request)).rejects.toThrow(/invalid envelope/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects inbound payloads larger than 16 MiB before parsing them', async () => {
    const sender = createRegisteredSender();
    const oversizedRequest = createRequest('subscribe-theme:set-active', 'x'.repeat(16 * 1024 * 1024));

    await expect(getInvokeHandler()({ sender }, oversizedRequest)).rejects.toThrow(/payload exceeds/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects unknown provider payload fields before dispatch', async () => {
    const sender = createRegisteredSender();
    const request = createRequest('subscribe-webui.start', { port: 25808, unexpected: true });

    await expect(getInvokeHandler()({ sender }, request)).rejects.toThrow(/invalid operation payload/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects a payload supplied to a void provider before dispatch', async () => {
    const sender = createRegisteredSender();
    const request = createRequest('subscribe-window-controls:close', { force: true });

    await expect(getInvokeHandler()({ sender }, request)).rejects.toThrow(/invalid operation payload/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects invalid nested provider data before dispatch', async () => {
    const sender = createRegisteredSender();
    const request = createRequest('subscribe-show-open', {
      filters: [{ name: 'Docs', extensions: ['pdf'], unexpected: true }],
    });

    await expect(getInvokeHandler()({ sender }, request)).rejects.toThrow(/invalid operation payload/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('does not expose rejected payload values in the adapter error', async () => {
    const sender = createRegisteredSender();
    const secret = 'secret-adapter-value';
    const request = createRequest('subscribe-notification.show', {
      title: 'Notice',
      body: 'Body',
      token: secret,
    });

    let thrown: unknown;
    try {
      await getInvokeHandler()({ sender }, request);
    } catch (error) {
      thrown = error;
    }

    expect(String(thrown)).toContain('invalid operation payload');
    expect(String(thrown)).not.toContain(secret);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('logs the rejected operation and safe issue path while keeping the renderer error generic', async () => {
    const sender = createRegisteredSender();
    const secret = '/private/secret-conversation-value';
    const diagnosticLog = vi.mocked(console.error);
    diagnosticLog.mockClear();
    let thrown: unknown;

    try {
      await getInvokeHandler()(
        { sender },
        createRequest('subscribe-presentation-runs.list-recoverable', { conversation_id: secret, limit: 20 })
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new Error(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE));
    expect(diagnosticLog).toHaveBeenCalledWith(
      '[adapter] Native IPC payload validation failed ' +
        '{"providerKey":"presentation-runs.list-recoverable","issues":[{"code":"invalid_string","path":["conversation_id"]}]}'
    );
    expect(JSON.stringify(diagnosticLog.mock.calls)).not.toContain(secret);
  });

  it('keeps the generic rejection when diagnostic logging fails', async () => {
    const sender = createRegisteredSender();
    vi.mocked(console.error).mockImplementation(() => {
      throw new Error('diagnostic sink failed');
    });

    await expect(
      getInvokeHandler()(
        { sender },
        createRequest('subscribe-presentation-runs.list-recoverable', {
          conversation_id: '/private/invalid-conversation',
          limit: 20,
        })
      )
    ).rejects.toEqual(new Error(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE));
  });
});
