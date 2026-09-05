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
  DIRECTOR_PRESET_RULES_PROFILE,
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
  it('publishes a compact profile marker for the renderer-visible readback', () => {
    expect(DIRECTOR_PRESET_RULES_PROFILE).toMatch(/^studio-director-rules-v1:[0-9a-f]+:[0-9a-f]{8}$/u);
    const [, encodedLength] = DIRECTOR_PRESET_RULES_PROFILE.split(':');
    expect(Number.parseInt(encodedLength!, 16)).toBe(DIRECTOR_PRESET_RULES.length);
    expect(DIRECTOR_PRESET_RULES_PROFILE).not.toContain(DIRECTOR_PRESET_RULES);
  });

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
    expect(DIRECTOR_PRESET_RULES).toMatch(/proposal IDs are tool inputs only/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never repeat.*identifier.*(?:person|reply)/is);
    expect(DIRECTOR_PRESET_RULES).toMatch(/read_storyboard for current authority/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never silently rebase, apply, approve, reject, or substitute/i);
  });

  it('distinguishes historical receipts from fresh status and route reads', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/studio_get_command_status reports one exact past command or query outcome/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/not a fresh project or\s+route read/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/studio_get_project_status or studio_list_routes again/i);
  });

  it('grants only fresh status-proven free recoveries and never owner-only spend authority', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/studio_get_project_status with detail: true immediately before acting/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/studio_apply_free_fix only when.*exact blocker remedy.*kind free_fix/is);
    expect(DIRECTOR_PRESET_RULES).toMatch(/retry_conditioning_frame or terminalize_refused_job/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/projectRevision as\s+expectedRevision/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/copy its exact dependentShotId or jobId/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never infer, translate, or reuse an older\s+remedy/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never use studio_apply_free_fix for a proposal or owner_only remedy/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /set_shot_reference_binding remains a normal studio_apply_edits operation, not a recovery/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /generation_submission_unknown and.*acknowledge_possible_duplicate_charge always stay owner-only/is
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/never terminalize or acknowledge them/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /terminalizing a refused submission.*never resubmits, authorizes, generates, or.*spends/is
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/conditioning repair may release only work the owner already authorized/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /read fresh detailed project status again before claiming the blocker cleared/i
    );
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

  it('requires the exact persisted predecessor frame before proposing or revising a chained Shot', () => {
    expect(DIRECTOR_PRESET_RULES).toContain('studio_get_conditioning_frame');
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /before proposing or revising any currently conditioned chained Shot.*studio_get_conditioning_frame/is
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/including before that Shot's first\s+generation/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /do not propose a downstream\s+Shooting script until its exact conditioning frame is available/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/describe what.*frame already shows, then move/is);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never.*substitute a poster or\s+seed still/is);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /claim a visual diagnosis when the exact\s+conditioning frame is unavailable/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/active\s+model cannot inspect the attached image/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/state that.*limitation.*do not submit a frame-aware revision/is);
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

  it('saves the agreed direction as the production brief before authoring the story', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/Before phase 2, restate the agreed direction/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/save it with set_brief[\s\S]*against a fresh project revision/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/do not invent answers they did not give/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/Never treat the initial one-line brief[\s\S]*clarification is complete/i);
  });

  it('follows the numbered journey from direction through the explicit Cut handoff', () => {
    const orderedPhases = [
      '1. Agree the direction',
      '2. Build the Storyline (storyboard and Shot plan) before planning canonical references',
      '3. Plan and request canonical references',
      '4. Guide production-quality Board frames through human review',
      '5. Guide paid video generation only after the frames are ready',
      '6. Hand the finished takes to an explicit Cut review and render',
    ];
    let previous = -1;
    for (const phase of orderedPhases) {
      const index = DIRECTOR_PRESET_RULES.indexOf(phase);
      expect(index, phase).toBeGreaterThan(previous);
      previous = index;
    }
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

  it('tells the Director how to speak, not only what to do', () => {
    /*
     * Regression: the Director repeated a proposal UUID and internal fields such as chainBreak in
     * otherwise user-facing prose. Exact identifiers remain necessary for tools, but they must not
     * cross that boundary into the words shown to the person.
     */
    expect(DIRECTOR_PRESET_RULES).toMatch(/never put an identifier in a sentence/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never name a tool, a field, or a stored value/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/not\s+chainBreak, not base_revision, not approvedAssetId/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never say review UI, human review/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/waiting for you rather than pending human\s+review/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/distinctions matter and\s+must survive; the vocabulary must not/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/one plain sentence saying what to do and where/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/no inline code spans/i);
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
    expect(DIRECTOR_PRESET_RULES).toMatch(/read_storyboard[\s\S]*studio_list_routes for current route authority/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/maxConditioningImages is greater[\s\S]*than zero/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /If it is zero, do not create or amend a reference plan, request reference images, or save a[\s\S]*non-empty Shot reference binding/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/choose a capable image route or continue reference-free/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/Never infer support from a model name/i);
  });

  it('treats Board frames as production images instead of adding a disposable sketch pass', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /high-fidelity production image reference[\s\S]*not as a disposable storyboard sketch/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /unless the chosen[\s\S]*visual language is itself sketch-like[\s\S]*never request rough line art, grey-tone sketches, colour keys/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/separate low-fidelity pass before the production-quality frame/i);
  });

  it('keeps paid Board generation under the owner’s visible review and spend confirmation', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/Board-frame generation is paid and owner-only/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /open Frames & Video[\s\S]*Generate next[\s\S]*frames[\s\S]*Generate missing frames/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/review the price, and confirm the spend there/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /A Board count proves that images exist, not that[\s\S]*the person accepted them/i
    );
  });

  it('routes migrated stale frames through the exact paid regeneration controls', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/migrated stale frame is not missing and is not production-ready/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/Generate missing frames will not replace it/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/choose Regenerate Beat frames/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/Regenerate Shot … frame control/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /Do not continue to video.*any Shot without a fresh take.*missing or stale frame/is
    );
  });

  it('reuses an accepted Board frame as the chain head’s first frame without paying for a duplicate', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/accepts a current Board frame for a chain head[\s\S]*Use as first frame/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/Reusing that already-paid image as the first frame is the default/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/do not request a redundant first-frame[\s\S]*image/i);
  });

  it('leaves Board promotion to the person and separates its free path from optional paid re-renders', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/person must perform this owner-only promotion/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/promote-only choice is free/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/keep that free promotion separate from any optional paid re-render/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/do not claim the promotion happened until a fresh detailed status/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/non-null newSpendSeedAssetId/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/seedStillAssetId is legacy.*not proof/is);
  });

  it('preserves predecessor-frame continuity for downstream Shots', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /continuous downstream Shot must instead start from the exact final frame of its predecessor's selected trimmed take/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/Board frame remains the visual target, but never substitute it/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never substitute it for that continuity frame/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/unless they deliberately choose a hard cut/i);
  });

  it('requires visible quote confirmation before paid video generation', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/choose Generate Shot or the visible chained-generation action/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/review the[\s\S]*quote, and confirm the spend there/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/Chat approval is not spend confirmation/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/You cannot start or confirm[\s\S]*video generation/i);
  });

  it('does not hand off to Cut until fresh status proves every active Shot has a current take', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/Read fresh detailed project status after they act/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/failed or blocked work is incomplete/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /only a current take for every active Shot permits the[\s\S]*handoff to Cut/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /active Shot has a current take, and that status contains no current_take_stale advisory/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/Never describe stale takes as ready/i);
  });

  it('requires an explicit creative review in Cut before calling the film complete', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/open Cut, play the film from beginning to end/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/review order,[\s\S]*timing, trims, joins, audio, and the ending/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/technically playable Cut do not prove[\s\S]*creative approval/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/Do not call the film complete until the person says they reviewed the Cut/i);
  });

  it('hands rendering to the owner without inventing an unverified result', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/choose Render, inspect the render summary/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/Rendering and export are owner-only UI actions/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(
      /Never claim a render started, finished,[\s\S]*unless positive evidence proves/i
    );
    expect(DIRECTOR_PRESET_RULES).toMatch(/ask the person to check the visible render result/i);
  });

  it('answers in the language the person writes in, since the rules themselves are English', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/language/i);
  });
});
