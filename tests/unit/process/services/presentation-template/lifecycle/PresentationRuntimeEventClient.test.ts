/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PresentationRuntimeEventClient,
  type PresentationTerminalEventAuthority,
  type PresentationRuntimeTerminalEvent,
} from '@/process/services/presentation-template/run/service/PresentationRuntimeEventClient';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const SHORT_CONVERSATION_ID = 'd0921953';
const TURN_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'backend-secret-token';

class FakeSocket extends EventEmitter {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly sent: unknown[] = [];
  readyState = 0;
  close = vi.fn(() => {
    this.readyState = FakeSocket.CLOSED;
  });
  terminate = vi.fn(() => {
    this.readyState = FakeSocket.CLOSED;
  });

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
  }

  message(value: string | Buffer): void {
    this.emit('message', value, false);
  }

  closed(code = 1006): void {
    this.readyState = FakeSocket.CLOSED;
    this.emit('close', code, Buffer.alloc(0));
  }
}

const releasedRuntime = {
  state: 'idle',
  can_send_message: true,
  has_task: false,
  task_status: 'finished',
  is_processing: false,
  pending_confirmations: 0,
  turn_id: null,
} as const;

const frame = (overrides: Record<string, unknown> = {}, envelopeOverrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    name: 'turn.completed',
    data: {
      session_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      status: 'finished',
      runtime: releasedRuntime,
      ...overrides,
    },
    ...envelopeOverrides,
  });

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function createHarness(
  onTerminalEvent: (
    event: PresentationRuntimeTerminalEvent,
    authority: PresentationTerminalEventAuthority
  ) => Promise<'handled' | 'pending' | 'forged'> = async () => 'handled'
) {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const socketOptions: unknown[] = [];
  const diagnostics: string[] = [];
  const client = new PresentationRuntimeEventClient({
    createSocket: (url, options) => {
      urls.push(url);
      socketOptions.push(options);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onTerminalEvent,
    diagnostic: (code) => diagnostics.push(code),
  });
  return { client, diagnostics, sockets, socketOptions, urls };
}

async function sendTimedFrames(
  harness: ReturnType<typeof createHarness>,
  turnPrefix: string,
  count: number,
  index = 0
): Promise<void> {
  if (index >= count) return;
  harness.sockets[0]!.message(frame({ turn_id: `${turnPrefix}${String(index).padStart(12, '0')}` }));
  await settle();
  vi.advanceTimersByTime(500);
  await sendTimedFrames(harness, turnPrefix, count, index + 1);
}

describe('PresentationRuntimeEventClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens each socket with its explicit backend credential and no token in the URL', () => {
    const harness = createHarness();
    const runtimeGlobals = globalThis as typeof globalThis & { __backendLocalToken?: string };
    runtimeGlobals.__backendLocalToken = 'wrong-global-token';

    try {
      harness.client.connect({ port: 43123, token: TOKEN });
      harness.client.connect({ port: 43124, token: 'rotated&token' });
    } finally {
      delete runtimeGlobals.__backendLocalToken;
    }

    expect(harness.urls).toEqual(['ws://127.0.0.1:43123/ws', 'ws://127.0.0.1:43124/ws']);
    expect(harness.socketOptions).toEqual([
      { headers: { Authorization: 'Bearer backend-secret-token' }, maxPayload: 256 * 1024 },
      { headers: { Authorization: 'Bearer rotated&token' }, maxPayload: 256 * 1024 },
    ]);
    expect(harness.sockets[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('parses only canonical required fields without aliases or defaults', async () => {
    const observed: PresentationRuntimeTerminalEvent[] = [];
    const harness = createHarness(async (event) => {
      observed.push(event);
      return 'handled';
    });
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    harness.sockets[0]!.message(frame());
    await settle();

    expect(observed).toEqual([
      {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        status: 'finished',
        runtime: releasedRuntime,
        observedAt: '2026-08-05T00:00:00.000Z',
      },
    ]);

    harness.sockets[0]!.message(
      JSON.stringify({
        name: 'turn.completed',
        data: { sessionId: CONVERSATION_ID, turnId: TURN_ID, status: 'finished', runtime: releasedRuntime },
      })
    );
    harness.sockets[0]!.message(frame({ turn_id: '88888888-8888-4888-8888-888888888888' }));
    await settle();

    expect(observed).toHaveLength(1);
    expect(harness.sockets[0]!.terminate).toHaveBeenCalledTimes(1);
  });

  it('normalizes a backend short session id without widening unsafe session ids', async () => {
    const observed: PresentationRuntimeTerminalEvent[] = [];
    const harness = createHarness(async (event) => {
      observed.push(event);
      return 'handled';
    });
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    harness.sockets[0]!.message(frame({ session_id: SHORT_CONVERSATION_ID.toUpperCase() }));
    await settle();

    expect(observed).toEqual([expect.objectContaining({ conversationId: SHORT_CONVERSATION_ID, turnId: TURN_ID })]);
    expect(harness.sockets[0]!.terminate).not.toHaveBeenCalled();

    harness.sockets[0]!.message(frame({ session_id: '../private', turn_id: '88888888-8888-4888-8888-888888888888' }));
    await settle();

    expect(observed).toHaveLength(1);
    expect(harness.sockets[0]!.terminate).toHaveBeenCalledTimes(1);
  });

  it('accepts canonical nullable runtime only as a terminal trigger', async () => {
    const observed: PresentationRuntimeTerminalEvent[] = [];
    const harness = createHarness(async (event) => {
      observed.push(event);
      return 'handled';
    });
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    harness.sockets[0]!.message(frame({ runtime: null }));
    await settle();

    expect(observed).toEqual([
      expect.objectContaining({ conversationId: CONVERSATION_ID, turnId: TURN_ID, runtime: null }),
    ]);
    expect(harness.sockets[0]!.terminate).not.toHaveBeenCalled();
  });

  it('accepts a frame at 256 KiB and quarantines a frame one byte over', async () => {
    const observed: PresentationRuntimeTerminalEvent[] = [];
    const harness = createHarness(async (event) => {
      observed.push(event);
      return 'handled';
    });
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();
    const base = JSON.parse(frame()) as { data: Record<string, unknown> };
    const overhead = Buffer.byteLength(JSON.stringify({ ...base, padding: '' }));
    const atLimit = JSON.stringify({ ...base, padding: 'x'.repeat(256 * 1024 - overhead) });

    expect(Buffer.byteLength(atLimit)).toBe(256 * 1024);
    harness.sockets[0]!.message(atLimit);
    await settle();
    expect(observed).toHaveLength(1);

    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[1]!.open();
    harness.sockets[1]!.message(`${atLimit} `);
    harness.sockets[1]!.message(frame({ turn_id: '99999999-9999-4999-8999-999999999999' }));
    await settle();

    expect(observed).toHaveLength(1);
    expect(harness.diagnostics).toContain('FRAME_OVERSIZE');
    expect(harness.sockets[1]!.terminate).toHaveBeenCalledTimes(1);
  });

  it('applies burst/rate limits only to canonical terminal events and quarantines one over burst', async () => {
    const onTerminal = vi.fn(async () => 'handled' as const);
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    for (let index = 0; index < 500; index += 1) {
      harness.sockets[0]!.message(JSON.stringify({ name: 'message.stream', data: { payload: 'ignored' } }));
    }
    for (let index = 0; index < 20; index += 1) {
      harness.sockets[0]!.message(frame({ turn_id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}` }));
    }
    await settle();

    expect(onTerminal).toHaveBeenCalledTimes(20);
    expect(harness.sockets[0]!.terminate).not.toHaveBeenCalled();

    harness.sockets[0]!.message(frame({ turn_id: '33333333-3333-4333-8333-333333333333' }));
    harness.sockets[0]!.message(frame({ turn_id: '88888888-8888-4888-8888-888888888888' }));
    await settle();
    expect(onTerminal).toHaveBeenCalledTimes(20);
    expect(harness.sockets[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(harness.diagnostics).toContain('EVENT_RATE_EXCEEDED');
  });

  it('allows 120 terminal events over one minute while retaining burst 20', async () => {
    const onTerminal = vi.fn(async () => 'handled' as const);
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    await sendTimedFrames(harness, '44444444-4444-4444-8444-', 120);

    expect(onTerminal).toHaveBeenCalledTimes(120);
    expect(harness.sockets[0]!.terminate).not.toHaveBeenCalled();
  });

  it('retains at most 32 exact terminal-before-bind tuples and quarantines tuple 33', async () => {
    const harness = createHarness(async () => 'pending');
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    await sendTimedFrames(harness, '55555555-5555-4555-8555-', 32);
    expect(harness.client.pendingCount).toBe(32);

    harness.sockets[0]!.message(frame({ turn_id: '66666666-6666-4666-8666-666666666666' }));
    harness.sockets[0]!.message(frame({ turn_id: '77777777-7777-4777-8777-777777777777' }));
    await settle();

    expect(harness.client.pendingCount).toBe(0);
    expect(harness.sockets[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(harness.diagnostics).toContain('PENDING_OVERFLOW');
  });

  it('reserves all 32 tuple slots before unresolved handlers and quarantines handler 33', async () => {
    const onTerminal = vi.fn(async () => new Promise<'handled' | 'pending' | 'forged'>(() => undefined));
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    await sendTimedFrames(harness, '55555555-5555-4555-8555-', 32);
    expect(onTerminal).toHaveBeenCalledTimes(32);
    expect(harness.client.pendingCount).toBe(32);

    harness.sockets[0]!.message(frame({ turn_id: '66666666-6666-4666-8666-666666666666' }));
    await settle();

    expect(onTerminal).toHaveBeenCalledTimes(32);
    expect(harness.sockets[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(harness.diagnostics).toContain('PENDING_OVERFLOW');
  });

  it('uses one receipt deadline for in-flight work and pending retries', async () => {
    let resolveBeforeDeadline!: (value: 'pending') => void;
    let beforeDeadlineCalls = 0;
    const beforeDeadline = createHarness(async () => {
      beforeDeadlineCalls += 1;
      return beforeDeadlineCalls === 1
        ? new Promise<'pending'>((resolve) => (resolveBeforeDeadline = resolve))
        : 'pending';
    });
    beforeDeadline.client.connect({ port: 43123, token: TOKEN });
    beforeDeadline.sockets[0]!.open();
    beforeDeadline.sockets[0]!.message(frame());
    await settle();

    await vi.advanceTimersByTimeAsync(119_000);
    resolveBeforeDeadline('pending');
    await settle();
    expect(beforeDeadline.client.pendingCount).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(beforeDeadline.client.consumePending(CONVERSATION_ID, TURN_ID)).resolves.toBe('missing');

    let resolveAfterDeadline!: (value: 'pending') => void;
    let afterDeadlineCalls = 0;
    const afterDeadline = createHarness(async () => {
      afterDeadlineCalls += 1;
      return afterDeadlineCalls === 1
        ? new Promise<'pending'>((resolve) => (resolveAfterDeadline = resolve))
        : 'pending';
    });
    afterDeadline.client.connect({ port: 43123, token: TOKEN });
    afterDeadline.sockets[0]!.open();
    afterDeadline.sockets[0]!.message(frame());
    await settle();

    await vi.advanceTimersByTimeAsync(120_000);
    resolveAfterDeadline('pending');
    await settle();
    expect(afterDeadline.client.pendingCount).toBe(0);
    await expect(afterDeadline.client.consumePending(CONVERSATION_ID, TURN_ID)).resolves.toBe('missing');
  });

  it('does not let an abort-ignoring in-flight handler stall pending consumption past its deadline', async () => {
    const harness = createHarness(async () => new Promise<'handled'>(() => undefined));
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();
    harness.sockets[0]!.message(frame());
    await settle();

    const consumed = harness.client.consumePending(CONVERSATION_ID, TURN_ID);
    let settled = false;
    void consumed.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(119_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(consumed).resolves.toBe('missing');
  });

  it('expires pending tuples at 120 seconds and never carries them across reconnect', async () => {
    const harness = createHarness(async () => 'pending');
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();
    harness.sockets[0]!.message(frame());
    await settle();

    expect(harness.client.pendingCount).toBe(1);
    vi.advanceTimersByTime(120_000);
    expect(await harness.client.consumePending(CONVERSATION_ID, TURN_ID)).toBe('missing');

    harness.sockets[0]!.message(frame());
    await settle();
    harness.sockets[0]!.closed();
    vi.advanceTimersByTime(1_000);

    expect(harness.sockets).toHaveLength(2);
    expect(harness.client.pendingCount).toBe(0);
  });

  it('uses bounded reconnect backoff, has no outgoing buffer, and stops on disconnect', () => {
    const harness = createHarness();
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.closed();
    vi.advanceTimersByTime(999);
    expect(harness.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(harness.sockets).toHaveLength(2);

    harness.sockets[1]!.closed();
    vi.advanceTimersByTime(1_999);
    expect(harness.sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(harness.sockets).toHaveLength(3);

    expect('send' in harness.client).toBe(false);
    harness.client.disconnect();
    harness.sockets[2]!.closed();
    vi.advanceTimersByTime(60_000);
    expect(harness.sockets).toHaveLength(3);
  });

  it('starts every reconnected socket with a fresh per-connection rate and burst budget', async () => {
    const onTerminal = vi.fn(async () => 'handled' as const);
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    for (let index = 0; index < 20; index += 1) {
      harness.sockets[0]!.message(frame({ turn_id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}` }));
    }
    await settle();
    harness.sockets[0]!.closed();
    vi.advanceTimersByTime(1_000);
    harness.sockets[1]!.open();
    for (let index = 0; index < 20; index += 1) {
      harness.sockets[1]!.message(frame({ turn_id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}` }));
    }
    await settle();

    expect(onTerminal).toHaveBeenCalledTimes(40);
    expect(harness.sockets[1]!.terminate).not.toHaveBeenCalled();
  });

  it('rate-limits diagnostics and never logs the token or payload', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const harness = createHarness();
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();
    harness.sockets[0]!.message('{"name":"turn.completed","data":{"secret":"payload-secret"}}');
    await settle();
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[1]!.open();
    harness.sockets[1]!.message('{"name":"turn.completed","data":{"secret":"payload-secret"}}');
    await settle();

    expect(harness.diagnostics.filter((code) => code === 'MALFORMED_EVENT')).toHaveLength(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('payload-secret');
  });

  it('deduplicates exact events and never buffers forged events', async () => {
    const onTerminal = vi
      .fn<(event: PresentationRuntimeTerminalEvent) => Promise<'handled' | 'pending' | 'forged'>>()
      .mockResolvedValueOnce('handled')
      .mockResolvedValueOnce('forged');
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    harness.sockets[0]!.message(frame());
    await settle();
    harness.sockets[0]!.message(frame());
    await settle();
    harness.sockets[0]!.message(frame({ turn_id: '77777777-7777-4777-8777-777777777777' }));
    await settle();

    expect(onTerminal).toHaveBeenCalledTimes(2);
    expect(harness.client.pendingCount).toBe(0);
  });

  it('bounds handled-event deduplication while preserving recent duplicate suppression', async () => {
    const onTerminal = vi.fn(async () => 'handled' as const);
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    await sendTimedFrames(harness, '44444444-4444-4444-8444-', 65);
    harness.sockets[0]!.message(frame({ turn_id: '44444444-4444-4444-8444-000000000000' }));
    await settle();
    harness.sockets[0]!.message(frame({ turn_id: '44444444-4444-4444-8444-000000000064' }));
    await settle();

    expect(onTerminal).toHaveBeenCalledTimes(66);
    expect(harness.sockets[0]!.terminate).not.toHaveBeenCalled();
  });

  it('revokes pending and in-flight authority synchronously when the stream is quarantined', async () => {
    let release!: () => void;
    let sideEffectCount = 0;
    let capturedAuthority: PresentationTerminalEventAuthority | null = null;
    const onTerminal = vi.fn(async (_event, authority) => {
      capturedAuthority = authority;
      await new Promise<void>((resolve) => (release = resolve));
      if (authority.isCurrent()) sideEffectCount += 1;
      return 'pending' as const;
    });
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();
    harness.sockets[0]!.message(frame());
    await vi.waitFor(() => expect(onTerminal).toHaveBeenCalledTimes(1));

    harness.sockets[0]!.message('{"name":"turn.completed","data":{}}');

    const authorityWasAborted = capturedAuthority?.signal.aborted;
    const authorityWasCurrent = capturedAuthority?.isCurrent();
    await expect(harness.client.consumePending(CONVERSATION_ID, TURN_ID)).resolves.toBe('missing');
    release();
    await settle();
    expect(authorityWasAborted).toBe(true);
    expect(authorityWasCurrent).toBe(false);
    expect(sideEffectCount).toBe(0);
    expect(harness.client.pendingCount).toBe(0);
  });

  it('does not invoke a terminal callback queued before same-turn quarantine', async () => {
    const onTerminal = vi.fn(async () => 'handled' as const);
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    harness.sockets[0]!.message(frame());
    harness.sockets[0]!.message('{"name":"turn.completed","data":{}}');
    await settle();

    expect(onTerminal).not.toHaveBeenCalled();
    expect(harness.client.pendingCount).toBe(0);
    expect(harness.sockets[0]!.terminate).toHaveBeenCalledTimes(1);
  });

  it('drops a retained pending tuple immediately on quarantine before reconnect', async () => {
    const harness = createHarness(async () => 'pending');
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();
    harness.sockets[0]!.message(frame());
    await settle();
    expect(harness.client.pendingCount).toBe(1);

    harness.sockets[0]!.message('{"name":"turn.completed","data":{}}');

    await expect(harness.client.consumePending(CONVERSATION_ID, TURN_ID)).resolves.toBe('missing');
    expect(harness.client.pendingCount).toBe(0);
    expect(harness.sockets).toHaveLength(1);
  });

  it('retries one nullable-runtime trigger on the same connection until authoritative handling succeeds', async () => {
    let released = false;
    const onTerminal = vi.fn(async () => (released ? ('handled' as const) : ('pending' as const)));
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    harness.sockets[0]!.message(frame({ runtime: null }));
    await settle();
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(harness.client.pendingCount).toBe(1);

    released = true;
    await vi.advanceTimersByTimeAsync(999);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(onTerminal).toHaveBeenCalledTimes(2);
    expect(harness.client.pendingCount).toBe(0);
    expect(harness.sockets).toHaveLength(1);
    expect(harness.sockets[0]!.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onTerminal).toHaveBeenCalledTimes(2);
  });

  it('retries an exact duplicate while its authoritative disposition remains pending', async () => {
    const onTerminal = vi
      .fn<(event: PresentationRuntimeTerminalEvent) => Promise<'handled' | 'pending' | 'forged'>>()
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('handled');
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    harness.sockets[0]!.message(frame({ runtime: null }));
    await settle();
    expect(harness.client.pendingCount).toBe(1);
    harness.sockets[0]!.message(frame({ runtime: null }));
    await settle();

    expect(onTerminal).toHaveBeenCalledTimes(2);
    expect(harness.client.pendingCount).toBe(0);
  });

  it('atomically hands an in-flight terminal-before-bind trigger to consumePending', async () => {
    let resolveFirst!: (value: 'pending') => void;
    const onTerminal = vi
      .fn<(event: PresentationRuntimeTerminalEvent) => Promise<'handled' | 'pending' | 'forged'>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce('handled');
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();

    harness.sockets[0]!.message(frame({ runtime: null }));
    await vi.waitFor(() => expect(onTerminal).toHaveBeenCalledTimes(1));
    const consumed = harness.client.consumePending(CONVERSATION_ID, TURN_ID);
    resolveFirst('pending');

    await expect(consumed).resolves.toBe('handled');
    expect(onTerminal).toHaveBeenCalledTimes(2);
    expect(harness.client.pendingCount).toBe(0);
  });

  it('preserves a pending tuple when consumePending remains pending or its handler throws', async () => {
    const onTerminal = vi
      .fn<(event: PresentationRuntimeTerminalEvent) => Promise<'handled' | 'pending' | 'forged'>>()
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('pending')
      .mockRejectedValueOnce(new Error('runtime observation unavailable'));
    const harness = createHarness(onTerminal);
    harness.client.connect({ port: 43123, token: TOKEN });
    harness.sockets[0]!.open();
    harness.sockets[0]!.message(frame({ runtime: null }));
    await settle();

    await expect(harness.client.consumePending(CONVERSATION_ID, TURN_ID)).resolves.toBe('pending');
    expect(harness.client.pendingCount).toBe(1);
    await expect(harness.client.consumePending(CONVERSATION_ID, TURN_ID)).rejects.toThrow(
      'runtime observation unavailable'
    );
    expect(harness.client.pendingCount).toBe(1);
  });
});
