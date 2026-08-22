/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ProviderHandler = (request: never) => unknown;
type HiddenHandler = (event: { sender: unknown; senderFrame: unknown }, request: unknown) => Promise<unknown> | unknown;

const mocks = vi.hoisted(() => ({
  conversationGet: vi.fn(),
  createPresentationSourceGrantService: vi.fn(),
  featureEnabled: true,
  exposeInMainWorld: vi.fn(),
  getPathForFile: vi.fn(),
  hiddenHandlers: new Map<string, HiddenHandler>(),
  ipcHandle: vi.fn((channel: string, handler: HiddenHandler) => {
    mocks.hiddenHandlers.set(channel, handler);
  }),
  ipcInvoke: vi.fn(),
  ownerProbe: vi.fn(),
  principalProbe: vi.fn(),
  registeredProviders: new Map<string, ProviderHandler>(),
  showOpenDialog: vi.fn(),
  storageProbe: vi.fn(),
  sourceService: {
    bindDraft: vi.fn(),
    createDraft: vi.fn(),
    getSourceOwner: vi.fn(),
    grantExternalDropPaths: vi.fn(),
    grantWorkspaceSource: vi.fn(),
    pickSources: vi.fn(),
    revoke: vi.fn(),
  },
}));

const provider = (name: string) => ({
  provider: (handler: ProviderHandler) => mocks.registeredProviders.set(name, handler),
});

vi.mock('@sentry/electron/preload', () => ({}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/weprompt-presentation-boundary'),
    isPackaged: true,
  },
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  ipcMain: { handle: mocks.ipcHandle },
  ipcRenderer: {
    invoke: mocks.ipcInvoke,
    off: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
    sendSync: vi.fn((channel: string) => {
      if (channel === 'get-backend-port') return 25808;
      if (channel === 'get-backend-startup-failed') return false;
      if (channel === 'get-backend-local-token') return 'local-token';
      return null;
    }),
  },
  webUtils: { getPathForFile: mocks.getPathForFile },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { get: { invoke: mocks.conversationGet } },
    presentationSources: {
      bindDraft: provider('bindDraft'),
      createDraft: provider('createDraft'),
      getSourceOwner: provider('getSourceOwner'),
      grantWorkspaceSource: provider('grantWorkspaceSource'),
      pickSources: provider('pickSources'),
      revoke: provider('revoke'),
    },
    presentationTemplates: {
      allocateScratch: provider('allocateScratch'),
      completeScratch: provider('completeScratch'),
      describeSpec: provider('describeSpec'),
      discardScratch: provider('discardScratch'),
      importSpec: provider('importSpec'),
      importSpecBound: provider('importSpecBound'),
      list: provider('list'),
      remove: provider('remove'),
      retainScratch: provider('retainScratch'),
    },
  },
}));

vi.mock('@/common/config/constants', () => ({
  get PRESENTATION_RUN_V2_ENABLED() {
    return mocks.featureEnabled;
  },
}));

vi.mock('@process/services/presentation-template/run', () => ({
  ArtifactScratchService: class {
    allocate = vi.fn();
    complete = vi.fn();
    discard = vi.fn();
    retain = vi.fn();
  },
  createPresentationSourceGrantService: mocks.createPresentationSourceGrantService,
}));

const HIDDEN_CHANNEL = 'presentation-sources:grant-external-drop';
const CONVERSATION_ID = '2be7b8fc-6af5-42b8-aed5-03644735c730';
const DRAFT_ID = 'd9b6195d-bab0-4662-b88c-1675772bb24d';
const GRANT_ID = '229ca31e-1150-4ad1-ad62-1c3368330adc';
const CLIENT_REQUEST_ID = 'c9426c09-4352-4c7c-88ca-039bfcaaf0d8';
const originalProcessTypeDescriptor = Object.getOwnPropertyDescriptor(process, 'type');

const setProcessType = (value: string): void => {
  Object.defineProperty(process, 'type', { configurable: true, value });
};

const invalidRequest = () => ({
  ok: false as const,
  code: 'INVALID_REQUEST' as const,
  messageKey: 'conversation.presentationRun.INVALID_REQUEST',
  retryable: false as const,
  state: 'preflight' as const,
  details: null,
});

const nativeFileRequired = () => ({
  ok: false as const,
  code: 'NATIVE_FILE_REQUIRED' as const,
  messageKey: 'conversation.presentationRun.NATIVE_FILE_REQUIRED',
  retryable: false as const,
  state: 'preflight' as const,
  details: null,
});

const internalError = () => ({
  ok: false as const,
  code: 'INTERNAL_ERROR' as const,
  messageKey: 'conversation.presentationRun.INTERNAL_ERROR',
  retryable: false as const,
  state: 'preflight' as const,
  details: null,
});

const ipcPreflightFailure = (code: 'FEATURE_DISABLED' | 'DESKTOP_REQUIRED') => ({
  ok: false as const,
  code,
  messageKey: `conversation.presentationRun.${code}`,
  retryable: false as const,
  state: 'preflight' as const,
  details: null,
});

const descriptor = {
  grantId: GRANT_ID,
  displayName: 'source.pdf',
  format: 'pdf' as const,
  sourceKind: 'external-drop' as const,
  byteLength: 128,
  sha256: 'a'.repeat(64),
  expiresAt: '2026-08-04T00:15:00.000Z',
};

const dropRequest = (files: readonly File[]) => ({
  owner: { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID },
  files,
  expected_owner_revision: 0,
});

const sourceFiles = {
  bridge: resolve(process.cwd(), 'packages/desktop/src/process/services/presentation-template/bridge.ts'),
  constants: resolve(process.cwd(), 'packages/desktop/src/common/adapter/native/constants.ts'),
  electronTypes: resolve(process.cwd(), 'packages/desktop/src/common/types/platform/electron.ts'),
  ipcBridge: resolve(process.cwd(), 'packages/desktop/src/common/adapter/ipcBridge.ts'),
  lifecycle: resolve(process.cwd(), 'packages/desktop/src/process/utils/mainWindowLifecycle.ts'),
  payloadSchemas: resolve(process.cwd(), 'packages/desktop/src/common/adapter/native/payloadSchemas.ts'),
  preload: resolve(process.cwd(), 'packages/desktop/src/preload/main.ts'),
};

function getExposedElectronApi(): Record<string, unknown> {
  const call = mocks.exposeInMainWorld.mock.calls.find(([key]) => key === 'electronAPI');
  expect(call).toBeDefined();
  return call?.[1] as Record<string, unknown>;
}

function createWindow() {
  const mainFrame = { url: 'file:///app/renderer/index.html' };
  const webContents = { isDestroyed: () => false, mainFrame };
  return { isDestroyed: () => false, webContents };
}

async function loadMainBoundary() {
  const bridge = await import('@process/services/presentation-template/bridge');
  bridge.initPresentationTemplateBridge();
  const handler = mocks.hiddenHandlers.get(HIDDEN_CHANNEL);
  expect(handler).toBeDefined();
  return { ...bridge, handler: handler! };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.featureEnabled = true;
  setProcessType('browser');
  mocks.hiddenHandlers.clear();
  mocks.registeredProviders.clear();
  mocks.conversationGet.mockResolvedValue({
    id: CONVERSATION_ID,
    type: 'acp',
    extra: { backend: 'opencode', workspace: '/workspace' },
  });
  mocks.createPresentationSourceGrantService.mockReturnValue(mocks.sourceService);
  mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  mocks.ipcInvoke.mockResolvedValue({ ok: true, status: 'granted', grants: [descriptor], ownerRevision: 1 });
  mocks.sourceService.getSourceOwner.mockResolvedValue({
    ok: true,
    owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
    ownerRevision: 0,
    grants: [],
  });
  mocks.sourceService.createDraft.mockResolvedValue({
    ok: true,
    status: 'created',
    draft: {
      draftId: DRAFT_ID,
      revision: 0,
      expiresAt: '2026-08-04T00:15:00.000Z',
      grantCount: 0,
    },
  });
  mocks.sourceService.bindDraft.mockResolvedValue({ ok: false, ...invalidRequest() });
  mocks.sourceService.pickSources.mockResolvedValue({ ok: true, status: 'cancelled', grants: [], ownerRevision: 0 });
  mocks.sourceService.grantWorkspaceSource.mockResolvedValue({ ok: false, ...invalidRequest() });
  mocks.sourceService.revoke.mockResolvedValue({ ok: false, ...invalidRequest() });
  mocks.sourceService.grantExternalDropPaths.mockResolvedValue({
    ok: true,
    status: 'granted',
    grants: [descriptor],
    ownerRevision: 1,
  });
});

afterAll(() => {
  if (originalProcessTypeDescriptor) {
    Object.defineProperty(process, 'type', originalProcessTypeDescriptor);
  } else {
    Reflect.deleteProperty(process, 'type');
  }
});

describe('presentation source public/private surface', () => {
  it('keeps the raw-path channel out of every renderer-callable generic surface', () => {
    for (const file of [
      sourceFiles.ipcBridge,
      sourceFiles.constants,
      sourceFiles.payloadSchemas,
      sourceFiles.electronTypes,
    ]) {
      expect(readFileSync(file, 'utf8')).not.toContain(HIDDEN_CHANNEL);
    }

    expect(readFileSync(sourceFiles.preload, 'utf8').split(HIDDEN_CHANNEL)).toHaveLength(2);
    expect(readFileSync(sourceFiles.bridge, 'utf8').split(HIDDEN_CHANNEL)).toHaveLength(2);
  });

  it('preserves the legacy renderer path helper and binds the source window in the shared lifecycle', () => {
    expect(readFileSync(sourceFiles.preload, 'utf8')).toContain(
      'getPathForFile: (file: File) => webUtils.getPathForFile(file),'
    );
    expect(readFileSync(sourceFiles.lifecycle, 'utf8')).toContain('setPresentationSourceMainWindow(window);');
  });
});

describe('presentation source external-drop preload boundary', () => {
  it('maps native-backed Files once and invokes only the private channel with native paths', async () => {
    const first = new File(['one'], 'one.pdf');
    const second = new File(['two'], 'two.pdf');
    mocks.getPathForFile.mockImplementation((file: File) =>
      file === first ? '/private/native/one.pdf' : '/private/native/two.pdf'
    );
    await import('@/preload/main');

    const electronApi = getExposedElectronApi() as {
      presentationSources: { grantExternalDrop: (request: ReturnType<typeof dropRequest>) => Promise<unknown> };
    };
    const result = await electronApi.presentationSources.grantExternalDrop(dropRequest([first, second]));

    expect(mocks.getPathForFile).toHaveBeenCalledTimes(2);
    expect(mocks.ipcInvoke).toHaveBeenCalledTimes(1);
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(HIDDEN_CHANNEL, {
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      native_paths: ['/private/native/one.pdf', '/private/native/two.pdf'],
      expected_owner_revision: 0,
    });
    expect(JSON.stringify(result)).not.toContain('/private/native');
  });

  it('accepts and canonicalizes a short uppercase conversation owner before private IPC', async () => {
    const file = new File(['one'], 'one.pdf');
    mocks.getPathForFile.mockReturnValue('/private/native/one.pdf');
    await import('@/preload/main');
    const electronApi = getExposedElectronApi() as {
      presentationSources: { grantExternalDrop: (request: ReturnType<typeof dropRequest>) => Promise<unknown> };
    };

    await electronApi.presentationSources.grantExternalDrop({
      ...dropRequest([file]),
      owner: { owner_type: 'conversation', conversation_id: 'D0921953' },
    });

    expect(mocks.ipcInvoke).toHaveBeenCalledWith(HIDDEN_CHANNEL, {
      owner: { owner_type: 'conversation', conversation_id: 'd0921953' },
      native_paths: ['/private/native/one.pdf'],
      expected_owner_revision: 0,
    });
  });

  it.each([
    ['empty native path', ''],
    ['non-string native path', 17],
  ])('returns NATIVE_FILE_REQUIRED with zero IPC for an %s', async (_label, nativePath) => {
    const file = new File(['one'], 'one.pdf');
    mocks.getPathForFile.mockReturnValue(nativePath);
    await import('@/preload/main');
    const electronApi = getExposedElectronApi() as {
      presentationSources: { grantExternalDrop: (request: ReturnType<typeof dropRequest>) => Promise<unknown> };
    };

    await expect(electronApi.presentationSources.grantExternalDrop(dropRequest([file]))).resolves.toEqual(
      nativeFileRequired()
    );
    expect(mocks.ipcInvoke).not.toHaveBeenCalled();
  });

  it('returns NATIVE_FILE_REQUIRED with zero IPC when Electron rejects a synthetic File', async () => {
    const file = new File(['synthetic'], 'synthetic.pdf');
    mocks.getPathForFile.mockImplementation(() => {
      throw new TypeError('The file is not backed by a native path');
    });
    await import('@/preload/main');
    const electronApi = getExposedElectronApi() as {
      presentationSources: { grantExternalDrop: (request: ReturnType<typeof dropRequest>) => Promise<unknown> };
    };

    await expect(electronApi.presentationSources.grantExternalDrop(dropRequest([file]))).resolves.toEqual(
      nativeFileRequired()
    );
    expect(mocks.ipcInvoke).not.toHaveBeenCalled();
  });

  it.each([
    ['empty batch', dropRequest([])],
    ['more than sixteen files', dropRequest(Array.from({ length: 17 }, () => new File(['x'], 'x.pdf')))],
    ['non-File member', { ...dropRequest([]), files: [{}] }],
    ['malformed owner', { ...dropRequest([new File(['x'], 'x.pdf')]), owner: { owner_type: 'draft' } }],
    [
      'unsafe revision',
      { ...dropRequest([new File(['x'], 'x.pdf')]), expected_owner_revision: Number.MAX_SAFE_INTEGER + 1 },
    ],
    ['unknown field', { ...dropRequest([new File(['x'], 'x.pdf')]), native_path: '/private/forged.pdf' }],
  ])('returns INVALID_REQUEST with zero file mapping and IPC for %s', async (_label, request) => {
    await import('@/preload/main');
    const electronApi = getExposedElectronApi() as {
      presentationSources: { grantExternalDrop: (request: never) => Promise<unknown> };
    };

    await expect(electronApi.presentationSources.grantExternalDrop(request as never)).resolves.toEqual(
      invalidRequest()
    );
    expect(mocks.getPathForFile).not.toHaveBeenCalled();
    expect(mocks.ipcInvoke).not.toHaveBeenCalled();
  });

  it('keeps the legacy helper behavior as a direct webUtils call', async () => {
    const file = new File(['legacy'], 'legacy.pdf');
    mocks.getPathForFile.mockReturnValue('/private/legacy.pdf');
    await import('@/preload/main');
    const electronApi = getExposedElectronApi() as { getPathForFile: (file: File) => string };

    expect(electronApi.getPathForFile(file)).toBe('/private/legacy.pdf');
    expect(mocks.getPathForFile).toHaveBeenCalledWith(file);
    expect(mocks.ipcInvoke).not.toHaveBeenCalled();
  });
});

describe('presentation source main-process boundary', () => {
  it('accepts a legacy uppercase UUID owner and dispatches its canonical lowercase identity', async () => {
    const window = createWindow();
    const { handler, setPresentationSourceMainWindow } = await loadMainBoundary();
    setPresentationSourceMainWindow(window as never);

    await handler(
      { sender: window.webContents, senderFrame: window.webContents.mainFrame },
      {
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID.toUpperCase() },
        native_paths: ['/private/native/source.pdf'],
        expected_owner_revision: 0,
      }
    );

    expect(mocks.sourceService.grantExternalDropPaths).toHaveBeenCalledWith({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      native_paths: ['/private/native/source.pdf'],
      expected_owner_revision: 0,
    });
  });

  it.each([
    ['FEATURE_DISABLED', () => (mocks.featureEnabled = false)],
    ['DESKTOP_REQUIRED', () => setProcessType('renderer')],
  ] as const)(
    'returns %s for every source IPC without constructing or dispatching the service',
    async (code, configurePreflight) => {
      configurePreflight();
      for (const operation of Object.values(mocks.sourceService)) {
        operation.mockImplementation(async () => {
          mocks.principalProbe();
          mocks.ownerProbe();
          mocks.storageProbe();
          return internalError();
        });
      }
      const window = createWindow();
      const { handler, setPresentationSourceMainWindow } = await loadMainBoundary();
      setPresentationSourceMainWindow(window as never);
      const publicRequests = {
        getSourceOwner: { owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID } },
        createDraft: { client_request_id: CLIENT_REQUEST_ID },
        bindDraft: { draft_id: DRAFT_ID, conversation_id: CONVERSATION_ID, expected_revision: 0 },
        pickSources: { owner: { owner_type: 'draft', draft_id: DRAFT_ID }, expected_owner_revision: 0 },
        grantWorkspaceSource: {
          conversation_id: CONVERSATION_ID,
          relative_path: 'sources/source.pdf',
          expected_owner_revision: 0,
        },
        revoke: {
          owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
          grant_id: GRANT_ID,
          expected_owner_revision: 0,
        },
      } as const;
      const results = await Promise.all(
        Object.entries(publicRequests).map(([name, request]) => mocks.registeredProviders.get(name)?.(request as never))
      );
      results.push(
        await handler(
          { sender: window.webContents, senderFrame: window.webContents.mainFrame },
          {
            owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
            native_paths: ['/private/native/source.pdf'],
            expected_owner_revision: 0,
          }
        )
      );

      expect(results).toEqual(Array.from({ length: 7 }, () => ipcPreflightFailure(code)));
      expect({
        dialog: mocks.showOpenDialog.mock.calls.length,
        factory: mocks.createPresentationSourceGrantService.mock.calls.length,
        owner: mocks.ownerProbe.mock.calls.length,
        ownerLookup: mocks.conversationGet.mock.calls.length,
        principal: mocks.principalProbe.mock.calls.length,
        service: Object.values(mocks.sourceService).reduce(
          (total, operation) => total + operation.mock.calls.length,
          0
        ),
        storage: mocks.storageProbe.mock.calls.length,
      }).toEqual({ dialog: 0, factory: 0, owner: 0, ownerLookup: 0, principal: 0, service: 0, storage: 0 });
    }
  );

  it('registers the hidden handler once and dispatches all six public providers directly', async () => {
    const { initPresentationTemplateBridge } = await loadMainBoundary();
    initPresentationTemplateBridge();

    expect(mocks.ipcHandle).toHaveBeenCalledTimes(1);
    const requests = {
      getSourceOwner: { owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID } },
      createDraft: { client_request_id: CLIENT_REQUEST_ID },
      bindDraft: { draft_id: DRAFT_ID, conversation_id: CONVERSATION_ID, expected_revision: 0 },
      pickSources: {
        owner: { owner_type: 'draft', draft_id: DRAFT_ID },
        expected_owner_revision: 0,
      },
      grantWorkspaceSource: {
        conversation_id: CONVERSATION_ID,
        relative_path: 'sources/source.pdf',
        expected_owner_revision: 0,
      },
      revoke: {
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        grant_id: GRANT_ID,
        expected_owner_revision: 0,
      },
    } as const;

    await Promise.all(
      Object.entries(requests).map(async ([name, request]) => {
        await mocks.registeredProviders.get(name)?.(request as never);
        expect(mocks.sourceService[name as keyof typeof mocks.sourceService]).toHaveBeenCalledWith(request);
      })
    );
  });

  it('keeps successful conversation lookup fail-closed until the Task 7 scope resolver exists', async () => {
    mocks.conversationGet.mockResolvedValue({
      id: CONVERSATION_ID,
      type: 'acp',
      extra: { backend: 'opencode', team_id: 'guessed-team', workspace: '/workspace' },
      team_id: 'guessed-team',
    });
    await loadMainBoundary();
    await mocks.registeredProviders.get('getSourceOwner')?.({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
    } as never);
    const factoryOptions = mocks.createPresentationSourceGrantService.mock.calls[0]?.[0] as {
      resolveConversationOwner: (input: { conversationId: string; principalId: string }) => Promise<unknown>;
    };

    await expect(
      factoryOptions.resolveConversationOwner({
        conversationId: CONVERSATION_ID,
        principalId: 'desktop-local-principal',
      })
    ).resolves.toEqual({ ok: false, code: 'SCOPE_UNAVAILABLE' });
  });

  it('maps only authoritative backend authorization and lookup statuses before scope resolution', async () => {
    await loadMainBoundary();
    await mocks.registeredProviders.get('getSourceOwner')?.({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
    } as never);
    const factoryOptions = mocks.createPresentationSourceGrantService.mock.calls[0]?.[0] as {
      resolveConversationOwner: (input: { conversationId: string; principalId: string }) => Promise<unknown>;
    };
    const resolveOwnerForStatus = async (status: number) => {
      mocks.conversationGet.mockRejectedValueOnce({ name: 'BackendHttpError', status, code: 'LOOKUP_FAILED' });
      return factoryOptions.resolveConversationOwner({
        conversationId: CONVERSATION_ID,
        principalId: 'desktop-local-principal',
      });
    };

    await expect(
      Promise.all([
        resolveOwnerForStatus(401),
        resolveOwnerForStatus(403),
        resolveOwnerForStatus(404),
        resolveOwnerForStatus(500),
      ])
    ).resolves.toEqual([
      { ok: false, code: 'RUN_FORBIDDEN' },
      { ok: false, code: 'RUN_FORBIDDEN' },
      { ok: false, code: 'RUN_NOT_FOUND' },
      { ok: false, code: 'SCOPE_UNAVAILABLE' },
    ]);
  });

  it('accepts only the exact bound live webContents and its mainFrame', async () => {
    const firstWindow = createWindow();
    const { handler, setPresentationSourceMainWindow } = await loadMainBoundary();
    setPresentationSourceMainWindow(firstWindow as never);
    const request = {
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      native_paths: ['/private/native/source.pdf'],
      expected_owner_revision: 0,
    };

    await expect(
      handler({ sender: firstWindow.webContents, senderFrame: firstWindow.webContents.mainFrame }, request)
    ).resolves.toEqual({ ok: true, status: 'granted', grants: [descriptor], ownerRevision: 1 });
    expect(mocks.sourceService.grantExternalDropPaths).toHaveBeenCalledWith(request);

    mocks.sourceService.grantExternalDropPaths.mockClear();
    await expect(handler({ sender: {}, senderFrame: firstWindow.webContents.mainFrame }, request)).resolves.toEqual(
      invalidRequest()
    );
    await expect(
      handler({ sender: firstWindow.webContents, senderFrame: { url: firstWindow.webContents.mainFrame.url } }, request)
    ).resolves.toEqual(invalidRequest());
    expect(mocks.sourceService.grantExternalDropPaths).not.toHaveBeenCalled();
  });

  it('denies the old sender after rebinding to a replacement main window', async () => {
    const oldWindow = createWindow();
    const newWindow = createWindow();
    const { handler, setPresentationSourceMainWindow } = await loadMainBoundary();
    const request = {
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      native_paths: ['/private/native/source.pdf'],
      expected_owner_revision: 0,
    };
    setPresentationSourceMainWindow(oldWindow as never);
    setPresentationSourceMainWindow(newWindow as never);

    await expect(
      handler({ sender: oldWindow.webContents, senderFrame: oldWindow.webContents.mainFrame }, request)
    ).resolves.toEqual(invalidRequest());
    await expect(
      handler({ sender: newWindow.webContents, senderFrame: newWindow.webContents.mainFrame }, request)
    ).resolves.toMatchObject({ ok: true, status: 'granted' });
    expect(mocks.sourceService.grantExternalDropPaths).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['relative path', ['relative/source.pdf']],
    ['duplicate paths', ['/private/source.pdf', '/private/source.pdf']],
    ['empty batch', []],
    ['over-limit batch', Array.from({ length: 17 }, (_, index) => `/private/source-${index}.pdf`)],
    ['NUL path', ['/private/source.pdf\0tail']],
    ['overlong path', [`/${'x'.repeat(4096)}`]],
  ])('rejects a hidden payload with %s before calling the service', async (_label, native_paths) => {
    const window = createWindow();
    const { handler, setPresentationSourceMainWindow } = await loadMainBoundary();
    setPresentationSourceMainWindow(window as never);

    await expect(
      handler(
        { sender: window.webContents, senderFrame: window.webContents.mainFrame },
        {
          owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
          native_paths,
          expected_owner_revision: 0,
        }
      )
    ).resolves.toEqual(invalidRequest());
    expect(mocks.sourceService.grantExternalDropPaths).not.toHaveBeenCalled();
  });

  it('maps unexpected service failures to a stable path-free result', async () => {
    const window = createWindow();
    const secretPath = '/private/native/secret-source.pdf';
    mocks.sourceService.grantExternalDropPaths.mockRejectedValue(new Error(`failed ${secretPath}`));
    const { handler, setPresentationSourceMainWindow } = await loadMainBoundary();
    setPresentationSourceMainWindow(window as never);

    const result = await handler(
      { sender: window.webContents, senderFrame: window.webContents.mainFrame },
      {
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        native_paths: [secretPath],
        expected_owner_revision: 0,
      }
    );

    expect(result).toEqual(internalError());
    expect(JSON.stringify(result)).not.toContain(secretPath);
  });

  it('returns only path-free managed-v2 result keys and values', async () => {
    const { handler, setPresentationSourceMainWindow } = await loadMainBoundary();
    const window = createWindow();
    setPresentationSourceMainWindow(window as never);
    const results = [
      await mocks.registeredProviders.get('getSourceOwner')?.({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      } as never),
      await mocks.registeredProviders.get('createDraft')?.({ client_request_id: CLIENT_REQUEST_ID } as never),
      await handler(
        { sender: window.webContents, senderFrame: window.webContents.mainFrame },
        {
          owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
          native_paths: ['/private/native/source.pdf'],
          expected_owner_revision: 0,
        }
      ),
    ];

    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value === null || typeof value !== 'object') {
        if (typeof value === 'string') {
          expect(value).not.toMatch(/(?:^|[\\/])(?:private|tmp|native|snapshots?|workspace)(?:[\\/]|$)/i);
        }
        return;
      }
      for (const [key, nested] of Object.entries(value)) {
        expect(key).not.toMatch(/(?:^|_)(?:path|native|workspace|snapshot)(?:_|$)/i);
        visit(nested);
      }
    };

    results.forEach(visit);
  });
});
