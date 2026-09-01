import type { AppOperationResult, AppOperationsContextCompactOutput } from '@/common/types/appOperations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const brokerResult: AppOperationResult<AppOperationsContextCompactOutput> = {
  ok: true,
  output: {
    snapshot: {},
    through_turn_id: 'turn-1',
  },
  operation: {
    task_id: 'context.compact',
    prompt_version: 'context.compact.v1',
    provider_id: 'operations-provider',
    model_id: 'operations-model',
    duration_ms: 25,
    queue_wait_ms: 2,
    attempts: 1,
    deduplicated: false,
  },
};

const mocks = vi.hoisted(() => ({
  runContextCompact: vi.fn(async () => brokerResult),
  contextCompactProvider: vi.fn(),
  cancelProvider: vi.fn(),
  initApplicationBridge: vi.fn(),
  initDialogBridge: vi.fn(),
  initNotificationBridge: vi.fn(),
  initProjectKnowledgeBridge: vi.fn(),
  initCreativeStudioBridge: vi.fn(),
  initSystemSettingsBridge: vi.fn(),
  initThemeBridge: vi.fn(),
  initUpdateBridge: vi.fn(),
  initWebuiBridge: vi.fn(),
  initWindowControlsBridge: vi.fn(),
  initPresentationTemplateBridge: vi.fn(),
  initDashboardBridge: vi.fn(),
}));

vi.mock('@process/services/presentation-template/bridge', () => ({
  initPresentationTemplateBridge: mocks.initPresentationTemplateBridge,
}));
vi.mock('@process/services/dashboard-store/bridge', () => ({
  initDashboardBridge: mocks.initDashboardBridge,
}));
vi.mock('@process/bridge/applicationBridge', () => ({ initApplicationBridge: mocks.initApplicationBridge }));
vi.mock('@process/bridge/native/dialogBridge', () => ({ initDialogBridge: mocks.initDialogBridge }));
vi.mock('@process/bridge/native/notificationBridge', () => ({ initNotificationBridge: mocks.initNotificationBridge }));
vi.mock('@process/bridge/projectKnowledgeBridge', () => ({
  initProjectKnowledgeBridge: mocks.initProjectKnowledgeBridge,
}));
vi.mock('@process/bridge/creativeStudioBridge', () => ({
  initCreativeStudioBridge: mocks.initCreativeStudioBridge,
}));
vi.mock('@process/bridge/native/systemSettingsBridge', () => ({
  initSystemSettingsBridge: mocks.initSystemSettingsBridge,
}));
vi.mock('@process/bridge/native/themeBridge', () => ({ initThemeBridge: mocks.initThemeBridge }));
vi.mock('@process/bridge/updateBridge', () => ({ initUpdateBridge: mocks.initUpdateBridge }));
vi.mock('@process/bridge/webuiBridge', () => ({ initWebuiBridge: mocks.initWebuiBridge }));
vi.mock('@process/bridge/native/windowControlsBridge', () => ({
  initWindowControlsBridge: mocks.initWindowControlsBridge,
  registerWindowMaximizeListeners: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    appOperations: {
      contextCompact: { provider: mocks.contextCompactProvider },
      cancel: { provider: mocks.cancelProvider },
    },
  },
}));

vi.mock('@process/services/app-operations', () => ({
  runContextCompact: mocks.runContextCompact,
}));

import { initAllBridges, initAppOperationsBridge } from '@process/bridge';

type ContextCompactHandler = (input: {
  operation_id: string;
  conversation_id: string;
  trigger: 'auto' | 'manual' | 'handoff';
}) => Promise<AppOperationResult<AppOperationsContextCompactOutput>>;

type CancelHandler = (input: { operation_id: string }) => Promise<void>;

describe('initAppOperationsBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runContextCompact.mockResolvedValue(brokerResult);
  });

  it('forwards context compaction input without model selection and returns the broker envelope', async () => {
    initAppOperationsBridge();

    expect(mocks.contextCompactProvider).toHaveBeenCalledOnce();
    const handler = mocks.contextCompactProvider.mock.calls[0]?.[0] as ContextCompactHandler;
    const input = {
      operation_id: 'operation-1',
      conversation_id: 'conversation-1',
      trigger: 'manual' as const,
    };

    await expect(handler(input)).resolves.toEqual(brokerResult);
    expect(mocks.runContextCompact).toHaveBeenCalledWith(
      {
        conversation_id: 'conversation-1',
        trigger: 'manual',
      },
      { signal: expect.any(AbortSignal) }
    );
  });

  it('aborts the controller tracked by operation id', async () => {
    let resolveOperation: ((result: AppOperationResult<AppOperationsContextCompactOutput>) => void) | undefined;
    mocks.runContextCompact.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOperation = resolve;
        })
    );
    initAppOperationsBridge();
    const contextCompact = mocks.contextCompactProvider.mock.calls[0]?.[0] as ContextCompactHandler;
    const cancel = mocks.cancelProvider.mock.calls[0]?.[0] as CancelHandler;

    const operation = contextCompact({
      operation_id: 'operation-1',
      conversation_id: 'conversation-1',
      trigger: 'auto',
    });
    const signal = mocks.runContextCompact.mock.calls[0]?.[1]?.signal;

    expect(signal?.aborted).toBe(false);
    await cancel({ operation_id: 'operation-1' });
    expect(signal?.aborted).toBe(true);

    resolveOperation?.(brokerResult);
    await operation;
  });

  it('keeps a newer duplicate-id controller cancelable after the older request completes', async () => {
    const signals: AbortSignal[] = [];
    const resolveOperations: Array<(result: AppOperationResult<AppOperationsContextCompactOutput>) => void> = [];
    mocks.runContextCompact.mockImplementation(
      (_input, options) =>
        new Promise((resolve) => {
          if (options.signal) signals.push(options.signal);
          resolveOperations.push(resolve);
        })
    );
    initAppOperationsBridge();
    const contextCompact = mocks.contextCompactProvider.mock.calls[0]?.[0] as ContextCompactHandler;
    const cancel = mocks.cancelProvider.mock.calls[0]?.[0] as CancelHandler;

    const older = contextCompact({
      operation_id: 'duplicate-operation',
      conversation_id: 'conversation-1',
      trigger: 'auto',
    });
    const newer = contextCompact({
      operation_id: 'duplicate-operation',
      conversation_id: 'conversation-2',
      trigger: 'auto',
    });

    resolveOperations[0]?.(brokerResult);
    await older;
    await cancel({ operation_id: 'duplicate-operation' });

    expect(signals[0]?.aborted).toBe(false);
    expect(signals[1]?.aborted).toBe(true);

    resolveOperations[1]?.(brokerResult);
    await newer;
  });

  it('treats cancellation for unknown and completed operation ids as idempotent', async () => {
    initAppOperationsBridge();
    const contextCompact = mocks.contextCompactProvider.mock.calls[0]?.[0] as ContextCompactHandler;
    const cancel = mocks.cancelProvider.mock.calls[0]?.[0] as CancelHandler;

    await expect(cancel({ operation_id: 'unknown-operation' })).resolves.toBeUndefined();
    await contextCompact({
      operation_id: 'completed-operation',
      conversation_id: 'conversation-1',
      trigger: 'handoff',
    });
    await expect(cancel({ operation_id: 'completed-operation' })).resolves.toBeUndefined();
  });

  it('keeps app operations registered in the top-level bridge initializer', () => {
    initAllBridges();

    expect(mocks.contextCompactProvider).toHaveBeenCalledOnce();
    expect(mocks.cancelProvider).toHaveBeenCalledOnce();
    expect(mocks.initCreativeStudioBridge).toHaveBeenCalledOnce();
  });
});
