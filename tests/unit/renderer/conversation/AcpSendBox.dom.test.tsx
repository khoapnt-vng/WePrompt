/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type {
  GetPresentationSourceOwnerResult,
  PickPresentationSourcesResult,
  PresentationGrantOwner,
  PresentationSourceDescriptor,
  PresentationSourceRef,
} from '@/common/types/office/presentationRun';
import type { PresentationTemplateSummary } from '@/common/types/office/presentationTemplate';
import type { ManagedPresentationSubmission } from '@/common/types/platform/presentationSubmission';
import AcpSendBox from '@/renderer/pages/conversation/platforms/acp/AcpSendBox';
import type { UseAcpMessageReturn } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';

const {
  sendMessageInvokeMock,
  addOrUpdateMessageMock,
  resetStateMock,
  emitterEmitMock,
  setSendBoxHandlerMock,
  useAcpConfigOptionsMock,
  useTeamPermissionMock,
  isMobileMock,
  mobileActionSheetEntries,
  contextUsageIndicatorProps,
  sendBoxProps,
  clearFilesMock,
  grantExternalDropMock,
  handleFilesAddedMock,
  clearSelectionMock,
  composeSendMock,
  createPresentationControllerMock,
  draftMutateMock,
  draftState,
  featureEnabledState,
  hydrateSourceOwnerMock,
  isElectronDesktopMock,
  legacyOpenFileSelectorMock,
  messageWarningMock,
  pickSourcesMock,
  presentationClaimInvokeMock,
  presentationControllerMock,
  presentationDispatchInvokeMock,
  presentationGetInvokeMock,
  presentationQueueItemsState,
  presentationStartInvokeMock,
  prepareScratchMock,
  revokeSourceMock,
  resetSourceDraftMock,
  selectedTemplateState,
  sourceDescriptorsState,
  sourceOwnerRevisionState,
  sourceOwnerState,
  sourcePendingState,
  sourceRefsState,
  runtimeViewState,
} = vi.hoisted(() => ({
  sendMessageInvokeMock: vi.fn(),
  addOrUpdateMessageMock: vi.fn(),
  resetStateMock: vi.fn(),
  emitterEmitMock: vi.fn(),
  setSendBoxHandlerMock: vi.fn(),
  useAcpConfigOptionsMock: vi.fn(),
  useTeamPermissionMock: vi.fn(),
  isMobileMock: { current: false },
  mobileActionSheetEntries: {
    current: [] as Array<{
      key: string;
      submenu?: {
        onSelect?: (value: string) => void;
      };
    }>,
  },
  contextUsageIndicatorProps: {
    current: null as {
      budget: {
        source: 'runtime' | 'estimated' | 'unknown';
        totalTokens: number | null;
        contextLimit?: number;
        ratio: number | null;
        status: 'healthy' | 'watch' | 'compress' | 'too_large';
      };
      localUsage: { today: number; weekToDate: number; monthToDate: number };
    } | null,
  },
  sendBoxProps: {
    current: null as {
      tokenUsage?: unknown;
      localUsage?: unknown;
      context_limit?: unknown;
      prefix?: React.ReactNode;
      tools?: React.ReactNode;
      onSlashBuiltinCommand?: (name: string) => void;
      hasPendingAttachments?: boolean;
      onFilesAdded?: (files: unknown[]) => void;
      onManagedDrop?: (files: readonly File[]) => Promise<void> | void;
      managedPresentationSubmission?: ManagedPresentationSubmission;
    } | null,
  },
  clearFilesMock: vi.fn(),
  grantExternalDropMock: vi.fn(),
  handleFilesAddedMock: vi.fn(),
  clearSelectionMock: vi.fn(),
  composeSendMock: vi.fn((input: string, files: string[]) => ({ input, files, injectSkills: [] })),
  createPresentationControllerMock: vi.fn(),
  draftMutateMock: vi.fn(),
  draftState: {
    current: {
      atPath: [] as Array<string | { path: string; name: string; isFile: boolean; relativePath?: string }>,
      uploadFile: [] as string[],
      content: '',
    },
  },
  featureEnabledState: { current: false },
  hydrateSourceOwnerMock: vi.fn().mockResolvedValue({
    ok: true,
    owner: { owner_type: 'conversation', conversation_id: 'd0921953' },
    ownerRevision: 0,
    grants: [],
  }),
  isElectronDesktopMock: vi.fn(() => true),
  legacyOpenFileSelectorMock: vi.fn(),
  messageWarningMock: vi.fn(),
  pickSourcesMock: vi.fn(),
  presentationClaimInvokeMock: vi.fn(),
  presentationControllerMock: {
    read: vi.fn(),
    enqueue: vi.fn(),
    recoverPersisting: vi.fn(),
    editQueued: vi.fn(),
    removeQueued: vi.fn(),
    claimHead: vi.fn(),
    allocateClaimed: vi.fn(),
    transition: vi.fn(),
    removePreflightFailed: vi.fn(),
    removeBound: vi.fn(),
    runCommittedHead: vi.fn(),
  },
  presentationDispatchInvokeMock: vi.fn(),
  presentationGetInvokeMock: vi.fn(),
  presentationQueueItemsState: { current: [] as Array<Record<string, unknown>> },
  presentationStartInvokeMock: vi.fn(),
  prepareScratchMock: vi.fn().mockResolvedValue(undefined),
  revokeSourceMock: vi.fn(),
  resetSourceDraftMock: vi.fn(),
  selectedTemplateState: { current: null as PresentationTemplateSummary | null },
  sourceDescriptorsState: { current: [] as PresentationSourceDescriptor[] },
  sourceOwnerRevisionState: { current: null as number | null },
  sourceOwnerState: { current: null as PresentationGrantOwner | null },
  sourcePendingState: { current: false },
  sourceRefsState: { current: [] as PresentationSourceRef[] },
  runtimeViewState: {
    current: {
      hydrated: true,
      canSendMessage: true,
      isProcessing: false,
      state: 'idle',
      markSendStarted: vi.fn(),
      markSendAccepted: vi.fn(),
      markSendFailed: vi.fn(),
    },
  },
}));

vi.mock('@/common/config/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common/config/constants')>();
  return {
    ...actual,
    get PRESENTATION_RUN_V2_ENABLED() {
      return featureEnabledState.current;
    },
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      sendMessage: {
        invoke: sendMessageInvokeMock,
      },
    },
    presentationRuns: {
      start: { invoke: presentationStartInvokeMock },
      get: { invoke: presentationGetInvokeMock },
      claimInitialDispatch: { invoke: presentationClaimInvokeMock },
      dispatch: { invoke: presentationDispatchInvokeMock },
    },
    conversation: {
      stop: {
        invoke: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

vi.mock('@/renderer/components/chat/SendBox', () => ({
  default: ({
    onSend,
    onChange,
    prefix,
    rightTools,
    managedPresentationSubmission,
    ...props
  }: {
    onSend: (message: string) => Promise<void>;
    onChange?: (value: string) => void;
    prefix?: React.ReactNode;
    rightTools?: React.ReactNode;
    managedPresentationSubmission?: ManagedPresentationSubmission;
  }) =>
    (() => {
      sendBoxProps.current = { ...props, managedPresentationSubmission };
      return (
        <div>
          {rightTools}
          {prefix}
          <button type='button' onClick={() => onChange?.('hello')}>
            change
          </button>
          <button
            type='button'
            onClick={() => {
              if (managedPresentationSubmission) {
                void managedPresentationSubmission.onSubmit({
                  queueItemId: '11111111-1111-4111-8111-111111111111',
                  clientRequestId: '22222222-2222-4222-8222-222222222222',
                  input: 'Hello',
                  selectedTemplateId: managedPresentationSubmission.selectedTemplateId,
                  sources: managedPresentationSubmission.sources,
                  capturedAt: '2026-08-05T00:00:00.000Z',
                });
                return;
              }
              void onSend('Hello').catch(() => {});
            }}
          >
            send
          </button>
        </div>
      );
    })(),
}));

vi.mock('@/renderer/components/chat/TemplateGallery', () => ({
  TemplateChipCard: ({ template }: { template: PresentationTemplateSummary }) => (
    <span data-testid='template-chip-card'>{template.manifest.name}</span>
  ),
  TemplateGalleryButton: () => null,
  TemplateGalleryPanel: () => null,
  usePresentationTemplates: () => ({
    templates: [],
    templatesLoading: false,
    galleryOpen: false,
    openGallery: vi.fn(),
    closeGallery: vi.fn(),
    toggleGallery: vi.fn(),
    selectedTemplate: selectedTemplateState.current,
    selectTemplate: vi.fn(),
    clearSelection: clearSelectionMock,
    importFromDialog: vi.fn(),
    removeTemplate: vi.fn(),
    prepareScratch: prepareScratchMock,
    composeSend: composeSendMock,
    registerScratchTurn: vi.fn(),
    retainScratchRun: vi.fn().mockResolvedValue(undefined),
    handleScratchTerminal: vi.fn(),
    interruptScratchTurn: vi.fn(),
    discardScratch: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({
  default: () => <span data-testid='composer-permission-control' />,
}));
vi.mock('@/renderer/components/agent/ContextUsageIndicator', () => ({
  default: (props: {
    budget: {
      source: 'runtime' | 'estimated' | 'unknown';
      totalTokens: number | null;
      contextLimit?: number;
      ratio: number | null;
      status: 'healthy' | 'watch' | 'compress' | 'too_large';
    };
    localUsage: { today: number; weekToDate: number; monthToDate: number };
  }) => {
    contextUsageIndicatorProps.current = props;
    return <span data-testid='context-usage-indicator' />;
  },
}));
vi.mock('@/renderer/components/chat/CommandQueuePanel', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/MobileActionSheet', () => ({
  default: ({
    entries,
  }: {
    entries?: Array<{
      key: string;
      submenu?: {
        onSelect?: (value: string) => void;
      };
    }>;
  }) => {
    mobileActionSheetEntries.current = entries ?? [];
    return null;
  },
  useAttachEntry: () => ({ entries: [], hiddenFileInput: null }),
}));
vi.mock('@/renderer/components/chat/ThoughtDisplay', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FileAttachButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FilePreview', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/HorizontalFileList', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/renderer/hooks/agent/useAcpModelInfo', () => ({
  useAcpModelInfo: () => ({
    model_info: null,
    canSwitch: false,
    selectModel: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({
  classifyConfigSetError: () => 'unknown',
  useAcpConfigOptions: useAcpConfigOptionsMock,
}));
vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  getSendBoxDraftHook: () => () => ({
    data: draftState.current,
    mutate: draftMutateMock,
  }),
}));
vi.mock('@/renderer/hooks/chat/useSendBoxFiles', () => ({
  useSendBoxFiles: () => ({
    handleFilesAdded: handleFilesAddedMock,
    clearFiles: clearFilesMock,
  }),
  createSetUploadFile: () => vi.fn(),
}));
vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({
  useAutoTitle: () => ({
    checkAndUpdateTitle: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    conversation: {
      id: 'd0921953',
      name: 'ACP budget fixture',
      type: 'acp',
      created_at: 1,
      modified_at: 1,
      extra: { backend: 'codex' },
    },
    loadedSkills: [],
    loadedMcpStatuses: [],
  }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: isMobileMock.current }),
}));
vi.mock('@/renderer/hooks/useLocalTokenUsage', () => ({
  useLocalTokenUsage: () => ({ today: 120, weekToDate: 560, monthToDate: 1_240 }),
}));
vi.mock('@/renderer/hooks/file/selection', () => ({
  useOpenFileSelector: () => ({
    openFileSelector: legacyOpenFileSelectorMock,
    onSlashBuiltinCommand: (name: string) => {
      if (name === 'open') legacyOpenFileSelectorMock();
    },
  }),
  usePresentationSourceDraft: () => ({
    owner: sourceOwnerState.current,
    ownerRevision: sourceOwnerRevisionState.current,
    descriptors: sourceDescriptorsState.current,
    sourceRefs: sourceRefsState.current,
    pending: sourcePendingState.current,
    hydrate: hydrateSourceOwnerMock,
    createDraft: vi.fn(),
    pickSources: pickSourcesMock,
    grantExternalDrop: grantExternalDropMock,
    grantWorkspaceSource: vi.fn(),
    revoke: revokeSourceMock,
    bindDraft: vi.fn(),
    reset: resetSourceDraftMock,
  }),
}));
vi.mock('@/renderer/hooks/ui/useLatestRef', () => ({
  useLatestRef: <T,>(value: T) => {
    const ref = React.useRef(value);
    ref.current = value;
    return ref;
  },
}));
vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => addOrUpdateMessageMock,
  useMessageList: () => [],
}));
vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({
  createPresentationCommandQueueController: (options: unknown) => {
    createPresentationControllerMock(options);
    return presentationControllerMock;
  },
  shouldEnqueueConversationCommand: () => false,
  useConversationCommandQueue: () => ({
    items: [],
    isPaused: false,
    isInteractionLocked: false,
    hasPendingCommands: false,
    enqueue: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    reorder: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    lockInteraction: vi.fn(),
    unlockInteraction: vi.fn(),
    resetActiveExecution: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => runtimeViewState.current,
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: setSendBoxHandlerMock,
  }),
}));
vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: useTeamPermissionMock,
}));
vi.mock('@/renderer/services/FileService', () => ({
  allSupportedExts: [],
}));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: isElectronDesktopMock,
}));
vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: emitterEmitMock,
  },
  useAddEventListener: vi.fn(),
}));
vi.mock('@/renderer/utils/file/fileSelection', () => ({
  mergeFileSelectionItems: vi.fn(),
}));
vi.mock('@/renderer/utils/file/messageFiles', () => ({
  buildDisplayMessage: (input: string) => input,
}));
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  ),
  Message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: messageWarningMock,
  },
  Tag: ({ children, onClose }: { children?: React.ReactNode; onClose?: () => void }) => (
    <span>
      {children}
      {onClose && (
        <button type='button' aria-label={`Remove ${String(children)}`} onClick={onClose}>
          remove
        </button>
      )}
    </span>
  ),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const pptxTemplate: PresentationTemplateSummary = {
  manifest: {
    id: 'business-review',
    name: 'Business Review',
    description: 'Quarterly results',
    format: 'pptx',
    kind: 'deck',
    source: 'builtin',
    themeFile: 'SKILL.md',
    referenceFile: 'reference.pptx',
    preview: 'preview.svg',
    version: 1,
    createdAt: '2026-08-04T00:00:00.000Z',
  },
  themePath: '/private/template/SKILL.md',
  referencePath: '/private/template/reference.pptx',
  previewDataUrl: 'data:image/svg+xml,preview',
};

const sourceDescriptor: PresentationSourceDescriptor = {
  grantId: 'grant-1',
  displayName: 'quarterly-results.xlsx',
  format: 'xlsx',
  sourceKind: 'native-picker',
  byteLength: 42,
  sha256: 'a'.repeat(64),
  expiresAt: '2026-08-04T00:15:00.000Z',
};

const currentConversationOwner: PresentationGrantOwner = {
  owner_type: 'conversation',
  conversation_id: 'd0921953',
};

const hydratedOwnerResult: GetPresentationSourceOwnerResult = {
  ok: true,
  owner: currentConversationOwner,
  ownerRevision: 0,
  grants: [],
};

const failedOwnerHydration: GetPresentationSourceOwnerResult = {
  ok: false,
  code: 'INTERNAL_ERROR',
  messageKey: 'conversation.presentationRun.errors.INTERNAL_ERROR',
  retryable: false,
  state: 'preflight',
  details: null,
};

const createDeferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const presentationQueueItem = (
  queueItemId: string,
  clientRequestId: string,
  execution: Record<string, unknown>
): Record<string, unknown> => ({
  queueItemId,
  clientRequestId,
  input: `Prompt ${queueItemId}`,
  selectedTemplateId: 'business-review',
  sources: [],
  sourceOwner: null,
  expectedOwnerRevision: null,
  confirmedOwnerRevision: null,
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
  execution,
});

const makeMessageState = (overrides: Partial<UseAcpMessageReturn> = {}): UseAcpMessageReturn => ({
  thought: { subject: '', description: '' },
  setThought: vi.fn(),
  running: true,
  hasHydratedRunningState: true,
  acpStatus: null,
  aiProcessing: false,
  setAiProcessing: vi.fn(),
  resetState: resetStateMock,
  tokenUsage: null,
  context_limit: 0,
  hasThinkingMessage: false,
  slashCommands: [],
  fetchSlashCommands: vi.fn(),
  ...overrides,
});

describe('AcpSendBox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    isMobileMock.current = false;
    mobileActionSheetEntries.current = [];
    contextUsageIndicatorProps.current = null;
    sendBoxProps.current = null;
    draftState.current = { atPath: [], uploadFile: [], content: '' };
    draftMutateMock.mockImplementation((updater: unknown) => {
      if (typeof updater === 'function') {
        draftState.current = (updater as (previous: typeof draftState.current) => typeof draftState.current)(
          draftState.current
        );
      }
      return Promise.resolve(draftState.current);
    });
    featureEnabledState.current = false;
    isElectronDesktopMock.mockReturnValue(true);
    selectedTemplateState.current = null;
    sourceDescriptorsState.current = [];
    sourceOwnerState.current = null;
    sourceOwnerRevisionState.current = null;
    sourcePendingState.current = false;
    sourceRefsState.current = [];
    runtimeViewState.current = {
      hydrated: true,
      canSendMessage: true,
      isProcessing: false,
      state: 'idle',
      markSendStarted: vi.fn(),
      markSendAccepted: vi.fn(),
      markSendFailed: vi.fn(),
    };
    presentationQueueItemsState.current = [];
    presentationControllerMock.read.mockImplementation(() => ({
      version: 2,
      conversationId: 'd0921953',
      revision: 1,
      items: presentationQueueItemsState.current,
    }));
    presentationControllerMock.recoverPersisting.mockResolvedValue(undefined);
    presentationControllerMock.enqueue.mockImplementation(async (input: Record<string, unknown>) => {
      if (
        presentationQueueItemsState.current.some(
          (item) => item.queueItemId === input.queueItemId || item.clientRequestId === input.clientRequestId
        )
      ) {
        throw new Error('managed presentation queue identifier collision');
      }
      const item = {
        ...input,
        sourceOwner: input.sourceOwner ?? null,
        expectedOwnerRevision: input.expectedOwnerRevision ?? null,
        confirmedOwnerRevision: input.expectedOwnerRevision ?? null,
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:00.000Z',
        execution: { state: 'queued' },
      };
      presentationQueueItemsState.current = [...presentationQueueItemsState.current, item];
      return item;
    });
    presentationControllerMock.claimHead.mockImplementation(async () => {
      const item = presentationQueueItemsState.current[0];
      const claimed = { ...item, execution: { state: 'claimed', claimedAt: '2026-08-05T00:00:01.000Z' } };
      presentationQueueItemsState.current = [claimed, ...presentationQueueItemsState.current.slice(1)];
      return claimed;
    });
    presentationControllerMock.allocateClaimed.mockImplementation(
      async (_queueItemId: string, start: (request: Record<string, unknown>) => Promise<Record<string, unknown>>) => {
        const item = presentationQueueItemsState.current[0];
        const result = await start({
          conversation_id: 'd0921953',
          client_request_id: item.clientRequestId,
          input: item.input,
          selected_template_id: item.selectedTemplateId,
          sources: item.sources,
        });
        if (result.ok !== true) throw new Error(String(result.code));
        const run = result.run as { runId: string; revision: number };
        const committed = {
          ...item,
          execution: { state: 'committed', runId: run.runId, revision: run.revision, postInvoked: false },
        };
        presentationQueueItemsState.current = [committed, ...presentationQueueItemsState.current.slice(1)];
        return committed;
      }
    );
    presentationControllerMock.transition.mockImplementation(async (queueItemId: string, execution: unknown) => {
      const index = presentationQueueItemsState.current.findIndex((item) => item.queueItemId === queueItemId);
      const transitioned = { ...presentationQueueItemsState.current[index], execution };
      presentationQueueItemsState.current = presentationQueueItemsState.current.map((item, itemIndex) =>
        itemIndex === index ? transitioned : item
      );
      return transitioned;
    });
    presentationControllerMock.removeBound.mockImplementation(async (queueItemId: string) => {
      presentationQueueItemsState.current = presentationQueueItemsState.current.filter(
        (item) => item.queueItemId !== queueItemId
      );
    });
    presentationStartInvokeMock.mockResolvedValue({
      ok: true,
      run: { runId: '33333333-3333-4333-8333-333333333333', revision: 4 },
    });
    presentationClaimInvokeMock.mockResolvedValue({
      ok: true,
      status: 'claimed',
      runId: '33333333-3333-4333-8333-333333333333',
      leaseToken: 'opaque-lease',
      revision: 5,
      expiresAt: '2026-08-05T00:01:00.000Z',
      renewAfterMs: 10_000,
    });
    presentationDispatchInvokeMock.mockResolvedValue({
      ok: true,
      status: 'bound',
      runId: '33333333-3333-4333-8333-333333333333',
      conversationId: 'd0921953',
      revision: 6,
      dispatchStatus: 'bound',
    });
    presentationGetInvokeMock.mockResolvedValue({
      ok: false,
      code: 'RUN_NOT_FOUND',
      messageKey: 'conversation.presentationRun.RUN_NOT_FOUND',
      retryable: false,
      state: 'lookup',
      details: null,
    });
    hydrateSourceOwnerMock.mockResolvedValue(hydratedOwnerResult);
    pickSourcesMock.mockResolvedValue({
      ok: true,
      status: 'cancelled',
      grants: [],
      ownerRevision: 0,
    });
    grantExternalDropMock.mockResolvedValue({
      ok: true,
      status: 'granted',
      grants: [sourceDescriptor],
      ownerRevision: 1,
    });
    prepareScratchMock.mockResolvedValue(undefined);
    composeSendMock.mockImplementation((input: string, files: string[]) => ({ input, files, injectSkills: [] }));
    useTeamPermissionMock.mockReturnValue(null);
    useAcpConfigOptionsMock.mockReturnValue({
      setStatus: { state: 'idle' },
      mode: null,
      model: null,
      thoughtLevel: null,
      reload: vi.fn(),
      setConfigOption: vi.fn(),
    });
  });

  it('canonicalizes an uppercase short presentation identity without changing the ordinary route identity', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;

    render(<AcpSendBox conversation_id='D0921953' backend='codex' messageState={makeMessageState()} />);

    await waitFor(() =>
      expect(hydrateSourceOwnerMock).toHaveBeenCalledWith({
        owner_type: 'conversation',
        conversation_id: 'd0921953',
      })
    );
    expect(createPresentationControllerMock).toHaveBeenCalledWith({ conversationId: 'd0921953' });
    expect(sendBoxProps.current?.managedPresentationSubmission).toBeDefined();
  });

  it('blocks managed preparation for a legacy attachment while preserving the submitted draft', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    draftState.current = { atPath: [], uploadFile: ['/private/legacy.xlsx'], content: 'Draft request' };

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    expect(draftState.current.content).toBe('Hello');
    expect(screen.getByRole('alert')).toHaveTextContent('conversation.presentationTemplates.sources.reselectRequired');
    expect(messageWarningMock).not.toHaveBeenCalled();
    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(prepareScratchMock).not.toHaveBeenCalled();
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(clearSelectionMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'source hydration is pending',
      arrange: () => {
        sourcePendingState.current = true;
      },
    },
    {
      name: 'source hydration failed',
      arrange: () => {
        hydrateSourceOwnerMock.mockResolvedValue(failedOwnerHydration);
      },
    },
    {
      name: 'source owner belongs to another conversation',
      arrange: () => {
        sourceOwnerState.current = { owner_type: 'conversation', conversation_id: 'conv-other' };
        sourceOwnerRevisionState.current = 3;
      },
    },
    {
      name: 'source owner revision is unavailable',
      arrange: () => {
        sourceOwnerState.current = currentConversationOwner;
        sourceOwnerRevisionState.current = null;
      },
    },
  ])('keeps an eligible managed draft out of legacy send while $name', async ({ arrange }) => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    draftState.current.content = 'Draft request';
    arrange();

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    expect(draftState.current.content).toBe('Hello');
    expect(clearSelectionMock).not.toHaveBeenCalled();
    expect(resetSourceDraftMock).not.toHaveBeenCalled();
    expect(prepareScratchMock).not.toHaveBeenCalled();
    expect(composeSendMock).not.toHaveBeenCalled();
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(presentationControllerMock.enqueue).not.toHaveBeenCalled();
    expect(presentationStartInvokeMock).not.toHaveBeenCalled();
    expect(presentationClaimInvokeMock).not.toHaveBeenCalled();
    expect(presentationDispatchInvokeMock).not.toHaveBeenCalled();
  });

  it('queues a previously blocked managed draft exactly once after source hydration becomes authoritative', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourcePendingState.current = true;

    const { rerender } = render(
      <AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />
    );
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });
    expect(presentationControllerMock.enqueue).not.toHaveBeenCalled();

    sourcePendingState.current = false;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    rerender(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => expect(presentationControllerMock.enqueue).toHaveBeenCalledTimes(1));
    expect(presentationStartInvokeMock).toHaveBeenCalledTimes(1);
    expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('keeps legacy attachments when managed source reselect is cancelled', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    draftState.current = { atPath: [], uploadFile: ['/private/legacy.xlsx'], content: 'Draft request' };

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await act(async () => {
      screen.getByRole('button', { name: 'conversation.presentationTemplates.sources.reselectAction' }).click();
    });

    expect(pickSourcesMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(emitterEmitMock).not.toHaveBeenCalledWith('acp.selected.file.clear');
    expect(draftState.current.uploadFile).toEqual(['/private/legacy.xlsx']);
  });

  it('clears legacy attachments only after managed source reselect is confirmed', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    draftState.current = { atPath: [], uploadFile: ['/private/legacy.xlsx'], content: 'Draft request' };
    pickSourcesMock.mockResolvedValue({
      ok: true,
      status: 'selected',
      grants: [sourceDescriptor],
      ownerRevision: 1,
    });

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await act(async () => {
      screen.getByRole('button', { name: 'conversation.presentationTemplates.sources.reselectAction' }).click();
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(clearFilesMock).toHaveBeenCalledTimes(1);
    expect(emitterEmitMock).toHaveBeenCalledWith('acp.selected.file.clear');
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('routes a prompt-only managed draft through durable claim and main-owned dispatch', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(1));
    expect(presentationControllerMock.enqueue).toHaveBeenCalledWith({
      queueItemId: '11111111-1111-4111-8111-111111111111',
      clientRequestId: '22222222-2222-4222-8222-222222222222',
      input: 'Hello',
      selectedTemplateId: 'business-review',
      sources: [],
      sourceOwner: null,
      expectedOwnerRevision: null,
    });
    expect(presentationControllerMock.claimHead).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(presentationStartInvokeMock).toHaveBeenCalledWith({
      conversation_id: 'd0921953',
      client_request_id: '22222222-2222-4222-8222-222222222222',
      input: 'Hello',
      selected_template_id: 'business-review',
      sources: [],
    });
    expect(presentationClaimInvokeMock).toHaveBeenCalledWith({
      conversation_id: 'd0921953',
      run_id: '33333333-3333-4333-8333-333333333333',
      holder_id: '11111111-1111-4111-8111-111111111111',
      expected_revision: 4,
    });
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(prepareScratchMock).not.toHaveBeenCalled();
  });

  it('persists opaque grants and preserves them when durable queue persistence fails', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 7;
    sourceRefsState.current = [
      {
        grantId: '44444444-4444-4444-8444-444444444444',
        expectedByteLength: 42,
        expectedSha256: 'a'.repeat(64),
      },
    ];
    presentationControllerMock.enqueue.mockRejectedValueOnce(new Error('localStorage quota'));

    render(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);
    const managed = sendBoxProps.current?.managedPresentationSubmission;
    expect(managed).toBeDefined();
    await expect(
      managed?.onSubmit({
        queueItemId: '11111111-1111-4111-8111-111111111111',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        input: 'Hello',
        selectedTemplateId: 'business-review',
        sources: sourceRefsState.current,
        capturedAt: '2026-08-05T00:00:00.000Z',
      })
    ).rejects.toThrow('localStorage quota');

    expect(presentationControllerMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: sourceRefsState.current,
        sourceOwner: currentConversationOwner,
        expectedOwnerRevision: 7,
      })
    );
    expect(JSON.stringify(presentationControllerMock.enqueue.mock.calls[0]?.[0])).not.toContain('/private/');
    expect(clearSelectionMock).not.toHaveBeenCalled();
    expect(resetSourceDraftMock).not.toHaveBeenCalled();
    expect(sourceRefsState.current).toHaveLength(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('keeps a managed submission queued without claiming while the runtime is busy, then drains it', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    runtimeViewState.current = {
      ...runtimeViewState.current,
      canSendMessage: false,
      isProcessing: true,
      state: 'running',
    };

    const { rerender } = render(
      <AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />
    );
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });
    await waitFor(() => expect(presentationControllerMock.enqueue).toHaveBeenCalledTimes(1));
    expect(presentationControllerMock.claimHead).not.toHaveBeenCalled();
    expect(presentationStartInvokeMock).not.toHaveBeenCalled();
    expect(presentationDispatchInvokeMock).not.toHaveBeenCalled();

    runtimeViewState.current = {
      ...runtimeViewState.current,
      canSendMessage: true,
      isProcessing: false,
      state: 'idle',
    };
    rerender(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);
    await waitFor(() => expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(1));
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('recovers a lost start reply by the stable client request id', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    presentationControllerMock.allocateClaimed.mockImplementationOnce(
      async (_queueItemId: string, start: (request: Record<string, unknown>) => Promise<unknown>) => {
        await start({
          conversation_id: 'd0921953',
          client_request_id: '22222222-2222-4222-8222-222222222222',
          input: 'Hello',
          selected_template_id: 'business-review',
          sources: [],
        });
        throw new Error('lost start reply');
      }
    );
    presentationStartInvokeMock.mockRejectedValueOnce(new Error('ipc reply lost'));
    presentationGetInvokeMock.mockResolvedValueOnce({
      ok: true,
      run: {
        runId: '33333333-3333-4333-8333-333333333333',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        conversationId: 'd0921953',
        selectedTemplateId: 'business-review',
        revision: 4,
        dispatchStatus: 'committed',
        artifactPhase: 'sources_snapshotted',
        disposition: null,
        retainedCandidate: null,
        actions: { openAllowed: false, discardAllowed: true },
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:01.000Z',
      },
    });

    render(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => expect(presentationGetInvokeMock).toHaveBeenCalledTimes(1));
    expect(presentationGetInvokeMock).toHaveBeenCalledWith({
      conversation_id: 'd0921953',
      client_request_id: '22222222-2222-4222-8222-222222222222',
    });
    expect(presentationControllerMock.transition).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
      state: 'committed',
      runId: '33333333-3333-4333-8333-333333333333',
      revision: 4,
      postInvoked: false,
    });
  });

  it('keeps definitive claim failure committed and retries the same run without reallocating', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    presentationClaimInvokeMock.mockResolvedValueOnce({
      ok: false,
      code: 'LEASE_CONFLICT',
      messageKey: 'conversation.presentationRun.LEASE_CONFLICT',
      retryable: false,
      state: 'committed',
      details: {
        runId: '33333333-3333-4333-8333-333333333333',
        leaseExpiresAt: '2026-08-05T00:01:00.000Z',
      },
    });

    const first = render(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });
    await waitFor(() => expect(presentationClaimInvokeMock).toHaveBeenCalledTimes(1));
    expect(presentationQueueItemsState.current[0]).toMatchObject({
      execution: {
        state: 'committed',
        runId: '33333333-3333-4333-8333-333333333333',
        revision: 4,
        postInvoked: false,
      },
    });
    expect(presentationDispatchInvokeMock).not.toHaveBeenCalled();
    first.unmount();

    presentationGetInvokeMock.mockResolvedValueOnce({
      ok: true,
      run: {
        runId: '33333333-3333-4333-8333-333333333333',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        conversationId: 'd0921953',
        selectedTemplateId: 'business-review',
        revision: 4,
        dispatchStatus: 'committed',
        artifactPhase: 'sources_snapshotted',
        disposition: null,
        retainedCandidate: null,
        actions: { openAllowed: false, discardAllowed: true },
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:01.000Z',
      },
    });
    render(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);

    await waitFor(() => expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(1));
    expect(presentationStartInvokeMock).toHaveBeenCalledTimes(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('does not redispatch a committed local item when main already reports dispatching', async () => {
    featureEnabledState.current = true;
    presentationQueueItemsState.current = [
      presentationQueueItem('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', {
        state: 'committed',
        runId: '33333333-3333-4333-8333-333333333333',
        revision: 4,
        postInvoked: false,
      }),
    ];
    presentationGetInvokeMock.mockResolvedValueOnce({
      ok: true,
      run: {
        runId: '33333333-3333-4333-8333-333333333333',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        conversationId: 'd0921953',
        selectedTemplateId: 'business-review',
        revision: 5,
        dispatchStatus: 'dispatching',
        artifactPhase: 'sources_extracted',
        disposition: null,
        retainedCandidate: null,
        actions: { openAllowed: false, discardAllowed: false },
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:01.000Z',
      },
    });

    render(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);

    await waitFor(() => expect(presentationGetInvokeMock).toHaveBeenCalledTimes(1));
    expect(presentationClaimInvokeMock).not.toHaveBeenCalled();
    expect(presentationDispatchInvokeMock).not.toHaveBeenCalled();
    expect(presentationQueueItemsState.current[0]).toMatchObject({ execution: { state: 'committed' } });
  });

  it.each([
    { status: 'bound', expectedState: null },
    { status: 'dispatch_uncertain', expectedState: 'dispatch_uncertain' },
  ])('reconciles a lost dispatch reply reported as $status without resending', async ({ status, expectedState }) => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    presentationDispatchInvokeMock.mockRejectedValueOnce(new Error('dispatch reply lost'));
    presentationGetInvokeMock.mockResolvedValueOnce({
      ok: true,
      run: {
        runId: '33333333-3333-4333-8333-333333333333',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        conversationId: 'd0921953',
        selectedTemplateId: 'business-review',
        revision: 6,
        dispatchStatus: status,
        artifactPhase: 'sources_extracted',
        disposition: status === 'dispatch_uncertain' ? 'TRACKING_REQUIRED' : null,
        retainedCandidate: null,
        actions: { openAllowed: false, discardAllowed: false },
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:01.000Z',
      },
    });

    render(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    if (expectedState === null) {
      await waitFor(() => expect(presentationQueueItemsState.current).toEqual([]));
      expect(presentationControllerMock.removeBound).toHaveBeenCalledTimes(1);
    } else {
      await waitFor(() =>
        expect(presentationQueueItemsState.current[0]).toMatchObject({ execution: { state: expectedState } })
      );
    }
    expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('keeps dispatch uncertainty observe-only across remount', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    presentationDispatchInvokeMock.mockResolvedValueOnce({
      ok: false,
      code: 'DISPATCH_UNCERTAIN',
      messageKey: 'conversation.presentationRun.DISPATCH_UNCERTAIN',
      retryable: false,
      state: 'dispatch_uncertain',
      details: {
        runId: '33333333-3333-4333-8333-333333333333',
        postInvoked: true,
        queryRequired: true,
      },
    });

    const { unmount } = render(
      <AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />
    );
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });
    await waitFor(() =>
      expect(presentationQueueItemsState.current[0]).toMatchObject({ execution: { state: 'dispatch_uncertain' } })
    );
    unmount();

    render(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);
    await waitFor(() => expect(presentationGetInvokeMock).toHaveBeenCalledTimes(1));
    expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('continues FIFO only after confirmed bound removal', async () => {
    featureEnabledState.current = true;
    presentationQueueItemsState.current = [
      presentationQueueItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
        state: 'bound',
        runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        revision: 8,
      }),
      presentationQueueItem('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', {
        state: 'queued',
      }),
      presentationQueueItem('44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', {
        state: 'queued',
      }),
    ];
    presentationStartInvokeMock
      .mockResolvedValueOnce({
        ok: true,
        run: { runId: '33333333-3333-4333-8333-333333333333', revision: 4 },
      })
      .mockResolvedValueOnce({
        ok: true,
        run: { runId: '66666666-6666-4666-8666-666666666666', revision: 4 },
      });
    presentationClaimInvokeMock.mockImplementation(async (request: { run_id: string }) => ({
      ok: true,
      status: 'claimed',
      runId: request.run_id,
      leaseToken: `lease-${request.run_id}`,
      revision: 5,
      expiresAt: '2026-08-05T00:01:00.000Z',
      renewAfterMs: 10_000,
    }));
    presentationDispatchInvokeMock.mockImplementation(async (request: { run_id: string }) => ({
      ok: true,
      status: 'bound',
      runId: request.run_id,
      conversationId: 'd0921953',
      revision: 6,
      dispatchStatus: 'bound',
    }));

    render(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);

    await waitFor(() => expect(presentationQueueItemsState.current).toEqual([]));
    expect(presentationControllerMock.claimHead.mock.calls.map(([queueItemId]) => queueItemId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444',
    ]);
    expect(presentationStartInvokeMock).toHaveBeenCalledTimes(2);
    expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(2);
  });

  it('preserves a managed initial handoff until the hydrated queue accepts it without legacy send', async () => {
    featureEnabledState.current = true;
    runtimeViewState.current = {
      ...runtimeViewState.current,
      canSendMessage: false,
      isProcessing: true,
      state: 'running',
    };
    const queueItemId = '11111111-1111-4111-8111-111111111111';
    const clientRequestId = '22222222-2222-4222-8222-222222222222';
    const storageKey = 'acp_initial_message_d0921953';
    const serialized = JSON.stringify({
      input: 'Create a presentation from the request below. Managed rules.\n\nInitial deck',
      files: [
        '/private/presentation-templates/business-review/THEME.md',
        '/private/presentation-templates/business-review/reference.pptx',
      ],
      queueItemId,
      clientRequestId,
    });
    const queueAccepted = createDeferred<void>();
    hydrateSourceOwnerMock.mockResolvedValue({
      ok: true,
      owner: currentConversationOwner,
      ownerRevision: 11,
      grants: [
        {
          ...sourceDescriptor,
          grantId: '44444444-4444-4444-8444-444444444444',
        },
      ],
    });
    presentationControllerMock.enqueue.mockImplementationOnce(async (input: Record<string, unknown>) => {
      await queueAccepted.promise;
      const queued = {
        ...input,
        confirmedOwnerRevision: input.expectedOwnerRevision ?? null,
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:00.000Z',
        execution: { state: 'queued' },
      };
      presentationQueueItemsState.current = [queued];
      return queued;
    });
    sendMessageInvokeMock.mockResolvedValue({ turn_id: 'legacy-turn', runtime: null, msg_id: 'legacy-msg' });
    sessionStorage.setItem(storageKey, serialized);

    render(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);

    await waitFor(() =>
      expect(hydrateSourceOwnerMock).toHaveBeenCalledWith({
        owner_type: 'conversation',
        conversation_id: 'd0921953',
      })
    );
    await waitFor(() => expect(presentationControllerMock.enqueue).toHaveBeenCalledTimes(1));
    expect(presentationControllerMock.enqueue).toHaveBeenCalledWith({
      queueItemId,
      clientRequestId,
      input: 'Initial deck',
      selectedTemplateId: 'business-review',
      sources: [
        {
          grantId: '44444444-4444-4444-8444-444444444444',
          expectedByteLength: 42,
          expectedSha256: 'a'.repeat(64),
        },
      ],
      sourceOwner: currentConversationOwner,
      expectedOwnerRevision: 11,
    });
    expect(sessionStorage.getItem(storageKey)).toBe(serialized);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(clearSelectionMock).not.toHaveBeenCalled();
    expect(presentationControllerMock.claimHead).not.toHaveBeenCalled();
    expect(presentationStartInvokeMock).not.toHaveBeenCalled();
    expect(presentationClaimInvokeMock).not.toHaveBeenCalled();
    expect(presentationDispatchInvokeMock).not.toHaveBeenCalled();

    await act(async () => queueAccepted.resolve());

    await waitFor(() => expect(sessionStorage.getItem(storageKey)).toBeNull());
    expect(clearSelectionMock).not.toHaveBeenCalled();
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('keeps the raw legacy send when the managed feature flag is false', async () => {
    featureEnabledState.current = false;
    selectedTemplateState.current = pptxTemplate;
    draftState.current = { atPath: [], uploadFile: ['/private/legacy.xlsx'], content: 'Draft request' };
    sendMessageInvokeMock.mockResolvedValue({ turn_id: 'turn-1', runtime: null, msg_id: 'msg-1' });
    composeSendMock.mockReturnValue({
      input: 'legacy directive\n\nHello',
      files: ['/private/legacy.xlsx', '/private/template/SKILL.md', '/private/template/reference.pptx'],
      injectSkills: ['officecli'],
    });

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1));
    expect(sendMessageInvokeMock).toHaveBeenCalledWith({
      input: 'legacy directive\n\nHello',
      conversation_id: 'd0921953',
      files: ['/private/legacy.xlsx', '/private/template/SKILL.md', '/private/template/reference.pptx'],
    });
    expect(sendBoxProps.current?.managedPresentationSubmission).toBeUndefined();
    expect(clearFilesMock).toHaveBeenCalledTimes(1);
    expect(messageWarningMock).not.toHaveBeenCalled();
  });

  it('routes managed attachment selection through opaque grants and renders only descriptor display names', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceDescriptorsState.current = [sourceDescriptor];

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    await waitFor(() =>
      expect(hydrateSourceOwnerMock).toHaveBeenCalledWith({
        owner_type: 'conversation',
        conversation_id: 'd0921953',
      })
    );
    await act(async () => {
      sendBoxProps.current?.onSlashBuiltinCommand?.('open');
    });
    expect(pickSourcesMock).toHaveBeenCalledTimes(1);
    expect(legacyOpenFileSelectorMock).not.toHaveBeenCalled();
    expect(screen.getByText('quarterly-results.xlsx')).toBeInTheDocument();
    expect(screen.queryByText(sourceDescriptor.sha256)).not.toBeInTheDocument();

    screen.getByRole('button', { name: 'Remove quarterly-results.xlsx' }).click();
    expect(revokeSourceMock).toHaveBeenCalledWith('grant-1');
  });

  it('routes eligible dropped files through opaque grants without creating legacy file metadata', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    const droppedFile = new File(['quarterly results'], 'quarterly-results.xlsx');

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    await act(async () => {
      await sendBoxProps.current?.onManagedDrop?.([droppedFile]);
    });

    expect(grantExternalDropMock).toHaveBeenCalledWith([droppedFile]);
    expect(handleFilesAddedMock).not.toHaveBeenCalled();
    expect(draftState.current.atPath).toEqual([]);
    expect(draftState.current.uploadFile).toEqual([]);
  });

  it('preserves legacy attachments when an eligible managed drop is rejected', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    draftState.current = { atPath: [], uploadFile: ['/private/legacy.xlsx'], content: 'Draft request' };
    grantExternalDropMock.mockResolvedValueOnce({ ok: false });
    const droppedFile = new File(['quarterly results'], 'quarterly-results.xlsx');

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    await act(async () => {
      await sendBoxProps.current?.onManagedDrop?.([droppedFile]);
    });

    expect(grantExternalDropMock).toHaveBeenCalledWith([droppedFile]);
    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(emitterEmitMock).not.toHaveBeenCalledWith('acp.selected.file.clear');
    expect(draftState.current.uploadFile).toEqual(['/private/legacy.xlsx']);
  });

  it('ignores a completed managed drop after eligibility changes', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    draftState.current = { atPath: [], uploadFile: ['/private/legacy.xlsx'], content: 'Draft request' };
    const dropResult = createDeferred<Awaited<ReturnType<typeof grantExternalDropMock>>>();
    grantExternalDropMock.mockReturnValueOnce(dropResult.promise);
    const droppedFile = new File(['quarterly results'], 'quarterly-results.xlsx');

    const { rerender } = render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    let pendingDrop: Promise<void> | void = undefined;
    act(() => {
      pendingDrop = sendBoxProps.current?.onManagedDrop?.([droppedFile]);
    });

    featureEnabledState.current = false;
    rerender(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    await act(async () => {
      dropResult.resolve({ ok: true, status: 'granted', grants: [sourceDescriptor], ownerRevision: 1 });
      await pendingDrop;
    });

    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(emitterEmitMock).not.toHaveBeenCalledWith('acp.selected.file.clear');
    expect(draftState.current.uploadFile).toEqual(['/private/legacy.xlsx']);
  });

  it('keeps shared legacy drop handling when managed presentation input is ineligible', () => {
    featureEnabledState.current = false;
    selectedTemplateState.current = pptxTemplate;

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    expect(sendBoxProps.current?.onManagedDrop).toBeUndefined();
    expect(sendBoxProps.current?.onFilesAdded).toBe(handleFilesAddedMock);
  });

  it('re-hydrates a prior conversation owner before opening the managed picker', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = { owner_type: 'conversation', conversation_id: 'previous-conversation' };
    sourceOwnerRevisionState.current = 4;
    const effectHydration = createDeferred<GetPresentationSourceOwnerResult>();
    const pickerHydration = createDeferred<GetPresentationSourceOwnerResult>();
    hydrateSourceOwnerMock.mockImplementationOnce(() => effectHydration.promise);
    hydrateSourceOwnerMock.mockImplementationOnce(() => pickerHydration.promise);

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    await waitFor(() => expect(hydrateSourceOwnerMock).toHaveBeenCalledTimes(1));

    act(() => {
      sendBoxProps.current?.onSlashBuiltinCommand?.('open');
    });

    expect(hydrateSourceOwnerMock).toHaveBeenCalledTimes(2);
    expect(pickSourcesMock).not.toHaveBeenCalled();
    expect(legacyOpenFileSelectorMock).not.toHaveBeenCalled();

    await act(async () => {
      pickerHydration.resolve(hydratedOwnerResult);
      await pickerHydration.promise;
    });
    await waitFor(() => expect(pickSourcesMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      effectHydration.resolve(hydratedOwnerResult);
      await effectHydration.promise;
    });
  });

  it('keeps raw attachments when current-owner hydration fails during reselect', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    draftState.current = { atPath: [], uploadFile: ['/private/legacy.xlsx'], content: 'Draft request' };
    hydrateSourceOwnerMock.mockResolvedValue(failedOwnerHydration);

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await act(async () => {
      screen.getByRole('button', { name: 'conversation.presentationTemplates.sources.reselectAction' }).click();
    });

    expect(pickSourcesMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(legacyOpenFileSelectorMock).not.toHaveBeenCalled();
    expect(draftState.current.uploadFile).toEqual(['/private/legacy.xlsx']);
  });

  it('removes a stale reselect notice and preserves raw files when navigation changes during the picker', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    draftState.current = { atPath: [], uploadFile: ['/private/legacy.xlsx'], content: 'Draft request' };
    const pickerResult = createDeferred<PickPresentationSourcesResult>();
    pickSourcesMock.mockReturnValueOnce(pickerResult.promise);

    const { rerender } = render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: 'conversation.presentationTemplates.sources.reselectAction' }).click();
    });
    expect(pickSourcesMock).toHaveBeenCalledTimes(1);

    rerender(
      <AcpSendBox
        conversation_id='d0921954'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => {
      pickerResult.resolve({
        ok: true,
        status: 'selected',
        grants: [sourceDescriptor],
        ownerRevision: 1,
      });
      await pickerResult.promise;
    });

    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(emitterEmitMock).not.toHaveBeenCalledWith('acp.selected.file.clear');
    expect(resetSourceDraftMock).toHaveBeenCalled();
    expect(draftState.current.uploadFile).toEqual(['/private/legacy.xlsx']);
  });

  it('hides opaque source tags when eligibility turns off without revoking hook state', () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceDescriptorsState.current = [sourceDescriptor];

    const { rerender } = render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );
    expect(screen.getByText('quarterly-results.xlsx')).toBeInTheDocument();
    expect(sendBoxProps.current?.hasPendingAttachments).toBe(true);

    featureEnabledState.current = false;
    rerender(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    expect(screen.queryByText('quarterly-results.xlsx')).not.toBeInTheDocument();
    expect(sendBoxProps.current?.hasPendingAttachments).toBe(false);
    expect(revokeSourceMock).not.toHaveBeenCalled();
    expect(sourceDescriptorsState.current).toEqual([sourceDescriptor]);
  });

  it('resets ACP loading state when sendMessage fails before any stream error arrives', async () => {
    sendMessageInvokeMock.mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/api/conversations/d0921953/messages',
        status: 400,
        body: {
          success: false,
          code: 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE',
          error: 'Workspace path is unavailable during execution: /tmp/missing',
          details: { workspace_path: '/tmp/missing' },
        },
      })
    );

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='claude'
        workspacePath='/tmp/missing'
        messageState={makeMessageState()}
      />
    );

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => {
      expect(resetStateMock).toHaveBeenCalledTimes(1);
    });
  });

  it('suppresses internal error cards and loading reset for active-turn busy conflicts', async () => {
    sendMessageInvokeMock.mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/api/conversations/d0921953/messages',
        status: 409,
        body: {
          success: false,
          code: 'CONFLICT',
          error: 'conversation d0921953 is already running',
        },
      })
    );

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => {
      expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1);
    });
    expect(addOrUpdateMessageMock).not.toHaveBeenCalled();
    expect(resetStateMock).not.toHaveBeenCalled();
  });

  it('uses container-responsive fluid width instead of a fixed max width', () => {
    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    const wrapper = screen.getByRole('button', { name: 'send' }).parentElement?.parentElement;
    expect(wrapper?.className).toContain('chat-surface-fluid');
    expect(wrapper?.className).not.toContain('w-[calc(100%-24px)]');
    expect(wrapper?.className).not.toContain('md:w-[calc(100%-clamp(80px,10vw,240px))]');
    expect(wrapper?.className).not.toContain('max-w-800px');
  });

  it('uses the full available width in team mode', () => {
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'd0921953',
      allConversationIds: ['d0921953'],
      propagateMode: vi.fn(),
      warmupSession: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    const wrapper = screen.getByRole('button', { name: 'send' }).parentElement?.parentElement;
    expect(wrapper?.className).toContain('w-full');
    expect(wrapper?.className).toContain('max-w-full');
    expect(wrapper?.className).not.toContain('w-[calc(100%-24px)]');
    expect(wrapper?.className).not.toContain('md:w-[calc(100%-clamp(80px,10vw,240px))]');
  });

  it('does not warm up team session on mount or draft content changes', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'd0921953',
      allConversationIds: ['d0921953'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    expect(warmupSession).not.toHaveBeenCalled();

    await act(async () => {
      screen.getByRole('button', { name: 'change' }).click();
    });

    expect(warmupSession).not.toHaveBeenCalled();
  });

  it('does not warm up team session when config options prepare runtime runs', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'd0921953',
      allConversationIds: ['d0921953'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    const configOptionsArgs = useAcpConfigOptionsMock.mock.calls[0]?.[0] as
      | { prepareRuntime?: () => Promise<void> }
      | undefined;
    await configOptionsArgs?.prepareRuntime?.();

    expect(warmupSession).not.toHaveBeenCalled();
  });

  it('still warms up team session before sending a message', async () => {
    sendMessageInvokeMock.mockResolvedValue({ turn_id: 'turn-1', runtime: null, msg_id: 'msg-1' });
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'd0921953',
      allConversationIds: ['d0921953'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps ACP config options enabled on desktop without rendering a standalone thought selector', () => {
    useAcpConfigOptionsMock.mockReturnValue({
      setStatus: { state: 'idle' },
      mode: null,
      model: null,
      thoughtLevel: {
        id: 'reasoning_effort',
        category: 'thought_level',
        currentValue: 'high',
        options: [{ value: 'high', label: 'High' }],
      },
      reload: vi.fn(),
      setConfigOption: vi.fn(),
    });

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    expect(useAcpConfigOptionsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    expect(screen.queryByTestId('mock-thought-selector')).not.toBeInTheDocument();
  });

  it('renders model and permission controls in the composer action row', () => {
    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
        modelSelector={<span data-testid='composer-model-selector'>Model</span>}
      />
    );

    expect(screen.getByTestId('composer-model-selector')).toBeInTheDocument();
    expect(screen.getByTestId('composer-permission-control')).toBeInTheDocument();
  });

  it('renders the context usage meter in right tools with ACP usage data', () => {
    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        messageState={makeMessageState({
          tokenUsage: { total_tokens: 12_000 },
          context_limit: 32_000,
        })}
      />
    );

    expect(screen.getByTestId('context-usage-indicator')).toBeInTheDocument();
    expect(contextUsageIndicatorProps.current).toEqual({
      budget: {
        source: 'runtime',
        totalTokens: 12_000,
        contextLimit: 32_000,
        ratio: 12_000 / 32_000,
        status: 'watch',
      },
      localUsage: { today: 120, weekToDate: 560, monthToDate: 1_240 },
    });
    expect(screen.getByRole('button', { name: 'send' })).toBeInTheDocument();
    expect(sendBoxProps.current).not.toHaveProperty('tokenUsage');
    expect(sendBoxProps.current).not.toHaveProperty('localUsage');
    expect(sendBoxProps.current).not.toHaveProperty('context_limit');
  });

  it('does not invent a context limit when ACP reports zero', () => {
    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        messageState={makeMessageState({
          tokenUsage: { total_tokens: 12_000 },
          context_limit: 0,
        })}
      />
    );

    expect(contextUsageIndicatorProps.current).toEqual({
      budget: {
        source: 'runtime',
        totalTokens: 12_000,
        contextLimit: undefined,
        ratio: null,
        status: 'healthy',
      },
      localUsage: { today: 120, weekToDate: 560, monthToDate: 1_240 },
    });
  });

  it('keeps an unknown-state context usage meter when ACP capacity is unavailable', () => {
    render(<AcpSendBox conversation_id='d0921953' backend='codex' messageState={makeMessageState()} />);

    expect(screen.getByTestId('context-usage-indicator')).toBeInTheDocument();
    expect(contextUsageIndicatorProps.current?.budget.source).toBe('estimated');
    expect(contextUsageIndicatorProps.current?.budget.contextLimit).toBeUndefined();
    expect(contextUsageIndicatorProps.current?.budget.ratio).toBeNull();
  });

  it('applies runtime thought level from the mobile action sheet without persisting a global preference', async () => {
    isMobileMock.current = true;
    const setConfigOption = vi.fn().mockResolvedValue([]);
    useAcpConfigOptionsMock.mockReturnValue({
      mode: null,
      model: null,
      thoughtLevel: {
        id: 'reasoning_effort',
        category: 'thought_level',
        currentValue: 'medium',
        options: [
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
      },
      setStatus: { state: 'idle' },
      setConfigOption,
      reload: vi.fn(),
      isLoading: false,
      configOptions: [],
    });

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    await act(async () => {
      mobileActionSheetEntries.current.find((entry) => entry.key === 'thought-level')?.submenu?.onSelect?.('high');
    });

    // This branch dropped global-preference persistence: only the runtime
    // config option is set; nothing is saved to a global agent preference.
    await waitFor(() => {
      expect(setConfigOption).toHaveBeenCalledWith('reasoning_effort', 'high');
    });
  });

  it('does not apply runtime thought level when observed confirmation fails', async () => {
    isMobileMock.current = true;
    const setConfigOption = vi.fn().mockRejectedValue(new Error('command_ack'));
    useAcpConfigOptionsMock.mockReturnValue({
      mode: null,
      model: null,
      thoughtLevel: {
        id: 'reasoning_effort',
        category: 'thought_level',
        currentValue: 'medium',
        options: [{ value: 'high', label: 'High' }],
      },
      setStatus: { state: 'idle' },
      setConfigOption,
      reload: vi.fn(),
      isLoading: false,
      configOptions: [],
    });

    render(
      <AcpSendBox
        conversation_id='d0921953'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />
    );

    await act(async () => {
      mobileActionSheetEntries.current.find((entry) => entry.key === 'thought-level')?.submenu?.onSelect?.('high');
    });

    await waitFor(() => {
      expect(setConfigOption).toHaveBeenCalledWith('reasoning_effort', 'high');
    });
  });
});
