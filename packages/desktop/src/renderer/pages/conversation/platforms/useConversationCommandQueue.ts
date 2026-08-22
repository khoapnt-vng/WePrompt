import { ipcBridge } from '@/common';
import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import {
  isPresentationConversationId,
  normalizePresentationConversationId,
} from '@/common/types/office/presentationConversationId';
import type {
  ConfirmQueuedPresentationSourcesResult,
  PresentationGrantOwner,
  PresentationRunFailureCode,
  PresentationSourceRef,
  StartPresentationRunRequest,
  StartPresentationRunResult,
} from '@/common/types/office/presentationRun';
import {
  PRESENTATION_COMMAND_QUEUE_MAX_INPUT_LENGTH,
  PRESENTATION_COMMAND_QUEUE_MAX_ITEMS,
  PRESENTATION_COMMAND_QUEUE_MAX_STATE_BYTES,
  PRESENTATION_COMMAND_QUEUE_VERSION,
  type EnqueuePresentationCommandInput,
  type PresentationCommandQueueExecution,
  type PresentationCommandQueueItem,
  type PresentationCommandQueueState,
  type PresentationCommandQueueStorage,
} from '@/common/types/platform/presentationCommandQueue';
import { uuid } from '@/common/utils';
import {
  getConversationRuntimeViewSnapshot,
  subscribeConversationRuntimeView,
} from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';
import { useAddEventListener } from '@/renderer/utils/emitter';
import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { classifyConversationBusyError } from './conversationBusyError';

export type ConversationCommandQueueItem = {
  id: string;
  input: string;
  files: string[];
  created_at: number;
  artifactScratchRunId?: string;
};

export type ConversationCommandQueueMode = 'auto' | 'manual';

export type ConversationCommandQueueState = {
  items: ConversationCommandQueueItem[];
  isPaused: boolean;
  mode: ConversationCommandQueueMode;
};

export const MAX_QUEUED_COMMANDS = 20;
export const MAX_QUEUED_COMMAND_INPUT_LENGTH = 20_000;
export const MAX_QUEUED_COMMAND_FILES = 50;
export const MAX_QUEUED_COMMAND_STATE_BYTES = 256 * 1024;

export type QueueValidationFailureReason =
  | 'emptyInput'
  | 'inputTooLong'
  | 'tooManyFiles'
  | 'queueFull'
  | 'queueTooLarge';

type QueueValidationSuccess = {
  ok: true;
  nextStateBytes: number;
};

type QueueValidationFailure = {
  ok: false;
  reason: QueueValidationFailureReason;
};

const COMMAND_QUEUE_LOG_PREFIX = '[conversation-command-queue]';

const summarizeQueuedCommand = (item: ConversationCommandQueueItem): Record<string, unknown> => ({
  id: item.id,
  created_at: item.created_at,
  inputLength: item.input.length,
  fileCount: item.files.length,
});

const logCommandQueue = (conversation_id: string, event: string, payload: Record<string, unknown> = {}): void => {
  console.info(COMMAND_QUEUE_LOG_PREFIX, {
    conversation_id,
    event,
    ...payload,
  });
  void ipcBridge.application?.writeRendererLog
    ?.invoke({
      level: 'info',
      tag: 'conversationCommandQueue',
      message: event,
      data: {
        conversation_id,
        ...payload,
      },
    })
    .catch(() => {});
};

const normalizeQueueMode = (mode: unknown): ConversationCommandQueueMode => (mode === 'manual' ? 'manual' : 'auto');

const createDefaultQueueState = (): ConversationCommandQueueState => ({
  items: [],
  isPaused: false,
  mode: 'auto',
});

const queueStore = new Map<string, ConversationCommandQueueState>();

const getStorageKey = (conversation_id: string): string => `conversation-command-queue/${conversation_id}`;
const measureQueueStateBytes = (state: ConversationCommandQueueState): number =>
  new TextEncoder().encode(JSON.stringify(state)).length;

const uniqueFiles = (files: string[]): string[] => Array.from(new Set(files.filter(Boolean)));
const isInputEmpty = (input: string): boolean => input.trim().length === 0;

const normalizeQueueItem = (item: unknown): ConversationCommandQueueItem | null => {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.input !== 'string' ||
    !Array.isArray(candidate.files) ||
    !candidate.files.every((file) => typeof file === 'string') ||
    typeof candidate.created_at !== 'number' ||
    !Number.isFinite(candidate.created_at)
  ) {
    return null;
  }

  const normalizedItem: ConversationCommandQueueItem = {
    id: candidate.id,
    input: candidate.input,
    files: uniqueFiles(candidate.files),
    created_at: candidate.created_at,
    ...(typeof candidate.artifactScratchRunId === 'string'
      ? { artifactScratchRunId: candidate.artifactScratchRunId }
      : {}),
  };

  if (
    isInputEmpty(normalizedItem.input) ||
    normalizedItem.input.length > MAX_QUEUED_COMMAND_INPUT_LENGTH ||
    normalizedItem.files.length > MAX_QUEUED_COMMAND_FILES
  ) {
    return null;
  }

  return normalizedItem;
};

export const normalizeQueueState = (state: unknown): ConversationCommandQueueState => {
  if (!state || typeof state !== 'object') {
    return createDefaultQueueState();
  }

  const candidate = state as Partial<ConversationCommandQueueState>;
  const mode = normalizeQueueMode(candidate.mode);
  const normalizedItems = Array.isArray(candidate.items)
    ? candidate.items.map(normalizeQueueItem).filter((item): item is ConversationCommandQueueItem => item !== null)
    : [];
  const items: ConversationCommandQueueItem[] = [];

  for (const item of normalizedItems.slice(0, MAX_QUEUED_COMMANDS)) {
    const nextItems = [...items, item];
    const nextState = {
      items: nextItems,
      isPaused: Boolean(candidate.isPaused),
      mode,
    };

    if (measureQueueStateBytes(nextState) > MAX_QUEUED_COMMAND_STATE_BYTES) {
      break;
    }

    items.push(item);
  }

  return {
    items,
    isPaused: items.length > 0 ? Boolean(candidate.isPaused) : false,
    mode,
  };
};

export const estimateQueueStateBytes = (state: ConversationCommandQueueState): number =>
  measureQueueStateBytes(normalizeQueueState(state));

export const createQueuedCommandItem = ({
  input,
  files,
  artifactScratchRunId,
}: Pick<ConversationCommandQueueItem, 'input' | 'files' | 'artifactScratchRunId'>): ConversationCommandQueueItem => ({
  id: uuid(),
  input,
  files: uniqueFiles(files),
  created_at: Date.now(),
  ...(artifactScratchRunId ? { artifactScratchRunId } : {}),
});

const getQueueValidationFailureReason = (state: ConversationCommandQueueState): QueueValidationFailureReason | null => {
  if (state.items.length > MAX_QUEUED_COMMANDS) {
    return 'queueFull';
  }

  if (state.items.some((item) => isInputEmpty(item.input))) {
    return 'emptyInput';
  }

  if (state.items.some((item) => item.input.length > MAX_QUEUED_COMMAND_INPUT_LENGTH)) {
    return 'inputTooLong';
  }

  if (state.items.some((item) => item.files.length > MAX_QUEUED_COMMAND_FILES)) {
    return 'tooManyFiles';
  }

  if (measureQueueStateBytes(state) > MAX_QUEUED_COMMAND_STATE_BYTES) {
    return 'queueTooLarge';
  }

  return null;
};

export const validateQueuedCommandItem = (
  item: ConversationCommandQueueItem,
  state: ConversationCommandQueueState
): QueueValidationSuccess | QueueValidationFailure => {
  const nextState = {
    ...state,
    items: [...state.items, item],
  };
  const failureReason = getQueueValidationFailureReason(nextState);
  if (failureReason) {
    return { ok: false, reason: failureReason };
  }
  const nextStateBytes = measureQueueStateBytes(nextState);
  return { ok: true, nextStateBytes };
};

const isQueueValidationFailure = (
  validation: QueueValidationSuccess | QueueValidationFailure
): validation is QueueValidationFailure => !validation.ok;

const readPersistedQueueState = (conversation_id: string): ConversationCommandQueueState => {
  if (queueStore.has(conversation_id)) {
    return queueStore.get(conversation_id) ?? createDefaultQueueState();
  }

  if (typeof window === 'undefined') {
    return createDefaultQueueState();
  }

  try {
    const stored = window.sessionStorage.getItem(getStorageKey(conversation_id));
    if (!stored) {
      return createDefaultQueueState();
    }

    const parsed = JSON.parse(stored) as unknown;
    const normalized = normalizeQueueState(parsed);
    queueStore.set(conversation_id, normalized);
    logCommandQueue(conversation_id, 'restored', {
      itemCount: normalized.items.length,
      isPaused: normalized.isPaused,
    });
    return normalized;
  } catch (error) {
    console.warn('[conversation-command-queue] Failed to read persisted queue state:', error);
    return createDefaultQueueState();
  }
};

const removePersistedQueueState = (conversation_id: string): void => {
  queueStore.delete(conversation_id);
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(getStorageKey(conversation_id));
    } catch (error) {
      console.warn('[conversation-command-queue] Failed to remove persisted queue state:', error);
    }
  }
};

const persistQueueState = (conversation_id: string, state: ConversationCommandQueueState): void => {
  const normalized = normalizeQueueState(state);

  if (normalized.items.length === 0 && !normalized.isPaused && normalized.mode === 'auto') {
    removePersistedQueueState(conversation_id);
    return;
  }

  queueStore.set(conversation_id, normalized);
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(getStorageKey(conversation_id), JSON.stringify(normalized));
    } catch (error) {
      console.warn('[conversation-command-queue] Failed to persist queue state:', error);
    }
  }
};

export const removeQueuedCommand = (
  items: ConversationCommandQueueItem[],
  commandId: string
): ConversationCommandQueueItem[] => items.filter((item) => item.id !== commandId);

export const reorderQueuedCommand = (
  items: ConversationCommandQueueItem[],
  activeCommandId: string,
  overCommandId: string
): ConversationCommandQueueItem[] => {
  const fromIndex = items.findIndex((item) => item.id === activeCommandId);
  const targetIndex = items.findIndex((item) => item.id === overCommandId);

  if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(targetIndex, 0, movedItem);
  return nextItems;
};

export const restoreQueuedCommand = (
  items: ConversationCommandQueueItem[],
  failedItem: ConversationCommandQueueItem
): ConversationCommandQueueItem[] => [failedItem, ...removeQueuedCommand(items, failedItem.id)];

export const updateQueuedCommand = (
  items: ConversationCommandQueueItem[],
  commandId: string,
  updates: Partial<Pick<ConversationCommandQueueItem, 'input' | 'files'>>
): ConversationCommandQueueItem[] =>
  items.map((item) =>
    item.id === commandId
      ? {
          ...item,
          ...updates,
          files: updates.files ? uniqueFiles(updates.files) : item.files,
        }
      : item
  );

export const shouldEnqueueConversationCommand = ({
  enabled = true,
  isBusy,
  hasPendingCommands,
}: {
  enabled?: boolean;
  isBusy: boolean;
  hasPendingCommands: boolean;
}): boolean => enabled && (isBusy || hasPendingCommands);

export type ConversationCommandQueueRuntimeGate = {
  hydrated: boolean;
  canSendMessage: boolean;
  isProcessing: boolean;
};

export type CommandQueueExecutionGate = {
  hydrated: boolean;
  canExecute: boolean;
  isProcessing: boolean;
};

export const getCommandQueueExecutionGate = ({
  isBusy,
  isHydrated = true,
  runtimeGate,
}: {
  isBusy: boolean;
  isHydrated?: boolean;
  runtimeGate?: ConversationCommandQueueRuntimeGate;
}): CommandQueueExecutionGate => {
  if (runtimeGate) {
    return {
      hydrated: runtimeGate.hydrated,
      canExecute: runtimeGate.canSendMessage && !runtimeGate.isProcessing,
      isProcessing: runtimeGate.isProcessing,
    };
  }

  return {
    hydrated: isHydrated,
    canExecute: !isBusy,
    isProcessing: isBusy,
  };
};

type UseConversationCommandQueueOptions = {
  conversation_id: string;
  enabled?: boolean;
  isBusy: boolean;
  isHydrated?: boolean;
  runtimeGate?: ConversationCommandQueueRuntimeGate;
  onExecute: (item: ConversationCommandQueueItem) => Promise<void>;
};

type EnqueueCommandInput = Pick<ConversationCommandQueueItem, 'input' | 'files' | 'artifactScratchRunId'>;
type UpdateCommandInput = Pick<ConversationCommandQueueItem, 'input'>;
type BackgroundCommandQueueRunner = {
  conversation_id: string;
  active: boolean;
  executing: boolean;
  onExecute: (item: ConversationCommandQueueItem) => Promise<void>;
};

const backgroundRunners = new Map<string, BackgroundCommandQueueRunner>();
let backgroundRuntimeViewUnsubscribe: (() => void) | null = null;

const ensureBackgroundRuntimeViewListener = (): void => {
  if (backgroundRuntimeViewUnsubscribe) {
    return;
  }

  backgroundRuntimeViewUnsubscribe = subscribeConversationRuntimeView(() => {
    for (const runner of backgroundRunners.values()) {
      if (!runner.active) {
        void drainBackgroundCommandQueue(runner);
      }
    }
  });
};

const releaseBackgroundRuntimeViewListener = (): void => {
  if (backgroundRunners.size > 0) {
    return;
  }

  backgroundRuntimeViewUnsubscribe?.();
  backgroundRuntimeViewUnsubscribe = null;
};

const registerBackgroundCommandQueueRunner = (
  runner: Omit<BackgroundCommandQueueRunner, 'active' | 'executing'>
): void => {
  const existing = backgroundRunners.get(runner.conversation_id);
  backgroundRunners.set(runner.conversation_id, {
    ...runner,
    active: true,
    executing: existing?.executing ?? false,
  });
  ensureBackgroundRuntimeViewListener();
};

const detachBackgroundCommandQueueRunner = (conversation_id: string): void => {
  const runner = backgroundRunners.get(conversation_id);
  if (!runner) {
    return;
  }

  const state = readPersistedQueueState(conversation_id);
  if (state.items.length === 0 || state.isPaused || state.mode === 'manual') {
    backgroundRunners.delete(conversation_id);
    releaseBackgroundRuntimeViewListener();
    return;
  }

  runner.active = false;
  void drainBackgroundCommandQueue(runner);
};

const drainBackgroundCommandQueue = async (runner: BackgroundCommandQueueRunner): Promise<void> => {
  if (runner.active || runner.executing) {
    return;
  }

  const runtimeView = getConversationRuntimeViewSnapshot(runner.conversation_id);
  const state = readPersistedQueueState(runner.conversation_id);
  if (state.items.length === 0) {
    backgroundRunners.delete(runner.conversation_id);
    releaseBackgroundRuntimeViewListener();
    return;
  }

  if (state.isPaused || state.mode === 'manual') {
    return;
  }

  if (!runtimeView.hydrated || !runtimeView.canSendMessage || runtimeView.isProcessing) {
    return;
  }

  const currentState = readPersistedQueueState(runner.conversation_id);
  const [nextCommand, ...remainingCommands] = currentState.items;
  if (!nextCommand) {
    backgroundRunners.delete(runner.conversation_id);
    releaseBackgroundRuntimeViewListener();
    return;
  }

  runner.executing = true;
  let shouldContinueDrain = true;
  logCommandQueue(runner.conversation_id, 'background-dequeued', {
    item: summarizeQueuedCommand(nextCommand),
    remainingItemCount: remainingCommands.length,
  });
  persistQueueState(runner.conversation_id, {
    ...currentState,
    items: remainingCommands,
    isPaused: false,
  });

  try {
    await runner.onExecute(nextCommand);
  } catch (error) {
    const failedState = readPersistedQueueState(runner.conversation_id);
    const restoredItems = restoreQueuedCommand(failedState.items, nextCommand);
    const busyError = classifyConversationBusyError(error);
    if (busyError) {
      logCommandQueue(runner.conversation_id, 'background-busy-wait', {
        item: summarizeQueuedCommand(nextCommand),
        busyKind: busyError.kind,
        status: busyError.status,
        code: busyError.code,
        remainingItemCount: restoredItems.length,
      });
      persistQueueState(runner.conversation_id, { ...failedState, items: restoredItems, isPaused: false });
      shouldContinueDrain = false;
      return;
    }
    console.error('[conversation-command-queue] Failed to execute background queued command:', error);
    logCommandQueue(runner.conversation_id, 'background-execute-failed', {
      item: summarizeQueuedCommand(nextCommand),
      error: error instanceof Error ? error.message : String(error),
    });
    persistQueueState(runner.conversation_id, { ...failedState, items: restoredItems, isPaused: true });
    Message.warning(
      i18n.t('conversation.commandQueue.pausedAfterFailure', {
        defaultValue: 'The next queued command could not start. Edit, reorder, or remove it to continue.',
      })
    );
  } finally {
    runner.executing = false;
    if (shouldContinueDrain) {
      void drainBackgroundCommandQueue(runner);
    }
  }
};

export const resetConversationCommandQueueBackgroundRunnerForTest = (): void => {
  backgroundRunners.clear();
  backgroundRuntimeViewUnsubscribe?.();
  backgroundRuntimeViewUnsubscribe = null;
};

const getQueueValidationMessage = (
  t: (key: string, options?: Record<string, unknown>) => string,
  reason: QueueValidationFailureReason
): string => {
  const warningKeyMap = {
    emptyInput: 'conversation.commandQueue.emptyInput',
    queueFull: 'conversation.commandQueue.queueFull',
    inputTooLong: 'conversation.commandQueue.inputTooLong',
    tooManyFiles: 'conversation.commandQueue.tooManyFiles',
    queueTooLarge: 'conversation.commandQueue.queueTooLarge',
  } as const;
  const defaultValueMap = {
    emptyInput: 'Queued commands cannot be empty.',
    queueFull: 'Queue is full. Remove a command before adding more.',
    inputTooLong: 'This queued command is too long. Shorten it before sending.',
    tooManyFiles: 'Too many files are attached to this queued command.',
    queueTooLarge: 'Queue data is too large to persist safely. Remove some queued commands first.',
  } as const;

  return t(warningKeyMap[reason], {
    count: MAX_QUEUED_COMMANDS,
    files: MAX_QUEUED_COMMAND_FILES,
    defaultValue: defaultValueMap[reason],
  });
};

export const useConversationCommandQueue = ({
  conversation_id,
  enabled = true,
  isBusy,
  isHydrated = true,
  runtimeGate,
  onExecute,
}: UseConversationCommandQueueOptions) => {
  const { t } = useTranslation();
  const executionGate = getCommandQueueExecutionGate({ isBusy, isHydrated, runtimeGate });
  const { data = createDefaultQueueState(), mutate } = useSWR(
    [`/conversation-command-queue/${conversation_id}`, conversation_id, enabled],
    ([, id, is_enabled]) => (is_enabled ? readPersistedQueueState(id) : createDefaultQueueState())
  );

  const stateRef = useRef(data);
  const pausedRef = useRef(data.isPaused);
  const waitingForTurnStartRef = useRef(false);
  const waitingForTurnCompletionRef = useRef(false);
  const waitingForBusyReleaseRef = useRef(false);
  const observedBusyBlockedGateRef = useRef(false);
  const interactionLockedRef = useRef(false);
  const onExecuteRef = useRef(onExecute);
  const [isInteractionLocked, setIsInteractionLocked] = useState(false);
  const [executionGateVersion, setExecutionGateVersion] = useState(0);

  useEffect(() => {
    stateRef.current = data;
  }, [data]);

  useEffect(() => {
    onExecuteRef.current = onExecute;
  }, [onExecute]);

  useEffect(() => {
    if (waitingForBusyReleaseRef.current) {
      if (!executionGate.hydrated || !executionGate.canExecute || executionGate.isProcessing) {
        observedBusyBlockedGateRef.current = true;
        return;
      }

      if (!observedBusyBlockedGateRef.current) {
        return;
      }

      waitingForBusyReleaseRef.current = false;
      observedBusyBlockedGateRef.current = false;
      waitingForTurnStartRef.current = false;
      waitingForTurnCompletionRef.current = false;
      logCommandQueue(conversation_id, 'busy-release', {
        pendingItemCount: stateRef.current.items.length,
      });
    }

    if (waitingForTurnStartRef.current && executionGate.isProcessing) {
      observedBusyBlockedGateRef.current = true;
      waitingForTurnStartRef.current = false;
      waitingForTurnCompletionRef.current = true;
      logCommandQueue(conversation_id, 'turn-started', {
        pendingItemCount: stateRef.current.items.length,
      });
      return;
    }

    if (waitingForTurnCompletionRef.current && executionGate.hydrated && executionGate.canExecute) {
      waitingForTurnCompletionRef.current = false;
      logCommandQueue(conversation_id, 'turn-finished', {
        pendingItemCount: stateRef.current.items.length,
      });
    }
  }, [conversation_id, executionGate.canExecute, executionGate.hydrated, executionGate.isProcessing]);

  useEffect(() => {
    pausedRef.current = data.isPaused;
  }, [data.isPaused]);

  useEffect(() => {
    interactionLockedRef.current = isInteractionLocked;
  }, [isInteractionLocked]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    registerBackgroundCommandQueueRunner({
      conversation_id,
      onExecute: (item) => onExecuteRef.current(item),
    });

    return () => {
      detachBackgroundCommandQueueRunner(conversation_id);
    };
  }, [conversation_id, enabled]);

  useEffect(() => {
    if (enabled) {
      return;
    }

    waitingForTurnStartRef.current = false;
    waitingForTurnCompletionRef.current = false;
    waitingForBusyReleaseRef.current = false;
    observedBusyBlockedGateRef.current = false;
    pausedRef.current = false;
    interactionLockedRef.current = false;
    stateRef.current = createDefaultQueueState();
    setIsInteractionLocked(false);
    removePersistedQueueState(conversation_id);
    void mutate(createDefaultQueueState(), { revalidate: false });
  }, [conversation_id, enabled, mutate]);

  const updateState = useCallback(
    (
      updater: (state: ConversationCommandQueueState) => ConversationCommandQueueState
    ): Promise<ConversationCommandQueueState | undefined> => {
      if (!enabled) {
        const nextState = createDefaultQueueState();
        stateRef.current = nextState;
        pausedRef.current = false;
        removePersistedQueueState(conversation_id);
        return Promise.resolve(nextState);
      }

      return mutate(
        (current) => {
          const nextState = normalizeQueueState(updater(current ?? createDefaultQueueState()));
          stateRef.current = nextState;
          pausedRef.current = nextState.isPaused;
          persistQueueState(conversation_id, nextState);
          return nextState;
        },
        { revalidate: false }
      );
    },
    [conversation_id, enabled, mutate]
  );

  const clear = useCallback(() => {
    waitingForTurnStartRef.current = false;
    waitingForTurnCompletionRef.current = false;
    waitingForBusyReleaseRef.current = false;
    observedBusyBlockedGateRef.current = false;
    pausedRef.current = false;
    logCommandQueue(conversation_id, 'cleared');
    void updateState(() => createDefaultQueueState());
  }, [conversation_id, updateState]);

  useAddEventListener(
    'conversation.deleted',
    (deletedConversationId) => {
      if (deletedConversationId !== conversation_id) {
        return;
      }
      clear();
      removePersistedQueueState(conversation_id);
    },
    [clear, conversation_id]
  );

  const enqueue = useCallback(
    ({ input, files, artifactScratchRunId }: EnqueueCommandInput) => {
      if (!enabled) {
        return null;
      }

      const currentState = normalizeQueueState(stateRef.current);
      const item = createQueuedCommandItem({ input, files, artifactScratchRunId });
      const validation = validateQueuedCommandItem(item, currentState);

      if (isQueueValidationFailure(validation)) {
        const reason: QueueValidationFailureReason = validation.reason;
        logCommandQueue(conversation_id, 'enqueue-rejected', {
          reason,
          item: summarizeQueuedCommand(item),
          currentItemCount: currentState.items.length,
        });
        Message.warning(getQueueValidationMessage(t, reason));
        return null;
      }

      const nextState: ConversationCommandQueueState = {
        ...currentState,
        items: [...currentState.items, item],
      };
      stateRef.current = nextState;
      logCommandQueue(conversation_id, 'enqueued', {
        item: summarizeQueuedCommand(item),
        currentItemCount: currentState.items.length,
      });
      void updateState(() => nextState);
      return item;
    },
    [conversation_id, enabled, t, updateState]
  );

  const update = useCallback(
    (commandId: string, { input }: UpdateCommandInput) => {
      if (!enabled) {
        return false;
      }

      const currentState = normalizeQueueState(stateRef.current);
      const currentItem = currentState.items.find((item) => item.id === commandId);
      if (!currentItem) {
        return false;
      }

      const nextItems = updateQueuedCommand(currentState.items, commandId, { input });
      const nextState: ConversationCommandQueueState = {
        ...currentState,
        isPaused: false,
        items: nextItems,
      };
      const failureReason = getQueueValidationFailureReason(nextState);

      if (failureReason) {
        logCommandQueue(conversation_id, 'update-rejected', {
          reason: failureReason,
          commandId,
          inputLength: input.length,
        });
        Message.warning(getQueueValidationMessage(t, failureReason));
        return false;
      }

      stateRef.current = nextState;
      logCommandQueue(conversation_id, 'updated', {
        commandId,
        inputLength: input.length,
      });
      void updateState(() => nextState);
      return true;
    },
    [conversation_id, enabled, t, updateState]
  );

  const remove = useCallback(
    (commandId: string) => {
      if (!enabled) {
        return;
      }

      logCommandQueue(conversation_id, 'removed', {
        commandId,
      });
      void updateState((state) => {
        const nextItems = removeQueuedCommand(state.items, commandId);
        return {
          ...state,
          items: nextItems,
          isPaused: false,
        };
      });
    },
    [conversation_id, enabled, updateState]
  );

  const prioritize = useCallback(
    (commandId: string) => {
      if (!enabled) {
        return;
      }
      logCommandQueue(conversation_id, 'prioritized', { commandId });
      void updateState((state) => {
        const target = state.items.find((item) => item.id === commandId);
        if (!target) return state;
        return {
          ...state,
          items: [target, ...removeQueuedCommand(state.items, commandId)],
          isPaused: false,
          mode: 'auto',
        };
      });
    },
    [conversation_id, enabled, updateState]
  );

  const sendNow = useCallback(
    (commandId: string) => {
      if (!enabled) {
        return;
      }

      const currentState = normalizeQueueState(stateRef.current);
      const target = currentState.items.find((item) => item.id === commandId);
      if (!target) {
        return;
      }

      // Remove only the targeted command; the rest keep their mode, order and paused flag.
      const nextItems = removeQueuedCommand(currentState.items, commandId);
      waitingForTurnStartRef.current = true;
      waitingForTurnCompletionRef.current = false;
      observedBusyBlockedGateRef.current = false;
      pausedRef.current = false;
      logCommandQueue(conversation_id, 'send-now', {
        item: summarizeQueuedCommand(target),
        remainingItemCount: nextItems.length,
      });
      void updateState((state) => ({
        ...state,
        items: removeQueuedCommand(state.items, commandId),
        isPaused: false,
      }));

      void onExecuteRef.current(target).catch((error) => {
        const busyError = classifyConversationBusyError(error);
        if (busyError) {
          waitingForBusyReleaseRef.current = true;
          waitingForTurnStartRef.current = false;
          waitingForTurnCompletionRef.current = true;
          pausedRef.current = false;
          logCommandQueue(conversation_id, 'send-now-busy-wait', {
            item: summarizeQueuedCommand(target),
            busyKind: busyError.kind,
            status: busyError.status,
            code: busyError.code,
            remainingItemCount: nextItems.length + 1,
          });
          void updateState((state) => ({
            ...state,
            items: restoreQueuedCommand(state.items, target),
            isPaused: false,
          }));
          return;
        }
        console.error('[conversation-command-queue] Failed to send queued command now:', error);
        logCommandQueue(conversation_id, 'send-now-failed', {
          item: summarizeQueuedCommand(target),
          error: error instanceof Error ? error.message : String(error),
        });
        waitingForTurnStartRef.current = false;
        waitingForTurnCompletionRef.current = false;
        pausedRef.current = true;
        void updateState((state) => ({
          ...state,
          items: restoreQueuedCommand(state.items, target),
          isPaused: true,
        }));
        Message.warning(
          t('conversation.commandQueue.pausedAfterFailure', {
            defaultValue: 'The next queued command could not start. Edit, reorder, or remove it to continue.',
          })
        );
      });
    },
    [conversation_id, enabled, t, updateState]
  );

  const reorder = useCallback(
    (activeCommandId: string, overCommandId: string) => {
      if (!enabled) {
        return;
      }

      logCommandQueue(conversation_id, 'reordered', {
        activeCommandId,
        overCommandId,
      });
      void updateState((state) => ({
        ...state,
        isPaused: false,
        items: reorderQueuedCommand(state.items, activeCommandId, overCommandId),
      }));
    },
    [conversation_id, enabled, updateState]
  );

  const pause = useCallback(() => {
    if (!enabled) {
      return;
    }

    pausedRef.current = true;
    waitingForTurnStartRef.current = false;
    waitingForTurnCompletionRef.current = false;
    waitingForBusyReleaseRef.current = false;
    observedBusyBlockedGateRef.current = false;
    logCommandQueue(conversation_id, 'paused', {
      itemCount: data.items.length,
    });
    void updateState((state) => {
      if (state.items.length === 0) {
        pausedRef.current = false;
        return createDefaultQueueState();
      }
      return {
        ...state,
        isPaused: true,
      };
    });
  }, [conversation_id, data.items.length, enabled, updateState]);

  const resume = useCallback(() => {
    if (!enabled) {
      return;
    }

    pausedRef.current = false;
    logCommandQueue(conversation_id, 'resumed', {
      itemCount: data.items.length,
    });
    void updateState((state) => ({
      ...state,
      isPaused: state.items.length > 0 ? false : state.isPaused,
    }));
  }, [conversation_id, data.items.length, enabled, updateState]);

  const toggleMode = useCallback(() => {
    if (!enabled) {
      return;
    }

    void updateState((state) => {
      const nextMode: ConversationCommandQueueMode = state.mode === 'auto' ? 'manual' : 'auto';
      logCommandQueue(conversation_id, 'mode-changed', { mode: nextMode });
      return {
        ...state,
        mode: nextMode,
      };
    });
  }, [conversation_id, enabled, updateState]);

  const lockInteraction = useCallback(() => {
    if (!enabled) {
      return;
    }

    interactionLockedRef.current = true;
    logCommandQueue(conversation_id, 'interaction-locked', {
      itemCount: stateRef.current.items.length,
    });
    setIsInteractionLocked(true);
  }, [conversation_id, enabled]);

  const unlockInteraction = useCallback(() => {
    if (!enabled) {
      return;
    }

    interactionLockedRef.current = false;
    logCommandQueue(conversation_id, 'interaction-unlocked', {
      itemCount: stateRef.current.items.length,
    });
    setIsInteractionLocked(false);
  }, [conversation_id, enabled]);

  const resetActiveExecution = useCallback(
    (reason: 'stop' | 'external-reset') => {
      const hadPendingTurn =
        waitingForTurnStartRef.current || waitingForTurnCompletionRef.current || waitingForBusyReleaseRef.current;
      waitingForTurnStartRef.current = false;
      waitingForTurnCompletionRef.current = false;
      waitingForBusyReleaseRef.current = false;
      observedBusyBlockedGateRef.current = false;

      if (!hadPendingTurn) {
        return;
      }

      logCommandQueue(conversation_id, 'execution-reset', {
        reason,
        pendingItemCount: stateRef.current.items.length,
      });
      setExecutionGateVersion((version) => version + 1);
    },
    [conversation_id]
  );

  useEffect(() => {
    if (
      !enabled ||
      data.mode === 'manual' ||
      !executionGate.hydrated ||
      pausedRef.current ||
      !executionGate.canExecute ||
      waitingForTurnStartRef.current ||
      waitingForTurnCompletionRef.current ||
      waitingForBusyReleaseRef.current ||
      interactionLockedRef.current ||
      data.items.length === 0
    ) {
      return;
    }

    const [nextCommand, ...remainingCommands] = data.items;
    waitingForTurnStartRef.current = true;
    observedBusyBlockedGateRef.current = false;
    logCommandQueue(conversation_id, 'dequeued', {
      item: summarizeQueuedCommand(nextCommand),
      remainingItemCount: remainingCommands.length,
    });

    // Await the state update so the item leaves the UI only once the send is
    // confirmed, preventing it from disappearing before the backend accepts it.
    void updateState((state) => ({
      ...state,
      items: remainingCommands,
      isPaused: false,
    })).then(() =>
      onExecuteRef.current(nextCommand).catch((error) => {
        const busyError = classifyConversationBusyError(error);
        if (busyError) {
          waitingForBusyReleaseRef.current = true;
          waitingForTurnStartRef.current = false;
          waitingForTurnCompletionRef.current = true;
          pausedRef.current = false;
          logCommandQueue(conversation_id, 'busy-wait', {
            item: summarizeQueuedCommand(nextCommand),
            busyKind: busyError.kind,
            status: busyError.status,
            code: busyError.code,
            remainingItemCount: remainingCommands.length + 1,
          });
          void updateState((state) => ({
            ...state,
            items: restoreQueuedCommand(state.items, nextCommand),
            isPaused: false,
          }));
          return;
        }
        console.error('[conversation-command-queue] Failed to execute queued command:', error);
        logCommandQueue(conversation_id, 'execute-failed', {
          item: summarizeQueuedCommand(nextCommand),
          error: error instanceof Error ? error.message : String(error),
        });
        waitingForTurnStartRef.current = false;
        waitingForTurnCompletionRef.current = false;
        pausedRef.current = true;
        void updateState((state) => ({
          ...state,
          items: restoreQueuedCommand(state.items, nextCommand),
          isPaused: true,
        }));
        Message.warning(
          t('conversation.commandQueue.pausedAfterFailure', {
            defaultValue: 'The next queued command could not start. Edit, reorder, or remove it to continue.',
          })
        );
      })
    );
  }, [
    conversation_id,
    data.items,
    data.mode,
    enabled,
    executionGateVersion,
    executionGate.canExecute,
    executionGate.hydrated,
    executionGate.isProcessing,
    isInteractionLocked,
    t,
    updateState,
  ]);

  return {
    items: enabled ? data.items : [],
    isPaused: enabled ? data.isPaused : false,
    mode: enabled ? data.mode : 'auto',
    isInteractionLocked,
    hasPendingCommands: enabled ? data.items.length > 0 : false,
    enqueue,
    update,
    remove,
    prioritize,
    sendNow,
    clear,
    reorder,
    pause,
    resume,
    toggleMode,
    lockInteraction,
    unlockInteraction,
    resetActiveExecution,
  };
};

const PRESENTATION_QUEUE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRESENTATION_QUEUE_SHA256_RE = /^[0-9a-f]{64}$/;
const PRESENTATION_QUEUE_TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const PRESENTATION_QUEUE_FAILURE_CODES: ReadonlySet<string> = new Set<PresentationRunFailureCode>([
  'FEATURE_DISABLED',
  'DESKTOP_REQUIRED',
  'INVALID_REQUEST',
  'REQUEST_COLLISION',
  'RUN_NOT_FOUND',
  'RUN_FORBIDDEN',
  'RUN_STATE_CONFLICT',
  'DRAFT_NOT_FOUND',
  'DRAFT_EXPIRED',
  'DRAFT_FOREIGN',
  'DRAFT_ALREADY_BOUND',
  'DRAFT_LIMIT_EXCEEDED',
  'GRANT_LIMIT_EXCEEDED',
  'NATIVE_FILE_REQUIRED',
  'DIALOG_UNAVAILABLE',
  'LEASE_CONFLICT',
  'LEASE_EXPIRED',
  'LEASE_FOREIGN',
  'SCOPE_UNAVAILABLE',
  'TEAM_SCOPE_UNSUPPORTED',
  'RUNTIME_UNSUPPORTED',
  'SOURCE_GRANT_INVALID',
  'SOURCE_GRANT_EXPIRED',
  'SOURCE_GRANT_FOREIGN',
  'SOURCE_GRANT_REPLAYED',
  'SOURCE_TAMPERED',
  'SOURCE_LIMIT_EXCEEDED',
  'SOURCE_FORMAT_UNSUPPORTED',
  'TEMPLATE_NOT_FOUND',
  'TEMPLATE_UNSUPPORTED',
  'RESOURCE_LIMIT_EXCEEDED',
  'RATE_LIMITED',
  'DISK_RESERVE_EXCEEDED',
  'PERSISTENCE_FAILED',
  'BACKEND_PREFLIGHT_BLOCKED',
  'DISPATCH_UNCERTAIN',
  'TRACKING_REQUIRED',
  'CANDIDATE_UNAVAILABLE',
  'HASH_MISMATCH',
  'UNSAFE_TO_OPEN',
  'UNSAFE_TO_DISCARD',
  'INTERNAL_ERROR',
]);

type ConfirmQueuedSources = (
  request: Parameters<typeof ipcBridge.presentationSources.confirmQueued.invoke>[0]
) => Promise<ConfirmQueuedPresentationSourcesResult>;

type PresentationCommandQueueRecord = {
  storage: PresentationCommandQueueStorage;
  confirmQueuedSources: ConfirmQueuedSources;
  now: () => Date;
  tail: Promise<void>;
  allocating: boolean;
  draining: boolean;
  state: PresentationCommandQueueState | null;
};

export type PresentationCommandQueueControllerOptions = {
  conversationId: string;
  storage?: PresentationCommandQueueStorage;
  confirmQueuedSources?: ConfirmQueuedSources;
  now?: () => Date;
};

export type PresentationCommandQueueController = {
  read: () => PresentationCommandQueueState;
  enqueue: (input: EnqueuePresentationCommandInput) => Promise<PresentationCommandQueueItem>;
  recoverPersisting: () => Promise<void>;
  retirePersisting: (queueItemId: string) => Promise<'confirmed' | 'removed'>;
  removePersistingAfterConfirmedGrantRevocation: (queueItemId: string, grantId: string) => Promise<void>;
  editQueued: (queueItemId: string, updates: { input: string }) => Promise<PresentationCommandQueueItem>;
  removeQueued: (queueItemId: string) => Promise<void>;
  claimHead: (queueItemId: string) => Promise<PresentationCommandQueueItem>;
  allocateClaimed: (
    queueItemId: string,
    start: (request: StartPresentationRunRequest) => Promise<StartPresentationRunResult>
  ) => Promise<PresentationCommandQueueItem>;
  transition: (
    queueItemId: string,
    execution: PresentationCommandQueueExecution
  ) => Promise<PresentationCommandQueueItem>;
  removePreflightFailed: (queueItemId: string) => Promise<void>;
  removeBound: (queueItemId: string) => Promise<void>;
  runCommittedHead: (
    execute: (item: PresentationCommandQueueItem) => Promise<void>
  ) => Promise<'executed' | 'busy' | 'not_runnable'>;
};

export class PresentationCommandQueueError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_STATE'
      | 'PERSISTENCE_FAILED'
      | 'READBACK_MISMATCH'
      | 'STATE_CONFLICT'
      | 'HEAD_CONFLICT'
      | 'CONFIRMATION_FAILED'
  ) {
    super(message);
    this.name = 'PresentationCommandQueueError';
  }
}

const presentationCommandQueueRecords = new Map<string, PresentationCommandQueueRecord>();

export const getPresentationCommandQueueStorageKey = (conversationId: string): string => {
  const canonicalConversationId = normalizePresentationConversationId(conversationId);
  if (canonicalConversationId === null) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue conversation id', 'INVALID_STATE');
  }
  return `presentation-command-queue/v2/${canonicalConversationId}`;
};

const createEmptyPresentationQueueState = (conversationId: string): PresentationCommandQueueState => ({
  version: PRESENTATION_COMMAND_QUEUE_VERSION,
  conversationId,
  revision: 0,
  items: [],
});

const isPresentationQueueRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasPresentationQueueKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
};

const isPresentationQueueRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isPresentationQueueTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const decodePresentationQueueOwner = (value: unknown): PresentationGrantOwner | null => {
  if (value === null) return null;
  if (!isPresentationQueueRecord(value)) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue owner', 'INVALID_STATE');
  }
  if (
    value.owner_type === 'draft' &&
    hasPresentationQueueKeys(value, ['owner_type', 'draft_id']) &&
    typeof value.draft_id === 'string' &&
    PRESENTATION_QUEUE_UUID_RE.test(value.draft_id)
  ) {
    return { owner_type: 'draft', draft_id: value.draft_id };
  }
  if (
    value.owner_type === 'conversation' &&
    hasPresentationQueueKeys(value, ['owner_type', 'conversation_id']) &&
    isPresentationConversationId(value.conversation_id)
  ) {
    return { owner_type: 'conversation', conversation_id: value.conversation_id };
  }
  throw new PresentationCommandQueueError('Invalid managed presentation queue owner', 'INVALID_STATE');
};

const decodePresentationQueueSource = (value: unknown): PresentationSourceRef => {
  if (
    !isPresentationQueueRecord(value) ||
    !hasPresentationQueueKeys(value, ['grantId', 'expectedByteLength', 'expectedSha256']) ||
    typeof value.grantId !== 'string' ||
    !PRESENTATION_QUEUE_UUID_RE.test(value.grantId) ||
    !Number.isSafeInteger(value.expectedByteLength) ||
    (value.expectedByteLength as number) < 1 ||
    (value.expectedByteLength as number) > PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES ||
    typeof value.expectedSha256 !== 'string' ||
    !PRESENTATION_QUEUE_SHA256_RE.test(value.expectedSha256)
  ) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue source ref', 'INVALID_STATE');
  }
  return {
    grantId: value.grantId,
    expectedByteLength: value.expectedByteLength as number,
    expectedSha256: value.expectedSha256,
  };
};

const decodePresentationQueueSources = (value: unknown): PresentationSourceRef[] => {
  if (!Array.isArray(value) || value.length > PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue source refs', 'INVALID_STATE');
  }
  const sources = value.map(decodePresentationQueueSource);
  if (
    new Set(sources.map(({ grantId }) => grantId.toLowerCase())).size !== sources.length ||
    sources.reduce((total, source) => total + source.expectedByteLength, 0) >
      PRESENTATION_RUN_LIMITS.MAX_TOTAL_SOURCE_BYTES
  ) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue source refs', 'INVALID_STATE');
  }
  return sources;
};

const decodePresentationQueueExecution = (value: unknown): PresentationCommandQueueExecution => {
  if (!isPresentationQueueRecord(value) || typeof value.state !== 'string') {
    throw new PresentationCommandQueueError('Invalid managed presentation queue execution state', 'INVALID_STATE');
  }
  if ((value.state === 'persisting' || value.state === 'queued') && hasPresentationQueueKeys(value, ['state'])) {
    return { state: value.state };
  }
  if (
    value.state === 'claimed' &&
    hasPresentationQueueKeys(value, ['state', 'claimedAt']) &&
    isPresentationQueueTimestamp(value.claimedAt)
  ) {
    return { state: 'claimed', claimedAt: value.claimedAt };
  }
  if (
    value.state === 'committed' &&
    hasPresentationQueueKeys(value, ['state', 'runId', 'revision', 'postInvoked']) &&
    typeof value.runId === 'string' &&
    PRESENTATION_QUEUE_UUID_RE.test(value.runId) &&
    isPresentationQueueRevision(value.revision) &&
    value.postInvoked === false
  ) {
    return { state: 'committed', runId: value.runId, revision: value.revision, postInvoked: false };
  }
  if (
    (value.state === 'dispatching' || value.state === 'bound') &&
    hasPresentationQueueKeys(value, ['state', 'runId', 'revision']) &&
    typeof value.runId === 'string' &&
    PRESENTATION_QUEUE_UUID_RE.test(value.runId) &&
    isPresentationQueueRevision(value.revision)
  ) {
    return { state: value.state, runId: value.runId, revision: value.revision };
  }
  if (
    value.state === 'preflight_failed' &&
    hasPresentationQueueKeys(value, ['state', 'code']) &&
    typeof value.code === 'string' &&
    PRESENTATION_QUEUE_FAILURE_CODES.has(value.code)
  ) {
    return { state: 'preflight_failed', code: value.code as PresentationRunFailureCode };
  }
  if (
    value.state === 'dispatch_uncertain' &&
    hasPresentationQueueKeys(value, ['state', 'runId', 'revision']) &&
    typeof value.runId === 'string' &&
    PRESENTATION_QUEUE_UUID_RE.test(value.runId)
  ) {
    const revision = value.revision;
    if (revision === null) {
      return { state: 'dispatch_uncertain', runId: value.runId, revision: null };
    }
    if (isPresentationQueueRevision(revision)) {
      return { state: 'dispatch_uncertain', runId: value.runId, revision };
    }
  }
  throw new PresentationCommandQueueError('Invalid managed presentation queue execution state', 'INVALID_STATE');
};

const decodePresentationQueueItem = (value: unknown): PresentationCommandQueueItem => {
  if (
    !isPresentationQueueRecord(value) ||
    !hasPresentationQueueKeys(value, [
      'queueItemId',
      'clientRequestId',
      'input',
      'selectedTemplateId',
      'sources',
      'sourceOwner',
      'expectedOwnerRevision',
      'confirmedOwnerRevision',
      'createdAt',
      'updatedAt',
      'execution',
    ]) ||
    typeof value.queueItemId !== 'string' ||
    !PRESENTATION_QUEUE_UUID_RE.test(value.queueItemId) ||
    typeof value.clientRequestId !== 'string' ||
    !PRESENTATION_QUEUE_UUID_RE.test(value.clientRequestId) ||
    typeof value.input !== 'string' ||
    value.input.trim().length === 0 ||
    value.input.length > PRESENTATION_COMMAND_QUEUE_MAX_INPUT_LENGTH ||
    typeof value.selectedTemplateId !== 'string' ||
    !PRESENTATION_QUEUE_TEMPLATE_ID_RE.test(value.selectedTemplateId) ||
    !isPresentationQueueTimestamp(value.createdAt) ||
    !isPresentationQueueTimestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt)
  ) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue item', 'INVALID_STATE');
  }
  const sources = decodePresentationQueueSources(value.sources);
  const sourceOwner = decodePresentationQueueOwner(value.sourceOwner);
  const expectedOwnerRevision =
    value.expectedOwnerRevision === null
      ? null
      : isPresentationQueueRevision(value.expectedOwnerRevision)
        ? value.expectedOwnerRevision
        : undefined;
  const confirmedOwnerRevision =
    value.confirmedOwnerRevision === null
      ? null
      : isPresentationQueueRevision(value.confirmedOwnerRevision)
        ? value.confirmedOwnerRevision
        : undefined;
  const execution = decodePresentationQueueExecution(value.execution);
  if (
    expectedOwnerRevision === undefined ||
    confirmedOwnerRevision === undefined ||
    (sources.length === 0 &&
      (sourceOwner !== null || expectedOwnerRevision !== null || confirmedOwnerRevision !== null)) ||
    (sources.length > 0 && (sourceOwner === null || expectedOwnerRevision === null)) ||
    (sources.length > 0 && execution.state === 'persisting' && confirmedOwnerRevision !== null) ||
    (sources.length > 0 && execution.state !== 'persisting' && confirmedOwnerRevision === null)
  ) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue source confirmation', 'INVALID_STATE');
  }
  return {
    queueItemId: value.queueItemId,
    clientRequestId: value.clientRequestId,
    input: value.input,
    selectedTemplateId: value.selectedTemplateId,
    sources,
    sourceOwner,
    expectedOwnerRevision,
    confirmedOwnerRevision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    execution,
  };
};

export const decodePresentationCommandQueueState = (
  value: unknown,
  expectedConversationId?: string
): PresentationCommandQueueState => {
  if (
    !isPresentationQueueRecord(value) ||
    !hasPresentationQueueKeys(value, ['version', 'conversationId', 'revision', 'items']) ||
    value.version !== PRESENTATION_COMMAND_QUEUE_VERSION ||
    !isPresentationConversationId(value.conversationId) ||
    (expectedConversationId !== undefined && value.conversationId !== expectedConversationId) ||
    !isPresentationQueueRevision(value.revision) ||
    !Array.isArray(value.items) ||
    value.items.length > PRESENTATION_COMMAND_QUEUE_MAX_ITEMS
  ) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue state', 'INVALID_STATE');
  }
  const items = value.items.map(decodePresentationQueueItem);
  if (
    new Set(items.map(({ queueItemId }) => queueItemId.toLowerCase())).size !== items.length ||
    new Set(items.map(({ clientRequestId }) => clientRequestId.toLowerCase())).size !== items.length
  ) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue identifiers', 'INVALID_STATE');
  }
  if (
    items.some(
      ({ sourceOwner }) =>
        sourceOwner?.owner_type === 'conversation' && sourceOwner.conversation_id !== value.conversationId
    )
  ) {
    throw new PresentationCommandQueueError(
      'Invalid managed presentation queue source owner conversation',
      'INVALID_STATE'
    );
  }
  return {
    version: PRESENTATION_COMMAND_QUEUE_VERSION,
    conversationId: value.conversationId,
    revision: value.revision,
    items,
  };
};

const presentationQueueBytes = (value: string): number => new TextEncoder().encode(value).length;

const decodeLegacyPresentationQueueState = (
  raw: string,
  legacyConversationId: string,
  canonicalConversationId: string
): PresentationCommandQueueState => {
  if (presentationQueueBytes(raw) > PRESENTATION_COMMAND_QUEUE_MAX_STATE_BYTES) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue state size', 'INVALID_STATE');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new PresentationCommandQueueError('Invalid managed presentation queue JSON', 'INVALID_STATE');
  }
  if (
    !isPresentationQueueRecord(parsed) ||
    parsed.conversationId !== legacyConversationId ||
    !Array.isArray(parsed.items) ||
    JSON.stringify(parsed) !== raw
  ) {
    throw new PresentationCommandQueueError('Invalid legacy managed presentation queue state', 'INVALID_STATE');
  }
  const items = parsed.items.map((item) => {
    if (!isPresentationQueueRecord(item) || !isPresentationQueueRecord(item.sourceOwner)) return item;
    if (item.sourceOwner.owner_type !== 'conversation' || item.sourceOwner.conversation_id !== legacyConversationId) {
      return item;
    }
    return {
      ...item,
      sourceOwner: { ...item.sourceOwner, conversation_id: canonicalConversationId },
    };
  });
  return decodePresentationCommandQueueState(
    { ...parsed, conversationId: canonicalConversationId, items },
    canonicalConversationId
  );
};

const migrateLegacyPresentationQueueKey = (
  storage: PresentationCommandQueueStorage,
  legacyConversationId: string,
  canonicalConversationId: string
): void => {
  if (legacyConversationId === canonicalConversationId || !PRESENTATION_QUEUE_UUID_RE.test(legacyConversationId)) {
    return;
  }
  const legacyKey = `presentation-command-queue/v2/${legacyConversationId}`;
  const canonicalKey = getPresentationCommandQueueStorageKey(canonicalConversationId);
  let legacyRaw: string | null;
  let canonicalRaw: string | null;
  try {
    legacyRaw = storage.getItem(legacyKey);
    if (legacyRaw === null) return;
    canonicalRaw = storage.getItem(canonicalKey);
  } catch (error) {
    throw new PresentationCommandQueueError(
      `Managed presentation queue migration read failed: ${error instanceof Error ? error.message : String(error)}`,
      'PERSISTENCE_FAILED'
    );
  }
  const migratedRaw = JSON.stringify(
    decodeLegacyPresentationQueueState(legacyRaw, legacyConversationId, canonicalConversationId)
  );
  if (canonicalRaw !== null && canonicalRaw !== migratedRaw) {
    throw new PresentationCommandQueueError('Managed presentation queue migration conflict', 'STATE_CONFLICT');
  }
  if (canonicalRaw === null) {
    try {
      storage.setItem(canonicalKey, migratedRaw);
      if (storage.getItem(canonicalKey) !== migratedRaw) {
        throw new PresentationCommandQueueError(
          'Managed presentation queue migration readback mismatch',
          'READBACK_MISMATCH'
        );
      }
    } catch (error) {
      if (error instanceof PresentationCommandQueueError) throw error;
      throw new PresentationCommandQueueError(
        `Managed presentation queue migration write failed: ${error instanceof Error ? error.message : String(error)}`,
        'PERSISTENCE_FAILED'
      );
    }
  }
  try {
    if (storage.getItem(canonicalKey) !== migratedRaw) {
      throw new PresentationCommandQueueError(
        'Managed presentation queue migration readback mismatch',
        'READBACK_MISMATCH'
      );
    }
    storage.removeItem(legacyKey);
    if (storage.getItem(legacyKey) !== null) {
      throw new PresentationCommandQueueError(
        'Managed presentation queue migration delete readback mismatch',
        'READBACK_MISMATCH'
      );
    }
  } catch (error) {
    if (error instanceof PresentationCommandQueueError) throw error;
    throw new PresentationCommandQueueError(
      `Managed presentation queue migration delete failed: ${error instanceof Error ? error.message : String(error)}`,
      'PERSISTENCE_FAILED'
    );
  }
};

const migrateLegacyPresentationQueueState = (
  storage: PresentationCommandQueueStorage,
  inputConversationId: string,
  canonicalConversationId: string
): void => {
  const legacyConversationIds = new Set<string>();
  if (PRESENTATION_QUEUE_UUID_RE.test(inputConversationId) && inputConversationId !== canonicalConversationId) {
    legacyConversationIds.add(inputConversationId);
  }
  if (PRESENTATION_QUEUE_UUID_RE.test(canonicalConversationId)) {
    const uppercaseConversationId = canonicalConversationId.toUpperCase();
    if (uppercaseConversationId !== canonicalConversationId) {
      legacyConversationIds.add(uppercaseConversationId);
    }
  }
  for (const legacyConversationId of legacyConversationIds) {
    migrateLegacyPresentationQueueKey(storage, legacyConversationId, canonicalConversationId);
  }
};

const readPresentationQueueState = (
  record: PresentationCommandQueueRecord,
  conversationId: string
): { state: PresentationCommandQueueState; raw: string | null } => {
  const key = getPresentationCommandQueueStorageKey(conversationId);
  let raw: string | null;
  try {
    raw = record.storage.getItem(key);
  } catch (error) {
    throw new PresentationCommandQueueError(
      `Managed presentation queue persistence read failed: ${error instanceof Error ? error.message : String(error)}`,
      'PERSISTENCE_FAILED'
    );
  }
  if (raw === null) return { state: createEmptyPresentationQueueState(conversationId), raw };
  if (presentationQueueBytes(raw) > PRESENTATION_COMMAND_QUEUE_MAX_STATE_BYTES) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue state size', 'INVALID_STATE');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new PresentationCommandQueueError('Invalid managed presentation queue JSON', 'INVALID_STATE');
  }
  const state = decodePresentationCommandQueueState(parsed, conversationId);
  if (JSON.stringify(state) !== raw) {
    throw new PresentationCommandQueueError('Invalid non-canonical managed presentation queue state', 'INVALID_STATE');
  }
  record.state = structuredClone(state);
  return { state, raw };
};

const restorePresentationQueueStorage = (
  record: PresentationCommandQueueRecord,
  key: string,
  previousRaw: string | null
): void => {
  try {
    if (previousRaw === null) {
      record.storage.removeItem(key);
      record.storage.getItem(key);
      return;
    }
    record.storage.setItem(key, previousRaw);
    record.storage.getItem(key);
  } catch {
    // The original mutation error remains authoritative. A later strict read
    // will fail closed if the best-effort rollback could not restore storage.
  }
};

const persistPresentationQueueState = (
  record: PresentationCommandQueueRecord,
  previousRaw: string | null,
  nextState: PresentationCommandQueueState
): PresentationCommandQueueState => {
  const validatedNextState = decodePresentationCommandQueueState(nextState, nextState.conversationId);
  const key = getPresentationCommandQueueStorageKey(validatedNextState.conversationId);
  const nextRaw = JSON.stringify(validatedNextState);
  if (presentationQueueBytes(nextRaw) > PRESENTATION_COMMAND_QUEUE_MAX_STATE_BYTES) {
    throw new PresentationCommandQueueError(
      'Managed presentation queue state is too large to persist',
      'INVALID_STATE'
    );
  }
  try {
    record.storage.setItem(key, nextRaw);
  } catch (error) {
    restorePresentationQueueStorage(record, key, previousRaw);
    throw new PresentationCommandQueueError(
      `Managed presentation queue persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      'PERSISTENCE_FAILED'
    );
  }
  let readback: string | null;
  try {
    readback = record.storage.getItem(key);
  } catch (error) {
    restorePresentationQueueStorage(record, key, previousRaw);
    throw new PresentationCommandQueueError(
      `Managed presentation queue readback failed: ${error instanceof Error ? error.message : String(error)}`,
      'READBACK_MISMATCH'
    );
  }
  if (readback !== nextRaw) {
    restorePresentationQueueStorage(record, key, previousRaw);
    throw new PresentationCommandQueueError('Managed presentation queue readback mismatch', 'READBACK_MISMATCH');
  }
  let confirmed: PresentationCommandQueueState;
  try {
    confirmed = decodePresentationCommandQueueState(JSON.parse(readback) as unknown, validatedNextState.conversationId);
    if (confirmed.revision !== validatedNextState.revision || JSON.stringify(confirmed) !== nextRaw) {
      throw new PresentationCommandQueueError('Managed presentation queue readback mismatch', 'READBACK_MISMATCH');
    }
  } catch (error) {
    restorePresentationQueueStorage(record, key, previousRaw);
    if (error instanceof PresentationCommandQueueError && error.code === 'READBACK_MISMATCH') throw error;
    throw new PresentationCommandQueueError(
      `Managed presentation queue readback validation failed: ${error instanceof Error ? error.message : String(error)}`,
      'READBACK_MISMATCH'
    );
  }
  record.state = structuredClone(confirmed);
  return confirmed;
};

const removePresentationQueueState = (
  record: PresentationCommandQueueRecord,
  conversationId: string,
  previousRaw: string
): void => {
  const key = getPresentationCommandQueueStorageKey(conversationId);
  try {
    record.storage.removeItem(key);
    if (record.storage.getItem(key) !== null) {
      throw new PresentationCommandQueueError(
        'Managed presentation queue delete readback mismatch',
        'READBACK_MISMATCH'
      );
    }
  } catch (error) {
    restorePresentationQueueStorage(record, key, previousRaw);
    if (error instanceof PresentationCommandQueueError) throw error;
    throw new PresentationCommandQueueError(
      `Managed presentation queue delete readback failed: ${error instanceof Error ? error.message : String(error)}`,
      'READBACK_MISMATCH'
    );
  }
  record.state = createEmptyPresentationQueueState(conversationId);
};

const runPresentationQueueMutation = <Result>(
  record: PresentationCommandQueueRecord,
  operation: () => Promise<Result>
): Promise<Result> => {
  const result = record.tail.then(operation, operation);
  record.tail = result.then(
    (): void => undefined,
    (): void => undefined
  );
  return result;
};

const nextPresentationQueueState = (
  current: PresentationCommandQueueState,
  items: PresentationCommandQueueItem[]
): PresentationCommandQueueState => ({
  ...current,
  revision: current.revision + 1,
  items,
});

const replacePresentationQueueItem = (
  state: PresentationCommandQueueState,
  queueItemId: string,
  replacement: PresentationCommandQueueItem
): PresentationCommandQueueItem[] => state.items.map((item) => (item.queueItemId === queueItemId ? replacement : item));

const requirePresentationQueueItem = (
  state: PresentationCommandQueueState,
  queueItemId: string
): PresentationCommandQueueItem => {
  const item = state.items.find((candidate) => candidate.queueItemId === queueItemId);
  if (item === undefined) {
    throw new PresentationCommandQueueError('Managed presentation queue item state conflict', 'STATE_CONFLICT');
  }
  return item;
};

const validatePresentationQueueTransition = (
  current: PresentationCommandQueueExecution,
  next: PresentationCommandQueueExecution
): void => {
  const allowed =
    (current.state === 'claimed' && (next.state === 'committed' || next.state === 'preflight_failed')) ||
    (current.state === 'committed' &&
      (next.state === 'dispatching' || next.state === 'bound' || next.state === 'dispatch_uncertain')) ||
    (current.state === 'dispatching' && (next.state === 'bound' || next.state === 'dispatch_uncertain'));
  if (!allowed) {
    throw new PresentationCommandQueueError('Managed presentation queue execution state conflict', 'STATE_CONFLICT');
  }
  if (
    'runId' in current &&
    'runId' in next &&
    (current.runId !== next.runId ||
      ('revision' in current &&
        current.revision !== null &&
        'revision' in next &&
        next.revision !== null &&
        next.revision < current.revision))
  ) {
    throw new PresentationCommandQueueError('Managed presentation queue run reference conflict', 'STATE_CONFLICT');
  }
};

export const isPresentationCommandExecutionRunnable = (
  execution: PresentationCommandQueueExecution
): execution is Extract<PresentationCommandQueueExecution, { state: 'committed' }> =>
  execution.state === 'committed' && execution.postInvoked === false;

const PRESENTATION_START_FAILURES_PROVING_NO_RUN = new Set<PresentationRunFailureCode>([
  'FEATURE_DISABLED',
  'DESKTOP_REQUIRED',
  'INVALID_REQUEST',
  'SCOPE_UNAVAILABLE',
  'TEAM_SCOPE_UNSUPPORTED',
  'RUNTIME_UNSUPPORTED',
  'RATE_LIMITED',
]);

const PRESENTATION_CONFIRMATION_FAILURES_PROVING_NO_COMMIT = new Set<PresentationRunFailureCode>([
  'INVALID_REQUEST',
  'SOURCE_TAMPERED',
  'SOURCE_LIMIT_EXCEEDED',
]);

const hasDurableUnboundGrantRevocationProof = (
  result: ConfirmQueuedPresentationSourcesResult,
  pending: PresentationCommandQueueItem
): boolean => {
  if (!('code' in result) || result.code !== 'SOURCE_GRANT_REPLAYED') return false;
  const { details } = result;
  return (
    isPresentationQueueRecord(details) &&
    hasPresentationQueueKeys(details, ['grantId', 'queueUnboundAtRevoke']) &&
    typeof details.grantId === 'string' &&
    details.queueUnboundAtRevoke === true &&
    pending.sources.some(({ grantId }) => grantId === details.grantId)
  );
};

const isRestorablePresentationStartFailure = (result: StartPresentationRunResult): boolean => {
  if (!('code' in result)) return false;
  return result.state === 'preflight' && PRESENTATION_START_FAILURES_PROVING_NO_RUN.has(result.code);
};

const confirmPresentationQueueItem = async (
  record: PresentationCommandQueueRecord,
  item: PresentationCommandQueueItem
): Promise<number | null> => {
  if (item.sources.length === 0) return null;
  if (item.sourceOwner === null || item.expectedOwnerRevision === null) {
    throw new PresentationCommandQueueError(
      'Managed presentation queue source confirmation is invalid',
      'INVALID_STATE'
    );
  }
  const result = await record.confirmQueuedSources({
    owner: item.sourceOwner,
    queue_item_id: item.queueItemId,
    sources: structuredClone(item.sources),
    expected_owner_revision: item.expectedOwnerRevision,
  });
  if ('code' in result) {
    throw new PresentationCommandQueueError(
      `Managed presentation queue confirmation failed: ${result.code}`,
      'CONFIRMATION_FAILED'
    );
  }
  return result.ownerRevision;
};

const defaultPresentationQueueStorage = (): PresentationCommandQueueStorage => {
  if (typeof window === 'undefined') {
    throw new PresentationCommandQueueError(
      'Managed presentation queue localStorage is unavailable',
      'PERSISTENCE_FAILED'
    );
  }
  return window.localStorage;
};

export const createPresentationCommandQueueController = (
  options: PresentationCommandQueueControllerOptions
): PresentationCommandQueueController => {
  const conversationId = normalizePresentationConversationId(options.conversationId);
  if (conversationId === null) {
    throw new PresentationCommandQueueError('Invalid managed presentation queue conversation id', 'INVALID_STATE');
  }
  const storage = options.storage ?? defaultPresentationQueueStorage();
  migrateLegacyPresentationQueueState(storage, options.conversationId, conversationId);
  const confirmQueuedSources =
    options.confirmQueuedSources ?? ((request) => ipcBridge.presentationSources.confirmQueued.invoke(request));
  const existing = presentationCommandQueueRecords.get(conversationId);
  const record: PresentationCommandQueueRecord = existing ?? {
    storage,
    confirmQueuedSources,
    now: options.now ?? (() => new Date()),
    tail: Promise.resolve(),
    allocating: false,
    draining: false,
    state: null,
  };
  record.storage = storage;
  record.confirmQueuedSources = confirmQueuedSources;
  record.now = options.now ?? (() => new Date());
  presentationCommandQueueRecords.set(conversationId, record);

  const read = (): PresentationCommandQueueState =>
    structuredClone(readPresentationQueueState(record, conversationId).state);

  const persistReplacement = (
    current: PresentationCommandQueueState,
    raw: string | null,
    replacement: PresentationCommandQueueItem
  ): PresentationCommandQueueItem => {
    const next = nextPresentationQueueState(
      current,
      replacePresentationQueueItem(current, replacement.queueItemId, replacement)
    );
    const confirmed = persistPresentationQueueState(record, raw, next);
    return structuredClone(requirePresentationQueueItem(confirmed, replacement.queueItemId));
  };

  const enqueue = (input: EnqueuePresentationCommandInput): Promise<PresentationCommandQueueItem> =>
    runPresentationQueueMutation(record, async () => {
      const { state: current, raw } = readPresentationQueueState(record, conversationId);
      if (current.items.length >= PRESENTATION_COMMAND_QUEUE_MAX_ITEMS) {
        throw new PresentationCommandQueueError('Managed presentation queue is full', 'INVALID_STATE');
      }
      if (
        current.items.some(
          (item) =>
            item.queueItemId.toLowerCase() === input.queueItemId.toLowerCase() ||
            item.clientRequestId.toLowerCase() === input.clientRequestId.toLowerCase()
        )
      ) {
        throw new PresentationCommandQueueError('Managed presentation queue identifier collision', 'STATE_CONFLICT');
      }
      if (current.items.some(({ execution }) => execution.state === 'persisting')) {
        throw new PresentationCommandQueueError(
          'Managed presentation queue confirmation is already pending',
          'STATE_CONFLICT'
        );
      }
      const timestamp = record.now().toISOString();
      const persisting = decodePresentationQueueItem({
        ...structuredClone(input),
        confirmedOwnerRevision: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        execution: { state: 'persisting' },
      });
      const persistingState = nextPresentationQueueState(current, [...current.items, persisting]);
      persistPresentationQueueState(record, raw, persistingState);

      const confirmedOwnerRevision = await confirmPresentationQueueItem(record, persisting);
      const { state: confirmedCurrent, raw: confirmedRaw } = readPresentationQueueState(record, conversationId);
      const durablePersisting = requirePresentationQueueItem(confirmedCurrent, persisting.queueItemId);
      if (durablePersisting.execution.state !== 'persisting') {
        throw new PresentationCommandQueueError(
          'Managed presentation queue confirmation state conflict',
          'STATE_CONFLICT'
        );
      }
      const queued: PresentationCommandQueueItem = {
        ...durablePersisting,
        confirmedOwnerRevision,
        updatedAt: record.now().toISOString(),
        execution: { state: 'queued' },
      };
      return persistReplacement(confirmedCurrent, confirmedRaw, queued);
    });

  const recoverPersisting = (): Promise<void> =>
    runPresentationQueueMutation(record, async () => {
      let persisted = readPresentationQueueState(record, conversationId);
      const pendingIds = persisted.state.items
        .filter(({ execution }) => execution.state === 'persisting')
        .map(({ queueItemId }) => queueItemId);
      for (const queueItemId of pendingIds) {
        const pending = requirePresentationQueueItem(persisted.state, queueItemId);
        const confirmedOwnerRevision = await confirmPresentationQueueItem(record, pending);
        const queued: PresentationCommandQueueItem = {
          ...pending,
          confirmedOwnerRevision,
          updatedAt: record.now().toISOString(),
          execution: { state: 'queued' },
        };
        persistReplacement(persisted.state, persisted.raw, queued);
        persisted = readPresentationQueueState(record, conversationId);
      }
    });

  const retirePersisting = (queueItemId: string): Promise<'confirmed' | 'removed'> =>
    runPresentationQueueMutation(record, async () => {
      const persisted = readPresentationQueueState(record, conversationId);
      const pending = requirePresentationQueueItem(persisted.state, queueItemId);
      if (pending.execution.state !== 'persisting') {
        throw new PresentationCommandQueueError(
          'Managed presentation queue item is not awaiting confirmation',
          'STATE_CONFLICT'
        );
      }

      let confirmedOwnerRevision: number | null = null;
      let definitivelyRejected = false;
      if (pending.sources.length > 0) {
        if (pending.sourceOwner === null || pending.expectedOwnerRevision === null) {
          throw new PresentationCommandQueueError(
            'Managed presentation queue source confirmation is invalid',
            'INVALID_STATE'
          );
        }
        const result = await record.confirmQueuedSources({
          owner: pending.sourceOwner,
          queue_item_id: pending.queueItemId,
          sources: structuredClone(pending.sources),
          expected_owner_revision: pending.expectedOwnerRevision,
        });
        if ('code' in result) {
          if (
            !PRESENTATION_CONFIRMATION_FAILURES_PROVING_NO_COMMIT.has(result.code) &&
            !hasDurableUnboundGrantRevocationProof(result, pending)
          ) {
            throw new PresentationCommandQueueError(
              `Managed presentation queue confirmation outcome is uncertain: ${result.code}`,
              'CONFIRMATION_FAILED'
            );
          }
          definitivelyRejected = true;
        } else confirmedOwnerRevision = result.ownerRevision;
      }

      const current = readPresentationQueueState(record, conversationId);
      const durablePending = requirePresentationQueueItem(current.state, queueItemId);
      if (
        durablePending.execution.state !== 'persisting' ||
        JSON.stringify(durablePending) !== JSON.stringify(pending)
      ) {
        throw new PresentationCommandQueueError(
          'Managed presentation queue confirmation state conflict',
          'STATE_CONFLICT'
        );
      }
      if (!definitivelyRejected) {
        const queued: PresentationCommandQueueItem = {
          ...durablePending,
          confirmedOwnerRevision,
          updatedAt: record.now().toISOString(),
          execution: { state: 'queued' },
        };
        persistReplacement(current.state, current.raw, queued);
        return 'confirmed';
      }

      const items = current.state.items.filter((candidate) => candidate.queueItemId !== queueItemId);
      if (items.length === 0) {
        if (current.raw === null) {
          throw new PresentationCommandQueueError(
            'Managed presentation queue confirmation state is not durable',
            'STATE_CONFLICT'
          );
        }
        removePresentationQueueState(record, conversationId, current.raw);
      } else {
        persistPresentationQueueState(record, current.raw, nextPresentationQueueState(current.state, items));
      }
      return 'removed';
    });

  const removePersistingAfterConfirmedGrantRevocation = (queueItemId: string, grantId: string): Promise<void> =>
    runPresentationQueueMutation(record, async () => {
      if (!PRESENTATION_QUEUE_UUID_RE.test(grantId)) {
        throw new PresentationCommandQueueError(
          'Managed presentation queue revoked grant proof is invalid',
          'INVALID_STATE'
        );
      }
      const current = readPresentationQueueState(record, conversationId);
      const pending = requirePresentationQueueItem(current.state, queueItemId);
      if (pending.execution.state !== 'persisting') {
        throw new PresentationCommandQueueError(
          'Managed presentation queue item is not in persisting state',
          'STATE_CONFLICT'
        );
      }
      if (!pending.sources.some((source) => source.grantId === grantId)) {
        throw new PresentationCommandQueueError(
          'Managed presentation queue revoked grant is not in the frozen source set',
          'STATE_CONFLICT'
        );
      }
      const items = current.state.items.filter((candidate) => candidate.queueItemId !== queueItemId);
      if (items.length === 0) {
        if (current.raw === null) {
          throw new PresentationCommandQueueError(
            'Managed presentation queue revoked-grant state is not durable',
            'STATE_CONFLICT'
          );
        }
        removePresentationQueueState(record, conversationId, current.raw);
        return;
      }
      persistPresentationQueueState(record, current.raw, nextPresentationQueueState(current.state, items));
    });

  const editQueued = (queueItemId: string, updates: { input: string }): Promise<PresentationCommandQueueItem> =>
    runPresentationQueueMutation(record, async () => {
      const persisted = readPresentationQueueState(record, conversationId);
      const item = requirePresentationQueueItem(persisted.state, queueItemId);
      if (item.execution.state !== 'queued') {
        throw new PresentationCommandQueueError(
          'Managed presentation queue item is not in queued state',
          'STATE_CONFLICT'
        );
      }
      const replacement = decodePresentationQueueItem({
        ...item,
        input: updates.input,
        updatedAt: record.now().toISOString(),
      });
      return persistReplacement(persisted.state, persisted.raw, replacement);
    });

  const removeQueued = (queueItemId: string): Promise<void> =>
    runPresentationQueueMutation(record, async () => {
      const persisted = readPresentationQueueState(record, conversationId);
      const item = requirePresentationQueueItem(persisted.state, queueItemId);
      if (item.execution.state !== 'queued') {
        throw new PresentationCommandQueueError(
          'Managed presentation queue item is not in queued state',
          'STATE_CONFLICT'
        );
      }
      const items = persisted.state.items.filter((candidate) => candidate.queueItemId !== queueItemId);
      if (items.length === 0 && persisted.raw !== null) {
        removePresentationQueueState(record, conversationId, persisted.raw);
        return;
      }
      persistPresentationQueueState(record, persisted.raw, nextPresentationQueueState(persisted.state, items));
    });

  const claimHead = (queueItemId: string): Promise<PresentationCommandQueueItem> =>
    runPresentationQueueMutation(record, async () => {
      const persisted = readPresentationQueueState(record, conversationId);
      const head = persisted.state.items[0];
      if (head?.queueItemId !== queueItemId) {
        throw new PresentationCommandQueueError(
          'Only the durable managed presentation queue head may claim',
          'HEAD_CONFLICT'
        );
      }
      if (head.execution.state !== 'queued') {
        throw new PresentationCommandQueueError(
          'Managed presentation queue head is not in queued state',
          'STATE_CONFLICT'
        );
      }
      const claimed: PresentationCommandQueueItem = {
        ...head,
        updatedAt: record.now().toISOString(),
        execution: { state: 'claimed', claimedAt: record.now().toISOString() },
      };
      return persistReplacement(persisted.state, persisted.raw, claimed);
    });

  const allocateClaimed = (
    queueItemId: string,
    start: (request: StartPresentationRunRequest) => Promise<StartPresentationRunResult>
  ): Promise<PresentationCommandQueueItem> =>
    runPresentationQueueMutation(record, async () => {
      if (record.allocating) {
        throw new PresentationCommandQueueError(
          'Managed presentation queue allocation is already in flight',
          'STATE_CONFLICT'
        );
      }
      const persisted = readPresentationQueueState(record, conversationId);
      const head = persisted.state.items[0];
      if (head?.queueItemId !== queueItemId) {
        throw new PresentationCommandQueueError(
          'Only the durable managed presentation queue head may allocate',
          'HEAD_CONFLICT'
        );
      }
      if (head.execution.state !== 'claimed') {
        throw new PresentationCommandQueueError('Managed presentation queue item is not claimed', 'STATE_CONFLICT');
      }
      record.allocating = true;
      let result: StartPresentationRunResult;
      try {
        result = await start({
          conversation_id: conversationId,
          client_request_id: head.clientRequestId,
          input: head.input,
          selected_template_id: head.selectedTemplateId,
          sources: structuredClone(head.sources),
        });
      } finally {
        record.allocating = false;
      }
      const afterStart = readPresentationQueueState(record, conversationId);
      const durableClaim = requirePresentationQueueItem(afterStart.state, queueItemId);
      if (durableClaim.execution.state !== 'claimed') {
        throw new PresentationCommandQueueError(
          'Managed presentation queue allocation state conflict',
          'STATE_CONFLICT'
        );
      }
      if ('code' in result) {
        if (isRestorablePresentationStartFailure(result)) {
          const failed: PresentationCommandQueueItem = {
            ...durableClaim,
            updatedAt: record.now().toISOString(),
            execution: { state: 'preflight_failed', code: result.code },
          };
          persistReplacement(afterStart.state, afterStart.raw, failed);
        }
        throw new PresentationCommandQueueError(
          `Managed presentation queue allocation failed: ${result.code}`,
          'STATE_CONFLICT'
        );
      }
      const committed: PresentationCommandQueueItem = {
        ...durableClaim,
        updatedAt: record.now().toISOString(),
        execution: {
          state: 'committed',
          runId: result.run.runId,
          revision: result.run.revision,
          postInvoked: false,
        },
      };
      return persistReplacement(afterStart.state, afterStart.raw, committed);
    });

  const transition = (
    queueItemId: string,
    execution: PresentationCommandQueueExecution
  ): Promise<PresentationCommandQueueItem> =>
    runPresentationQueueMutation(record, async () => {
      const persisted = readPresentationQueueState(record, conversationId);
      const item = requirePresentationQueueItem(persisted.state, queueItemId);
      const decodedExecution = decodePresentationQueueExecution(execution);
      validatePresentationQueueTransition(item.execution, decodedExecution);
      const replacement: PresentationCommandQueueItem = {
        ...item,
        updatedAt: record.now().toISOString(),
        execution: decodedExecution,
      };
      return persistReplacement(persisted.state, persisted.raw, replacement);
    });

  const removePreflightFailed = (queueItemId: string): Promise<void> =>
    runPresentationQueueMutation(record, async () => {
      const persisted = readPresentationQueueState(record, conversationId);
      const head = persisted.state.items[0];
      if (head?.queueItemId !== queueItemId) {
        throw new PresentationCommandQueueError(
          'Only the durable managed presentation queue head may clear a preflight failure',
          'HEAD_CONFLICT'
        );
      }
      if (head.execution.state !== 'preflight_failed') {
        throw new PresentationCommandQueueError(
          'Managed presentation queue item is not a preflight failure',
          'STATE_CONFLICT'
        );
      }
      const items = persisted.state.items.slice(1);
      if (items.length === 0) {
        if (persisted.raw === null) {
          throw new PresentationCommandQueueError(
            'Managed presentation queue preflight failure is not durable',
            'STATE_CONFLICT'
          );
        }
        removePresentationQueueState(record, conversationId, persisted.raw);
        return;
      }
      persistPresentationQueueState(record, persisted.raw, nextPresentationQueueState(persisted.state, items));
    });

  const removeBound = (queueItemId: string): Promise<void> =>
    runPresentationQueueMutation(record, async () => {
      const persisted = readPresentationQueueState(record, conversationId);
      const item = requirePresentationQueueItem(persisted.state, queueItemId);
      if (item.execution.state !== 'bound') {
        throw new PresentationCommandQueueError('Managed presentation queue item is not bound', 'STATE_CONFLICT');
      }
      const items = persisted.state.items.filter((candidate) => candidate.queueItemId !== queueItemId);
      if (items.length === 0) {
        if (persisted.raw === null) {
          throw new PresentationCommandQueueError(
            'Managed presentation queue bound state is not durable',
            'STATE_CONFLICT'
          );
        }
        removePresentationQueueState(record, conversationId, persisted.raw);
        return;
      }
      persistPresentationQueueState(record, persisted.raw, nextPresentationQueueState(persisted.state, items));
    });

  const runCommittedHead = async (
    execute: (item: PresentationCommandQueueItem) => Promise<void>
  ): Promise<'executed' | 'busy' | 'not_runnable'> => {
    if (record.draining) return 'busy';
    const state = readPresentationQueueState(record, conversationId).state;
    const head = state.items[0];
    if (head === undefined || !isPresentationCommandExecutionRunnable(head.execution)) return 'not_runnable';
    record.draining = true;
    try {
      const dispatching = await runPresentationQueueMutation(record, async () => {
        const persisted = readPresentationQueueState(record, conversationId);
        const durableHead = persisted.state.items[0];
        if (durableHead === undefined || !isPresentationCommandExecutionRunnable(durableHead.execution)) {
          return null;
        }
        const replacement: PresentationCommandQueueItem = {
          ...durableHead,
          updatedAt: record.now().toISOString(),
          execution: {
            state: 'dispatching',
            runId: durableHead.execution.runId,
            revision: durableHead.execution.revision,
          },
        };
        validatePresentationQueueTransition(durableHead.execution, replacement.execution);
        return persistReplacement(persisted.state, persisted.raw, replacement);
      });
      if (dispatching === null) return 'not_runnable';
      await execute(structuredClone(dispatching));
      return 'executed';
    } finally {
      record.draining = false;
    }
  };

  return {
    read,
    enqueue,
    recoverPersisting,
    retirePersisting,
    removePersistingAfterConfirmedGrantRevocation,
    editQueued,
    removeQueued,
    claimHead,
    allocateClaimed,
    transition,
    removePreflightFailed,
    removeBound,
    runCommittedHead,
  };
};
