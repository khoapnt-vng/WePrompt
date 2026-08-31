/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  extractCommand,
  isDestructiveCommand,
  summarizePermission,
} from '@/renderer/pages/conversation/Messages/components/permissionIntent';

describe('extractCommand', () => {
  it('strips an "Execute:"-style label and trims', () => {
    expect(extractCommand('Execute: rm "a.html"')).toBe('rm "a.html"');
    expect(extractCommand('  run:  ls -la  ')).toBe('ls -la');
    expect(extractCommand('rm x')).toBe('rm x');
    expect(extractCommand(undefined)).toBe('');
  });
});

describe('isDestructiveCommand', () => {
  it('flags deletes and irreversible operations', () => {
    expect(isDestructiveCommand('rm "/Users/me/Downloads/Project Home Screen.html"')).toBe(true);
    expect(isDestructiveCommand('rm -rf build')).toBe(true);
    expect(isDestructiveCommand('sudo rm foo')).toBe(true);
    expect(isDestructiveCommand('git reset --hard HEAD~1')).toBe(true);
    expect(isDestructiveCommand('git clean -fd')).toBe(true);
  });

  it('does not flag ordinary commands', () => {
    expect(isDestructiveCommand('ls -la')).toBe(false);
    expect(isDestructiveCommand('cat package.json')).toBe(false);
    expect(isDestructiveCommand('')).toBe(false);
  });

  it('errs toward caution: a command that merely mentions rm still flags', () => {
    // Conservative by design — a false positive is a harmless extra caution,
    // and the exact command is always shown so the user can judge.
    expect(isDestructiveCommand('grep -r rm .')).toBe(true);
  });
});

describe('summarizePermission', () => {
  it('summarizes a destructive command and keeps the raw command', () => {
    const summary = summarizePermission({ action: 'exec', command: 'Execute: rm "a.html"' });
    expect(summary.destructive).toBe(true);
    expect(summary.intentKey).toBe('messages.permission.intent.destructive');
    expect(summary.command).toBe('rm "a.html"');
  });

  it('maps non-destructive actions to plain intents', () => {
    expect(summarizePermission({ action: 'edit' }).intentKey).toBe('messages.permission.intent.edit');
    expect(summarizePermission({ action: 'read' }).intentKey).toBe('messages.permission.intent.read');
    expect(summarizePermission({ action: 'fetch' }).intentKey).toBe('messages.permission.intent.fetch');
    expect(summarizePermission({ action: 'mcp' }).intentKey).toBe('messages.permission.intent.tool');
    expect(summarizePermission({ action: 'exec', command: 'ls -la' }).intentKey).toBe('messages.permission.intent.run');
  });

  it('falls back to a generic intent when nothing is known', () => {
    const summary = summarizePermission({});
    expect(summary.intentKey).toBe('messages.permission.intent.generic');
    expect(summary.destructive).toBe(false);
    expect(summary.command).toBe('');
  });
  /*
   * An MCP tool call arrives with `action` set to the TOOL NAME, not to a category, and the `mcp`
   * marker in `command_type`. Before this was honoured the populated MCP description reached the
   * `command.length > 0` fall-through and a read-only tool call announced itself as "I'd like to run
   * a command" — the copy that made BUG-190 look like an exec-path defect to two readers in a row.
   */
  it('announces an MCP tool call as a tool, driven by command_type rather than action', () => {
    const summary = summarizePermission({
      action: 'studio_get_conditioning_frame',
      command: 'Read the conditioning frame for shot_2',
      commandType: 'mcp',
    });

    expect(summary.intentKey).toBe('messages.permission.intent.tool');
    expect(summary.destructive).toBe(false);
    // The exact request is still shown alongside the summary, so an imperfect summary cannot mislead.
    expect(summary.command).toBe('Read the conditioning frame for shot_2');
  });

  it('still announces a shell command as a command when command_type is not mcp', () => {
    // The regression that matters: this module is shared by every conversation type, so the exec path
    // must be provably unchanged.
    expect(summarizePermission({ action: 'exec', command: 'ls -la' }).intentKey).toBe('messages.permission.intent.run');
    expect(summarizePermission({ action: 'bash', command: 'cat package.json' }).intentKey).toBe(
      'messages.permission.intent.run'
    );
    expect(summarizePermission({ action: 'exec', command: 'npm test', commandType: 'npm' }).intentKey).toBe(
      'messages.permission.intent.run'
    );
  });

  it('keeps destructive precedence over an MCP tool call', () => {
    // Owner decision, 2026-08-31: destructive detection outranks every other intent, MCP included.
    // A false caution is cheaper than a missed one, and the raw request is always displayed.
    const summary = summarizePermission({
      action: 'some_tool',
      command: 'rm -rf build',
      commandType: 'mcp',
    });

    expect(summary.intentKey).toBe('messages.permission.intent.destructive');
    expect(summary.destructive).toBe(true);
  });

  it('accepts an mcp action directly, for any caller that sends a category instead of a tool name', () => {
    expect(summarizePermission({ action: 'mcp', command: 'anything' }).intentKey).toBe(
      'messages.permission.intent.tool'
    );
  });

  it('ignores an unknown command_type rather than guessing', () => {
    expect(summarizePermission({ action: 'read', command: 'a.txt', commandType: 'something_new' }).intentKey).toBe(
      'messages.permission.intent.read'
    );
  });
});
