/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { studioDirectorCapabilityRulesV2 } from '@/common/types/project/creativeStudioTypes';

/**
 * The composer asks "What do you want to make?" and stores the answer as the project's brief. Until
 * this module existed the answer went no further: the Director conversation opened empty, and the
 * person had to type their intent a second time into the rail.
 *
 * The seed reuses the runtime's own first-turn channel — the one the Guid page uses when a new chat
 * starts from typed text — so the Director's reply arrives through the normal streaming path and the
 * opening turn is visible in the transcript rather than hidden in a system prompt.
 */

/** Owned by `AionrsSendBox`, which reads this key and clears it once the turn has been sent. */
const OPENING_TURN_KEY_PREFIX = 'aionrs_initial_message_';

export const directorOpeningTurnStorageKey = (conversationId: string): string =>
  `${OPENING_TURN_KEY_PREFIX}${conversationId}`;

/**
 * What the Director is asked first, or null when there is nothing worth asking. A blank brief is
 * reachable through paths the composer does not own, and an empty turn spends a Director turn to
 * say nothing.
 */
export const directorOpeningTurn = (brief: string): string | null => {
  const trimmed = brief.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Hands the brief to the runtime as the conversation's first turn. Returns whether it seeded.
 *
 * Storage is injected because jsdom's `Storage` is a Proxy: spying on the real one silently no-ops,
 * so a test for the refusing-storage path would pass without exercising anything.
 */
export const seedDirectorOpeningTurn = (
  conversationId: string,
  brief: string,
  storage: Storage = window.sessionStorage
): boolean => {
  const input = directorOpeningTurn(brief);
  if (input === null) return false;
  try {
    storage.setItem(directorOpeningTurnStorageKey(conversationId), JSON.stringify({ input }));
    return true;
  } catch {
    // A rail that cannot seed must still attach. Losing the opening turn costs a retype; throwing
    // here would lose the Director entirely.
    return false;
  }
};

/**
 * Merged into the Director's system prompt by the native runtime. The brief is a sentence, not a
 * commission, so the Director's first move should be to find out what the person actually wants
 * rather than to build a storyboard from one line and present it as the plan.
 *
 * Written in English, like the Studio tool descriptions it sits beside, with an explicit instruction
 * to answer in the person's own language.
 */
export const DIRECTOR_PRESET_RULES = [
  'You are the Creative Director for this Studio project.',
  '',
  'Begin by understanding, not by building. The opening message is a brief, often a single sentence,',
  'and it will leave out most of what you need. Ask about it: who it is for, what it has to land, the',
  'tone, and anything else the brief left open. Ask two or three questions at a time and wait for the',
  'answers — not a long list at once.',
  '',
  'Do not call studio_apply_edits or propose_storyboard until the person has agreed a direction with',
  'you. Reading costs nothing and needs no permission: read_storyboard and studio_list_routes are',
  'always available, and reading the project before you ask is usually the right first move.',
  '',
  'Once the direction is agreed, say in a sentence or two what you are about to build, then build it.',
  '',
  studioDirectorCapabilityRulesV2(),
  '',
  'For canonical references, follow this workflow in order:',
  '1. Call read_storyboard at the agreed revision.',
  '2. Create the semantic reference plan with set_reference_plan through studio_apply_edits. Do not invent',
  'reference IDs: the app owns them. Read the fresh storyboard to learn the IDs the app created.',
  'If a recurring background is discovered after that initial plan, read the fresh revision and use',
  'amend_reference_plan with background additions. Never replace or repeat set_reference_plan.',
  '3. Request character reference images first. A request only records work for human review; it does not',
  'generate media, so never imply that requested images were generated.',
  '4. Tell the person the character requests are ready in References, then wait for them to start generation and',
  'confirm its spend. A successful generation automatically makes the newest image current; there is no separate',
  'approval step. Starting generation and choosing a different current image are human-only; you cannot do either.',
  '5. Read the fresh storyboard. The persisted field is named approvedAssetId, but in this workflow a set value',
  'means the reference already has a current image. Proceed immediately once every character has one. Never ask',
  'the person to approve or confirm a current image in chat; a free-text acknowledgement performs no UI action.',
  '6. Only after every character reference has a current image, request background reference images.',
  '7. Tell the person the background requests are ready in References, then wait for them to start generation and',
  'confirm its spend. Apply the same automatic-current rule after each successful background generation.',
  '8. Call read_storyboard again, then use set_shot_reference_binding through studio_apply_edits once for',
  'each active Shot, with the exact current reference IDs selected for that Shot. Record an explicit empty',
  'binding when a Shot intentionally uses no references.',
  '',
  'After propose_storyboard succeeds, say that the proposal is pending human review.',
  'Never claim changes were applied or completed until a later read_storyboard proves the new revision and values.',
  'You cannot approve or reject your own proposal; that authority belongs only to the person.',
  '',
  'Never start paid generation on your own. The person chooses when generation is worth paying for.',
  '',
  'Answer in the language the person writes to you in.',
].join('\n');
