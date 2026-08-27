/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2,
  STUDIO_MAX_MUTATION_OPERATIONS,
} from '@/common/types/project/creativeStudioTypes';

import {
  DIRECTOR_PRESET_RULES,
  directorOpeningTurn,
  directorOpeningTurnStorageKey,
  seedDirectorOpeningTurn,
} from '@/renderer/pages/studio/components/Workspace/DirectorRail/openingTurn';

/** A storage double. jsdom's Storage is a Proxy, so spying on the real one silently no-ops. */
const storageDouble = (): Storage & { written: Record<string, string> } => {
  const written: Record<string, string> = {};
  return {
    written,
    getItem: (key: string) => written[key] ?? null,
    setItem: (key: string, value: string) => {
      written[key] = value;
    },
    removeItem: (key: string) => {
      delete written[key];
    },
    clear: () => {
      for (const key of Object.keys(written)) delete written[key];
    },
    key: () => null,
    length: 0,
  } as Storage & { written: Record<string, string> };
};

describe('the Director opening turn', () => {
  it('carries the brief the person typed into the composer', () => {
    expect(directorOpeningTurn('  A dog finds a lost shoe  ')).toBe('A dog finds a lost shoe');
  });

  it('has nothing to say when the brief is blank', () => {
    // A project can reach the rail with an empty brief through paths the composer does not own.
    // Sending an empty turn would spend a Director turn to say nothing.
    expect(directorOpeningTurn('')).toBeNull();
    expect(directorOpeningTurn('   \n  ')).toBeNull();
  });

  it('seeds under the key AionrsSendBox actually reads', () => {
    // The key template is written out by hand in two other files. A third hand-written copy that
    // drifts would seed a key nobody reads, and the failure is silent: no opening turn, no error.
    const consumer = readFileSync(
      resolve(process.cwd(), 'packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx'),
      'utf8'
    );
    const template = /`([a-z_]+)\$\{conversation_id\}`/.exec(consumer);
    expect(template, 'AionrsSendBox no longer builds the key this way').not.toBeNull();
    expect(directorOpeningTurnStorageKey('conv_1')).toBe(`${template![1]}conv_1`);
  });

  it('writes a payload the consumer can parse', () => {
    const storage = storageDouble();
    expect(seedDirectorOpeningTurn('conv_1', 'A dog finds a lost shoe', storage)).toBe(true);
    const raw = storage.written[directorOpeningTurnStorageKey('conv_1')];
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!)).toEqual({ input: 'A dog finds a lost shoe' });
  });

  it('does not seed a blank brief', () => {
    const storage = storageDouble();
    expect(seedDirectorOpeningTurn('conv_1', '   ', storage)).toBe(false);
    expect(Object.keys(storage.written)).toHaveLength(0);
  });

  it('reports failure rather than throwing when storage refuses the write', () => {
    // A rail that cannot seed must still attach. Losing the opening turn costs a retype; throwing
    // here would lose the Director entirely.
    const refusing = {
      ...storageDouble(),
      setItem: vi.fn(() => {
        throw new Error('quota');
      }),
    } as unknown as Storage;
    expect(() => seedDirectorOpeningTurn('conv_1', 'A dog finds a lost shoe', refusing)).not.toThrow();
    expect(seedDirectorOpeningTurn('conv_1', 'A dog finds a lost shoe', refusing)).toBe(false);
  });
});

describe('the Director preset rules', () => {
  it('tells the Director to ask before it builds', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/ask/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/before/i);
  });

  it('ends the authoring brake when the person agrees or directly asks to build or draft', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/brake ends[\s\S]*explicitly agrees to a direction/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/directly asks you to build or draft the film/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/authorizes free authoring only; it never authorizes paid generation/i);
  });

  it('names the two tools it must not reach for unprompted', () => {
    // Naming them is what makes the instruction actionable; "do not act" alone is advice.
    expect(DIRECTOR_PRESET_RULES).toContain('studio_apply_edits');
    expect(DIRECTOR_PRESET_RULES).toContain('propose_storyboard');
  });

  it('leaves the free reads free, so asking well is not also blocked', () => {
    expect(DIRECTOR_PRESET_RULES).toContain('read_storyboard');
    expect(DIRECTOR_PRESET_RULES).toContain('studio_get_project_status');
    expect(DIRECTOR_PRESET_RULES).toContain('studio_get_proposal');
    expect(DIRECTOR_PRESET_RULES).toContain('studio_list_routes');
    expect(DIRECTOR_PRESET_RULES).toMatch(/start with studio_get_project_status/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/detail: true.*only/i);
  });

  it('requires an exact proposal read and current storyboard before drafting a replacement', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/studio_get_proposal with the\s+full proposal ID/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/read_storyboard for current authority/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never silently rebase, apply, approve, reject, or substitute/i);
  });

  it('distinguishes historical receipts from fresh status and route reads', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/studio_get_command_status reports one exact past command or query outcome/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/not a fresh project or\s+route read/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/studio_get_project_status or studio_list_routes again/i);
  });

  it('keeps shooting scripts bounded to shot-specific content without duplicating global composition inputs', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/shootingScript bounded to shot-specific visible depiction and action/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never repeat the project\s+brief/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/project or organization rules/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/BOARD STYLE, or STYLE boilerplate/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/app composes those\s+global instructions separately/i);

    // Prompt tuning must not displace the Wave 6 status-read procedure.
    expect(DIRECTOR_PRESET_RULES).toMatch(/start with studio_get_project_status/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/detail: true.*only/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/studio_get_project_status or studio_list_routes again/i);
  });

  it('describes every governed operation from the exact shared disposition policy', () => {
    for (const [operation, disposition] of Object.entries(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2)) {
      const heading =
        disposition === 'proposal'
          ? 'Permitted through propose_storyboard and human review:'
          : disposition === 'direct'
            ? 'Permitted directly through studio_apply_edits:'
            : 'Unavailable to you:';
      const section = DIRECTOR_PRESET_RULES.slice(
        DIRECTOR_PRESET_RULES.indexOf(heading),
        DIRECTOR_PRESET_RULES.indexOf('\n', DIRECTOR_PRESET_RULES.indexOf(heading))
      );
      expect(section, `${operation} must be described as ${disposition}`).toContain(operation);
    }
  });

  it('authors Beats and Shots through review without claiming it can spend', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/permitted to create and edit Beats and Shots/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/author the storyboard with propose_storyboard/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/agrees a[\s\S]*direction, or directly asks you to build or draft/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never start or confirm paid generation/i);
  });

  it('drafts the storyboard as a numbered phase before it plans references', () => {
    const direction = DIRECTOR_PRESET_RULES.indexOf('1. Agree the direction');
    const storyboard = DIRECTOR_PRESET_RULES.indexOf('2. Draft the storyboard before planning canonical references');
    const references = DIRECTOR_PRESET_RULES.indexOf('3. Plan and request canonical references');
    expect(direction).toBeGreaterThanOrEqual(0);
    expect(storyboard).toBeGreaterThan(direction);
    expect(references).toBeGreaterThan(storyboard);
  });

  it('requires one bounded proposal whose adjacent coverage operations create the Shots', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/exactly one\s+propose_storyboard call for the complete draft/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /for every new Beat, put add_beat immediately followed by\s+apply_coverage for that same Beat/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/apply_coverage shots array creates all of that Beat's Shots/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/6 Beats × 6 Shots film is 12 operations total/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/not 42 operations made from six add_shot calls per Beat/i);
    expect(DIRECTOR_PRESET_RULES).toContain(`The mutation batch cap is ${STUDIO_MAX_MUTATION_OPERATIONS}`);
    expect(DIRECTOR_PRESET_RULES).toMatch(/a 42-operation draft is rejected/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/one proposal and\s+one human review click/i);
  });

  it('uses coverage only for empty coverage and edit_shot for existing Shooting scripts', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /apply_coverage fills empty coverage and never rewrites an existing Shooting script/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/preserve every fixed\s+Shot exactly as read/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/use edit_shot for that exact Shot instead/i);
  });

  it('keeps a recorded proposal pending until a later read proves human acceptance', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/pending human review/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never claim.*applied/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/cannot approve or reject your own proposal/i);
  });

  it('closes out only exact tool-proven outcomes and names the action still owed', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/close every turn from positive tool evidence/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/applied when a current read proves the revision and values/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/recorded when the write result proves a record exists/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/queued when the result proves work is waiting/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/proposal pending human review is pending, not applied/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /reference request queued for the person to start[\s\S]*recorded work, not generated media/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /reference plan or current reference images do not complete the workflow[\s\S]*active Shot remains\s+unbound/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/Shots that still need set_shot_reference_binding as remaining work/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/rejected, failed, busy, unconfirmed, and storage_error.*incomplete/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/when the person owes an action, name that exact action/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/accept or revise a proposal/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/start reference\s+generation and confirm its spend/i);
  });

  it('forbids an evidence-free stock all-done claim', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/never use a stock claim such as "All done"/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/"everything went through as planned"/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/unless fresh tool\s+evidence proves every requested item complete/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/for mixed outcomes, list what is proved and what remains/i);
  });

  it('spells out the ordered app-owned current-reference workflow', () => {
    const orderedSteps = [
      'Call read_storyboard at the agreed revision',
      'set_reference_plan through studio_apply_edits',
      'Request character reference images first',
      'character requests are ready in References',
      '5. Read the fresh storyboard',
      'request background reference images',
      'background requests are ready in References',
      'Call read_storyboard again',
      'set_shot_reference_binding through studio_apply_edits',
    ];
    let previous = -1;
    for (const step of orderedSteps) {
      const index = DIRECTOR_PRESET_RULES.indexOf(step);
      expect(index, step).toBeGreaterThan(previous);
      previous = index;
    }
    expect(DIRECTOR_PRESET_RULES).toMatch(/do not invent\s+reference IDs/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/app owns them/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/recurring background.*discovered[\s\S]*amend_reference_plan/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never replace or repeat set_reference_plan/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/request only records work for human review; it does not\s+generate media/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/successful generation automatically makes the newest image current/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/approvedAssetId[\s\S]*means the reference already has a current image/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never ask[\s\S]*approve or confirm a current image in chat/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/free-text acknowledgement performs no UI action/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/choosing a different current image are human-only/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/once for\s+each active Shot/i);
  });

  it('answers in the language the person writes in, since the rules themselves are English', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/language/i);
  });
});
