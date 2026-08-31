/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { localTokenAuthHeaders } from '@/common/adapter/httpBridge';
import { normalizePresentationConversationId } from '@/common/types/office/presentationConversationId';

const MAX_FRAME_BYTES = 256 * 1024;
const MAX_PENDING_TUPLES = 32;
const MAX_SEEN_TUPLES = 64;
const PENDING_TTL_MS = 120_000;
const PENDING_RETRY_INTERVAL_MS = 1_000;
const DIAGNOSTIC_INTERVAL_MS = 60_000;
const MAX_EVENTS_PER_MINUTE = 120;
const BURST_CAPACITY = 20;
const BURST_REFILL_PER_MS = MAX_EVENTS_PER_MINUTE / 60_000;

export type PresentationRuntimeObservation = {
  state: string;
  can_send_message: boolean;
  has_task: boolean;
  task_status?: string;
  is_processing: boolean;
  pending_confirmations: number;
  turn_id: string | null;
};

export type PresentationRuntimeTerminalEvent = {
  conversationId: string;
  turnId: string;
  status: 'finished';
  runtime: PresentationRuntimeObservation | null;
  observedAt: string;
};

export type TerminalDisposition = 'handled' | 'pending' | 'forged';
export type PendingTerminalDisposition = TerminalDisposition | 'missing';

/** Immutable authority for one received terminal tuple on one socket generation. */
export type PresentationTerminalEventAuthority = {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  isCurrent(): boolean;
};

type SocketLike = {
  readonly readyState: number;
  on(event: 'open', listener: () => void): unknown;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: 'close', listener: (code: number, reason: unknown) => void): unknown;
  on(event: 'error', listener: () => void): unknown;
  close(): void;
  terminate(): void;
};

export type PresentationRuntimeEventClientOptions = {
  createSocket: (url: string, options: { headers: Record<string, string>; maxPayload: number }) => SocketLike;
  onTerminalEvent: (
    event: PresentationRuntimeTerminalEvent,
    authority: PresentationTerminalEventAuthority
  ) => Promise<TerminalDisposition>;
  diagnostic?: (code: string) => void;
  now?: () => Date;
};

type PendingTerminal = { event: PresentationRuntimeTerminalEvent; expiresAt: number; epoch: number };

type InFlightTerminal = {
  operation: Promise<TerminalDisposition>;
  controller: AbortController;
  deadlineAt: number;
  deadlineTimer: ReturnType<typeof setTimeout>;
  epoch: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRuntime(value: unknown): PresentationRuntimeObservation | null {
  if (!isRecord(value)) return null;
  const requiredKeys = ['state', 'can_send_message', 'has_task', 'is_processing', 'pending_confirmations', 'turn_id'];
  if (requiredKeys.some((key) => !(key in value))) return null;
  if (
    typeof value.state !== 'string' ||
    typeof value.can_send_message !== 'boolean' ||
    typeof value.has_task !== 'boolean' ||
    typeof value.is_processing !== 'boolean' ||
    !Number.isSafeInteger(value.pending_confirmations) ||
    (value.turn_id !== null && (typeof value.turn_id !== 'string' || !UUID_PATTERN.test(value.turn_id))) ||
    ('task_status' in value && typeof value.task_status !== 'string')
  ) {
    return null;
  }
  return {
    state: value.state,
    can_send_message: value.can_send_message,
    has_task: value.has_task,
    ...('task_status' in value ? { task_status: value.task_status as string } : {}),
    is_processing: value.is_processing,
    pending_confirmations: value.pending_confirmations as number,
    turn_id: value.turn_id as string | null,
  };
}

function parseTerminalEvent(value: unknown, observedAt: string): PresentationRuntimeTerminalEvent | null | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') return null;
  if (value.name !== 'turn.completed') return undefined;
  if (!isRecord(value.data)) return null;
  const data = value.data;
  const runtime = data.runtime === null ? null : parseRuntime(data.runtime);
  const conversationId = normalizePresentationConversationId(data.session_id);
  if (
    conversationId === null ||
    typeof data.turn_id !== 'string' ||
    !UUID_PATTERN.test(data.turn_id) ||
    data.status !== 'finished' ||
    (data.runtime !== null && runtime === null)
  ) {
    return null;
  }
  return {
    conversationId,
    turnId: data.turn_id,
    status: 'finished',
    runtime,
    observedAt,
  };
}

function frameBytes(value: unknown): Buffer | null {
  if (typeof value === 'string') return Buffer.from(value);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (Array.isArray(value) && value.every((entry) => Buffer.isBuffer(entry))) return Buffer.concat(value);
  return null;
}

export class PresentationRuntimeEventClient {
  private readonly options: PresentationRuntimeEventClientOptions;
  private socket: SocketLike | null = null;
  private credentials: { port: number; token: string } | null = null;
  private generation = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private socketEpoch = 0;
  private pending = new Map<string, PendingTerminal>();
  private seen = new Map<string, number>();
  private inFlight = new Map<string, InFlightTerminal>();
  private eventTimes: number[] = [];
  private burstTokens = BURST_CAPACITY;
  private burstUpdatedAt = 0;
  private diagnosticTimes = new Map<string, number>();

  constructor(options: PresentationRuntimeEventClientOptions) {
    this.options = options;
  }

  get pendingCount(): number {
    this.expireTerminalState();
    return this.pending.size + this.inFlight.size;
  }

  connect(credentials: { port: number; token: string }): void {
    if (
      !Number.isSafeInteger(credentials.port) ||
      credentials.port < 1 ||
      credentials.port > 65_535 ||
      credentials.token.length < 1 ||
      credentials.token.length > 4_096
    ) {
      throw new Error('Invalid presentation runtime credentials');
    }
    this.generation += 1;
    this.clearReconnect();
    const previous = this.socket;
    this.socket = null;
    this.socketEpoch += 1;
    previous?.close();
    this.credentials = { ...credentials };
    this.reconnectAttempt = 0;
    this.clearConnectionState();
    this.openSocket(this.generation);
  }

  disconnect(): void {
    this.generation += 1;
    this.credentials = null;
    this.clearReconnect();
    const previous = this.socket;
    this.socket = null;
    this.socketEpoch += 1;
    previous?.close();
    this.clearConnectionState();
  }

  async consumePending(conversationId: string, turnId: string): Promise<PendingTerminalDisposition> {
    this.expireTerminalState();
    const canonicalConversationId = normalizePresentationConversationId(conversationId);
    if (canonicalConversationId === null || !UUID_PATTERN.test(turnId)) return 'missing';
    const key = this.tupleKey(canonicalConversationId, turnId);
    const epoch = this.socketEpoch;
    const inFlight = this.inFlight.get(key);
    if (inFlight !== undefined) {
      const disposition = await this.awaitInFlight(inFlight);
      if (disposition === null) return 'missing';
      if (epoch !== this.socketEpoch) return 'missing';
      if (disposition !== 'pending') return disposition;
    }
    const pending = this.pending.get(key);
    if (pending === undefined || pending.epoch !== epoch) return 'missing';
    return this.evaluateTerminalEvent(pending.event, epoch, undefined, pending.expiresAt);
  }

  private openSocket(generation: number): void {
    const credentials = this.credentials;
    if (credentials === null || generation !== this.generation) return;
    this.socketEpoch += 1;
    const epoch = this.socketEpoch;
    this.clearConnectionState();
    const url = `ws://127.0.0.1:${credentials.port}/ws`;
    const socket = this.options.createSocket(url, {
      headers: localTokenAuthHeaders(credentials.token),
      maxPayload: MAX_FRAME_BYTES,
    });
    this.socket = socket;
    socket.on('open', () => {
      if (this.isCurrentSocket(socket, generation, epoch)) this.reconnectAttempt = 0;
    });
    socket.on('message', (data, isBinary) => {
      if (!this.isCurrentSocket(socket, generation, epoch)) return;
      void this.handleMessage(socket, generation, epoch, data, isBinary);
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (!this.isCurrentSocket(socket, generation, epoch) || this.credentials === null) return;
      this.socket = null;
      this.socketEpoch += 1;
      this.clearConnectionState();
      this.scheduleReconnect(generation);
    });
  }

  private async handleMessage(
    socket: SocketLike,
    generation: number,
    epoch: number,
    data: unknown,
    isBinary: boolean
  ): Promise<void> {
    const bytes = frameBytes(data);
    if (isBinary || bytes === null) {
      this.quarantine(socket, generation, epoch, 'MALFORMED_EVENT');
      return;
    }
    if (bytes.byteLength > MAX_FRAME_BYTES) {
      this.quarantine(socket, generation, epoch, 'FRAME_OVERSIZE');
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString('utf8'));
    } catch {
      this.quarantine(socket, generation, epoch, 'MALFORMED_EVENT');
      return;
    }
    const event = parseTerminalEvent(raw, this.now().toISOString());
    if (event === undefined) return;
    if (event === null) {
      this.quarantine(socket, generation, epoch, 'MALFORMED_EVENT');
      return;
    }
    if (!this.consumeRateCapacity()) {
      this.quarantine(socket, generation, epoch, 'EVENT_RATE_EXCEEDED');
      return;
    }
    const key = this.tupleKey(event.conversationId, event.turnId);
    if (this.hasSeen(key)) return;
    try {
      await this.evaluateTerminalEvent(event, epoch, { socket, generation });
    } catch {
      return;
    }
  }

  private evaluateTerminalEvent(
    event: PresentationRuntimeTerminalEvent,
    epoch: number,
    connection?: { socket: SocketLike; generation: number },
    pendingExpiresAt?: number
  ): Promise<TerminalDisposition> {
    this.expireTerminalState();
    const key = this.tupleKey(event.conversationId, event.turnId);
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing.operation;
    const retained = this.pending.get(key);
    if (retained !== undefined) {
      if (retained.epoch !== epoch) return Promise.resolve('pending');
      this.pending.delete(key);
    }
    const deadlineAt = pendingExpiresAt ?? retained?.expiresAt ?? Date.parse(event.observedAt) + PENDING_TTL_MS;
    const now = this.now().getTime();
    if (epoch !== this.socketEpoch || deadlineAt <= now) return Promise.resolve('pending');
    if (retained === undefined && this.pending.size + this.inFlight.size >= MAX_PENDING_TUPLES) {
      if (connection !== undefined) {
        this.quarantine(connection.socket, connection.generation, epoch, 'PENDING_OVERFLOW');
      }
      return Promise.resolve('pending');
    }

    const controller = new AbortController();
    let entry!: InFlightTerminal;
    const authority: PresentationTerminalEventAuthority = Object.freeze({
      signal: controller.signal,
      deadlineAt,
      isCurrent: (): boolean =>
        epoch === this.socketEpoch && !controller.signal.aborted && this.now().getTime() < deadlineAt,
    });
    const operation = Promise.resolve().then(async (): Promise<TerminalDisposition> => {
      if (!authority.isCurrent()) return 'pending';
      try {
        const disposition = await this.options.onTerminalEvent(event, authority);
        if (!authority.isCurrent()) return 'pending';
        if (disposition === 'pending') {
          this.retainPending(key, event, epoch, deadlineAt);
        } else {
          this.pending.delete(key);
          this.markSeen(key);
        }
        return disposition;
      } catch (error) {
        if (authority.isCurrent()) this.retainPending(key, event, epoch, deadlineAt);
        throw error;
      } finally {
        clearTimeout(entry.deadlineTimer);
        if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
      }
    });
    entry = {
      operation,
      controller,
      deadlineAt,
      deadlineTimer: setTimeout(() => this.expireInFlight(key, entry), deadlineAt - now),
      epoch,
    };
    this.inFlight.set(key, entry);
    return operation;
  }

  private retainPending(key: string, event: PresentationRuntimeTerminalEvent, epoch: number, expiresAt: number): void {
    this.expireTerminalState();
    if (epoch !== this.socketEpoch || expiresAt <= this.now().getTime()) return;
    const existing = this.pending.get(key);
    if (existing !== undefined) {
      this.schedulePendingRetry(epoch);
      return;
    }
    this.pending.set(key, { event, expiresAt, epoch });
    this.schedulePendingRetry(epoch);
  }

  private consumeRateCapacity(): boolean {
    const now = this.now().getTime();
    this.eventTimes = this.eventTimes.filter((time) => now - time < 60_000);
    if (this.eventTimes.length >= MAX_EVENTS_PER_MINUTE) return false;
    if (this.burstUpdatedAt === 0) this.burstUpdatedAt = now;
    const elapsed = Math.max(0, now - this.burstUpdatedAt);
    this.burstTokens = Math.min(BURST_CAPACITY, this.burstTokens + elapsed * BURST_REFILL_PER_MS);
    this.burstUpdatedAt = now;
    if (this.burstTokens < 1) return false;
    this.burstTokens -= 1;
    this.eventTimes.push(now);
    return true;
  }

  private quarantine(socket: SocketLike, generation: number, epoch: number, code: string): void {
    if (!this.isCurrentSocket(socket, generation, epoch)) return;
    this.diagnostic(code);
    this.socket = null;
    this.socketEpoch += 1;
    this.clearConnectionState();
    socket.terminate();
    this.scheduleReconnect(generation);
  }

  private diagnostic(code: string): void {
    const now = this.now().getTime();
    const previous = this.diagnosticTimes.get(code);
    if (previous !== undefined && now - previous < DIAGNOSTIC_INTERVAL_MS) return;
    this.diagnosticTimes.set(code, now);
    this.options.diagnostic?.(code);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearConnectionState(): void {
    this.clearPendingRetry();
    this.pending.clear();
    this.seen.clear();
    for (const entry of this.inFlight.values()) {
      entry.controller.abort();
      clearTimeout(entry.deadlineTimer);
    }
    this.inFlight.clear();
    this.eventTimes = [];
    this.burstTokens = BURST_CAPACITY;
    this.burstUpdatedAt = this.now().getTime();
  }

  private isCurrentSocket(socket: SocketLike, generation: number, epoch: number): boolean {
    return generation === this.generation && epoch === this.socketEpoch && socket === this.socket;
  }

  private scheduleReconnect(generation: number): void {
    if (this.credentials === null || generation !== this.generation || this.reconnectTimer !== null) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket(generation);
    }, delay);
  }

  private schedulePendingRetry(epoch: number): void {
    if (epoch !== this.socketEpoch || this.pending.size === 0 || this.pendingRetryTimer !== null) return;
    this.pendingRetryTimer = setTimeout(() => {
      this.pendingRetryTimer = null;
      void this.retryPending(epoch);
    }, PENDING_RETRY_INTERVAL_MS);
  }

  private async retryPending(epoch: number): Promise<void> {
    if (epoch !== this.socketEpoch) return;
    this.expireTerminalState();
    const pending = [...this.pending.values()];
    if (pending.length === 0) return;
    await Promise.allSettled(
      pending.map(({ event, expiresAt }) => this.evaluateTerminalEvent(event, epoch, undefined, expiresAt))
    );
    if (epoch !== this.socketEpoch) return;
    this.expireTerminalState();
    this.schedulePendingRetry(epoch);
  }

  private clearPendingRetry(): void {
    if (this.pendingRetryTimer !== null) clearTimeout(this.pendingRetryTimer);
    this.pendingRetryTimer = null;
  }

  private expireTerminalState(): void {
    const now = this.now().getTime();
    for (const [key, value] of this.pending) {
      if (value.expiresAt <= now) this.pending.delete(key);
    }
    for (const [key, entry] of this.inFlight) {
      if (entry.deadlineAt <= now) this.expireInFlight(key, entry);
    }
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
    if (this.pending.size === 0) this.clearPendingRetry();
  }

  private expireInFlight(key: string, entry: InFlightTerminal): void {
    if (this.inFlight.get(key) !== entry) return;
    entry.controller.abort();
    clearTimeout(entry.deadlineTimer);
    this.inFlight.delete(key);
  }

  private awaitInFlight(entry: InFlightTerminal): Promise<TerminalDisposition | null> {
    const signal = entry.controller.signal;
    return new Promise((resolve, reject) => {
      let complete = false;
      const finish = (operation: () => void): void => {
        if (complete) return;
        complete = true;
        signal.removeEventListener('abort', onAbort);
        operation();
      };
      const onAbort = (): void => finish(() => resolve(null));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      void entry.operation.then(
        (disposition) => finish(() => resolve(disposition)),
        (error: unknown) => finish(() => reject(error))
      );
    });
  }

  private hasSeen(key: string): boolean {
    this.expireTerminalState();
    return this.seen.has(key);
  }

  private markSeen(key: string): void {
    this.expireTerminalState();
    this.seen.delete(key);
    this.seen.set(key, this.now().getTime() + PENDING_TTL_MS);
    while (this.seen.size > MAX_SEEN_TUPLES) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }

  private tupleKey(conversationId: string, turnId: string): string {
    return `${conversationId}\u0000${turnId}`;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
