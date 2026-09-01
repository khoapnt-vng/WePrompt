/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Schema-6 Director subprocess authority. No schema-5 proposal or route paths cross this boundary. */
export const STUDIO_PILOT_ENV = {
  projectId: 'AIONUI_STUDIO_PROJECT_ID',
  projectDir: 'AIONUI_STUDIO_PROJECT_DIR',
} as const;

export type StudioPilotDirectorSessionAuthorityV3 = {
  serverId: string;
  serverName: string;
  scriptPath: string;
  projectDir: string;
};
