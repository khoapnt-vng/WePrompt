import { describe, expect, it, vi } from 'vitest';

import {
  createCreativeStudioCloseHandshake,
  initCreativeStudioBridge,
  type CreativeStudioCloseHandshakeDependencies,
} from '@process/bridge/creativeStudioBridge';

describe('initCreativeStudioBridge', () => {
  it('registers only the schema-6 connection and Pilot providers', () => {
    const initConnections = vi.fn();
    const initPilot = vi.fn();

    initCreativeStudioBridge({ initConnections, initPilot });

    expect(initConnections).toHaveBeenCalledOnce();
    expect(initPilot).toHaveBeenCalledOnce();
  });

  it('does not continue when the connection boundary fails to register', () => {
    const failure = new Error('connection bridge unavailable');
    const initPilot = vi.fn();

    expect(() =>
      initCreativeStudioBridge({
        initConnections: () => {
          throw failure;
        },
        initPilot,
      })
    ).toThrow(failure);
    expect(initPilot).not.toHaveBeenCalled();
  });
});

type CloseEvent = { preventDefault: ReturnType<typeof vi.fn> };

const createCloseEvent = (): CloseEvent => ({ preventDefault: vi.fn() });

const createDependencies = (
  overrides: Partial<CreativeStudioCloseHandshakeDependencies> = {}
): CreativeStudioCloseHandshakeDependencies => ({
  getCurrentUrl: () => 'file:///Applications/WePrompt/index.html#/studio/project_1',
  queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 0 })),
  flushUnsavedWork: vi.fn(async () => ({ saved: true })),
  showMessageBox: vi.fn(async () => ({ response: 2 })),
  translate: (key, options) => (options?.count === undefined ? key : `${key}:${options.count}`),
  closeWindow: vi.fn(),
  hideWindow: vi.fn(),
  quitApp: vi.fn(),
  onQuitCancelled: vi.fn(),
  ...overrides,
});

const studioUrl = (suffix = ''): string =>
  `file:///Applications/WePrompt/index.html#/studio/project_1${suffix.length === 0 ? '' : `/${suffix}`}`;

describe('createCreativeStudioCloseHandshake', () => {
  it('runs preflight only for the canonical viewless Pilot project route', async () => {
    const dependencies = createDependencies();
    const event = createCloseEvent();

    expect(createCreativeStudioCloseHandshake(dependencies).handleWindowClose(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(dependencies.queryUnsavedWork).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 3_000 }));
  });

  it.each([
    'file:///Applications/WePrompt/index.html',
    'file:///Applications/WePrompt/index.html#/guid',
    'file:///Applications/WePrompt/index.html#/studio',
    'not a renderer URL',
    ...['brief', 'write', 'produce', 'review', 'references', 'table', 'board', 'cut'].map(studioUrl),
  ])('leaves non-Pilot and retired room URLs to the normal close lifecycle: %s', (url) => {
    const dependencies = createDependencies({ getCurrentUrl: () => url });
    const event = createCloseEvent();

    expect(createCreativeStudioCloseHandshake(dependencies).handleWindowClose(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(dependencies.queryUnsavedWork).not.toHaveBeenCalled();
  });

  it('closes a clean Pilot window and bypasses the recursive close event', async () => {
    const dependencies = createDependencies();
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    expect(handshake.handleWindowClose(createCloseEvent())).toBe(true);
    await vi.waitFor(() => expect(dependencies.closeWindow).toHaveBeenCalledOnce());
    expect(handshake.handleWindowClose(createCloseEvent())).toBe(false);
    expect(dependencies.hideWindow).not.toHaveBeenCalled();
  });

  it('flushes dirty work only after the save choice', async () => {
    const dependencies = createDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 2 })),
      showMessageBox: vi.fn(async () => ({ response: 0 })),
    });

    createCreativeStudioCloseHandshake(dependencies).handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(dependencies.closeWindow).toHaveBeenCalledOnce());
    expect(dependencies.showMessageBox).toHaveBeenCalledExactlyOnceWith({
      type: 'warning',
      buttons: [
        'conversation.creativeStudio.close.saveAndClose',
        'conversation.creativeStudio.close.discard',
        'conversation.creativeStudio.close.cancel',
      ],
      defaultId: 0,
      cancelId: 2,
      message: 'conversation.creativeStudio.close.unsavedMessage:2',
    });
    expect(dependencies.flushUnsavedWork).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 3_000 });
  });

  it('keeps dirty work open when the person cancels', async () => {
    const dependencies = createDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 1 })),
      showMessageBox: vi.fn(async () => ({ response: 2 })),
    });

    createCreativeStudioCloseHandshake(dependencies).handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(dependencies.showMessageBox).toHaveBeenCalledOnce());
    expect(dependencies.closeWindow).not.toHaveBeenCalled();
    expect(dependencies.flushUnsavedWork).not.toHaveBeenCalled();
  });

  it('requires explicit discard when the renderer query is unavailable', async () => {
    const dependencies = createDependencies({
      queryUnsavedWork: vi.fn(async () => Promise.reject(new Error('renderer timed out'))),
      showMessageBox: vi.fn(async () => ({ response: 0 })),
    });

    createCreativeStudioCloseHandshake(dependencies).handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(dependencies.closeWindow).toHaveBeenCalledOnce());
    expect(dependencies.showMessageBox).toHaveBeenCalledExactlyOnceWith({
      type: 'warning',
      buttons: ['conversation.creativeStudio.close.discard', 'conversation.creativeStudio.close.cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'conversation.creativeStudio.close.unavailableMessage',
    });
  });

  it('keeps the window open when unavailable-work discard is cancelled', async () => {
    const dependencies = createDependencies({
      queryUnsavedWork: vi.fn(async () => Promise.reject(new Error('renderer timed out'))),
      showMessageBox: vi.fn(async () => ({ response: 1 })),
    });

    createCreativeStudioCloseHandshake(dependencies).handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(dependencies.showMessageBox).toHaveBeenCalledOnce());
    expect(dependencies.closeWindow).not.toHaveBeenCalled();
  });

  it('falls back to bounded discard review when a save cannot complete', async () => {
    const showMessageBox = vi.fn().mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 });
    const dependencies = createDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 1 })),
      flushUnsavedWork: vi.fn(async () => Promise.reject(new Error('flush timed out'))),
      showMessageBox,
    });

    createCreativeStudioCloseHandshake(dependencies).handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(2));
    expect(showMessageBox.mock.calls[1]?.[0]).toMatchObject({
      buttons: ['conversation.creativeStudio.close.discard', 'conversation.creativeStudio.close.cancel'],
    });
    expect(dependencies.closeWindow).not.toHaveBeenCalled();
  });

  it('closes only after explicit discard when flush reports unsaved work', async () => {
    const showMessageBox = vi.fn().mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 0 });
    const dependencies = createDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 1 })),
      flushUnsavedWork: vi.fn(async () => ({ saved: false })),
      showMessageBox,
    });

    createCreativeStudioCloseHandshake(dependencies).handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(dependencies.closeWindow).toHaveBeenCalledOnce());
    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });

  it('coalesces repeated close events into one renderer query', async () => {
    let resolveQuery: ((value: { dirtyDraftCount: number }) => void) | undefined;
    const dependencies = createDependencies({
      queryUnsavedWork: vi.fn(
        () =>
          new Promise<{ dirtyDraftCount: number }>((resolve) => {
            resolveQuery = resolve;
          })
      ),
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    handshake.handleWindowClose(createCloseEvent());
    handshake.handleWindowClose(createCloseEvent());

    expect(dependencies.queryUnsavedWork).toHaveBeenCalledOnce();
    resolveQuery?.({ dirtyDraftCount: 0 });
    await vi.waitFor(() => expect(dependencies.closeWindow).toHaveBeenCalledOnce());
  });

  it('hides before explicit quit and bypasses its confirmed retry', async () => {
    const calls: string[] = [];
    const dependencies = createDependencies({
      hideWindow: vi.fn(() => calls.push('hide')),
      quitApp: vi.fn(() => calls.push('quit')),
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    expect(handshake.handleBeforeQuit(createCloseEvent())).toBe(true);
    await vi.waitFor(() => expect(dependencies.quitApp).toHaveBeenCalledOnce());
    expect(calls).toEqual(['hide', 'quit']);
    expect(handshake.handleBeforeQuit(createCloseEvent())).toBe(false);
  });

  it('cancels explicit quit without hiding and permits a later retry', async () => {
    const showMessageBox = vi.fn().mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 1 });
    const dependencies = createDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 1 })),
      showMessageBox,
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    handshake.handleBeforeQuit(createCloseEvent());
    await vi.waitFor(() => expect(dependencies.onQuitCancelled).toHaveBeenCalledOnce());
    expect(dependencies.hideWindow).not.toHaveBeenCalled();
    handshake.handleBeforeQuit(createCloseEvent());
    await vi.waitFor(() => expect(dependencies.quitApp).toHaveBeenCalledOnce());
  });
});
