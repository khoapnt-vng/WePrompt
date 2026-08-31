/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as commandQueueModule from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import {
  PRESENTATION_COMMAND_QUEUE_MAX_INPUT_LENGTH,
  PRESENTATION_COMMAND_QUEUE_MAX_ITEMS,
  PRESENTATION_COMMAND_QUEUE_MAX_STATE_BYTES,
} from '@/common/types/platform/presentationCommandQueue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CONVERSATION_ID = '2be7b8fc-6af5-42b8-aed5-03644735c730';
const SHORT_CONVERSATION_ID = 'd0921953';
const QUEUE_ITEM_ID = '37f0a614-3e7f-41b5-87fd-49076fcf078d';
const SECOND_QUEUE_ITEM_ID = '9ba9e8d0-dbd3-43a3-b12d-a3a04ef50464';
const CLIENT_REQUEST_ID = 'c9426c09-4352-4c7c-88ca-039bfcaaf0d8';
const SECOND_CLIENT_REQUEST_ID = '0d8ff76d-0640-4334-926f-cb4da12d18de';
const GRANT_ID = '229ca31e-1150-4ad1-ad62-1c3368330adc';
const RUN_ID = '5a68fccc-7b90-49b4-88f9-d78bb88255ed';
const NOW = '2026-08-05T00:00:00.000Z';
const STORAGE_KEY = `presentation-command-queue/v2/${CONVERSATION_ID}`;
const SHORT_STORAGE_KEY = `presentation-command-queue/v2/${SHORT_CONVERSATION_ID}`;

type SourceRef = {
  grantId: string;
  expectedByteLength: number;
  expectedSha256: string;
};

type QueueExecution =
  | { state: 'persisting' }
  | { state: 'queued' }
  | { state: 'claimed'; claimedAt: string }
  | { state: 'committed'; runId: string; revision: number; postInvoked: false }
  | { state: 'dispatching'; runId: string; revision: number }
  | { state: 'bound'; runId: string; revision: number }
  | { state: 'preflight_failed'; code: string }
  | { state: 'dispatch_uncertain'; runId: string; revision: number | null };

type QueueItem = {
  queueItemId: string;
  clientRequestId: string;
  input: string;
  selectedTemplateId: string;
  sources: SourceRef[];
  execution: QueueExecution;
};

type QueueController = {
  read: () => { version: 2; conversationId: string; revision: number; items: QueueItem[] };
  enqueue: (input: {
    queueItemId: string;
    clientRequestId: string;
    input: string;
    selectedTemplateId: string;
    sources: SourceRef[];
    sourceOwner: { owner_type: 'conversation'; conversation_id: string } | null;
    expectedOwnerRevision: number | null;
  }) => Promise<QueueItem>;
  recoverPersisting: () => Promise<void>;
  retirePersisting: (queueItemId: string) => Promise<'confirmed' | 'removed'>;
  removePersistingAfterConfirmedGrantRevocation: (queueItemId: string, grantId: string) => Promise<void>;
  editQueued: (queueItemId: string, updates: { input: string }) => Promise<QueueItem>;
  removeQueued: (queueItemId: string) => Promise<void>;
  claimHead: (queueItemId: string) => Promise<QueueItem>;
  allocateClaimed: (
    queueItemId: string,
    start: (request: unknown) => Promise<
      | {
          ok: true;
          run: {
            runId: string;
            revision: number;
          };
        }
      | { ok: false; code: string }
    >
  ) => Promise<QueueItem>;
  transition: (queueItemId: string, execution: QueueExecution) => Promise<QueueItem>;
  removePreflightFailed: (queueItemId: string) => Promise<void>;
  removeBound: (queueItemId: string) => Promise<void>;
  runCommittedHead: (execute: (item: QueueItem) => Promise<void>) => Promise<'executed' | 'busy' | 'not_runnable'>;
};

type StorageBoundary = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

class MemoryStorage implements StorageBoundary {
  readonly values = new Map<string, string>();
  readonly operations: string[] = [];

  getItem(key: string): string | null {
    this.operations.push(`get:${key}`);
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.operations.push(`set:${key}`);
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.operations.push(`remove:${key}`);
    this.values.delete(key);
  }
}

type ConfirmQueuedSources = (
  request: unknown
) => Promise<
  | { ok: true; status: 'confirmed' | 'already_confirmed'; ownerRevision: number; expiresAt: string }
  | { ok: false; code: string }
>;

type ControllerFactory = (options: {
  conversationId: string;
  storage: StorageBoundary;
  confirmQueuedSources: ConfirmQueuedSources;
  now: () => Date;
}) => QueueController;

const sourceRef = (overrides: Partial<SourceRef> = {}): SourceRef => ({
  grantId: GRANT_ID,
  expectedByteLength: 128,
  expectedSha256: 'a'.repeat(64),
  ...overrides,
});

const testUuid = (value: number): string => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;

const persistedQueueItem = (index: number, input = 'Create a deck') => ({
  queueItemId: testUuid(1_000 + index),
  clientRequestId: testUuid(2_000 + index),
  input,
  selectedTemplateId: 'business-review',
  sources: [],
  sourceOwner: null,
  expectedOwnerRevision: null,
  confirmedOwnerRevision: null,
  createdAt: NOW,
  updatedAt: NOW,
  execution: { state: 'queued' as const },
});

const enqueueInput = (
  overrides: Partial<Parameters<QueueController['enqueue']>[0]> = {}
): Parameters<QueueController['enqueue']>[0] => ({
  queueItemId: QUEUE_ITEM_ID,
  clientRequestId: CLIENT_REQUEST_ID,
  input: 'Create a concise board update',
  selectedTemplateId: 'business-review',
  sources: [sourceRef()],
  sourceOwner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
  expectedOwnerRevision: 1,
  ...overrides,
});

const confirmed: ConfirmQueuedSources = vi.fn(async () => ({
  ok: true,
  status: 'confirmed',
  ownerRevision: 2,
  expiresAt: '2026-08-06T00:00:00.000Z',
}));

const getFactory = (module: object = commandQueueModule): ControllerFactory => {
  const factory = Reflect.get(module, 'createPresentationCommandQueueController');
  expect(factory).toBeTypeOf('function');
  return factory as ControllerFactory;
};

const createController = (
  storage: StorageBoundary,
  confirmQueuedSources: ConfirmQueuedSources = confirmed,
  conversationId = CONVERSATION_ID,
  module: object = commandQueueModule
): QueueController =>
  getFactory(module)({
    conversationId,
    storage,
    confirmQueuedSources,
    now: () => new Date(NOW),
  });

describe('managed presentation queue persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirm-writes persisting before main confirmation and confirm-writes queued afterward', async () => {
    const storage = new MemoryStorage();
    const confirmQueuedSources = vi.fn<ConfirmQueuedSources>(async () => {
      const duringConfirmation = JSON.parse(storage.values.get(STORAGE_KEY) ?? '{}') as {
        items?: Array<{ execution?: QueueExecution }>;
      };
      expect(duringConfirmation.items?.[0]?.execution).toEqual({ state: 'persisting' });
      return {
        ok: true,
        status: 'confirmed',
        ownerRevision: 2,
        expiresAt: '2026-08-06T00:00:00.000Z',
      };
    });
    const controller = createController(storage, confirmQueuedSources);

    const item = await controller.enqueue(enqueueInput());

    expect(item.execution).toEqual({ state: 'queued' });
    expect(confirmQueuedSources).toHaveBeenCalledOnce();
    expect(storage.operations).toEqual([
      `get:presentation-command-queue/v2/${CONVERSATION_ID.toUpperCase()}`,
      `get:${STORAGE_KEY}`,
      `set:${STORAGE_KEY}`,
      `get:${STORAGE_KEY}`,
      `get:${STORAGE_KEY}`,
      `set:${STORAGE_KEY}`,
      `get:${STORAGE_KEY}`,
    ]);
  });

  it('canonicalizes a backend conversation id at controller ingress and persists it under one lowercase key', async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage, confirmed, SHORT_CONVERSATION_ID.toUpperCase());

    await controller.enqueue(
      enqueueInput({
        sourceOwner: { owner_type: 'conversation', conversation_id: SHORT_CONVERSATION_ID },
      })
    );

    expect(controller.read().conversationId).toBe(SHORT_CONVERSATION_ID);
    expect(storage.values.has(SHORT_STORAGE_KEY)).toBe(true);
    expect(Array.from(storage.values.keys())).toEqual([SHORT_STORAGE_KEY]);
    expect(createController(storage, confirmed, SHORT_CONVERSATION_ID).read()).toMatchObject({
      conversationId: SHORT_CONVERSATION_ID,
      items: [
        expect.objectContaining({
          queueItemId: QUEUE_ITEM_ID,
          clientRequestId: CLIENT_REQUEST_ID,
          sourceOwner: { owner_type: 'conversation', conversation_id: SHORT_CONVERSATION_ID },
        }),
      ],
    });
  });

  it('probes the deterministic uppercase legacy UUID key for a canonical caller and migrates it after proof', () => {
    const storage = new MemoryStorage();
    const legacyConversationId = CONVERSATION_ID.toUpperCase();
    const legacyKey = `presentation-command-queue/v2/${legacyConversationId}`;
    storage.values.set(
      legacyKey,
      JSON.stringify({
        version: 2,
        conversationId: legacyConversationId,
        revision: 1,
        items: [
          {
            ...persistedQueueItem(0),
            sources: [sourceRef()],
            sourceOwner: { owner_type: 'conversation', conversation_id: legacyConversationId },
            expectedOwnerRevision: 1,
            confirmedOwnerRevision: 2,
          },
        ],
      })
    );
    storage.values.set('presentation-command-queue/v2/UNRELATED', 'leave-me-alone');

    const state = createController(storage, confirmed, CONVERSATION_ID).read();

    expect(state).toMatchObject({
      conversationId: CONVERSATION_ID,
      items: [
        expect.objectContaining({
          sourceOwner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        }),
      ],
    });
    expect(storage.values.has(legacyKey)).toBe(false);
    expect(JSON.parse(storage.values.get(STORAGE_KEY)!)).toMatchObject({
      conversationId: CONVERSATION_ID,
      items: [
        expect.objectContaining({
          sourceOwner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        }),
      ],
    });
    expect(storage.values.get('presentation-command-queue/v2/UNRELATED')).toBe('leave-me-alone');
  });

  it('rejects non-canonical persisted aliases and never widens durable queue identifiers', async () => {
    const uppercaseEnvelope = {
      version: 2,
      conversationId: SHORT_CONVERSATION_ID.toUpperCase(),
      revision: 0,
      items: [],
    };

    expect(() =>
      commandQueueModule.decodePresentationCommandQueueState(uppercaseEnvelope, SHORT_CONVERSATION_ID)
    ).toThrow(/invalid/i);
    expect(() => createController(new MemoryStorage(), confirmed, '../private')).toThrow(/conversation id/i);

    const controller = createController(new MemoryStorage(), confirmed, SHORT_CONVERSATION_ID);
    await expect(
      controller.enqueue(
        enqueueInput({
          queueItemId: SHORT_CONVERSATION_ID,
          sourceOwner: { owner_type: 'conversation', conversation_id: SHORT_CONVERSATION_ID },
        })
      )
    ).rejects.toThrow(/item/i);
  });

  it('never calls main when the initial local write throws', async () => {
    const storage: StorageBoundary = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }),
      removeItem: vi.fn(),
    };
    const confirmQueuedSources = vi.fn<ConfirmQueuedSources>(confirmed);
    const controller = createController(storage, confirmQueuedSources);

    await expect(controller.enqueue(enqueueInput())).rejects.toThrow(/persist/i);
    expect(confirmQueuedSources).not.toHaveBeenCalled();
  });

  it('rejects a readback mismatch and restores the previous canonical state', async () => {
    let value: string | null = null;
    let mismatchNextRead = false;
    const storage: StorageBoundary = {
      getItem: vi.fn(() => {
        if (value === null) return null;
        if (!mismatchNextRead) return value;
        mismatchNextRead = false;
        return `${value} `;
      }),
      setItem: vi.fn((_key, nextValue) => {
        value = nextValue;
        mismatchNextRead = true;
      }),
      removeItem: vi.fn(() => {
        value = null;
      }),
    };
    const confirmQueuedSources = vi.fn<ConfirmQueuedSources>(confirmed);
    const controller = createController(storage, confirmQueuedSources);

    await expect(controller.enqueue(enqueueInput())).rejects.toThrow(/readback/i);
    expect(confirmQueuedSources).not.toHaveBeenCalled();
    expect(value).toBeNull();
  });

  it('rejects revision overflow before write and preserves the exact canonical envelope', async () => {
    const storage = new MemoryStorage();
    const item = persistedQueueItem(0);
    const previousRaw = JSON.stringify({
      version: 2,
      conversationId: CONVERSATION_ID,
      revision: Number.MAX_SAFE_INTEGER,
      items: [item],
    });
    storage.values.set(STORAGE_KEY, previousRaw);
    const controller = createController(storage);

    await expect(controller.editQueued(item.queueItemId, { input: 'Updated deck' })).rejects.toThrow(/state|revision/i);

    expect(storage.values.get(STORAGE_KEY)).toBe(previousRaw);
    expect(controller.read()).toMatchObject({
      revision: Number.MAX_SAFE_INTEGER,
      items: [{ input: 'Create a deck', execution: { state: 'queued' } }],
    });
  });

  it('does not persist an invalid confirmation owner revision', async () => {
    const storage = new MemoryStorage();
    let persistingRaw = '';
    const confirmQueuedSources = vi.fn<ConfirmQueuedSources>(async () => {
      persistingRaw = storage.values.get(STORAGE_KEY) ?? '';
      return {
        ok: true,
        status: 'confirmed',
        ownerRevision: Number.MAX_SAFE_INTEGER + 1,
        expiresAt: '2026-08-06T00:00:00.000Z',
      };
    });
    const controller = createController(storage, confirmQueuedSources);

    await expect(controller.enqueue(enqueueInput())).rejects.toThrow(/state|revision|confirmation/i);

    expect(persistingRaw).not.toBe('');
    expect(storage.values.get(STORAGE_KEY)).toBe(persistingRaw);
    expect(controller.read().items[0]?.execution).toEqual({ state: 'persisting' });
  });

  it('does not persist invalid run fields returned by allocation', async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));
    await controller.claimHead(QUEUE_ITEM_ID);
    const claimedRaw = storage.values.get(STORAGE_KEY);

    await expect(
      controller.allocateClaimed(QUEUE_ITEM_ID, async () => ({
        ok: true,
        run: { runId: 'not-a-uuid', revision: 4 },
      }))
    ).rejects.toThrow(/state|run/i);

    expect(storage.values.get(STORAGE_KEY)).toBe(claimedRaw);
    expect(controller.read().items[0]?.execution).toMatchObject({ state: 'claimed' });
  });

  it('initializes v2 separately and never converts the path-bearing legacy queue', async () => {
    const storage = new MemoryStorage();
    const legacyKey = `conversation-command-queue/${CONVERSATION_ID}`;
    const legacyValue = JSON.stringify({
      items: [{ id: 'legacy', input: 'legacy send', files: ['/private/source.pdf'], created_at: 1 }],
      isPaused: false,
      mode: 'auto',
    });
    storage.values.set(legacyKey, legacyValue);
    const controller = createController(storage);

    expect(controller.read()).toEqual({ version: 2, conversationId: CONVERSATION_ID, revision: 0, items: [] });
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));

    expect(storage.values.get(legacyKey)).toBe(legacyValue);
    expect(storage.values.get(STORAGE_KEY)).not.toContain('/private/source.pdf');
    expect(confirmed).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'unknown envelope version', envelopeMutation: { version: 1 }, itemMutation: {} },
    { label: 'path-bearing files', envelopeMutation: {}, itemMutation: { files: ['/private/source.pdf'] } },
    { label: 'source descriptor', envelopeMutation: {}, itemMutation: { displayName: 'source.pdf' } },
  ])('rejects persisted v2 with $label instead of normalizing it', ({ envelopeMutation, itemMutation }) => {
    const storage = new MemoryStorage();
    storage.values.set(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        conversationId: CONVERSATION_ID,
        revision: 1,
        ...envelopeMutation,
        items: [
          {
            queueItemId: QUEUE_ITEM_ID,
            clientRequestId: CLIENT_REQUEST_ID,
            input: 'Create a deck',
            selectedTemplateId: 'business-review',
            sources: [sourceRef()],
            sourceOwner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
            expectedOwnerRevision: 1,
            confirmedOwnerRevision: null,
            createdAt: NOW,
            updatedAt: NOW,
            execution: { state: 'persisting' },
            ...itemMutation,
          },
        ],
      })
    );

    expect(() => createController(storage).read()).toThrow(/invalid/i);
  });

  it('rejects an unknown formatted preflight failure code instead of casting it into the strict union', () => {
    const storage = new MemoryStorage();
    storage.values.set(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        conversationId: CONVERSATION_ID,
        revision: 1,
        items: [
          {
            ...persistedQueueItem(0),
            execution: { state: 'preflight_failed', code: 'TOTALLY_UNKNOWN' },
          },
        ],
      })
    );

    expect(() => createController(storage).read()).toThrow(/execution state/i);
  });

  it('rejects a conversation source owner that differs from the strict queue envelope conversation', () => {
    const storage = new MemoryStorage();
    storage.values.set(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        conversationId: CONVERSATION_ID,
        revision: 1,
        items: [
          {
            ...persistedQueueItem(0),
            sources: [sourceRef()],
            sourceOwner: { owner_type: 'conversation', conversation_id: SECOND_QUEUE_ITEM_ID },
            expectedOwnerRevision: 1,
            confirmedOwnerRevision: 2,
          },
        ],
      })
    );

    expect(() => createController(storage).read()).toThrow(/owner|conversation/i);
  });

  it('rejects duplicate, over-count, and aggregate-overflow opaque refs before persistence', async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    const duplicate = [sourceRef(), sourceRef()];
    const overCount = Array.from({ length: 17 }, (_, index) =>
      sourceRef({ grantId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}` })
    );
    const aggregateOverflow = Array.from({ length: 5 }, (_, index) =>
      sourceRef({
        grantId: `00000000-0000-4000-8000-${(index + 32).toString(16).padStart(12, '0')}`,
        expectedByteLength: 64 * 1_024 * 1_024,
      })
    );

    await expect(controller.enqueue(enqueueInput({ sources: duplicate }))).rejects.toThrow(/source/i);
    await expect(controller.enqueue(enqueueInput({ sources: overCount }))).rejects.toThrow(/source/i);
    await expect(controller.enqueue(enqueueInput({ sources: aggregateOverflow }))).rejects.toThrow(/source/i);
    expect(storage.values.size).toBe(0);
  });

  it('accepts the exact input and item-count ceilings and rejects the first value over either ceiling', async () => {
    const inputStorage = new MemoryStorage();
    const inputController = createController(inputStorage);
    await expect(
      inputController.enqueue(
        enqueueInput({
          input: 'x'.repeat(PRESENTATION_COMMAND_QUEUE_MAX_INPUT_LENGTH),
          sources: [],
          sourceOwner: null,
          expectedOwnerRevision: null,
        })
      )
    ).resolves.toMatchObject({ input: 'x'.repeat(PRESENTATION_COMMAND_QUEUE_MAX_INPUT_LENGTH) });
    await expect(
      inputController.enqueue(
        enqueueInput({
          queueItemId: SECOND_QUEUE_ITEM_ID,
          clientRequestId: SECOND_CLIENT_REQUEST_ID,
          input: 'x'.repeat(PRESENTATION_COMMAND_QUEUE_MAX_INPUT_LENGTH + 1),
          sources: [],
          sourceOwner: null,
          expectedOwnerRevision: null,
        })
      )
    ).rejects.toThrow(/item/i);

    const countStorage = new MemoryStorage();
    const countController = createController(countStorage);
    await Promise.all(
      Array.from({ length: PRESENTATION_COMMAND_QUEUE_MAX_ITEMS }, (_, index) =>
        countController.enqueue(
          enqueueInput({
            queueItemId: testUuid(3_000 + index),
            clientRequestId: testUuid(4_000 + index),
            input: `Deck ${index}`,
            sources: [],
            sourceOwner: null,
            expectedOwnerRevision: null,
          })
        )
      )
    );
    expect(countController.read().items).toHaveLength(PRESENTATION_COMMAND_QUEUE_MAX_ITEMS);
    await expect(
      countController.enqueue(
        enqueueInput({
          queueItemId: testUuid(5_000),
          clientRequestId: testUuid(6_000),
          sources: [],
          sourceOwner: null,
          expectedOwnerRevision: null,
        })
      )
    ).rejects.toThrow(/full/i);
  });

  it('accepts a canonical state below the byte ceiling and rejects the first canonical state above it', () => {
    const items: ReturnType<typeof persistedQueueItem>[] = [];
    let acceptedRaw = '';
    let overflowRaw = '';
    for (let index = 0; index < PRESENTATION_COMMAND_QUEUE_MAX_ITEMS; index += 1) {
      const nextItems = [...items, persistedQueueItem(index, 'x'.repeat(PRESENTATION_COMMAND_QUEUE_MAX_INPUT_LENGTH))];
      const raw = JSON.stringify({
        version: 2,
        conversationId: CONVERSATION_ID,
        revision: nextItems.length,
        items: nextItems,
      });
      if (new TextEncoder().encode(raw).length > PRESENTATION_COMMAND_QUEUE_MAX_STATE_BYTES) {
        overflowRaw = raw;
        break;
      }
      items.push(nextItems.at(-1)!);
      acceptedRaw = raw;
    }
    expect(acceptedRaw).not.toBe('');
    expect(overflowRaw).not.toBe('');

    const storage = new MemoryStorage();
    storage.values.set(STORAGE_KEY, acceptedRaw);
    expect(createController(storage).read().items).toHaveLength(items.length);
    storage.values.set(STORAGE_KEY, overflowRaw);
    expect(() => createController(storage).read()).toThrow(/size/i);
  });

  it('serializes concurrent managed mutations through one conversation tail', async () => {
    const storage = new MemoryStorage();
    let releaseConfirmation: (() => void) | undefined;
    const confirmQueuedSources = vi.fn<ConfirmQueuedSources>(
      () =>
        new Promise((resolve) => {
          releaseConfirmation = () =>
            resolve({
              ok: true,
              status: 'confirmed',
              ownerRevision: 2,
              expiresAt: '2026-08-06T00:00:00.000Z',
            });
        })
    );
    const controller = createController(storage, confirmQueuedSources);

    const first = controller.enqueue(enqueueInput());
    await vi.waitFor(() => expect(confirmQueuedSources).toHaveBeenCalledOnce());
    const second = controller.enqueue(
      enqueueInput({
        queueItemId: SECOND_QUEUE_ITEM_ID,
        clientRequestId: SECOND_CLIENT_REQUEST_ID,
        input: 'Second deck',
        sources: [],
        sourceOwner: null,
        expectedOwnerRevision: null,
      })
    );
    await Promise.resolve();

    expect(controller.read().items).toMatchObject([{ queueItemId: QUEUE_ITEM_ID, execution: { state: 'persisting' } }]);
    releaseConfirmation?.();
    await Promise.all([first, second]);

    expect(controller.read().items).toMatchObject([
      { queueItemId: QUEUE_ITEM_ID, execution: { state: 'queued' } },
      { queueItemId: SECOND_QUEUE_ITEM_ID, execution: { state: 'queued' } },
    ]);
  });

  it('recovers a lost main reply with the same stable IDs and idempotent confirmation', async () => {
    const storage = new MemoryStorage();
    const confirmQueuedSources = vi
      .fn<ConfirmQueuedSources>()
      .mockRejectedValueOnce(new Error('lost IPC reply'))
      .mockResolvedValueOnce({
        ok: true,
        status: 'already_confirmed',
        ownerRevision: 2,
        expiresAt: '2026-08-06T00:00:00.000Z',
      });
    const first = createController(storage, confirmQueuedSources);

    await expect(first.enqueue(enqueueInput())).rejects.toThrow('lost IPC reply');
    expect(first.read().items[0]).toMatchObject({
      queueItemId: QUEUE_ITEM_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      execution: { state: 'persisting' },
    });

    vi.resetModules();
    const freshModule = await import('@/renderer/pages/conversation/platforms/useConversationCommandQueue');
    const restarted = createController(storage, confirmQueuedSources, CONVERSATION_ID, freshModule);
    await restarted.recoverPersisting();

    expect(restarted.read().items[0]).toMatchObject({
      queueItemId: QUEUE_ITEM_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      execution: { state: 'queued' },
    });
    expect(confirmQueuedSources).toHaveBeenCalledTimes(2);
  });

  it('removes an exact persisting item only after an explicit definitive confirmation rejection', async () => {
    const storage = new MemoryStorage();
    const confirmQueuedSources = vi
      .fn<ConfirmQueuedSources>()
      .mockRejectedValueOnce(new Error('lost IPC reply'))
      .mockResolvedValueOnce({ ok: false, code: 'SOURCE_TAMPERED' });
    const controller = createController(storage, confirmQueuedSources);
    await expect(controller.enqueue(enqueueInput())).rejects.toThrow('lost IPC reply');

    await expect(controller.retirePersisting(QUEUE_ITEM_ID)).resolves.toBe('removed');

    expect(controller.read().items).toEqual([]);
    expect(confirmQueuedSources).toHaveBeenCalledTimes(2);
  });

  it('preserves an exact persisting item when retirement confirmation transport is uncertain', async () => {
    const storage = new MemoryStorage();
    const confirmQueuedSources = vi
      .fn<ConfirmQueuedSources>()
      .mockRejectedValueOnce(new Error('lost IPC reply'))
      .mockRejectedValueOnce(new Error('transport unavailable'));
    const controller = createController(storage, confirmQueuedSources);
    await expect(controller.enqueue(enqueueInput())).rejects.toThrow('lost IPC reply');

    await expect(controller.retirePersisting(QUEUE_ITEM_ID)).rejects.toThrow('transport unavailable');

    expect(controller.read().items).toMatchObject([{ queueItemId: QUEUE_ITEM_ID, execution: { state: 'persisting' } }]);
  });

  it.each([
    'FEATURE_DISABLED',
    'DESKTOP_REQUIRED',
    'DRAFT_NOT_FOUND',
    'DRAFT_EXPIRED',
    'DRAFT_FOREIGN',
    'SOURCE_GRANT_INVALID',
    'SOURCE_GRANT_EXPIRED',
    'SOURCE_GRANT_FOREIGN',
    'SOURCE_GRANT_REPLAYED',
    'RUN_NOT_FOUND',
    'RUN_FORBIDDEN',
    'SCOPE_UNAVAILABLE',
    'TEAM_SCOPE_UNSUPPORTED',
    'PERSISTENCE_FAILED',
    'INTERNAL_ERROR',
  ] as const)('preserves an exact persisting item when confirmation returns uncertain %s', async (code) => {
    const storage = new MemoryStorage();
    const confirmQueuedSources = vi
      .fn<ConfirmQueuedSources>()
      .mockRejectedValueOnce(new Error('lost IPC reply'))
      .mockResolvedValueOnce({ ok: false, code });
    const controller = createController(storage, confirmQueuedSources);
    await expect(controller.enqueue(enqueueInput())).rejects.toThrow('lost IPC reply');

    await expect(controller.retirePersisting(QUEUE_ITEM_ID)).rejects.toThrow(/uncertain/i);

    expect(controller.read().items).toMatchObject([{ queueItemId: QUEUE_ITEM_ID, execution: { state: 'persisting' } }]);
  });

  it('removes an exact persisting item after durable proof that its frozen grant was revoked unbound', async () => {
    const storage = new MemoryStorage();
    const confirmQueuedSources = vi
      .fn<ConfirmQueuedSources>()
      .mockRejectedValueOnce(new Error('lost IPC reply'))
      .mockResolvedValueOnce({
        ok: false,
        code: 'SOURCE_GRANT_REPLAYED',
        messageKey: 'conversation.presentationRun.errors.SOURCE_GRANT_REPLAYED',
        retryable: false,
        state: 'grant_validation',
        details: { grantId: GRANT_ID, queueUnboundAtRevoke: true },
      });
    const controller = createController(storage, confirmQueuedSources);
    await expect(controller.enqueue(enqueueInput())).rejects.toThrow('lost IPC reply');

    await expect(controller.retirePersisting(QUEUE_ITEM_ID)).resolves.toBe('removed');

    expect(controller.read().items).toEqual([]);
    expect(confirmQueuedSources).toHaveBeenCalledTimes(2);
  });

  it('preserves a persisting item when durable revoke proof names a grant outside its frozen sources', async () => {
    const storage = new MemoryStorage();
    const confirmQueuedSources = vi
      .fn<ConfirmQueuedSources>()
      .mockRejectedValueOnce(new Error('lost IPC reply'))
      .mockResolvedValueOnce({
        ok: false,
        code: 'SOURCE_GRANT_REPLAYED',
        messageKey: 'conversation.presentationRun.errors.SOURCE_GRANT_REPLAYED',
        retryable: false,
        state: 'grant_validation',
        details: { grantId: SECOND_QUEUE_ITEM_ID, queueUnboundAtRevoke: true },
      });
    const controller = createController(storage, confirmQueuedSources);
    await expect(controller.enqueue(enqueueInput())).rejects.toThrow('lost IPC reply');

    await expect(controller.retirePersisting(QUEUE_ITEM_ID)).rejects.toThrow(/uncertain/i);

    expect(controller.read().items).toMatchObject([
      { queueItemId: QUEUE_ITEM_ID, sources: [{ grantId: GRANT_ID }], execution: { state: 'persisting' } },
    ]);
  });

  it('preserves a persisting item when revoke replay names its frozen grant without durable proof', async () => {
    const storage = new MemoryStorage();
    const confirmQueuedSources = vi
      .fn<ConfirmQueuedSources>()
      .mockRejectedValueOnce(new Error('lost IPC reply'))
      .mockResolvedValueOnce({
        ok: false,
        code: 'SOURCE_GRANT_REPLAYED',
        messageKey: 'conversation.presentationRun.errors.SOURCE_GRANT_REPLAYED',
        retryable: false,
        state: 'grant_validation',
        details: { grantId: GRANT_ID },
      });
    const controller = createController(storage, confirmQueuedSources);
    await expect(controller.enqueue(enqueueInput())).rejects.toThrow('lost IPC reply');

    await expect(controller.retirePersisting(QUEUE_ITEM_ID)).rejects.toThrow(/uncertain/i);

    expect(controller.read().items).toMatchObject([
      { queueItemId: QUEUE_ITEM_ID, sources: [{ grantId: GRANT_ID }], execution: { state: 'persisting' } },
    ]);
  });

  it('advances rather than removes a persisting item when retirement confirmation succeeds', async () => {
    const storage = new MemoryStorage();
    const confirmQueuedSources = vi
      .fn<ConfirmQueuedSources>()
      .mockRejectedValueOnce(new Error('lost IPC reply'))
      .mockResolvedValueOnce({
        ok: true,
        status: 'already_confirmed',
        ownerRevision: 2,
        expiresAt: '2026-08-06T00:00:00.000Z',
      });
    const controller = createController(storage, confirmQueuedSources);
    await expect(controller.enqueue(enqueueInput())).rejects.toThrow('lost IPC reply');

    await expect(controller.retirePersisting(QUEUE_ITEM_ID)).resolves.toBe('confirmed');

    expect(controller.read().items).toMatchObject([
      { queueItemId: QUEUE_ITEM_ID, confirmedOwnerRevision: 2, execution: { state: 'queued' } },
    ]);
  });

  it('removes a never-confirmed persisting item after exact proof that its frozen grant was revoked', async () => {
    const storage = new MemoryStorage();
    const confirmQueuedSources = vi.fn<ConfirmQueuedSources>().mockRejectedValueOnce(new Error('lost IPC reply'));
    const controller = createController(storage, confirmQueuedSources);
    await expect(controller.enqueue(enqueueInput())).rejects.toThrow('lost IPC reply');

    await expect(
      controller.removePersistingAfterConfirmedGrantRevocation(QUEUE_ITEM_ID, GRANT_ID)
    ).resolves.toBeUndefined();

    expect(controller.read().items).toEqual([]);
    expect(confirmQueuedSources).toHaveBeenCalledOnce();
  });

  it('preserves a persisting item when the proven revoked grant is not in its frozen sources', async () => {
    const storage = new MemoryStorage();
    const confirmQueuedSources = vi.fn<ConfirmQueuedSources>().mockRejectedValueOnce(new Error('lost IPC reply'));
    const controller = createController(storage, confirmQueuedSources);
    await expect(controller.enqueue(enqueueInput())).rejects.toThrow('lost IPC reply');

    await expect(
      controller.removePersistingAfterConfirmedGrantRevocation(QUEUE_ITEM_ID, '9ba9e8d0-dbd3-43a3-b12d-a3a04ef50464')
    ).rejects.toThrow(/revoked grant/i);

    expect(controller.read().items).toMatchObject([
      { queueItemId: QUEUE_ITEM_ID, sources: [{ grantId: GRANT_ID }], execution: { state: 'persisting' } },
    ]);
  });

  it('lets concurrent recovery to queued win over persisting revoke-proof removal', async () => {
    const storage = new MemoryStorage();
    let releaseConfirmation: (() => void) | undefined;
    const confirmation = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });
    const confirmQueuedSources = vi
      .fn<ConfirmQueuedSources>()
      .mockRejectedValueOnce(new Error('lost IPC reply'))
      .mockImplementationOnce(async () => {
        await confirmation;
        return {
          ok: true,
          status: 'already_confirmed',
          ownerRevision: 2,
          expiresAt: '2026-08-06T00:00:00.000Z',
        };
      });
    const controller = createController(storage, confirmQueuedSources);
    await expect(controller.enqueue(enqueueInput())).rejects.toThrow('lost IPC reply');
    expect(controller.removePersistingAfterConfirmedGrantRevocation).toBeTypeOf('function');

    const recovery = controller.recoverPersisting();
    const removal = controller.removePersistingAfterConfirmedGrantRevocation(QUEUE_ITEM_ID, GRANT_ID);
    releaseConfirmation?.();

    await expect(recovery).resolves.toBeUndefined();
    await expect(removal).rejects.toThrow(/persisting/i);
    expect(controller.read().items).toMatchObject([
      { queueItemId: QUEUE_ITEM_ID, confirmedOwnerRevision: 2, execution: { state: 'queued' } },
    ]);
  });

  it('allows editing and removal only while queued', async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));

    await expect(controller.editQueued(QUEUE_ITEM_ID, { input: 'Updated board brief' })).resolves.toMatchObject({
      input: 'Updated board brief',
      execution: { state: 'queued' },
    });
    await controller.claimHead(QUEUE_ITEM_ID);

    await expect(controller.editQueued(QUEUE_ITEM_ID, { input: 'Too late' })).rejects.toThrow(/state/i);
    await expect(controller.removeQueued(QUEUE_ITEM_ID)).rejects.toThrow(/state/i);
  });

  it.each(['write', 'readback'] as const)('rolls back a failed claim confirm-%s', async (failure) => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));
    if (failure === 'write') {
      vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      });
    } else {
      vi.spyOn(storage, 'getItem')
        .mockImplementationOnce((key) => storage.values.get(key) ?? null)
        .mockImplementationOnce((key) => `${storage.values.get(key) ?? ''} `);
    }

    await expect(controller.claimHead(QUEUE_ITEM_ID)).rejects.toThrow(/persist|readback/i);
    expect(controller.read().items[0]?.execution).toEqual({ state: 'queued' });
  });

  it('claims only the durable queued head and allocates only after confirmed claim', async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));
    await controller.enqueue(
      enqueueInput({
        queueItemId: SECOND_QUEUE_ITEM_ID,
        clientRequestId: SECOND_CLIENT_REQUEST_ID,
        input: 'Second deck',
        sources: [],
        sourceOwner: null,
        expectedOwnerRevision: null,
      })
    );
    const allocate = vi.fn(async () => ({ ok: true as const, run: { runId: RUN_ID, revision: 4 } }));

    await expect(controller.claimHead(SECOND_QUEUE_ITEM_ID)).rejects.toThrow(/head/i);
    await expect(controller.allocateClaimed(QUEUE_ITEM_ID, allocate)).rejects.toThrow(/claimed/i);
    expect(allocate).not.toHaveBeenCalled();

    await controller.claimHead(QUEUE_ITEM_ID);
    const committed = await controller.allocateClaimed(QUEUE_ITEM_ID, allocate);

    expect(allocate).toHaveBeenCalledOnce();
    expect(committed.execution).toEqual({ state: 'committed', runId: RUN_ID, revision: 4, postInvoked: false });
  });

  it('confirm-writes dispatching before invoking a committed head', async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));
    await controller.claimHead(QUEUE_ITEM_ID);
    await controller.allocateClaimed(QUEUE_ITEM_ID, async () => ({
      ok: true,
      run: { runId: RUN_ID, revision: 4 },
    }));
    const execute = vi.fn(async (item: QueueItem) => {
      expect(item.execution).toEqual({ state: 'dispatching', runId: RUN_ID, revision: 4 });
      expect(controller.read().items[0]?.execution).toEqual(item.execution);
      expect(JSON.parse(storage.values.get(STORAGE_KEY) ?? '{}')).toMatchObject({
        items: [{ execution: { state: 'dispatching', runId: RUN_ID, revision: 4 } }],
      });
    });

    await expect(controller.runCommittedHead(execute)).resolves.toBe('executed');
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each(['write', 'readback'] as const)(
    'never invokes the executor when the dispatching confirm-%s fails',
    async (failure) => {
      const storage = new MemoryStorage();
      const controller = createController(storage);
      await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));
      await controller.claimHead(QUEUE_ITEM_ID);
      await controller.allocateClaimed(QUEUE_ITEM_ID, async () => ({
        ok: true,
        run: { runId: RUN_ID, revision: 4 },
      }));
      if (failure === 'write') {
        vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
          throw new DOMException('quota exceeded', 'QuotaExceededError');
        });
      } else {
        vi.spyOn(storage, 'getItem')
          .mockImplementationOnce((key) => storage.values.get(key) ?? null)
          .mockImplementationOnce((key) => storage.values.get(key) ?? null)
          .mockImplementationOnce((key) => `${storage.values.get(key) ?? ''} `);
      }
      const execute = vi.fn(async () => undefined);

      await expect(controller.runCommittedHead(execute)).rejects.toThrow(/persist|readback/i);
      expect(execute).not.toHaveBeenCalled();
      expect(controller.read().items[0]?.execution).toEqual({
        state: 'committed',
        runId: RUN_ID,
        revision: 4,
        postInvoked: false,
      });
    }
  );

  it('rejects committed to preflight-failed so an allocated run cannot expose Restore or resend', async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));
    await controller.claimHead(QUEUE_ITEM_ID);
    await controller.allocateClaimed(QUEUE_ITEM_ID, async () => ({
      ok: true,
      run: { runId: RUN_ID, revision: 4 },
    }));

    await expect(
      controller.transition(QUEUE_ITEM_ID, { state: 'preflight_failed', code: 'BACKEND_PREFLIGHT_BLOCKED' })
    ).rejects.toThrow(/state/i);
    expect(controller.read().items[0]?.execution).toEqual({
      state: 'committed',
      runId: RUN_ID,
      revision: 4,
      postInvoked: false,
    });
  });

  it('removes only a durable preflight-failed head with confirmed final null readback', async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));
    await controller.claimHead(QUEUE_ITEM_ID);

    await expect(
      controller.allocateClaimed(QUEUE_ITEM_ID, async () => ({
        ok: false,
        code: 'FEATURE_DISABLED',
        messageKey: 'conversation.presentationRun.FEATURE_DISABLED',
        retryable: false,
        state: 'preflight',
        details: null,
      }))
    ).rejects.toThrow(/FEATURE_DISABLED/);
    expect(controller.read().items[0]?.execution).toEqual({
      state: 'preflight_failed',
      code: 'FEATURE_DISABLED',
    });

    await controller.removePreflightFailed(QUEUE_ITEM_ID);

    expect(storage.values.get(STORAGE_KEY)).toBeUndefined();
    expect(storage.operations.slice(-2)).toEqual([`remove:${STORAGE_KEY}`, `get:${STORAGE_KEY}`]);
  });

  it.each([
    {
      label: 'post-allocation committed failure',
      failure: {
        ok: false,
        code: 'BACKEND_PREFLIGHT_BLOCKED',
        messageKey: 'conversation.presentationRun.BACKEND_PREFLIGHT_BLOCKED',
        retryable: true,
        state: 'committed',
        details: { runId: RUN_ID, retryAfterMs: 1_000, postInvoked: false },
      },
    },
    {
      label: 'dispatch uncertainty',
      failure: {
        ok: false,
        code: 'DISPATCH_UNCERTAIN',
        messageKey: 'conversation.presentationRun.DISPATCH_UNCERTAIN',
        retryable: false,
        state: 'dispatch_uncertain',
        details: { runId: RUN_ID, postInvoked: true, queryRequired: true },
      },
    },
    {
      label: 'request lookup collision',
      failure: {
        ok: false,
        code: 'REQUEST_COLLISION',
        messageKey: 'conversation.presentationRun.REQUEST_COLLISION',
        retryable: false,
        state: 'lookup',
        details: { existingRunId: RUN_ID },
      },
    },
    {
      label: 'persistence ambiguity',
      failure: {
        ok: false,
        code: 'PERSISTENCE_FAILED',
        messageKey: 'conversation.presentationRun.PERSISTENCE_FAILED',
        retryable: false,
        state: 'preflight',
        details: { postInvoked: false },
      },
    },
    {
      label: 'post-allocation source tampering',
      failure: {
        ok: false,
        code: 'SOURCE_TAMPERED',
        messageKey: 'conversation.presentationRun.SOURCE_TAMPERED',
        retryable: false,
        state: 'grant_validation',
        details: { grantId: GRANT_ID },
      },
    },
    {
      label: 'post-allocation source grant expiry',
      failure: {
        ok: false,
        code: 'SOURCE_GRANT_EXPIRED',
        messageKey: 'conversation.presentationRun.SOURCE_GRANT_EXPIRED',
        retryable: false,
        state: 'grant_expired',
        details: { grantId: GRANT_ID },
      },
    },
  ])('keeps $label claimed and non-restorable for stable-ID query', async ({ failure }) => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));
    await controller.claimHead(QUEUE_ITEM_ID);

    await expect(controller.allocateClaimed(QUEUE_ITEM_ID, async () => failure as never)).rejects.toThrow(failure.code);

    expect(controller.read().items[0]?.execution).toMatchObject({ state: 'claimed' });
    await expect(controller.removePreflightFailed(QUEUE_ITEM_ID)).rejects.toThrow(/preflight/i);
  });

  it.each<QueueExecution>([
    { state: 'committed', runId: RUN_ID, revision: 4, postInvoked: false },
    { state: 'dispatching', runId: RUN_ID, revision: 5 },
    { state: 'bound', runId: RUN_ID, revision: 6 },
    { state: 'dispatch_uncertain', runId: RUN_ID, revision: null },
  ])('never removes an allocated $state item through preflight cleanup', async (execution) => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));
    await controller.claimHead(QUEUE_ITEM_ID);
    await controller.allocateClaimed(QUEUE_ITEM_ID, async () => ({
      ok: true,
      run: { runId: RUN_ID, revision: 4 },
    }));
    if (execution.state !== 'committed') await controller.transition(QUEUE_ITEM_ID, execution);

    await expect(controller.removePreflightFailed(QUEUE_ITEM_ID)).rejects.toThrow(/preflight/i);
    expect(controller.read().items).toHaveLength(1);
  });

  it('deletes only bound items and confirms null readback for the final item', async () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));

    await expect(controller.removeBound(QUEUE_ITEM_ID)).rejects.toThrow(/bound/i);
    await controller.claimHead(QUEUE_ITEM_ID);
    await controller.allocateClaimed(QUEUE_ITEM_ID, async () => ({
      ok: true,
      run: { runId: RUN_ID, revision: 4 },
    }));
    await controller.transition(QUEUE_ITEM_ID, { state: 'bound', runId: RUN_ID, revision: 6 });
    await controller.removeBound(QUEUE_ITEM_ID);

    expect(storage.values.get(STORAGE_KEY)).toBeUndefined();
    expect(storage.operations.slice(-2)).toEqual([`remove:${STORAGE_KEY}`, `get:${STORAGE_KEY}`]);
  });

  it.each(['delete', 'null-readback'] as const)(
    'rolls back the final bound cleanup when confirmed %s fails',
    async (failure) => {
      const storage = new MemoryStorage();
      const controller = createController(storage);
      await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));
      await controller.claimHead(QUEUE_ITEM_ID);
      await controller.allocateClaimed(QUEUE_ITEM_ID, async () => ({
        ok: true,
        run: { runId: RUN_ID, revision: 4 },
      }));
      await controller.transition(QUEUE_ITEM_ID, { state: 'bound', runId: RUN_ID, revision: 6 });
      if (failure === 'delete') {
        vi.spyOn(storage, 'removeItem').mockImplementationOnce(() => {
          throw new DOMException('storage unavailable', 'InvalidStateError');
        });
      } else {
        vi.spyOn(storage, 'removeItem').mockImplementationOnce(() => undefined);
      }

      await expect(controller.removeBound(QUEUE_ITEM_ID)).rejects.toThrow(/readback/i);
      expect(controller.read().items[0]?.execution).toEqual({ state: 'bound', runId: RUN_ID, revision: 6 });
    }
  );

  it.each<QueueExecution>([
    { state: 'dispatching', runId: RUN_ID, revision: 5 },
    { state: 'bound', runId: RUN_ID, revision: 6 },
    { state: 'dispatch_uncertain', runId: RUN_ID, revision: null },
  ])('keeps $state observe-only and never automatically executes or removes it', async (execution) => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    await controller.enqueue(enqueueInput({ sources: [], sourceOwner: null, expectedOwnerRevision: null }));
    await controller.claimHead(QUEUE_ITEM_ID);
    await controller.allocateClaimed(QUEUE_ITEM_ID, async () => ({
      ok: true,
      run: { runId: RUN_ID, revision: 4 },
    }));
    await controller.transition(QUEUE_ITEM_ID, execution);
    const execute = vi.fn(async () => undefined);

    await expect(controller.runCommittedHead(execute)).resolves.toBe('not_runnable');
    expect(execute).not.toHaveBeenCalled();
    await expect(controller.removeQueued(QUEUE_ITEM_ID)).rejects.toThrow(/state/i);
  });
});
