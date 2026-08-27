/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceBeatDisplayState } from '../workspaceProjection';

export const WORKSPACE_BEAT_DISPLAY_STATE_KEYS = {
  duration_pending: 'conversation.creativeStudio.workspace.table.state.durationPending',
  no_coverage: 'conversation.creativeStudio.workspace.table.state.noCoverage',
  seed_pending: 'conversation.creativeStudio.workspace.table.state.seedPending',
  part_done: 'conversation.creativeStudio.workspace.table.state.partDone',
  needs_attention: 'conversation.creativeStudio.workspace.table.state.needsAttention',
  rendering: 'conversation.creativeStudio.workspace.table.state.rendering',
  stale: 'conversation.creativeStudio.workspace.table.state.stale',
  status_pending: 'conversation.creativeStudio.workspace.table.state.statusPending',
  ready: 'conversation.creativeStudio.workspace.table.state.ready',
  draft: 'conversation.creativeStudio.workspace.table.state.draft',
} as const satisfies Record<WorkspaceBeatDisplayState, string>;
