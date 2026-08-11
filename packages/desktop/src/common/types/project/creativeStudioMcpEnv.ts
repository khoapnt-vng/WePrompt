/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// The env-var contract between the main process (which builds the Studio
// session-MCP descriptor) and the Studio MCP subprocess (which reads it).
// Both sides import these so a rename can never silently desync the two ends.

export const STUDIO_ENV = {
  projectId: 'AIONUI_STUDIO_PROJECT_ID',
  projectDir: 'AIONUI_STUDIO_PROJECT_DIR',
  pendingDir: 'AIONUI_STUDIO_PENDING_DIR',
} as const;
