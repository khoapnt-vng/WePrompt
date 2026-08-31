import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
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
import AionrsSendBox from '@/renderer/pages/conversation/platforms/aionrs/AionrsSendBox';
import type { AionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import {
  clearActiveContextBudget,
  getActiveContextBudget,
} from '@/renderer/pages/conversation/contextHandoff/contextBudget';

type AionrsMessageStateMock = {
  thought: {
    subject: string;
    description: string;
  };
  running: boolean;
  setActiveMsgId: ReturnType<typeof vi.fn>;
  setWaitingResponse: ReturnType<typeof vi.fn>;
  resetState: ReturnType<typeof vi.fn>;
  tokenUsage: { total_tokens: number } | null;
};

type RuntimeViewStateMock = {
  hydrated: boolean;
  canSendMessage: boolean;
  isProcessing: boolean;
  pendingConfirmations: number;
  state: string;
  activeTurnId: string | null;
  markSendStarted: ReturnType<typeof vi.fn>;
  markSendAccepted: ReturnType<typeof vi.fn>;
  markSendFailed: ReturnType<typeof vi.fn>;
  markStopRequested: ReturnType<typeof vi.fn>;
  markStopAcknowledged: ReturnType<typeof vi.fn>;
  resetLocalGate: ReturnType<typeof vi.fn>;
};

type ThoughtDisplayPropsMock = {
  thought?: {
    subject: string;
    description: string;
  };
  running?: boolean;
  awaitingApproval?: boolean;
  onStop?: () => void;
};

type CommandQueuePanelPropsMock = {
  onEdit: (item: Record<string, unknown>) => void;
  onSendNow: (item: Record<string, unknown>) => Promise<void>;
  onRemove: (commandId: string) => void;
  onClear: () => void;
};

type MobileActionSheetEntryMock = {
  key: string;
  submenu?: {
    options: Array<{ key: string; label: string; description?: string; active?: boolean }>;
    onSelect: (value: string) => void;
  };
};

type AgentModeSelectorPropsMock = {
  modeLabelFormatter: (mode: { value: string; label: string }) => string;
};

const {
  aionrsMessageState,
  checkAndUpdateTitleMock,
  createAionrsMessageState,
  createRuntimeViewState,
  emitMock,
  enqueueMock,
  ensureConversationRuntimeMock,
  messageErrorMock,
  runtimeViewState,
  sendMessageInvokeMock,
  thoughtDisplayProps,
  translateMock,
  useTeamPermissionMock,
  setSendBoxHandlerMock,
  markSendFailedMock,
  markSendStartedMock,
  markSendAcceptedMock,
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
  aionrsConfigChangedHandler,
  agentModeSelectorProps,
  classifyConfigSetErrorState,
  commandQueuePanelProps,
  conversationContextState,
  conversationQueueItemsState,
  conversationStopInvokeMock,
  discardScratchMock,
  eventHandlers,
  interruptScratchTurnMock,
  layoutState,
  mergeFileSelectionItemsMock,
  mobileActionSheetProps,
  queueClearMock,
  queuePrioritizeMock,
  queueRemoveMock,
  runtimeConfigState,
  setUploadFileMock,
  templateGalleryState,
  aionrsChatSendBoxProps,
  kbHintProps,
  toolOutcomeProviderValues,
  pendingRecoveryMock,
  updateLocalImageMock,
  useMessageLstCacheMock,
} = vi.hoisted(() => ({
  checkAndUpdateTitleMock: vi.fn(),
  createAionrsMessageState: (): AionrsMessageStateMock => ({
    thought: { subject: '', description: '' },
    running: false,
    setActiveMsgId: vi.fn(),
    setWaitingResponse: vi.fn(),
    resetState: vi.fn(),
    tokenUsage: null,
  }),
  createRuntimeViewState: (): RuntimeViewStateMock => ({
    hydrated: true,
    canSendMessage: true,
    isProcessing: false,
    pendingConfirmations: 0,
    state: 'idle',
    activeTurnId: null,
    markSendStarted: vi.fn(),
    markSendAccepted: vi.fn(),
    markSendFailed: vi.fn(),
    markStopRequested: vi.fn(),
    markStopAcknowledged: vi.fn(),
    resetLocalGate: vi.fn(),
  }),
  emitMock: vi.fn(),
  enqueueMock: vi.fn(),
  ensureConversationRuntimeMock: vi.fn().mockResolvedValue({ recovered: false, config_options: [], runtime: null }),
  messageErrorMock: vi.fn(),
  aionrsMessageState: { current: undefined as AionrsMessageStateMock | undefined },
  runtimeViewState: { current: undefined as RuntimeViewStateMock | undefined },
  sendMessageInvokeMock: vi.fn().mockResolvedValue(undefined),
  thoughtDisplayProps: { current: null as ThoughtDisplayPropsMock | null },
  translateMock: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  useTeamPermissionMock: vi.fn(),
  setSendBoxHandlerMock: vi.fn(),
  markSendFailedMock: vi.fn(),
  markSendStartedMock: vi.fn(),
  markSendAcceptedMock: vi.fn(),
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
      onMobilePlusClick?: () => void;
      onSelectedWorkspaceItemsChange?: (items: unknown[]) => void;
      onStop?: () => Promise<void>;
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
  aionrsConfigChangedHandler: {
    current: null as null | ((capabilities: { modes?: string[] }) => void),
  },
  agentModeSelectorProps: { current: null as AgentModeSelectorPropsMock | null },
  classifyConfigSetErrorState: { current: 'unknown' },
  commandQueuePanelProps: { current: null as CommandQueuePanelPropsMock | null },
  conversationContextState: {
    current: {
      loadedSkills: [] as string[],
      loadedMcpStatuses: [] as Array<{ id: string; name: string; status: string; reason?: string }>,
      loadedMcpServers: [] as string[],
      conversation: {
        id: 'd0921953',
        name: 'AionRS budget fixture',
        type: 'aionrs',
        created_at: 1,
        modified_at: 1,
        extra: { backend: 'aionrs', workspace: '/tmp/aionrs-budget' },
        model: {
          id: 'provider-1',
          name: 'Provider',
          platform: 'openai',
          base_url: '',
          api_key: '',
          use_model: 'gpt-4.1',
        },
      },
    },
  },
  conversationQueueItemsState: { current: [] as Array<Record<string, unknown>> },
  conversationStopInvokeMock: vi.fn().mockResolvedValue({ runtime: null }),
  discardScratchMock: vi.fn().mockResolvedValue(undefined),
  eventHandlers: { current: new Map<string, (...args: unknown[]) => void>() },
  interruptScratchTurnMock: vi.fn().mockResolvedValue(undefined),
  layoutState: { current: { isMobile: false } },
  mergeFileSelectionItemsMock: vi.fn((items: unknown[]) => items),
  mobileActionSheetProps: {
    current: null as null | {
      open: boolean;
      onClose: () => void;
      entries: MobileActionSheetEntryMock[];
    },
  },
  queueClearMock: vi.fn(),
  queuePrioritizeMock: vi.fn(),
  queueRemoveMock: vi.fn(),
  runtimeConfigState: {
    current: {
      setStatus: { state: 'idle' },
      mode: null as null | {
        id: string;
        currentValue: string;
        options: Array<{ value: string; label: string; description?: string | null }>;
      },
      model: null,
      thoughtLevel: null as null | {
        id: string;
        currentValue: string;
        options: Array<{ value: string; label: string; description?: string | null }>;
      },
      reload: vi.fn(),
      setConfigOption: vi.fn().mockResolvedValue(undefined),
    },
  },
  setUploadFileMock: vi.fn(),
  templateGalleryState: {
    current: {
      galleryOpen: false,
      templatesLoading: false,
      templates: [] as PresentationTemplateSummary[],
    },
  },
  aionrsChatSendBoxProps: { current: null as null | Record<string, unknown> },
  kbHintProps: { current: null as null | Record<string, unknown> },
  toolOutcomeProviderValues: { current: [] as unknown[] },
  pendingRecoveryMock: vi.fn(),
  updateLocalImageMock: vi.fn(),
  useMessageLstCacheMock: vi.fn(),
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
    conversation: {
      sendMessage: {
        invoke: sendMessageInvokeMock,
      },
      stop: {
        invoke: conversationStopInvokeMock,
      },
    },
    presentationRuns: {
      start: { invoke: presentationStartInvokeMock },
      get: { invoke: presentationGetInvokeMock },
      claimInitialDispatch: { invoke: presentationClaimInvokeMock },
      dispatch: { invoke: presentationDispatchInvokeMock },
    },
  },
}));

vi.mock('@/renderer/components/chat/SendBox', () => ({
  default: ({
    enableContextCommand,
    onSend,
    onChange,
    onMobilePlusClick,
    onSelectedWorkspaceItemsChange,
    onSlashBuiltinCommand,
    onStop,
    managedPresentationSubmission,
    prefix,
    rightTools,
    ...props
  }: {
    enableContextCommand?: boolean;
    onSend: (message: string) => Promise<void>;
    onChange?: (value: string) => void;
    onMobilePlusClick?: () => void;
    onSelectedWorkspaceItemsChange?: (items: unknown[]) => void;
    onSlashBuiltinCommand?: (name: string) => void;
    onStop?: () => Promise<void>;
    managedPresentationSubmission?: ManagedPresentationSubmission;
    prefix?: React.ReactNode;
    rightTools?: React.ReactNode;
  }) =>
    (() => {
      sendBoxProps.current = {
        ...props,
        managedPresentationSubmission,
        onMobilePlusClick,
        onSelectedWorkspaceItemsChange,
        onSlashBuiltinCommand,
        onStop,
      };
      return (
        <div>
          {rightTools}
          {prefix}
          <span data-testid='context-command-enabled'>{String(Boolean(enableContextCommand))}</span>
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
          <button type='button' onClick={() => void onSend('/context compact').catch(() => {})}>
            compact context
          </button>
          <button type='button' onClick={() => void onSend('/context pin').catch(() => {})}>
            invalid context
          </button>
          <button type='button' onClick={() => void onSend('/context compact later').catch(() => {})}>
            context with arguments
          </button>
          <button type='button' onClick={() => void onSend('/context mystery').catch(() => {})}>
            unsupported context
          </button>
        </div>
      );
    })(),
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({
  default: (props: AgentModeSelectorPropsMock) => {
    agentModeSelectorProps.current = props;
    return <span data-testid='composer-permission-control' />;
  },
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

vi.mock('@/renderer/components/chat/TemplateGallery', () => ({
  TemplateChipCard: ({ template, onRemove }: { template: PresentationTemplateSummary; onRemove: () => void }) => (
    <span data-testid='template-chip-card'>
      {template.manifest.name}
      <button type='button' aria-label='Remove template' onClick={onRemove}>
        remove
      </button>
    </span>
  ),
  TemplateGalleryButton: () => null,
  TemplateGalleryPanel: () => null,
  usePresentationTemplates: () => ({
    templates: templateGalleryState.current.templates,
    templatesLoading: templateGalleryState.current.templatesLoading,
    galleryOpen: templateGalleryState.current.galleryOpen,
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
    interruptScratchTurn: interruptScratchTurnMock,
    discardScratch: discardScratchMock,
  }),
}));
vi.mock('@/renderer/components/chat/CommandQueuePanel', () => ({
  default: (props: CommandQueuePanelPropsMock) => {
    commandQueuePanelProps.current = props;
    return null;
  },
}));
vi.mock('@/renderer/components/chat/MobileActionSheet', () => ({
  default: (props: { open: boolean; onClose: () => void; entries: MobileActionSheetEntryMock[] }) => {
    mobileActionSheetProps.current = props;
    return null;
  },
  useAttachEntry: () => ({ entries: [], hiddenFileInput: null }),
}));
vi.mock('@/renderer/components/chat/ThoughtDisplay', () => ({
  default: (props: ThoughtDisplayPropsMock) => {
    thoughtDisplayProps.current = props;
    if (!props.running && !props.thought?.subject) {
      return null;
    }
    return <div data-testid='thought-display'>processing</div>;
  },
}));
vi.mock('@/renderer/components/media/FileAttachButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FilePreview', () => ({
  default: ({ path, onRemove }: { path: string; onRemove: () => void }) => (
    <button type='button' aria-label={`Remove file ${path}`} onClick={onRemove} />
  ),
}));
vi.mock('@/renderer/components/media/HorizontalFileList', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({
  classifyConfigSetError: () => classifyConfigSetErrorState.current,
  useAcpConfigOptions: () => runtimeConfigState.current,
}));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  ConversationProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useConversationContextSafe: () => conversationContextState.current,
}));
vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  MessageListLoadingProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  MessageListProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  MessagePaginationProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useMessageList: () => [],
  useMessageLstCache: useMessageLstCacheMock,
}));
vi.mock('@/renderer/pages/conversation/Messages/MessageList', () => ({
  default: ({ emptySlot }: { emptySlot?: React.ReactNode }) => <div data-testid='aionrs-message-list'>{emptySlot}</div>,
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary', () => ({
  ToolOutcomeInterpreterProvider: ({ children, value }: { children?: React.ReactNode; value: unknown }) => {
    toolOutcomeProviderValues.current.push(value);
    return <>{children}</>;
  },
}));
vi.mock('@/renderer/pages/conversation/Messages/artifacts', () => ({
  ConversationArtifactProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/renderer/pages/conversation/Messages/usePendingConfirmationsRecovery', () => ({
  usePendingConfirmationsRecovery: pendingRecoveryMock,
}));
vi.mock('@/renderer/pages/conversation/knowledge/KbStaleChatHint', () => ({
  default: (props: Record<string, unknown>) => {
    kbHintProps.current = props;
    return <div data-testid='kb-stale-hint' />;
  },
}));
vi.mock('@/renderer/components/layout/FlexFullContainer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/renderer/components/media/LocalImageView', () => {
  const LocalImageView = () => null;
  LocalImageView.useUpdateLocalImage = () => updateLocalImageMock;
  LocalImageView.Provider = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { default: LocalImageView };
});
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => layoutState.current,
}));
vi.mock('@/renderer/hooks/useLocalTokenUsage', () => ({
  useLocalTokenUsage: () => ({ today: 120, weekToDate: 560, monthToDate: 1_240 }),
}));
vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({
  useAutoTitle: () => ({
    checkAndUpdateTitle: checkAndUpdateTitleMock,
  }),
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
  createSetUploadFile: () => setUploadFileMock,
}));
vi.mock('@/renderer/hooks/chat/useSlashCommands', () => ({
  useSlashCommands: () => [],
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
vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({
  createPresentationCommandQueueController: (options: unknown) => {
    createPresentationControllerMock(options);
    return presentationControllerMock;
  },
  shouldEnqueueConversationCommand: () => false,
  useConversationCommandQueue: () => ({
    items: conversationQueueItemsState.current,
    isPaused: false,
    isInteractionLocked: false,
    hasPendingCommands: false,
    enqueue: enqueueMock,
    remove: queueRemoveMock,
    clear: queueClearMock,
    reorder: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    lockInteraction: vi.fn(),
    unlockInteraction: vi.fn(),
    resetActiveExecution: vi.fn(),
    prioritize: queuePrioritizeMock,
  }),
}));
vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => runtimeViewState.current,
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn().mockResolvedValue({
    extra: {
      workspace: '/tmp/workspace',
    },
  }),
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCreateError', () => ({
  getConversationRuntimeWorkspaceErrorMessage: () => 'workspace failed',
}));
vi.mock('@/renderer/pages/conversation/utils/ensureConversationRuntime', () => ({
  ensureConversationRuntime: ensureConversationRuntimeMock,
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
    emit: emitMock,
  },
  useAddEventListener: (name: string, handler: (...args: unknown[]) => void) => {
    eventHandlers.current.set(name, handler);
  },
}));
vi.mock('@/renderer/utils/file/fileSelection', () => ({
  mergeFileSelectionItems: mergeFileSelectionItemsMock,
}));
vi.mock('@/renderer/utils/file/messageFiles', () => ({
  buildDisplayMessage: (input: string) => input,
  collectSelectedFiles: () => [],
}));
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  ),
  Message: {
    warning: messageWarningMock,
    error: messageErrorMock,
    success: vi.fn(),
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
vi.mock('@icon-park/react', () => ({
  Brain: () => null,
  MagicHat: () => null,
  Shield: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translateMock }),
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsMessage', () => ({
  useAionrsMessage: (_conversationId: string, options: { onConfigChanged: (value: { modes?: string[] }) => void }) => {
    aionrsConfigChangedHandler.current = options.onConfigChanged;
    return aionrsMessageState.current;
  },
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

const presentationRunLookup = (dispatchStatus: string) => ({
  ok: true,
  run: {
    runId: '33333333-3333-4333-8333-333333333333',
    clientRequestId: '22222222-2222-4222-8222-222222222222',
    conversationId: 'd0921953',
    selectedTemplateId: 'business-review',
    revision: 5,
    dispatchStatus,
    artifactPhase: 'sources_extracted',
    disposition: null,
    retainedCandidate: null,
    actions: { openAllowed: false, discardAllowed: false },
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:01.000Z',
  },
});

const modelSelection = {
  current_model: {
    provider_id: 'openai',
    model: 'gpt-4.1',
    use_model: 'openai/gpt-4.1',
  },
} as AionrsModelSelection;

describe('AionrsSendBox', () => {
  beforeEach(() => {
    clearActiveContextBudget('d0921953');
    vi.clearAllMocks();
    sessionStorage.clear();
    aionrsMessageState.current = createAionrsMessageState();
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      markSendStarted: markSendStartedMock,
      markSendAccepted: markSendAcceptedMock,
      markSendFailed: markSendFailedMock,
    };
    thoughtDisplayProps.current = null;
    contextUsageIndicatorProps.current = null;
    sendBoxProps.current = null;
    commandQueuePanelProps.current = null;
    mobileActionSheetProps.current = null;
    aionrsConfigChangedHandler.current = null;
    agentModeSelectorProps.current = null;
    eventHandlers.current.clear();
    draftState.current = { atPath: [], uploadFile: [], content: '' };
    draftMutateMock.mockImplementation((updater: unknown) => {
      if (typeof updater === 'function') {
        draftState.current = (updater as (previous: typeof draftState.current) => typeof draftState.current)(
          draftState.current
        );
      }
      return Promise.resolve(draftState.current);
    });
    setUploadFileMock.mockImplementation((next: string[] | ((previous: string[]) => string[])) => {
      draftState.current = {
        ...draftState.current,
        uploadFile: typeof next === 'function' ? next(draftState.current.uploadFile) : next,
      };
    });
    layoutState.current = { isMobile: false };
    conversationContextState.current = {
      loadedSkills: [],
      loadedMcpStatuses: [],
      loadedMcpServers: [],
      conversation: {
        id: 'd0921953',
        name: 'AionRS budget fixture',
        type: 'aionrs',
        created_at: 1,
        modified_at: 1,
        extra: { backend: 'aionrs', workspace: '/tmp/aionrs-budget' },
        model: {
          id: 'provider-1',
          name: 'Provider',
          platform: 'openai',
          base_url: '',
          api_key: '',
          use_model: 'gpt-4.1',
        },
      },
    };
    conversationQueueItemsState.current = [];
    runtimeConfigState.current = {
      setStatus: { state: 'idle' },
      mode: null,
      model: null,
      thoughtLevel: null,
      reload: vi.fn(),
      setConfigOption: vi.fn().mockResolvedValue(undefined),
    };
    classifyConfigSetErrorState.current = 'unknown';
    templateGalleryState.current = { galleryOpen: false, templatesLoading: false, templates: [] };
    sendMessageInvokeMock.mockResolvedValue({ msg_id: 'msg-1', turn_id: 'turn-1', runtime: null });
    conversationStopInvokeMock.mockResolvedValue({ runtime: null });
    discardScratchMock.mockResolvedValue(undefined);
    interruptScratchTurnMock.mockResolvedValue(undefined);
    queueClearMock.mockClear();
    queuePrioritizeMock.mockClear();
    queueRemoveMock.mockClear();
    mergeFileSelectionItemsMock.mockImplementation((items: unknown[]) => items);
    featureEnabledState.current = false;
    isElectronDesktopMock.mockReturnValue(true);
    selectedTemplateState.current = null;
    sourceDescriptorsState.current = [];
    sourceOwnerState.current = null;
    sourcePendingState.current = false;
    sourceRefsState.current = [];
    presentationQueueItemsState.current = [];
    presentationControllerMock.read.mockImplementation(() => ({
      version: 2,
      conversationId: 'd0921953',
      revision: 1,
      items: presentationQueueItemsState.current,
    }));
    presentationControllerMock.recoverPersisting.mockResolvedValue(undefined);
    presentationControllerMock.enqueue.mockImplementation(async (input: Record<string, unknown>) => {
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
    presentationControllerMock.runCommittedHead.mockImplementation(
      async (execute: (item: unknown) => Promise<void>) => {
        const item = presentationQueueItemsState.current[0];
        if ((item.execution as { state?: string })?.state !== 'committed') return 'not_runnable';
        const execution = item.execution as { runId: string; revision: number };
        const dispatching = {
          ...item,
          execution: { state: 'dispatching', runId: execution.runId, revision: execution.revision },
        };
        presentationQueueItemsState.current = [dispatching, ...presentationQueueItemsState.current.slice(1)];
        await execute(dispatching);
        return 'executed';
      }
    );
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
    sourceOwnerRevisionState.current = null;
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
    ensureConversationRuntimeMock.mockResolvedValue({ recovered: false, config_options: [], runtime: null });
    useTeamPermissionMock.mockReturnValue(null);
  });

  it('lets a human composer interception consume a message before any model turn is submitted', async () => {
    const beforeSend = vi.fn().mockResolvedValue(true);
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} beforeSend={beforeSend} />);

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => expect(beforeSend).toHaveBeenCalledWith({ message: 'Hello', hasAttachments: false }));
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(markSendStartedMock).not.toHaveBeenCalled();
  });

  it('passes attachment authority to an interceptor that declines and preserves the ordinary human send', async () => {
    draftState.current = {
      atPath: [{ path: '/private/reference', name: 'reference', isFile: false }],
      uploadFile: [],
      content: 'Hello',
    };
    const beforeSend = vi.fn().mockResolvedValue(false);
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} beforeSend={beforeSend} />);

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    expect(beforeSend).toHaveBeenCalledWith({ message: 'Hello', hasAttachments: true });
    expect(markSendStartedMock).toHaveBeenCalledTimes(1);
    expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a human composer interceptor rejects', async () => {
    const beforeSend = vi.fn().mockRejectedValue(new Error('review state changed'));
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} beforeSend={beforeSend} />);

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('restores a queued human command for editing and releases its presentation scratch', () => {
    const queued = {
      id: 'queue-1',
      input: 'Revise this turn',
      files: ['/private/a.png', '/private/a.png'],
      artifactScratchRunId: 'scratch-1',
    };
    conversationQueueItemsState.current = [queued];
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    act(() => commandQueuePanelProps.current?.onEdit(queued));

    expect(queueRemoveMock).toHaveBeenCalledWith('queue-1');
    expect(discardScratchMock).toHaveBeenCalledWith('scratch-1');
    expect(setUploadFileMock).toHaveBeenCalledWith(['/private/a.png']);
  });

  it('cleans queued scratch state across remove, clear, and send-now actions', async () => {
    const scratchItem = {
      id: 'queue-1',
      input: 'First',
      files: [],
      artifactScratchRunId: 'scratch-1',
    };
    const plainItem = { id: 'queue-2', input: 'Second', files: [] };
    conversationQueueItemsState.current = [scratchItem, plainItem];
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    act(() => {
      commandQueuePanelProps.current?.onRemove('queue-1');
      commandQueuePanelProps.current?.onRemove('missing');
      commandQueuePanelProps.current?.onClear();
    });
    await act(async () => commandQueuePanelProps.current?.onSendNow(plainItem));

    expect(queueClearMock).toHaveBeenCalledTimes(1);
    expect(queuePrioritizeMock).toHaveBeenCalledWith('queue-2');
    expect(aionrsMessageState.current?.resetState).toHaveBeenCalledTimes(1);
  });

  it('stops the active human turn and acknowledges backend runtime authority', async () => {
    runtimeViewState.current = { ...createRuntimeViewState(), activeTurnId: 'turn-active', state: 'running' };
    conversationStopInvokeMock.mockResolvedValueOnce({ runtime: { status: 'idle' } });
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await act(async () => sendBoxProps.current?.onStop?.());

    expect(interruptScratchTurnMock).toHaveBeenCalledWith('turn-active');
    expect(runtimeViewState.current.markStopRequested).toHaveBeenCalledWith('turn-active');
    expect(runtimeViewState.current.markStopAcknowledged).toHaveBeenCalledWith('turn-active', { status: 'idle' });
  });

  it('resets the local execution gate when active-turn cancellation fails', async () => {
    runtimeViewState.current = { ...createRuntimeViewState(), activeTurnId: 'turn-active', state: 'running' };
    interruptScratchTurnMock.mockRejectedValueOnce(new Error('scratch unavailable'));
    conversationStopInvokeMock.mockRejectedValueOnce(new Error('stop unavailable'));
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await act(async () => sendBoxProps.current?.onStop?.());

    expect(runtimeViewState.current.resetLocalGate).toHaveBeenCalledWith('stop_failed');
    expect(aionrsMessageState.current?.resetState).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes an uppercase short presentation identity without changing the ordinary route identity', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;

    render(<AionrsSendBox conversation_id='D0921953' modelSelection={modelSelection} />);

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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    expect(draftState.current.content).toBe('Hello');
    expect(screen.getByRole('alert')).toHaveTextContent('conversation.presentationTemplates.sources.reselectRequired');
    expect(messageWarningMock).not.toHaveBeenCalled();
    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(prepareScratchMock).not.toHaveBeenCalled();
    expect(sendBoxProps.current?.managedPresentationSubmission).toBeUndefined();
    expect(presentationControllerMock.enqueue).not.toHaveBeenCalled();
    expect(presentationStartInvokeMock).not.toHaveBeenCalled();
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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
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
    draftState.current.content = 'Draft request';

    const { rerender } = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });
    expect(presentationControllerMock.enqueue).not.toHaveBeenCalled();

    sourcePendingState.current = false;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    rerender(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await act(async () => {
      screen.getByRole('button', { name: 'conversation.presentationTemplates.sources.reselectAction' }).click();
    });

    expect(pickSourcesMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalledWith('aionrs.selected.file.clear');
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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await act(async () => {
      screen.getByRole('button', { name: 'conversation.presentationTemplates.sources.reselectAction' }).click();
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(clearFilesMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith('aionrs.selected.file.clear');
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('allows a prompt-only managed-eligible draft to continue', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
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
    expect(presentationDispatchInvokeMock).toHaveBeenCalledWith({
      conversation_id: 'd0921953',
      run_id: '33333333-3333-4333-8333-333333333333',
      lease_token: 'opaque-lease',
      expected_revision: 5,
    });
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(prepareScratchMock).not.toHaveBeenCalled();
    expect(messageWarningMock).not.toHaveBeenCalled();
  });

  it('persists only opaque granted sources before the durable managed claim', async () => {
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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => expect(presentationControllerMock.enqueue).toHaveBeenCalledTimes(1));
    expect(presentationControllerMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: sourceRefsState.current,
        sourceOwner: currentConversationOwner,
        expectedOwnerRevision: 7,
      })
    );
    expect(JSON.stringify(presentationControllerMock.enqueue.mock.calls[0]?.[0])).not.toContain('/private/');
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('preserves the selected template and source state when queue persistence fails', async () => {
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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
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

    expect(clearSelectionMock).not.toHaveBeenCalled();
    expect(resetSourceDraftMock).not.toHaveBeenCalled();
    expect(sourceRefsState.current).toHaveLength(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('keeps a managed submission durably queued without claiming while the runtime is busy', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      hydrated: true,
      canSendMessage: false,
      isProcessing: true,
      state: 'running',
    };

    const { rerender } = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => expect(presentationControllerMock.enqueue).toHaveBeenCalledTimes(1));
    expect(presentationControllerMock.claimHead).not.toHaveBeenCalled();
    expect(presentationStartInvokeMock).not.toHaveBeenCalled();
    expect(presentationDispatchInvokeMock).not.toHaveBeenCalled();
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();

    runtimeViewState.current = createRuntimeViewState();
    rerender(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await waitFor(() => expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(1));
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('keeps opaque granted sources in a busy managed queue without allocating a run', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 9;
    sourceRefsState.current = [
      {
        grantId: '44444444-4444-4444-8444-444444444444',
        expectedByteLength: 42,
        expectedSha256: 'a'.repeat(64),
      },
    ];
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      hydrated: true,
      canSendMessage: false,
      isProcessing: true,
      state: 'running',
    };

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => expect(presentationControllerMock.enqueue).toHaveBeenCalledTimes(1));
    expect(presentationControllerMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: sourceRefsState.current,
        sourceOwner: currentConversationOwner,
        expectedOwnerRevision: 9,
      })
    );
    expect(presentationControllerMock.claimHead).not.toHaveBeenCalled();
    expect(presentationStartInvokeMock).not.toHaveBeenCalled();
  });

  it('queries by the stable client request id before recovering a lost start reply', async () => {
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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
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

  it('keeps a claimed managed item observable when authority lookup temporarily fails', async () => {
    featureEnabledState.current = true;
    presentationQueueItemsState.current = [
      presentationQueueItem('queue-claimed', 'request-claimed', {
        state: 'claimed',
        claimedAt: '2026-08-05T00:00:01.000Z',
      }),
    ];
    presentationGetInvokeMock.mockRejectedValueOnce(new Error('lookup unavailable'));

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() =>
      expect(presentationGetInvokeMock).toHaveBeenCalledWith({
        conversation_id: 'd0921953',
        client_request_id: 'request-claimed',
      })
    );
    expect(presentationControllerMock.transition).not.toHaveBeenCalled();
  });

  it('keeps a claimed managed item unchanged after a definitive lookup failure', async () => {
    featureEnabledState.current = true;
    presentationQueueItemsState.current = [
      presentationQueueItem('queue-claimed', 'request-claimed', {
        state: 'claimed',
        claimedAt: '2026-08-05T00:00:01.000Z',
      }),
    ];
    presentationGetInvokeMock.mockResolvedValueOnce({ ok: false, code: 'LOOKUP_DENIED' });

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(presentationGetInvokeMock).toHaveBeenCalledTimes(1));
    expect(presentationControllerMock.allocateClaimed).not.toHaveBeenCalled();
  });

  it('publishes the persisted claimed item when restart allocation fails', async () => {
    featureEnabledState.current = true;
    presentationQueueItemsState.current = [
      presentationQueueItem('queue-claimed', 'request-claimed', {
        state: 'claimed',
        claimedAt: '2026-08-05T00:00:01.000Z',
      }),
    ];
    presentationControllerMock.allocateClaimed.mockRejectedValueOnce(new Error('allocation failed'));
    presentationGetInvokeMock.mockResolvedValueOnce({ ok: false, code: 'RUN_NOT_FOUND' });

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(presentationControllerMock.allocateClaimed).toHaveBeenCalledTimes(1));
    expect(presentationQueueItemsState.current[0]).toMatchObject({ queueItemId: 'queue-claimed' });
  });

  it.each([
    ['dispatching', 'dispatching'],
    ['bound', 'bound'],
    ['dispatch_uncertain', 'dispatch_uncertain'],
    ['failed', 'bound'],
  ])('recovers a claimed managed item whose main dispatch status is %s', async (dispatchStatus, expectedState) => {
    featureEnabledState.current = true;
    presentationQueueItemsState.current = [
      presentationQueueItem('queue-claimed', 'request-claimed', {
        state: 'claimed',
        claimedAt: '2026-08-05T00:00:01.000Z',
      }),
    ];
    presentationGetInvokeMock.mockResolvedValue(presentationRunLookup(dispatchStatus));

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() =>
      expect(presentationControllerMock.transition).toHaveBeenCalledWith(
        'queue-claimed',
        expect.objectContaining({ state: expectedState })
      )
    );
  });

  it.each([
    ['dispatch_uncertain', 'dispatch_uncertain'],
    ['allocating', 'dispatching'],
    ['committed', 'dispatching'],
    ['dispatching', 'dispatching'],
    ['bound', 'bound'],
  ])('observes a dispatching managed item whose main status is %s', async (dispatchStatus, expectedState) => {
    featureEnabledState.current = true;
    presentationQueueItemsState.current = [
      presentationQueueItem('queue-dispatching', 'request-dispatching', {
        state: 'dispatching',
        runId: '33333333-3333-4333-8333-333333333333',
        revision: 4,
      }),
    ];
    presentationGetInvokeMock.mockResolvedValue(presentationRunLookup(dispatchStatus));

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() =>
      expect(presentationGetInvokeMock).toHaveBeenCalledWith({
        conversation_id: 'd0921953',
        run_id: '33333333-3333-4333-8333-333333333333',
      })
    );
    if (expectedState !== 'dispatching') {
      expect(presentationControllerMock.transition).toHaveBeenCalledWith(
        'queue-dispatching',
        expect.objectContaining({ state: expectedState })
      );
    }
  });

  it('keeps a definitive claim failure in safe committed state without dispatching or allocating another run', async () => {
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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => expect(presentationClaimInvokeMock).toHaveBeenCalledTimes(1));
    expect(presentationQueueItemsState.current[0]).toMatchObject({
      queueItemId: '11111111-1111-4111-8111-111111111111',
      clientRequestId: '22222222-2222-4222-8222-222222222222',
      execution: {
        state: 'committed',
        runId: '33333333-3333-4333-8333-333333333333',
        revision: 4,
        postInvoked: false,
      },
    });
    expect(presentationDispatchInvokeMock).not.toHaveBeenCalled();
    expect(presentationStartInvokeMock).toHaveBeenCalledTimes(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('retries the same committed run after a definitive no-POST dispatch response without starting another run', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    presentationDispatchInvokeMock.mockResolvedValueOnce({
      ok: false,
      code: 'BACKEND_PREFLIGHT_BLOCKED',
      messageKey: 'conversation.presentationRun.BACKEND_PREFLIGHT_BLOCKED',
      retryable: true,
      state: 'committed',
      details: {
        runId: '33333333-3333-4333-8333-333333333333',
        retryAfterMs: 1_000,
        postInvoked: false,
      },
    });

    const first = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });
    await waitFor(() => expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(1));
    first.unmount();

    presentationGetInvokeMock.mockResolvedValueOnce({
      ok: true,
      run: {
        runId: '33333333-3333-4333-8333-333333333333',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        conversationId: 'd0921953',
        selectedTemplateId: 'business-review',
        revision: 5,
        dispatchStatus: 'committed',
        artifactPhase: 'sources_snapshotted',
        disposition: null,
        retainedCandidate: null,
        actions: { openAllowed: false, discardAllowed: true },
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:01.000Z',
      },
    });
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(2));
    expect(presentationStartInvokeMock).toHaveBeenCalledTimes(1);
    expect(presentationControllerMock.enqueue).toHaveBeenCalledTimes(1);
    expect(presentationQueueItemsState.current).toEqual([]);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('does not redispatch a persisted committed item when main authority already reports dispatching', async () => {
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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(presentationGetInvokeMock).toHaveBeenCalledTimes(1));
    expect(presentationClaimInvokeMock).not.toHaveBeenCalled();
    expect(presentationDispatchInvokeMock).not.toHaveBeenCalled();
    expect(presentationQueueItemsState.current[0]).toMatchObject({
      queueItemId: '11111111-1111-4111-8111-111111111111',
      execution: { state: 'committed', runId: '33333333-3333-4333-8333-333333333333' },
    });
  });

  it('reconciles a lost dispatch reply reported as bound without resending', async () => {
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
        dispatchStatus: 'bound',
        artifactPhase: 'sources_extracted',
        disposition: null,
        retainedCandidate: null,
        actions: { openAllowed: false, discardAllowed: false },
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:01.000Z',
      },
    });

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => expect(presentationQueueItemsState.current).toEqual([]));
    expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(1);
    expect(presentationControllerMock.removeBound).toHaveBeenCalledTimes(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('reconciles a lost dispatch reply reported as uncertain without resending', async () => {
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
        dispatchStatus: 'dispatch_uncertain',
        artifactPhase: 'sources_extracted',
        disposition: 'TRACKING_REQUIRED',
        retainedCandidate: null,
        actions: { openAllowed: false, discardAllowed: false },
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:01.000Z',
      },
    });

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() =>
      expect(presentationQueueItemsState.current[0]).toMatchObject({
        queueItemId: '11111111-1111-4111-8111-111111111111',
        execution: {
          state: 'dispatch_uncertain',
          runId: '33333333-3333-4333-8333-333333333333',
          revision: 6,
        },
      })
    );
    expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('continues FIFO draining after confirmed bound cleanup without double-claiming a successor', async () => {
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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(presentationQueueItemsState.current).toEqual([]));
    expect(presentationControllerMock.claimHead.mock.calls.map(([queueItemId]) => queueItemId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444',
    ]);
    expect(presentationStartInvokeMock).toHaveBeenCalledTimes(2);
    expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(2);
  });

  it('keeps dispatch uncertainty pending and observe-only without a renderer backend resend', async () => {
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

    const { unmount } = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() =>
      expect(presentationControllerMock.transition).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
        state: 'dispatch_uncertain',
        runId: '33333333-3333-4333-8333-333333333333',
        revision: null,
      })
    );
    expect(sendBoxProps.current?.managedPresentationSubmission?.progress).toEqual({
      queueItemId: '11111111-1111-4111-8111-111111111111',
      progress: {
        state: 'dispatch_uncertain',
        runId: '33333333-3333-4333-8333-333333333333',
        revision: null,
      },
    });

    unmount();
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await waitFor(() => expect(presentationGetInvokeMock).toHaveBeenCalledTimes(1));
    expect(presentationDispatchInvokeMock).toHaveBeenCalledTimes(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('keeps the create-project first message stored until runtime and queue readiness are available', async () => {
    const storageKey = 'aionrs_initial_message_d0921953';
    const initialMessage = JSON.stringify({ input: 'Build the project BRD.', files: ['/brief.md'] });
    const runtimeReady = createDeferred<{ recovered: boolean; config_options: never[]; runtime: null }>();
    ensureConversationRuntimeMock.mockReturnValueOnce(runtimeReady.promise);
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      hydrated: false,
      canSendMessage: false,
    };
    sendMessageInvokeMock.mockResolvedValueOnce({ msg_id: 'msg-1', turn_id: 'turn-1', runtime: null });
    sessionStorage.setItem(storageKey, initialMessage);

    const { rerender } = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('d0921953'));
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBe(initialMessage);

    await act(async () => {
      runtimeReady.resolve({ recovered: false, config_options: [], runtime: null });
      await runtimeReady.promise;
    });
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBe(initialMessage);

    runtimeViewState.current = createRuntimeViewState();
    rerender(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1));
  });

  it('consumes the create-project first message only after the backend accepts the turn', async () => {
    const storageKey = 'aionrs_initial_message_d0921953';
    const processedKey = 'aionrs_initial_processed_d0921953';
    const initialMessage = JSON.stringify({ input: 'Build the project BRD.', files: ['/brief.md'] });
    const accepted = createDeferred<{ msg_id: string; turn_id: string; runtime: null }>();
    sendMessageInvokeMock.mockReturnValueOnce(accepted.promise);
    sessionStorage.setItem(storageKey, initialMessage);

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(storageKey)).toBe(initialMessage);
    expect(sessionStorage.getItem(processedKey)).toBeNull();

    await act(async () => {
      accepted.resolve({ msg_id: 'msg-1', turn_id: 'turn-1', runtime: null });
      await accepted.promise;
    });

    await waitFor(() => expect(sessionStorage.getItem(storageKey)).toBeNull());
    expect(sessionStorage.getItem(processedKey)).toBe('1');
    expect(markSendAcceptedMock).toHaveBeenCalledWith('turn-1', null, 'msg-1');
  });

  it('preserves a failed create-project first message and retries it after remount', async () => {
    const storageKey = 'aionrs_initial_message_d0921953';
    const processedKey = 'aionrs_initial_processed_d0921953';
    const initialMessage = JSON.stringify({ input: 'Build the project BRD.', files: ['/brief.md'] });
    sendMessageInvokeMock
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockResolvedValueOnce({ msg_id: 'msg-2', turn_id: 'turn-2', runtime: null });
    sessionStorage.setItem(storageKey, initialMessage);

    const firstRender = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(messageErrorMock).toHaveBeenCalledWith('workspace failed'));
    expect(sessionStorage.getItem(storageKey)).toBe(initialMessage);
    expect(sessionStorage.getItem(processedKey)).toBeNull();

    firstRender.unmount();
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(sessionStorage.getItem(storageKey)).toBeNull());
    expect(sessionStorage.getItem(processedKey)).toBe('1');
  });

  it('does not double-submit the create-project first message across rerenders or remounts while acceptance is pending', async () => {
    const storageKey = 'aionrs_initial_message_d0921953';
    const initialMessage = JSON.stringify({ input: 'Build the project BRD.', files: ['/brief.md'] });
    const accepted = createDeferred<{ msg_id: string; turn_id: string; runtime: null }>();
    sendMessageInvokeMock.mockReturnValueOnce(accepted.promise);
    sessionStorage.setItem(storageKey, initialMessage);

    const firstRender = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1));

    firstRender.rerender(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    firstRender.rerender(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    firstRender.unmount();
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(storageKey)).toBe(initialMessage);

    await act(async () => {
      accepted.resolve({ msg_id: 'msg-1', turn_id: 'turn-1', runtime: null });
      await accepted.promise;
    });

    await waitFor(() => expect(sessionStorage.getItem(storageKey)).toBeNull());
  });

  it('routes a prompt-only managed initial message through the persistent queue while the runtime is busy', async () => {
    featureEnabledState.current = true;
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      canSendMessage: false,
      isProcessing: true,
      state: 'running',
    };
    sessionStorage.setItem(
      'aionrs_initial_message_d0921953',
      JSON.stringify({
        input: 'Create a presentation from the request below. Managed rules.\n\nInitial deck',
        files: [
          '/private/presentation-templates/business-review/THEME.md',
          '/private/presentation-templates/business-review/reference.pptx',
        ],
        injectSkills: ['officecli'],
      })
    );

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(presentationControllerMock.enqueue).toHaveBeenCalledTimes(1));
    const initial = presentationControllerMock.enqueue.mock.calls[0]?.[0] as {
      queueItemId: string;
      clientRequestId: string;
      input: string;
      selectedTemplateId: string;
      sources: unknown[];
    };
    expect(initial).toMatchObject({
      input: 'Initial deck',
      selectedTemplateId: 'business-review',
      sources: [],
    });
    expect(initial.queueItemId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(initial.clientRequestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(sessionStorage.getItem('aionrs_initial_processed_d0921953')).toBe('1');
    expect(presentationControllerMock.claimHead).not.toHaveBeenCalled();
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('hydrates and persists opaque grants before routing a managed initial message', async () => {
    featureEnabledState.current = true;
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
    sessionStorage.setItem(
      'aionrs_initial_message_d0921953',
      JSON.stringify({
        input: 'Create a presentation from the request below. Managed rules.\n\nInitial sourced deck',
        files: [
          '/private/presentation-templates/business-review/THEME.md',
          '/private/presentation-templates/business-review/reference.pptx',
        ],
        injectSkills: ['officecli'],
      })
    );

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(presentationControllerMock.enqueue).toHaveBeenCalledTimes(1));
    expect(presentationControllerMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'Initial sourced deck',
        sources: [
          {
            grantId: '44444444-4444-4444-8444-444444444444',
            expectedByteLength: 42,
            expectedSha256: 'a'.repeat(64),
          },
        ],
        sourceOwner: currentConversationOwner,
        expectedOwnerRevision: 11,
      })
    );
    expect(JSON.stringify(presentationControllerMock.enqueue.mock.calls[0]?.[0])).not.toContain('/private/');
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'a string', files: '/private/presentation-templates/business-review/THEME.md' },
    { name: 'an object', files: { path: '/private/presentation-templates/business-review/THEME.md' } },
    {
      name: 'a mixed array',
      files: [
        '/private/presentation-templates/business-review/THEME.md',
        { path: '/private/presentation-templates/business-review/reference.pptx' },
      ],
    },
  ])('fails closed for a managed initial handoff whose files value is $name', async ({ files }) => {
    featureEnabledState.current = true;
    const storageKey = 'aionrs_initial_message_d0921953';
    const serialized = JSON.stringify({
      input: 'Create a presentation from the request below. Managed rules.\n\nInitial deck',
      files,
      injectSkills: ['officecli'],
    });
    sendMessageInvokeMock.mockResolvedValue({ turn_id: 'legacy-turn', runtime: null, msg_id: 'legacy-msg' });
    sessionStorage.setItem(storageKey, serialized);

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(sessionStorage.getItem(storageKey)).toBe(serialized);
    expect(sessionStorage.getItem('aionrs_initial_processed_d0921953')).toBeNull();
    expect(presentationControllerMock.enqueue).not.toHaveBeenCalled();
    expect(presentationControllerMock.claimHead).not.toHaveBeenCalled();
    expect(presentationStartInvokeMock).not.toHaveBeenCalled();
    expect(presentationClaimInvokeMock).not.toHaveBeenCalled();
    expect(presentationDispatchInvokeMock).not.toHaveBeenCalled();
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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1));
    expect(sendMessageInvokeMock).toHaveBeenCalledWith({
      input: 'legacy directive\n\nHello',
      conversation_id: 'd0921953',
      files: ['/private/legacy.xlsx', '/private/template/SKILL.md', '/private/template/reference.pptx'],
      pinned_context: [],
      inject_skills: ['officecli'],
    });
    expect(sendBoxProps.current?.managedPresentationSubmission).toBeUndefined();
    expect(clearFilesMock).toHaveBeenCalledTimes(1);
    expect(messageWarningMock).not.toHaveBeenCalled();
  });

  it('routes managed attachment selection through opaque grants and renders only descriptor display names', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceDescriptorsState.current = [sourceDescriptor];

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await act(async () => {
      await sendBoxProps.current?.onManagedDrop?.([droppedFile]);
    });

    expect(grantExternalDropMock).toHaveBeenCalledWith([droppedFile]);
    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalledWith('aionrs.selected.file.clear');
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

    const { rerender } = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    let pendingDrop: Promise<void> | void = undefined;
    act(() => {
      pendingDrop = sendBoxProps.current?.onManagedDrop?.([droppedFile]);
    });

    featureEnabledState.current = false;
    rerender(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      dropResult.resolve({ ok: true, status: 'granted', grants: [sourceDescriptor], ownerRevision: 1 });
      await pendingDrop;
    });

    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalledWith('aionrs.selected.file.clear');
    expect(draftState.current.uploadFile).toEqual(['/private/legacy.xlsx']);
  });

  it('keeps shared legacy drop handling when managed presentation input is ineligible', () => {
    featureEnabledState.current = false;
    selectedTemplateState.current = pptxTemplate;

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(sendBoxProps.current?.onManagedDrop).toBeUndefined();
    expect(sendBoxProps.current?.onFilesAdded).toBe(handleFilesAddedMock);
  });

  it('waits for current-owner hydration before opening the managed picker', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    const effectHydration = createDeferred<GetPresentationSourceOwnerResult>();
    const pickerHydration = createDeferred<GetPresentationSourceOwnerResult>();
    hydrateSourceOwnerMock.mockImplementationOnce(() => effectHydration.promise);
    hydrateSourceOwnerMock.mockImplementationOnce(() => pickerHydration.promise);

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
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

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
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

  it('does not continue an old picker request after navigation during owner hydration', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    const effectHydration = createDeferred<GetPresentationSourceOwnerResult>();
    const pickerHydration = createDeferred<GetPresentationSourceOwnerResult>();
    hydrateSourceOwnerMock.mockImplementationOnce(() => effectHydration.promise);
    hydrateSourceOwnerMock.mockImplementationOnce(() => pickerHydration.promise);

    const { rerender } = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await waitFor(() => expect(hydrateSourceOwnerMock).toHaveBeenCalledTimes(1));
    act(() => {
      sendBoxProps.current?.onSlashBuiltinCommand?.('open');
    });
    expect(hydrateSourceOwnerMock).toHaveBeenCalledTimes(2);

    rerender(<AionrsSendBox conversation_id='d0921954' modelSelection={modelSelection} />);
    await act(async () => {
      pickerHydration.resolve(hydratedOwnerResult);
      await pickerHydration.promise;
    });

    expect(pickSourcesMock).not.toHaveBeenCalled();
    expect(legacyOpenFileSelectorMock).not.toHaveBeenCalled();
    expect(resetSourceDraftMock).toHaveBeenCalled();

    await act(async () => {
      effectHydration.resolve(hydratedOwnerResult);
      await effectHydration.promise;
    });
  });

  it('removes a stale reselect notice and preserves raw files when eligibility changes during the picker', async () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceOwnerState.current = currentConversationOwner;
    sourceOwnerRevisionState.current = 0;
    draftState.current = { atPath: [], uploadFile: ['/private/legacy.xlsx'], content: 'Draft request' };
    const pickerResult = createDeferred<PickPresentationSourcesResult>();
    pickSourcesMock.mockReturnValueOnce(pickerResult.promise);

    const { rerender } = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: 'conversation.presentationTemplates.sources.reselectAction' }).click();
    });
    expect(pickSourcesMock).toHaveBeenCalledTimes(1);

    featureEnabledState.current = false;
    rerender(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
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
    expect(emitMock).not.toHaveBeenCalledWith('aionrs.selected.file.clear');
    expect(draftState.current.uploadFile).toEqual(['/private/legacy.xlsx']);
  });

  it('hides opaque source tags when eligibility turns off without revoking hook state', () => {
    featureEnabledState.current = true;
    selectedTemplateState.current = pptxTemplate;
    sourceDescriptorsState.current = [sourceDescriptor];

    const { rerender } = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    expect(screen.getByText('quarterly-results.xlsx')).toBeInTheDocument();
    expect(sendBoxProps.current?.hasPendingAttachments).toBe(true);

    featureEnabledState.current = false;
    rerender(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(screen.queryByText('quarterly-results.xlsx')).not.toBeInTheDocument();
    expect(sendBoxProps.current?.hasPendingAttachments).toBe(false);
    expect(revokeSourceMock).not.toHaveBeenCalled();
    expect(sourceDescriptorsState.current).toEqual([sourceDescriptor]);
  });

  it('does not warm up team session when draft content changes', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'd0921953',
      allConversationIds: ['d0921953'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalled();
    });
    warmupSession.mockClear();

    await act(async () => {
      screen.getByRole('button', { name: 'change' }).click();
    });

    expect(warmupSession).not.toHaveBeenCalled();
  });

  it('still warms up team session before sending', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'd0921953',
      allConversationIds: ['d0921953'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalled();
    });
    warmupSession.mockClear();

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalledTimes(1);
    });
  });

  it('does not start standalone runtime while preparing a team conversation', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'd0921953',
      allConversationIds: ['d0921953'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalled();
    });
    expect(ensureConversationRuntimeMock).not.toHaveBeenCalled();
  });

  it('uses runtime ensure instead of legacy warmup for standalone runtime preparation', async () => {
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => {
      expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('d0921953');
    });
  });

  it('reports a standalone runtime preparation failure without warming the composer', async () => {
    ensureConversationRuntimeMock.mockRejectedValueOnce(new Error('workspace unavailable'));

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await waitFor(() => expect(messageErrorMock).toHaveBeenCalledWith('workspace failed'));
  });

  it('uses the supplied team transport for an ordinary human message', async () => {
    const teamSendMessage = vi.fn().mockResolvedValue(undefined);
    render(
      <AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} teamSendMessage={teamSendMessage} />
    );

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    expect(teamSendMessage).toHaveBeenCalledWith({ input: 'Hello', files: [] });
    expect(markSendStartedMock).not.toHaveBeenCalled();
  });

  it('suppresses visible error and preserves runtime gate for active-turn busy conflicts', async () => {
    sendMessageInvokeMock.mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/api/conversations/d0921953/messages',
        status: 409,
        body: { success: false, code: 'CONFLICT', error: 'conversation d0921953 is already running' },
      })
    );

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);
    await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('d0921953'));

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => {
      expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1);
    });
    expect(markSendFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'busy_conflict', busyKind: 'active_turn' })
    );
    expect(Message.error).not.toHaveBeenCalled();
  });

  it('exposes complete mobile model, permission, thought, skill, and MCP actions', async () => {
    layoutState.current = { isMobile: true };
    conversationContextState.current = {
      ...conversationContextState.current,
      loadedSkills: ['slides'],
      loadedMcpStatuses: [
        { id: 'mcp-loaded', name: 'Loaded MCP', status: 'loaded' },
        { id: 'mcp-reason', name: 'Failed MCP', status: 'failed', reason: 'offline' },
        { id: 'mcp-plain', name: 'Plain failure', status: 'failed' },
      ],
    };
    const propagateMode = vi.fn();
    useTeamPermissionMock.mockReturnValue({
      warmupSession: vi.fn().mockResolvedValue(undefined),
      propagateMode,
    });
    const setConfigOption = vi.fn().mockResolvedValue(undefined);
    runtimeConfigState.current = {
      ...runtimeConfigState.current,
      mode: {
        id: 'permission-mode',
        currentValue: 'auto_edit',
        options: [
          { value: 'auto_edit', label: 'Auto', description: 'Review edits' },
          { value: 'yolo', label: 'Full access', description: null },
        ],
      },
      thoughtLevel: {
        id: 'thought-level',
        currentValue: 'high',
        options: [
          { value: 'high', label: 'High', description: 'Think longer' },
          { value: 'low', label: 'Low', description: null },
        ],
      },
      setConfigOption,
    };
    const provider = {
      id: 'provider-1',
      name: 'Provider',
      platform: 'openai',
      base_url: '',
      api_key: '',
      models: ['gpt-4.1', 'gpt-4.1-mini'],
    };
    const handleSelectModel = vi.fn().mockResolvedValue(undefined);
    const mobileModelSelection = {
      current_model: { ...provider, use_model: 'gpt-4.1' },
      providers: [provider],
      getAvailableModels: () => ['gpt-4.1', 'gpt-4.1-mini'],
      handleSelectModel,
      getDisplayModelName: (name?: string) => name ?? '',
    } as AionrsModelSelection;

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={mobileModelSelection} />);
    await act(async () => {
      aionrsConfigChangedHandler.current?.({});
      aionrsConfigChangedHandler.current?.({ modes: [] });
      aionrsConfigChangedHandler.current?.({ modes: ['deep_mode'] });
    });

    act(() => sendBoxProps.current?.onMobilePlusClick?.());
    await waitFor(() => expect(mobileActionSheetProps.current?.open).toBe(true));
    const entries = mobileActionSheetProps.current?.entries ?? [];
    expect(entries.map((entry) => entry.key)).toEqual(['model', 'thought-level', 'permission', 'skills', 'mcp']);

    const permission = entries.find((entry) => entry.key === 'permission')?.submenu;
    permission?.onSelect('auto_edit');
    expect(setConfigOption).not.toHaveBeenCalled();
    for (const errorKind of ['command_ack', 'confirmation_timeout', 'config_update_in_progress', 'unknown']) {
      classifyConfigSetErrorState.current = errorKind;
      setConfigOption.mockRejectedValueOnce(new Error(errorKind));
      await act(async () => permission?.onSelect('yolo'));
    }
    setConfigOption.mockResolvedValueOnce(undefined);
    await act(async () => permission?.onSelect('yolo'));
    expect(propagateMode).toHaveBeenCalledWith('yolo');

    const model = entries.find((entry) => entry.key === 'model')?.submenu;
    model?.onSelect('missing::gpt-4.1');
    model?.onSelect('provider-1::');
    model?.onSelect('provider-1::gpt-4.1-mini');
    expect(handleSelectModel).toHaveBeenCalledWith(provider, 'gpt-4.1-mini');

    const thought = entries.find((entry) => entry.key === 'thought-level')?.submenu;
    await act(async () => thought?.onSelect('low'));
    entries.find((entry) => entry.key === 'skills')?.submenu?.onSelect('slides');
    entries.find((entry) => entry.key === 'mcp')?.submenu?.onSelect('mcp-loaded');
    expect(draftState.current.content).toBe('/slides ');

    act(() => mobileActionSheetProps.current?.onClose());
    await waitFor(() => expect(mobileActionSheetProps.current?.open).toBe(false));
  });

  it('uses mobile fallback modes and a select-model prompt without runtime options', () => {
    layoutState.current = { isMobile: true };
    const noModelSelection = {
      current_model: undefined,
      providers: [],
      getAvailableModels: () => [],
      handleSelectModel: vi.fn(),
      getDisplayModelName: () => '',
    } as AionrsModelSelection;

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={noModelSelection} />);

    const entries = mobileActionSheetProps.current?.entries ?? [];
    const permissionOptions = entries.find((entry) => entry.key === 'permission')?.submenu?.options ?? [];
    expect(permissionOptions.map((option) => option.key)).toEqual(['default', 'auto_edit', 'yolo']);
    expect(entries.find((entry) => entry.key === 'model')).toBeDefined();
  });

  it('keeps file, folder, template, event, and mode controls wired to their owners', () => {
    const initialAtPath = [
      '/private/string-file.txt',
      { path: '/private/folder', name: 'Folder', isFile: false },
      { path: '/private/object-file.txt', name: 'Object file', isFile: true },
    ];
    draftState.current = {
      atPath: initialAtPath,
      uploadFile: ['/private/upload-a.png', '/private/upload-b.png'],
      content: 'Draft',
    };
    conversationContextState.current = {
      ...conversationContextState.current,
      loadedMcpStatuses: undefined as unknown as [],
      loadedMcpServers: ['filesystem'],
    };
    selectedTemplateState.current = pptxTemplate;
    templateGalleryState.current = { galleryOpen: true, templatesLoading: true, templates: [pptxTemplate] };
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    screen.getByRole('button', { name: 'Remove file /private/upload-a.png' }).click();
    screen.getByRole('button', { name: 'Remove Folder' }).click();
    screen.getByRole('button', { name: 'Remove template' }).click();
    act(() => sendBoxProps.current?.onSelectedWorkspaceItemsChange?.(['/private/replaced.txt']));

    const merged = [...initialAtPath, '/private/appended.txt'];
    mergeFileSelectionItemsMock.mockReturnValueOnce(merged);
    act(() => eventHandlers.current.get('aionrs.selected.file.append')?.(['/private/appended.txt']));
    mergeFileSelectionItemsMock.mockReturnValueOnce(initialAtPath);
    act(() => eventHandlers.current.get('aionrs.selected.file.append')?.(['/private/duplicate.txt']));

    expect(agentModeSelectorProps.current?.modeLabelFormatter({ value: 'auto_edit', label: 'Auto' })).toBe(
      'agentMode.auto'
    );
    expect(agentModeSelectorProps.current?.modeLabelFormatter({ value: 'yolo', label: 'Full' })).toBe(
      'agentMode.full-access'
    );
    expect(agentModeSelectorProps.current?.modeLabelFormatter({ value: 'default', label: 'Default label' })).toBe(
      'Default label'
    );
  });

  it('renders model and permission controls in the composer action row', () => {
    render(
      <AionrsSendBox
        conversation_id='d0921953'
        modelSelection={modelSelection}
        modelSelector={<span data-testid='composer-model-selector'>Model</span>}
      />
    );

    expect(screen.getByTestId('composer-model-selector')).toBeInTheDocument();
    expect(screen.getByTestId('composer-permission-control')).toBeInTheDocument();
  });

  it('renders the context usage meter in right tools with AionRS usage data', () => {
    aionrsMessageState.current = {
      ...createAionrsMessageState(),
      tokenUsage: { total_tokens: 12_000 },
    };

    const miniMaxSelection = {
      current_model: {
        provider_id: 'minimax',
        model: 'MiniMax-M2.5',
        use_model: 'minimax/MiniMax-M2.5',
      },
    } as AionrsModelSelection;

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={miniMaxSelection} />);

    expect(screen.getByTestId('context-usage-indicator')).toBeInTheDocument();
    expect(contextUsageIndicatorProps.current).toEqual({
      budget: {
        source: 'runtime',
        totalTokens: 12_000,
        contextLimit: 204_800,
        ratio: 12_000 / 204_800,
        status: 'healthy',
      },
      localUsage: { today: 120, weekToDate: 560, monthToDate: 1_240 },
    });
    expect(screen.getByRole('button', { name: 'send' })).toBeInTheDocument();
    expect(sendBoxProps.current).not.toHaveProperty('tokenUsage');
    expect(sendBoxProps.current).not.toHaveProperty('localUsage');
    expect(sendBoxProps.current).not.toHaveProperty('context_limit');
  });

  it('publishes, updates, and clears the composer budget synchronously for sibling surfaces', () => {
    aionrsMessageState.current = {
      ...createAionrsMessageState(),
      tokenUsage: { total_tokens: 110_000 },
    };

    const { rerender, unmount } = render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(getActiveContextBudget('d0921953')).toEqual(contextUsageIndicatorProps.current?.budget);

    aionrsMessageState.current = {
      ...createAionrsMessageState(),
      tokenUsage: { total_tokens: 220_000 },
    };
    rerender(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(getActiveContextBudget('d0921953')).toEqual(contextUsageIndicatorProps.current?.budget);
    expect(getActiveContextBudget('d0921953')?.totalTokens).toBe(220_000);

    unmount();
    expect(getActiveContextBudget('d0921953')).toBeUndefined();
  });

  it('renders an estimated context usage meter when AionRS runtime usage is unavailable', () => {
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(screen.getByTestId('context-usage-indicator')).toBeInTheDocument();
    expect(contextUsageIndicatorProps.current?.budget.source).toBe('estimated');
    expect(contextUsageIndicatorProps.current?.budget.contextLimit).toBe(1_047_576);
    expect(contextUsageIndicatorProps.current?.budget.totalTokens).toBeGreaterThan(0);
  });

  it('resolves the AionRS context window from the raw backend model field', () => {
    const rawModelSelection = {
      current_model: {
        provider_id: 'minimax',
        model: 'minimax/minimax-m2.5',
        use_model: null,
      },
    } as unknown as AionrsModelSelection;

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={rawModelSelection} />);

    expect(contextUsageIndicatorProps.current?.budget.contextLimit).toBe(204_800);
    expect(contextUsageIndicatorProps.current?.budget.source).toBe('estimated');
  });
  it('hides stale processing when the hydrated runtime view is idle', () => {
    aionrsMessageState.current = {
      ...createAionrsMessageState(),
      running: true,
    };
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      hydrated: true,
      isProcessing: false,
      canSendMessage: true,
      state: 'idle',
    };

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(screen.queryByTestId('thought-display')).not.toBeInTheDocument();
    expect(thoughtDisplayProps.current?.running).toBe(false);
  });

  it('shows processing while the hydrated runtime view is processing', () => {
    aionrsMessageState.current = createAionrsMessageState();
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      hydrated: true,
      isProcessing: true,
      canSendMessage: false,
      state: 'running',
    };

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(screen.getByTestId('thought-display')).toBeInTheDocument();
    expect(thoughtDisplayProps.current?.running).toBe(true);
  });

  it('declares the user as the blocker while a confirmation is pending', () => {
    aionrsMessageState.current = createAionrsMessageState();
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      hydrated: true,
      isProcessing: true,
      canSendMessage: false,
      pendingConfirmations: 1,
      state: 'running',
    };

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(thoughtDisplayProps.current?.awaitingApproval).toBe(true);
  });

  it('declares the user as the blocker while the runtime reports waiting_confirmation', () => {
    aionrsMessageState.current = createAionrsMessageState();
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      hydrated: true,
      isProcessing: false,
      canSendMessage: false,
      pendingConfirmations: 0,
      state: 'waiting_confirmation',
    };

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(thoughtDisplayProps.current?.awaitingApproval).toBe(true);
  });

  it('does not claim the user is blocking an ordinary processing turn', () => {
    aionrsMessageState.current = createAionrsMessageState();
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      hydrated: true,
      isProcessing: true,
      canSendMessage: false,
      pendingConfirmations: 0,
      state: 'running',
    };

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(thoughtDisplayProps.current?.awaitingApproval).toBe(false);
  });

  it('withholds the approval claim until the runtime view has hydrated', () => {
    aionrsMessageState.current = createAionrsMessageState();
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      hydrated: false,
      isProcessing: true,
      canSendMessage: false,
      pendingConfirmations: 1,
      state: 'waiting_confirmation',
    };

    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(thoughtDisplayProps.current?.awaitingApproval).toBe(false);
  });

  it('advertises the native context command in the shared slash menu', () => {
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    expect(screen.getByTestId('context-command-enabled')).toHaveTextContent('true');
  });

  it('intercepts valid context commands before queueing or sending a chat turn', async () => {
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await act(async () => {
      screen.getByRole('button', { name: 'compact context' }).click();
    });

    expect(emitMock).toHaveBeenCalledWith('aionrs.context-command', {
      conversationId: 'd0921953',
      command: { action: 'compact' },
    });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(checkAndUpdateTitleMock).not.toHaveBeenCalled();
  });

  it('shows a localized validation error without sending invalid context commands', async () => {
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await act(async () => {
      screen.getByRole('button', { name: 'invalid context' }).click();
    });

    expect(messageErrorMock).toHaveBeenCalledWith('conversation.contextHandoff.command.missingPinText');
    expect(emitMock).not.toHaveBeenCalledWith('aionrs.context-command', expect.anything());
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it.each([
    ['context with arguments', 'conversation.contextHandoff.command.unexpectedArguments'],
    ['unsupported context', 'conversation.contextHandoff.command.unsupportedSubcommand'],
  ])('localizes the %s validation failure without starting a model turn', async (buttonName, messageKey) => {
    render(<AionrsSendBox conversation_id='d0921953' modelSelection={modelSelection} />);

    await act(async () => {
      screen.getByRole('button', { name: buttonName }).click();
    });

    expect(messageErrorMock).toHaveBeenCalledWith(messageKey);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });
});

describe('AionrsChat human-submit bridge', () => {
  let AionrsChat: typeof import('@/renderer/pages/conversation/platforms/aionrs/AionrsChat').default;

  beforeAll(async () => {
    vi.doMock('@/renderer/pages/conversation/platforms/aionrs/AionrsSendBox', () => ({
      default: (props: Record<string, unknown>) => {
        aionrsChatSendBoxProps.current = props;
        return <div data-testid='aionrs-chat-sendbox' />;
      },
    }));
    ({ default: AionrsChat } = await import('@/renderer/pages/conversation/platforms/aionrs/AionrsChat'));
  });

  beforeEach(() => {
    aionrsChatSendBoxProps.current = null;
    kbHintProps.current = null;
    toolOutcomeProviderValues.current = [];
    pendingRecoveryMock.mockClear();
    updateLocalImageMock.mockClear();
    useMessageLstCacheMock.mockClear();
  });

  it('passes the optional human-submit interceptor through the configured chat surface', async () => {
    const beforeSend = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <AionrsChat
        conversation_id='director-chat'
        workspace='/tmp/director-a'
        modelSelection={modelSelection}
        modelSelector={<span>Model selector</span>}
        session_mode='agent'
        emptySlot={<span>Director empty state</span>}
        loadedSkills={['slides']}
        loadedMcpServers={['studio']}
        loadedMcpStatuses={[]}
        agent_name='Director'
        assistantId='director-assistant'
        project_id='project-1'
        session_mcp_servers={[]}
        beforeSend={beforeSend}
      />
    );

    expect(useMessageLstCacheMock).toHaveBeenCalledWith('director-chat');
    expect(pendingRecoveryMock).toHaveBeenCalledWith('director-chat');
    expect(updateLocalImageMock).toHaveBeenCalledWith({ root: '/tmp/director-a' });
    expect(screen.getByText('Director empty state')).toBeInTheDocument();
    expect(aionrsChatSendBoxProps.current).toMatchObject({
      conversation_id: 'director-chat',
      modelSelection,
      session_mode: 'agent',
      agent_name: 'Director',
      beforeSend,
    });
    expect(kbHintProps.current).toMatchObject({
      conversationId: 'director-chat',
      projectId: 'project-1',
      workspace: '/tmp/director-a',
      sessionMcpServers: [],
    });

    rerender(
      <AionrsChat
        conversation_id='director-chat'
        workspace='/tmp/director-b'
        modelSelection={modelSelection}
        project_id='project-1'
        beforeSend={beforeSend}
      />
    );

    await waitFor(() => {
      expect(updateLocalImageMock).toHaveBeenLastCalledWith({ root: '/tmp/director-b' });
    });
  });

  it('leaves ordinary chats unintercepted when the optional bridge is absent', () => {
    render(<AionrsChat conversation_id='ordinary-chat' workspace='/tmp/ordinary' modelSelection={modelSelection} />);

    expect(aionrsChatSendBoxProps.current).toMatchObject({
      conversation_id: 'ordinary-chat',
      modelSelection,
      beforeSend: undefined,
    });
    expect(kbHintProps.current).toMatchObject({
      conversationId: 'ordinary-chat',
      projectId: undefined,
      workspace: '/tmp/ordinary',
      sessionMcpServers: undefined,
    });
    expect(toolOutcomeProviderValues.current).toEqual([]);
  });

  it('scopes an installed domain interpreter to the embedded chat message tree', () => {
    const toolOutcomeInterpreter = vi.fn(() => 'observed' as const);
    render(
      <AionrsChat
        conversation_id='director-chat'
        workspace='/tmp/director'
        modelSelection={modelSelection}
        toolOutcomeInterpreter={toolOutcomeInterpreter}
      />
    );

    expect(toolOutcomeProviderValues.current).toEqual([toolOutcomeInterpreter]);
    expect(screen.getByTestId('aionrs-message-list')).toBeInTheDocument();
  });
});
