/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turn a raw permission request (backend-supplied title/description + action)
 * into a plain-language intent for the UI, plus a conservative "destructive"
 * flag so the prompt can caution before irreversible file operations.
 *
 * Design notes:
 * - The plain intent is a SUMMARY only. The exact command is always shown
 *   alongside it by the caller, so an imperfect summary can never mislead the
 *   user about what they're approving.
 * - Destructive detection errs toward flagging: a false positive is just an
 *   extra (harmless) caution, a false negative would hide a real risk. It keeps
 *   precedence over every other intent, including an MCP tool call.
 * - `commandType` is the backend's `command_type`. For an MCP call `action` is
 *   the tool name, not a category, so this is the only field that identifies
 *   the request as a tool rather than a shell command.
 */

export type PermissionSummary = {
  /** i18n key for the plain-language intent line. */
  intentKey: string;
  /** True when the command looks like it deletes or overwrites files. */
  destructive: boolean;
  /** The command to display, with any "Execute:"-style label stripped. */
  command: string;
};

const COMMAND_LABEL = /^\s*(?:execute|run|command|exec|shell)\s*:\s*/i;

// Deletes / overwrites that cannot be undone. Anchored to a token boundary so
// "confirm" doesn't match "rm", etc.
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /(?:^|[\s;&|(])rm(?:\s|$)/i,
  /(?:^|[\s;&|(])rmdir(?:\s|$)/i,
  /(?:^|[\s;&|(])unlink(?:\s|$)/i,
  /(?:^|[\s;&|(])shred(?:\s|$)/i,
  /(?:^|[\s;&|(])truncate(?:\s|$)/i,
  /(?:^|[\s;&|(])dd(?:\s|$)/i,
  /(?:^|[\s;&|(])del(?:\s|$)/i, // Windows delete
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-\S*f/i,
];

export const extractCommand = (raw?: string): string => (raw ?? '').replace(COMMAND_LABEL, '').trim();

export const isDestructiveCommand = (command: string): boolean =>
  command.length > 0 && DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));

export const summarizePermission = (input: {
  action?: string;
  command?: string;
  commandType?: string;
}): PermissionSummary => {
  const command = extractCommand(input.command);
  const destructive = isDestructiveCommand(command);
  const action = (input.action ?? '').toLowerCase();
  const commandType = (input.commandType ?? '').toLowerCase();

  let intentKey = 'messages.permission.intent.generic';
  if (destructive) {
    intentKey = 'messages.permission.intent.destructive';
  } else if (action === 'edit') {
    intentKey = 'messages.permission.intent.edit';
  } else if (action === 'read' || action === 'info') {
    intentKey = 'messages.permission.intent.read';
  } else if (action === 'fetch') {
    intentKey = 'messages.permission.intent.fetch';
  } else if (commandType === 'mcp' || action === 'mcp') {
    // `action` carries the tool name for an MCP call, so the marker is in `command_type`. Without
    // this the populated MCP description reached the exec fall-through below and a tool call was
    // announced as "I'd like to run a command" — which is why BUG-190 was diagnosed against the
    // wrong renderer path twice.
    intentKey = 'messages.permission.intent.tool';
  } else if (action === 'exec' || command.length > 0) {
    intentKey = 'messages.permission.intent.run';
  }

  return { intentKey, destructive, command };
};
