/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOCUMENTS = [
  'docs/design/creative-studio-2-director-autonomy-roadmap.md',
  'docs/design/creative-studio-2-design-handoff.md',
  'docs/design/creative-studio-2-programme-plan.md',
  'docs/design/creative-studio-2-handoff-state.md',
] as const;

const PHASE_2_STATUS_HEADING = '## Current Phase 2 status';
const PHASE_2_DECISION = [
  'Phase 2A is the Level 1 happy path over the existing flat storyboard. Phase 2B broadens that',
  'happy path with Section -> Clip -> Take and Table/Board review. Phase 2C hardens Level 1 with',
  'versioned recovery/checkpointing and exactly-once attribution. 2A/2B are not full or hardened',
  'Level 1. Their direct edits are temporarily not generally undoable; StudioRuleListUndo remains',
  'rule-list-specific and unchanged. Paid authority remains Phase 3b.',
].join('\n');
const TEMPORARY_RECOVERY_BOUNDARY = [
  '`set_brief` is the sharpest temporary recovery gap. CAS and receipts prevent stale/ambiguous writes',
  'but are not undo.',
].join('\n');

const phase2Status = (document: string): string => {
  const start = document.indexOf(PHASE_2_STATUS_HEADING);
  const end = document.indexOf('\n## ', start + PHASE_2_STATUS_HEADING.length);

  return document.slice(start, end === -1 ? undefined : end);
};

const readCurrentPhase2Status = async (path: string): Promise<string> => {
  const document = await readFile(resolve(process.cwd(), path), 'utf8');

  return phase2Status(document);
};

describe('Creative Studio 2 authority documents', () => {
  it.each(DOCUMENTS)('defines the staged Level 1 boundary in %s', async (path) => {
    const status = await readCurrentPhase2Status(path);

    expect(status).toContain(PHASE_2_STATUS_HEADING);
    expect(status).toContain(PHASE_2_DECISION);
  });

  it.each(DOCUMENTS)('names the temporary recovery boundary in %s', async (path) => {
    const status = await readCurrentPhase2Status(path);

    expect(status).toContain(TEMPORARY_RECOVERY_BOUNDARY);
  });

  it.each(DOCUMENTS)('excludes superseded Level 1 claims from the current status in %s', async (path) => {
    const status = await readCurrentPhase2Status(path);

    expect(status).not.toMatch(/undoable from (?:the )?first phase onward/i);
    expect(status).not.toMatch(/phase 2 completes level 1/i);
  });
});
