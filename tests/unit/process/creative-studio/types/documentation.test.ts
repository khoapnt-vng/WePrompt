/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOCUMENTS = [
  'docs/design/creative-studio-2-director-autonomy-roadmap.md',
  'docs/design/creative-studio-2-design-handoff.md',
  'docs/design/creative-studio-2-programme-plan.md',
  'docs/design/creative-studio-2-handoff-state.md',
] as const;

const CLOSEOUT_AUTHORITY_DOCUMENTS = [
  'docs/design/creative-studio-2-director-autonomy-roadmap.md',
  'docs/design/creative-studio-2-programme-plan.md',
  'docs/design/creative-studio-2-handoff-state.md',
] as const;
const GATE_RECORDS = [
  'docs/design/creative-studio-2-gates/phase-1.md',
  'docs/design/creative-studio-2-gates/phase-2a.md',
] as const;
const OBSOLETE_PHASE_1_GATE = 'docs/design/creative-studio-2-phase-1-gate.md';
const PHASE_2_CLOSEOUT = 'Phase 2A happy path complete; Level 1 not hardened; 2B next; 2C remains recovery gate.';
const GATE_LINKS = [
  ['Phase 1', 'creative-studio-2-gates/phase-1.md'],
  ['Phase 2A', 'creative-studio-2-gates/phase-2a.md'],
] as const;
const PHASE_2A_GATE = 'docs/design/creative-studio-2-gates/phase-2a.md';
const FINAL_GATE_EVIDENCE = [
  /\|\s*Lint\s*\|\s*`bun run lint --quiet`\s*\|\s*exit 0; 1,244 warnings and 0 errors\s*\|/,
  /\|\s*Format\s*\|\s*`bun run format`\s*\|\s*exit 0\s*\|/,
  /\|\s*Post-format documentation\s*\|\s*`bunx vitest run tests\/unit\/process\/creative-studio\/types\/documentation\.test\.ts`\s*\|\s*exit 0; 1 file, 20\/20 passed\s*\|/,
  /\|\s*Diff check\s*\|\s*`git diff --check`\s*\|\s*exit 0\s*\|/,
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
  it('records the required final lint, format, documentation, and diff evidence in the Phase 2A gate', async () => {
    const gate = await readFile(resolve(process.cwd(), PHASE_2A_GATE), 'utf8');

    for (const evidence of FINAL_GATE_EVIDENCE) expect(gate).toMatch(evidence);
  });

  it('keeps both gate records and removes the obsolete flat Phase 1 gate', async () => {
    await expect(
      Promise.all(GATE_RECORDS.map((path) => readFile(resolve(process.cwd(), path), 'utf8')))
    ).resolves.toHaveLength(GATE_RECORDS.length);
    await expect(readFile(resolve(process.cwd(), OBSOLETE_PHASE_1_GATE), 'utf8')).rejects.toThrow('ENOENT');
  });

  it.each(CLOSEOUT_AUTHORITY_DOCUMENTS)(
    'links each closeout authority document to both gate records in %s',
    async (path) => {
      const document = await readFile(resolve(process.cwd(), path), 'utf8');

      for (const [label, target] of GATE_LINKS) {
        const link = document.match(new RegExp(`\\[${label}\\]\\(([^)]+)\\)`));

        expect(link?.[1]).toBe(target);
        await expect(readFile(resolve(process.cwd(), dirname(path), link![1]), 'utf8')).resolves.not.toBe('');
      }
    }
  );

  it.each(CLOSEOUT_AUTHORITY_DOCUMENTS)('records the Phase 2A closeout boundary in %s', async (path) => {
    const status = await readCurrentPhase2Status(path);

    expect(status).toContain(PHASE_2_CLOSEOUT);
  });

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
