/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessagePermission } from '@/common/chat/chatLib';
import MessageAcpPermission from '@/renderer/pages/conversation/Messages/acp/MessageAcpPermission';
import MessagePermission from '@/renderer/pages/conversation/Messages/components/MessagePermission';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const confirmInvoke = vi.hoisted(() => vi.fn());
const confirmMessageInvoke = vi.hoisted(() => vi.fn());
const messageError = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { confirmation: { confirm: { invoke: confirmInvoke } } },
  },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: { confirmMessage: { invoke: confirmMessageInvoke } },
}));

// Real Arco, except `Message` — it mounts through the legacy ReactDOM.render that React 18
// removed, which throws an unhandled error inside jsdom.
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return { ...actual, Message: { ...actual.Message, error: messageError } };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === 'messages.confirmation.yesAlwaysAllowTool' || key === 'messages.confirmation.allowMCPTool'
        ? `${key}:${String(options?.serverName)}:${String(options?.toolName)}`
        : typeof options?.defaultValue === 'string'
          ? options.defaultValue
          : key,
  }),
}));

const buildMessage = (overrides: Partial<IMessagePermission['content']> = {}): IMessagePermission =>
  ({
    id: 'm1',
    msg_id: 'm1',
    conversation_id: 'c1',
    type: 'permission',
    position: 'center',
    content: {
      id: 'p1',
      call_id: 'call-1',
      action: 'exec',
      description: 'ls -la',
      options: [
        { label: 'Allow', value: 'proceed' },
        { label: 'Deny', value: 'deny' },
      ],
      ...overrides,
    },
  }) as IMessagePermission;

const acpMessage = {
  id: 'm2',
  conversation_id: 'c1',
  type: 'acp_permission',
  position: 'center',
  content: {
    tool_call: { tool_call_id: 'tc-1', kind: 'execute', title: 'Run a command' },
    options: [
      { option_id: 'allow', name: 'Allow' },
      { option_id: 'deny', name: 'Deny' },
    ],
  },
} as never;

describe('MessagePermission', () => {
  beforeEach(() => {
    confirmInvoke.mockReset();
    confirmMessageInvoke.mockReset();
    messageError.mockReset();
  });

  it('surfaces a toast and stays answerable when the confirm IPC rejects', async () => {
    confirmInvoke.mockRejectedValue(new Error('agent gone'));
    render(<MessagePermission message={buildMessage()} />);

    fireEvent.click(screen.getByTestId('message-permission-option-proceed'));

    await waitFor(() => expect(messageError).toHaveBeenCalledWith('messages.permissionResponseFailed'));
    // The card must not flip to "response sent" — the agent is still blocked.
    expect(screen.queryByText('messages.responseSentSuccessfully')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('message-permission-option-proceed')).not.toBeDisabled());
  });

  it('shows the spinner on the pressed option and disables only its siblings', async () => {
    let resolveConfirm: (() => void) | undefined;
    confirmInvoke.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveConfirm = resolve;
      })
    );
    render(<MessagePermission message={buildMessage()} />);

    fireEvent.click(screen.getByTestId('message-permission-option-proceed'));

    await waitFor(() =>
      expect(screen.getByTestId('message-permission-option-proceed').className).toContain('arco-btn-loading')
    );
    expect(screen.getByTestId('message-permission-option-deny')).toBeDisabled();

    resolveConfirm?.();
    await waitFor(() => expect(screen.getByText('messages.responseSentSuccessfully')).toBeTruthy());
  });

  it('reddens the warning and the affirmative option for a destructive request', () => {
    render(
      <MessagePermission
        message={buildMessage({
          description: 'rm -rf build',
          options: [
            { label: 'Allow', value: 'proceed' },
            { label: 'Always allow', value: 'proceed_always' },
            { label: 'Deny', value: 'deny' },
          ],
        })}
      />
    );

    expect(screen.getByText('messages.permission.destructiveWarning').className).toContain('text-danger');
    expect(screen.getByTestId('message-permission-option-proceed').className).toContain('arco-btn-status-danger');
    // "Always allow" stays deliberately muted so auto-approving deletes is not a casual default.
    expect(screen.getByTestId('message-permission-option-proceed_always').className).not.toContain(
      'arco-btn-status-danger'
    );
  });

  it('renders an icon component rather than an emoji glyph', () => {
    const { container } = render(<MessagePermission message={buildMessage()} />);
    expect(container.querySelector('[data-testid="permission-icon-exec"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('uses the generic presentation and sends the exact always-allow response', async () => {
    confirmInvoke.mockResolvedValue(undefined);
    const message = {
      ...buildMessage({
        action: 'unknown_tool',
        title: 'Review this tool',
        description: '',
        options: [{ label: 'Always allow', value: 'proceed_always' }],
      }),
      msg_id: '',
    } as IMessagePermission;
    render(<MessagePermission message={message} />);

    expect(screen.getByTestId('permission-icon-generic')).toBeTruthy();
    expect(screen.getByText('Review this tool')).toBeTruthy();
    fireEvent.click(screen.getByTestId('message-permission-option-proceed_always'));

    await waitFor(() =>
      expect(confirmInvoke).toHaveBeenCalledWith({
        conversation_id: 'c1',
        call_id: 'call-1',
        msg_id: '',
        data: { value: 'proceed_always' },
        always_allow: true,
      })
    );
  });

  it('explains when a permission request has no response options', () => {
    render(<MessagePermission message={buildMessage({ options: undefined })} />);
    expect(screen.getByText('messages.noOptionsAvailable')).toBeTruthy();
  });
});

describe('MessageAcpPermission', () => {
  beforeEach(() => {
    confirmMessageInvoke.mockReset();
    messageError.mockReset();
  });

  it('surfaces a toast when the confirm IPC rejects', async () => {
    confirmMessageInvoke.mockRejectedValue(new Error('call_id stale'));
    render(<MessageAcpPermission message={acpMessage} />);

    fireEvent.click(screen.getByTestId('message-acp-permission-option-allow'));

    await waitFor(() => expect(messageError).toHaveBeenCalledWith('messages.permissionResponseFailed'));
    expect(screen.queryByText('messages.responseSentSuccessfully')).toBeNull();
  });

  it('shows the spinner on the pressed option and renders an icon component', async () => {
    let resolveConfirm: (() => void) | undefined;
    confirmMessageInvoke.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveConfirm = resolve;
      })
    );
    const { container } = render(<MessageAcpPermission message={acpMessage} />);

    expect(container.querySelector('[data-testid="acp-permission-icon-execute"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);

    fireEvent.click(screen.getByTestId('message-acp-permission-option-allow'));
    await waitFor(() =>
      expect(screen.getByTestId('message-acp-permission-option-allow').className).toContain('arco-btn-loading')
    );
    expect(screen.getByTestId('message-acp-permission-option-deny')).toBeDisabled();

    resolveConfirm?.();
    await waitFor(() => expect(screen.getByText('messages.responseSentSuccessfully')).toBeTruthy());
  });
});

/**
 * A Director MCP tool call reaches the renderer through AionCore's Aionrs protocol sink. The
 * backend carries the exact raw server/tool identity separately from display text:
 *
 *   action        = the registered proxy name, never a category
 *   command_type  = "mcp"
 *   mcp_identity  = the raw server name + raw MCP tool name
 *   proceed_always = exact-tool approval, never a server-wide grant
 *
 * Do not derive authority identity from `action`, title, or description: proxy names may be
 * collision-qualified and all three are presentation fields.
 */
const directorMcpConfirmation = {
  id: 'conf-mcp-1',
  call_id: 'call-mcp-1',
  title: 'mcp wants to use: studio_get_project_status',
  action: 'studio_get_project_status',
  description: 'MCP aionui-creative-studio/studio_get_project_status: {}',
  command_type: 'mcp',
  mcp_identity: {
    server_name: 'aionui-creative-studio',
    tool_name: 'studio_get_project_status',
  },
  options: [
    { label: 'messages.confirmation.yesAllowOnce', value: 'proceed_once' },
    {
      label: 'messages.confirmation.yesAlwaysAllowTool',
      value: 'proceed_always',
      params: { serverName: 'aionui-creative-studio', toolName: 'studio_get_project_status' },
    },
    { label: 'messages.confirmation.no', value: 'cancel' },
  ],
};

describe('MessagePermission — Director MCP wire payload', () => {
  beforeEach(() => {
    confirmInvoke.mockReset();
    confirmMessageInvoke.mockReset();
    messageError.mockReset();
  });

  it('announces a real Director MCP payload as a tool, not as a shell command', () => {
    render(<MessagePermission message={buildMessage(directorMcpConfirmation)} />);

    expect(screen.getByText('messages.permission.intent.tool')).toBeTruthy();
    expect(screen.queryByText('messages.permission.intent.run')).toBeNull();
    expect(screen.getByTestId('permission-icon-mcp')).toBeTruthy();
    expect(screen.getByTestId('permission-mcp-identity').textContent).toBe(
      'messages.confirmation.allowMCPTool:aionui-creative-studio:studio_get_project_status'
    );
  });

  it('renders control and bidi characters as visible escapes without changing raw identity', () => {
    const serverName = 'studio\u{202e}res\nver';
    const toolName = 'raw\0tool';
    const message = buildMessage({
      ...directorMcpConfirmation,
      mcp_identity: { server_name: serverName, tool_name: toolName },
      description: `MCP ${serverName}/${toolName}`,
    });

    render(<MessagePermission message={message} />);

    expect(message.content.mcp_identity).toEqual({ server_name: serverName, tool_name: toolName });
    expect(screen.getByTestId('permission-mcp-identity').textContent).toBe(
      'messages.confirmation.allowMCPTool:studio\\u{202E}res\\u{000A}ver:raw\\u{0000}tool'
    );
    expect(screen.getByTestId('message-permission-card').textContent).not.toContain('\u{202e}');
    expect(screen.getByTestId('message-permission-card').textContent).not.toContain('\0');
  });

  it('labels Always as an exact server/tool grant using sanitized identity params', () => {
    render(
      <MessagePermission
        message={buildMessage({
          ...directorMcpConfirmation,
          mcp_identity: { server_name: 'server\u{202e}name', tool_name: 'tool\nname' },
          options: [
            { label: 'messages.confirmation.yesAllowOnce', value: 'proceed_once' },
            {
              label: 'messages.confirmation.yesAlwaysAllowTool',
              value: 'proceed_always',
              // The renderer does not trust backend interpolation params when exact raw identity exists.
              params: { serverName: 'spoofed', toolName: 'spoofed' },
            },
            { label: 'messages.confirmation.no', value: 'cancel' },
          ],
        })}
      />
    );

    expect(screen.getByTestId('message-permission-option-proceed_always').textContent).toBe(
      'messages.confirmation.yesAlwaysAllowTool:server\\u{202E}name:tool\\u{000A}name'
    );
    expect(screen.queryByText(/yesAlwaysAllowServer/)).toBeNull();
  });

  it('keeps announcing an exec-category payload of the same shape as a command', () => {
    // The Aionrs sink fills `action` with the tool name for every category, so this payload differs
    // from the MCP one only in `command_type`. It is the regression that matters: permissionIntent is
    // shared conversation surface and every conversation type renders through it.
    render(
      <MessagePermission
        message={buildMessage({
          ...directorMcpConfirmation,
          title: 'exec wants to use: Bash',
          action: 'Bash',
          description: 'ls -la',
          command_type: 'exec',
        })}
      />
    );

    expect(screen.getByText('messages.permission.intent.run')).toBeTruthy();
    expect(screen.queryByText('messages.permission.intent.tool')).toBeNull();
  });

  it('lets a destructive description outrank the MCP category', () => {
    render(
      <MessagePermission message={buildMessage({ ...directorMcpConfirmation, description: 'rm -rf /tmp/studio' })} />
    );

    expect(screen.getByText('messages.permission.intent.destructive')).toBeTruthy();
  });
});
