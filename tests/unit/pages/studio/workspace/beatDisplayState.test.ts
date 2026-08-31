/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { WORKSPACE_BEAT_DISPLAY_STATE_KEYS } from '@/renderer/pages/studio/components/Workspace/Views/beatDisplayState';

describe('shared Workspace Beat display-state copy', () => {
  it('owns the existing ten-state map without collapsing it into Shot status words', () => {
    expect(WORKSPACE_BEAT_DISPLAY_STATE_KEYS).toEqual({
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
    });
    expect(Object.keys(WORKSPACE_BEAT_DISPLAY_STATE_KEYS)).toHaveLength(10);
  });
});
