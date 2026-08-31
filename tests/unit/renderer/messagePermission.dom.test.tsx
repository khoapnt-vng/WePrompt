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
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
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
 * Transcribed from AionCore v0.1.51, not invented. A Director MCP tool call reaches the renderer
 * through the Aionrs protocol sink, which builds the confirmation at
 * `crates/aionui-ai-agent/src/capability/backend_protocol_sink.rs:31-59`:
 *
 *   title        = format!("{} wants to use: {}", category, tool_name)
 *   action       = Some(tool_name.to_string())        <- the TOOL NAME, never a category
 *   command_type = Some(category.to_string())         <- the only category signal
 *   options      = [proceed_once, proceed_always, cancel] with i18n keys as labels
 *
 * `command_type` is `"mcp"` because `aion-mcp/src/tool_proxy.rs:89` reports `ToolCategory::Mcp` for
 * every proxied MCP tool and its Display impl writes "mcp" (aionrs; verified present and identical in
 * 0.2.6 and 0.2.8, which bracket the pinned v0.2.7). Wire keys are snake_case because
 * `aionui-common/src/types.rs:52-60` declares `Confirmation` with no serde rename — corroborated by
 * this component already reading `call_id` successfully from the same object.
 *
 * Do not "tidy" these values. They are the wire shape.
 */
const directorMcpConfirmation = {
  id: 'conf-mcp-1',
  call_id: 'call-mcp-1',
  title: 'mcp wants to use: studio_get_project_status',
  action: 'studio_get_project_status',
  description: 'MCP aionui-creative-studio/studio_get_project_status: {}',
  command_type: 'mcp',
  options: [
    { label: 'messages.confirmation.yesAllowOnce', value: 'proceed_once' },
    { label: 'messages.confirmation.yesAllowAlways', value: 'proceed_always' },
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
