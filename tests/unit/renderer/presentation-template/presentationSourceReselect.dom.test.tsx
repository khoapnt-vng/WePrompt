/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  agentSelectionMock,
  capturedGuidActionRowProps,
  capturedGuidInputCardProps,
  capturedGuidSendDeps,
  capturedSlashControllerOptions,
  createDraftMock,
  grantExternalDropMock,
  guidInputMock,
  pickSourcesMock,
  presentationSourceDraftMock,
  revokeMock,
  sendMock,
  onSlashBuiltinCommandMock,
  MockIcon,
} = vi.hoisted(() => {
  const sourceDraft = {
    owner: null,
    ownerRevision: null,
    descriptors: [],
    sourceRefs: [],
    pending: false,
    hydrate: vi.fn(),
    createDraft: vi.fn(),
    pickSources: vi.fn(),
    grantExternalDrop: vi.fn(),
    grantWorkspaceSource: vi.fn(),
    revoke: vi.fn(),
    bindDraft: vi.fn(),
    reset: vi.fn(),
  };
  return {
    MockIcon: () => null,
    agentSelectionMock: {
      selectedAssistantId: 'assistant-aionrs',
      selectedAssistant: {
        id: 'assistant-aionrs',
        agent: { type: 'aionrs', source: 'builtin' },
      },
      selectedAssistantBackend: 'aionrs',
      selectedAssistantAvailable: true,
      selectedMode: 'default',
      setSelectedMode: vi.fn(),
      selectedAcpModel: null,
      setSelectedAcpModel: vi.fn(),
      selectedThoughtLevelValue: '',
      setSelectedThoughtLevelValue: vi.fn(),
      currentAcpCachedModelInfo: null,
      currentAgentAvailableCommands: [],
      currentAgentModeOptions: [],
      currentThoughtLevelOption: null,
      defaultAssistantId: 'assistant-aionrs',
      setSelectedAssistantId: vi.fn(),
      assistants: [],
    },
    capturedGuidActionRowProps: [] as Array<Record<string, unknown>>,
    capturedGuidInputCardProps: [] as Array<Record<string, unknown>>,
    capturedGuidSendDeps: [] as Array<Record<string, unknown>>,
    capturedSlashControllerOptions: [] as Array<Record<string, unknown>>,
    createDraftMock: sourceDraft.createDraft,
    grantExternalDropMock: sourceDraft.grantExternalDrop,
    guidInputMock: {
      input: 'Build a financial review',
      setInput: vi.fn(),
      files: ['/legacy/revenue.xlsx'],
      setFiles: vi.fn(),
      dir: '',
      setDir: vi.fn(),
      projectId: undefined as string | undefined,
      setProjectId: vi.fn(),
      loading: false,
      setLoading: vi.fn(),
      isInputFocused: false,
      isFileDragging: false,
      dragHandlers: {},
      onPaste: vi.fn(),
      handleTextareaFocus: vi.fn(),
      handleTextareaBlur: vi.fn(),
      handleFilesUploaded: vi.fn(),
      handleRemoveFile: vi.fn(),
    },
    pickSourcesMock: sourceDraft.pickSources,
    presentationSourceDraftMock: sourceDraft,
    revokeMock: sourceDraft.revoke,
    sendMock: {
      handleSend: vi.fn(),
      sendMessageHandler: vi.fn(),
      isButtonDisabled: false,
      retireManagedPresentationAttemptAfterSourceChange: vi.fn(),
    },
    onSlashBuiltinCommandMock: vi.fn(),
  };
});

vi.mock('@/common/config/constants', () => ({
  PRESENTATION_RUN_V2_ENABLED: true,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) } },
    assistants: { get: { invoke: vi.fn().mockResolvedValue(null) } },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, key: 'guid-location', pathname: '/guid', search: '', hash: '' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('swr', () => ({
  default: () => ({ data: null }),
}));

vi.mock('@/renderer/hooks/file/selection', () => ({
  useOpenFileSelector: () => ({ onSlashBuiltinCommand: onSlashBuiltinCommandMock }),
  usePresentationSourceDraft: () => presentationSourceDraftMock,
}));

vi.mock('@/renderer/components/chat/TemplateGallery', () => ({
  TemplateChipCard: () => null,
  TemplateGalleryButton: () => null,
  TemplateGalleryExpanded: () => null,
  usePresentationTemplates: () => ({
    selectedTemplate: {
      manifest: { id: 'business-review', format: 'pptx' },
    },
    templates: [],
    templatesLoading: false,
    galleryOpen: false,
    openGallery: vi.fn(),
    closeGallery: vi.fn(),
    toggleGallery: vi.fn(),
    selectTemplate: vi.fn(),
    clearSelection: vi.fn(),
    importFromDialog: vi.fn(),
    removeTemplate: vi.fn(),
    composeSend: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({ activeBorderColor: '#000', inactiveBorderColor: '#ccc', activeShadow: 'none' }),
}));

vi.mock('@/renderer/hooks/chat/useSlashCommandController', () => ({
  getFuzzyMatchIndices: vi.fn(),
  useSlashCommandController: (options: Record<string, unknown>) => {
    capturedSlashControllerOptions.push(options);
    return {
      activeIndex: 0,
      filteredCommands: [],
      isOpen: false,
      query: '',
      onKeyDown: () => false,
      onSelectByIndex: vi.fn(),
      setActiveIndex: vi.fn(),
    };
  },
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidAssistantSelection', () => ({
  useGuidAssistantSelection: () => agentSelectionMock,
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidInput', () => ({
  useGuidInput: () => guidInputMock,
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => ({
    modelList: [],
    isGoogleAuth: false,
    current_model: undefined,
    setCurrentModel: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidSend', () => ({
  useGuidSend: (deps: Record<string, unknown>) => {
    capturedGuidSendDeps.push(deps);
    return sendMock;
  },
}));

vi.mock('@/renderer/pages/guid/hooks/useTypewriterPlaceholder', () => ({
  useTypewriterPlaceholder: () => '',
}));

vi.mock('@/renderer/pages/guid/components/AssistantSelectionArea', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/guid/components/GuidActionRow', () => ({
  default: (props: Record<string, unknown>) => {
    capturedGuidActionRowProps.push(props);
    return null;
  },
}));

vi.mock('@/renderer/pages/guid/components/GuidInputCard', () => ({
  default: (props: Record<string, unknown>) => {
    capturedGuidInputCardProps.push(props);
    return <div data-testid='guid-input-card'>{props.presentationSourceNotice as React.ReactNode}</div>;
  },
}));

vi.mock('@/renderer/pages/guid/components/GuidModelSelector', () => ({
  default: () => null,
}));

vi.mock('@/renderer/components/chat/SlashCommandMenu', () => ({
  default: () => null,
}));

vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({
  default: () => null,
}));

vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', () => ({
  useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
}));

vi.mock('@/renderer/hooks/system/useSpeechInput', () => ({
  appendSpeechTranscript: (previous: string, transcript: string) => `${previous}${transcript}`,
}));

vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: vi.fn().mockResolvedValue({ allServers: [] }),
}));

vi.mock('@/renderer/pages/conversation/projects/projectStorage', () => ({
  getWorkspaceBasename: () => '',
  readProjects: () => [],
}));

vi.mock('@/renderer/pages/guid/utils/assistantDefaults', () => ({
  resolveGuidAssistantDefaults: () => ({ disabledBuiltinSkillIds: [], skillIds: [], mcpIds: [] }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
}));

vi.mock('@icon-park/react', () => {
  return {
    FolderOpen: MockIcon,
    Layers: MockIcon,
    Lightning: MockIcon,
    Paperclip: MockIcon,
    Star: MockIcon,
  };
});

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' onClick={onClick} {...props}>
      {children}
    </button>
  ),
  ConfigProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import GuidPage from '@/renderer/pages/guid/GuidPage';

const selectedGrant = {
  grantId: 'grant-1',
  displayName: 'Revenue.xlsx',
  format: 'xlsx' as const,
  sourceKind: 'native-picker' as const,
  byteLength: 1024,
  sha256: 'source-hash',
  expiresAt: '2026-08-04T12:00:00.000Z',
};

describe('Guid presentation source re-selection', () => {
  const originalElectronAPI = window.electronAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} });
    guidInputMock.files = ['/legacy/revenue.xlsx'];
    guidInputMock.projectId = undefined;
    agentSelectionMock.selectedAssistant.agent.type = 'aionrs';
    presentationSourceDraftMock.owner = null;
    presentationSourceDraftMock.descriptors = [];
    presentationSourceDraftMock.pending = false;
    createDraftMock.mockResolvedValue({
      ok: true,
      status: 'created',
      draft: { draftId: 'draft-1', revision: 0, expiresAt: '2026-08-04T12:00:00.000Z', grantCount: 0 },
    });
    pickSourcesMock.mockResolvedValue({ ok: true, status: 'selected', grants: [selectedGrant], ownerRevision: 1 });
    grantExternalDropMock.mockResolvedValue({
      ok: true,
      status: 'granted',
      grants: [selectedGrant],
      ownerRevision: 1,
    });
    revokeMock.mockResolvedValue({
      ok: true,
      status: 'revoked',
      grantId: 'grant-1',
      ownerRevision: 2,
      revokedAt: '2026-08-04T12:01:00.000Z',
      queueUnboundAtRevoke: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: originalElectronAPI });
  });

  it('reveals the inline warning and clears legacy files only after a confirmed managed selection', async () => {
    render(<GuidPage />);
    guidInputMock.setFiles.mockClear();

    expect(capturedGuidSendDeps.at(-1)?.requiresPresentationSourceReselect).toBe(true);
    expect(createDraftMock).not.toHaveBeenCalled();

    const onPresentationSourceReselectRequired = capturedGuidSendDeps.at(-1)?.onPresentationSourceReselectRequired;
    expect(onPresentationSourceReselectRequired).toBeTypeOf('function');
    act(() => {
      (onPresentationSourceReselectRequired as () => void)();
    });
    expect(screen.getByText('conversation.presentationTemplates.sources.reselectRequired')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.presentationTemplates.sources.reselectAction' }));

    await waitFor(() => {
      expect(createDraftMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
      expect(pickSourcesMock).toHaveBeenCalledTimes(1);
      expect(guidInputMock.setFiles).toHaveBeenCalledWith([]);
    });
    expect(sendMock.retireManagedPresentationAttemptAfterSourceChange).toHaveBeenCalledWith({ kind: 'added' });
    expect(sendMock.sendMessageHandler).not.toHaveBeenCalled();
  });

  it('keeps the warning and legacy files when the managed picker is cancelled', async () => {
    pickSourcesMock.mockResolvedValue({ ok: true, status: 'cancelled', grants: [], ownerRevision: 0 });
    render(<GuidPage />);
    guidInputMock.setFiles.mockClear();

    const onPresentationSourceReselectRequired = capturedGuidSendDeps.at(-1)?.onPresentationSourceReselectRequired;
    expect(onPresentationSourceReselectRequired).toBeTypeOf('function');
    act(() => {
      (onPresentationSourceReselectRequired as () => void)();
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.presentationTemplates.sources.reselectAction' }));

    await waitFor(() => expect(pickSourcesMock).toHaveBeenCalledTimes(1));
    expect(guidInputMock.setFiles).not.toHaveBeenCalled();
    expect(screen.getByText('conversation.presentationTemplates.sources.reselectRequired')).toBeInTheDocument();
  });

  it('lazily grants actual dropped files without falling through to an automatic send', async () => {
    const source = new File(['revenue'], 'revenue.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    render(<GuidPage />);
    guidInputMock.setFiles.mockClear();

    const onManagedDrop = capturedGuidInputCardProps.at(-1)?.onManagedDrop;
    expect(onManagedDrop).toBeTypeOf('function');
    await act(async () => {
      await (onManagedDrop as (files: readonly File[]) => Promise<void>)([source]);
    });

    expect(createDraftMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(grantExternalDropMock).toHaveBeenCalledWith([source]);
    expect(sendMock.retireManagedPresentationAttemptAfterSourceChange).toHaveBeenCalledWith({ kind: 'added' });
    expect(guidInputMock.setFiles).toHaveBeenCalledWith([]);
    expect(sendMock.sendMessageHandler).not.toHaveBeenCalled();
  });

  it('passes exact successful revoke proof and never retires after a rejected revoke', async () => {
    presentationSourceDraftMock.descriptors = [selectedGrant];
    render(<GuidPage />);
    const onRevokePresentationSource = capturedGuidInputCardProps.at(-1)?.onRevokePresentationSource;
    expect(onRevokePresentationSource).toBeTypeOf('function');

    act(() => {
      (onRevokePresentationSource as (grantId: string) => void)(selectedGrant.grantId);
    });
    await waitFor(() =>
      expect(sendMock.retireManagedPresentationAttemptAfterSourceChange).toHaveBeenCalledWith({
        kind: 'revoked',
        grantId: selectedGrant.grantId,
        queueUnboundAtRevoke: true,
      })
    );

    sendMock.retireManagedPresentationAttemptAfterSourceChange.mockClear();
    revokeMock.mockResolvedValueOnce({ ok: false, code: 'SOURCE_GRANT_REPLAYED' });
    act(() => {
      (onRevokePresentationSource as (grantId: string) => void)(selectedGrant.grantId);
    });
    await waitFor(() => expect(revokeMock).toHaveBeenCalledTimes(2));
    expect(sendMock.retireManagedPresentationAttemptAfterSourceChange).not.toHaveBeenCalled();

    revokeMock.mockResolvedValueOnce({
      ok: true,
      status: 'already_revoked',
      grantId: selectedGrant.grantId,
      ownerRevision: 2,
      revokedAt: '2026-08-04T12:01:00.000Z',
      queueUnboundAtRevoke: true,
    });
    act(() => {
      (onRevokePresentationSource as (grantId: string) => void)(selectedGrant.grantId);
    });
    await waitFor(() => expect(revokeMock).toHaveBeenCalledTimes(3));
    expect(sendMock.retireManagedPresentationAttemptAfterSourceChange).toHaveBeenCalledWith({
      kind: 'revoked',
      grantId: selectedGrant.grantId,
      queueUnboundAtRevoke: true,
    });

    sendMock.retireManagedPresentationAttemptAfterSourceChange.mockClear();
    revokeMock.mockResolvedValueOnce({
      ok: true,
      status: 'already_revoked',
      grantId: selectedGrant.grantId,
      ownerRevision: 2,
      revokedAt: '2026-08-04T12:01:00.000Z',
      queueUnboundAtRevoke: false,
    });
    act(() => {
      (onRevokePresentationSource as (grantId: string) => void)(selectedGrant.grantId);
    });
    await waitFor(() => expect(revokeMock).toHaveBeenCalledTimes(4));
    expect(sendMock.retireManagedPresentationAttemptAfterSourceChange).not.toHaveBeenCalled();
  });

  it('routes the eligible /open command through the managed picker without calling the legacy selector', async () => {
    render(<GuidPage />);
    guidInputMock.setFiles.mockClear();

    const onExecuteBuiltin = capturedSlashControllerOptions.at(-1)?.onExecuteBuiltin;
    expect(onExecuteBuiltin).toBeTypeOf('function');
    act(() => {
      (onExecuteBuiltin as (name: string) => void)('open');
    });

    await waitFor(() => expect(pickSourcesMock).toHaveBeenCalledTimes(1));
    expect(createDraftMock).toHaveBeenCalledTimes(1);
    expect(onSlashBuiltinCommandMock).not.toHaveBeenCalled();
  });

  it('leaves Project Home on the legacy file path because its managed scope is unknown', () => {
    guidInputMock.projectId = 'project-1';
    render(<GuidPage />);

    expect(capturedGuidSendDeps.at(-1)?.requiresPresentationSourceReselect).toBe(false);
    expect(capturedGuidActionRowProps.at(-1)?.onManagedFilePicker).toBeUndefined();
    expect(capturedGuidInputCardProps.at(-1)?.onManagedDrop).toBeUndefined();
  });

  it('hides managed descriptors and revoke controls after eligibility turns false without clearing hook grants', () => {
    presentationSourceDraftMock.descriptors = [selectedGrant];
    const { rerender } = render(<GuidPage />);

    expect(capturedGuidInputCardProps.at(-1)?.presentationSourceDescriptors).toEqual([selectedGrant]);
    expect(capturedGuidInputCardProps.at(-1)?.onRevokePresentationSource).toBeTypeOf('function');

    guidInputMock.projectId = 'project-1';
    rerender(<GuidPage />);

    expect(capturedGuidInputCardProps.at(-1)?.presentationSourceDescriptors).toEqual([]);
    expect(capturedGuidInputCardProps.at(-1)?.onRevokePresentationSource).toBeUndefined();
    expect(presentationSourceDraftMock.descriptors).toEqual([selectedGrant]);
  });

  it('ignores a deferred picker selection after presentation eligibility turns false', async () => {
    let resolvePicker:
      | ((result: { ok: true; status: 'selected'; grants: Array<typeof selectedGrant>; ownerRevision: number }) => void)
      | null = null;
    pickSourcesMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePicker = resolve;
      })
    );
    const { rerender } = render(<GuidPage />);
    guidInputMock.setFiles.mockClear();

    const onPresentationSourceReselectRequired = capturedGuidSendDeps.at(-1)?.onPresentationSourceReselectRequired;
    expect(onPresentationSourceReselectRequired).toBeTypeOf('function');
    act(() => {
      (onPresentationSourceReselectRequired as () => void)();
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.presentationTemplates.sources.reselectAction' }));
    await waitFor(() => expect(pickSourcesMock).toHaveBeenCalledTimes(1));

    guidInputMock.projectId = 'project-1';
    rerender(<GuidPage />);
    await act(async () => {
      resolvePicker?.({ ok: true, status: 'selected', grants: [selectedGrant], ownerRevision: 1 });
      await Promise.resolve();
    });

    expect(guidInputMock.setFiles).not.toHaveBeenCalled();
  });

  it('ignores a deferred managed drop after presentation eligibility turns false', async () => {
    let resolveDrop:
      | ((result: { ok: true; status: 'granted'; grants: Array<typeof selectedGrant>; ownerRevision: number }) => void)
      | null = null;
    grantExternalDropMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDrop = resolve;
      })
    );
    const source = new File(['revenue'], 'revenue.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const { rerender } = render(<GuidPage />);
    guidInputMock.setFiles.mockClear();

    const onManagedDrop = capturedGuidInputCardProps.at(-1)?.onManagedDrop;
    expect(onManagedDrop).toBeTypeOf('function');
    let dropPromise: Promise<void> | undefined;
    act(() => {
      dropPromise = (onManagedDrop as (files: readonly File[]) => Promise<void>)([source]);
    });
    await waitFor(() => expect(grantExternalDropMock).toHaveBeenCalledWith([source]));

    guidInputMock.projectId = 'project-1';
    rerender(<GuidPage />);
    await act(async () => {
      resolveDrop?.({ ok: true, status: 'granted', grants: [selectedGrant], ownerRevision: 1 });
      await dropPromise;
    });

    expect(guidInputMock.setFiles).not.toHaveBeenCalled();
  });

  it('keeps /open on the legacy selector when managed presentation eligibility is false', () => {
    guidInputMock.projectId = 'project-1';
    render(<GuidPage />);

    const onExecuteBuiltin = capturedSlashControllerOptions.at(-1)?.onExecuteBuiltin;
    expect(onExecuteBuiltin).toBeTypeOf('function');
    act(() => {
      (onExecuteBuiltin as (name: string) => void)('open');
    });

    expect(onSlashBuiltinCommandMock).toHaveBeenCalledWith('open');
    expect(createDraftMock).not.toHaveBeenCalled();
  });
});
