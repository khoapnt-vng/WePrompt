/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';

const { createServerMock, updateServerMock, importServersMock, toggleServerMock, messageErrorMock } = vi.hoisted(
  () => ({
    createServerMock: vi.fn(),
    updateServerMock: vi.fn(),
    importServersMock: vi.fn(),
    toggleServerMock: vi.fn(),
    messageErrorMock: vi.fn(),
  })
);

vi.mock('@arco-design/web-react', () => ({
  Message: { error: messageErrorMock, success: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {
    createServer: { invoke: createServerMock },
    updateServer: { invoke: updateServerMock },
    importServers: { invoke: importServersMock },
    toggleServer: { invoke: toggleServerMock },
  },
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  isBackendHttpError: () => false,
}));

import { useMcpServerCRUD } from '@/renderer/hooks/mcp/useMcpServerCRUD';

const serverData = (name: string) => ({
  name,
  description: 'desc',
  transport: { type: 'stdio' as const, command: 'npx', args: ['-y', 'thing'] },
  original_json: '{}',
  enabled: true,
  builtin: false,
});

const persisted = (name: string): IMcpServer =>
  ({ ...serverData(name), id: `id-${name}`, created_at: 1, updated_at: 1 }) as unknown as IMcpServer;

const setup = () => {
  const saveMcpServers = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useMcpServerCRUD(saveMcpServers));
  return { result, saveMcpServers };
};

describe('useMcpServerCRUD reserved-name guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServerMock.mockImplementation((payload: { name: string }) => Promise.resolve(persisted(payload.name)));
    updateServerMock.mockImplementation(({ data }: { data: { name: string } }) =>
      Promise.resolve(persisted(data.name))
    );
    importServersMock.mockImplementation(({ servers }: { servers: Array<{ name: string }> }) =>
      Promise.resolve(servers.map((server) => persisted(server.name)))
    );
    toggleServerMock.mockImplementation((input: { id: string }) => Promise.resolve(persisted(input.id)));
  });

  it('refuses to register a server claiming the auto-approved team name', async () => {
    const { result } = setup();

    let created: IMcpServer | undefined;
    await act(async () => {
      created = await result.current.handleAddMcpServer(serverData('aionui-team'));
    });

    expect(created).toBeUndefined();
    expect(createServerMock).not.toHaveBeenCalled();
  });

  it('tells the user why the registration was refused', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.handleAddMcpServer(serverData('aionui-team'));
    });

    expect(messageErrorMock).toHaveBeenCalledWith('settings.mcpJsonReservedNameError');
  });

  it('still registers an ordinary server name', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.handleAddMcpServer(serverData('my-postgres'));
    });

    expect(createServerMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a rename onto a reserved name, so the add guard cannot be sidestepped by editing', async () => {
    const { result } = setup();
    const existing = persisted('harmless');

    let updated: IMcpServer | undefined;
    await act(async () => {
      updated = await result.current.handleEditMcpServer(existing, serverData('aionui-creative-studio'));
    });

    expect(updated).toBeUndefined();
    expect(updateServerMock).not.toHaveBeenCalled();
  });

  it('drops reserved entries from a batch import but still imports the rest', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.handleBatchImportMcpServers([serverData('my-postgres'), serverData('aionui-team')]);
    });

    expect(importServersMock).toHaveBeenCalledTimes(1);
    const sent = importServersMock.mock.calls[0][0].servers.map((server: { name: string }) => server.name);
    expect(sent).toEqual(['my-postgres']);
  });

  it('sends nothing when every entry in a batch import is reserved', async () => {
    const { result } = setup();

    let imported: IMcpServer[] | undefined;
    await act(async () => {
      imported = await result.current.handleBatchImportMcpServers([serverData('aionui-team')]);
    });

    expect(imported).toBeUndefined();
    expect(importServersMock).not.toHaveBeenCalled();
  });
});
