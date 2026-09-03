# Chat Status Indicators — Design

- **Date:** 2026-07-26
- **Branch:** `feat/chat-status` (based on `sprint1`)
- **Status:** Approved design, pending implementation plan

## Problem

The conversation sidebar's leading icon slot carries almost no status meaning today, and where it does carry meaning it is inconsistent or wrong.

Concretely, in `ConversationRow.tsx`:

1. **Idle rows render nothing.** `renderConversationStatus()` falls through to `return null`, so the leading slot is an empty 22px box for the majority of rows.
2. **Failure is invisible.** No branch renders an error state. A conversation whose last turn failed looks identical to one that has never run.
3. **The same state gets two different colors.** Awaiting-approval renders `iconColors.warning` when the sidebar is collapsed, but a `color='green'` / `text-success-6` pill when expanded.
4. **The expanded pill destroys the chat name.** When awaiting approval, the `Tag` replaces the name entirely, so the user cannot tell *which* chat is blocked without hovering.
5. **The 60s "completion" mark is mislabeled.** `markRecentCompletion()` is called only when `event.state === 'ai_waiting_input'`. It does not mean "finished" — it means "the agent asked you a question." It then renders the agent logo (semantically empty) and decays after 60s, even though a pending question does not stop being pending.
6. **Derivation is duplicated.** The `isWaitingApproval` expression is repeated verbatim in `ConversationRow.tsx:60-61` and `useConversationListSync.ts:336-337`. (`conversationRuntimeViewStore.ts` passes `pending_confirmations` into a view model but does not derive the boolean, so it is not a duplication site.)

The net effect: the two states that most need distinguishing — "the agent is politely blocked on your click" and "the run broke" — are either merged into one warning glyph or not shown at all.

## Goals

- Every row always carries an accurate status glyph in the leading slot.
- "Blocked on you" and "failed" are unmistakably different at a glance.
- The chat name is never hidden.
- One derivation function, imported everywhere.

## Non-goals

- Unread/last-viewed tracking per conversation. Deferred; requires new persisted state.
- Distinguishing user-cancelled runs from never-run chats. Both resolve to `idle` (see Accepted trade-offs).
- Any change to cron row rendering or batch-select mode.

## State model

New module: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/utils/conversationStatus.ts`

```ts
export type TConversationStatusMark = 'idle' | 'running' | 'needs_you' | 'done' | 'failed';
```

Derivation is **first match wins**, in this order:

| Order | Mark | Condition |
| --- | --- | --- |
| 1 | `needs_you` | `runtime.state === 'waiting_confirmation'` OR `(runtime.pending_confirmations ?? 0) > 0` OR `awaitingInputAt` is set |
| 2 | `failed` | `recentFailureAt` is set |
| 3 | `running` | `isGenerating` OR `runtime.state` in `{'starting', 'running', 'cancelling'}` |
| 4 | `done` | `recentCompletionAt` is set and within the decay window |
| 5 | `idle` | otherwise |

`needs_you` outranks everything because it is the only state that blocks on the user. `failed` outranks `running` so that a retry-in-progress does not hide a prior failure until the new turn actually starts streaming.

The function takes the row's already-available inputs and returns a mark — it does no IPC and holds no state, so it is directly unit-testable:

```ts
export const resolveConversationStatusMark = (input: {
  runtime?: TConversationRuntimeSummary;
  isGenerating: boolean;
  awaitingInputAt?: number;
  recentFailureAt?: number;
  recentCompletionAt?: number;
  now: number;
}): TConversationStatusMark => { /* ... */ };
```

`now` is injected rather than read from `Date.now()` internally, so decay-window tests need no fake timers for the pure function.

## Event plumbing

`useConversationListSync` currently keeps one timestamp map (`recentCompletionAtByConversationId`) and populates it from the wrong event. It becomes three maps, all following the existing `Map` + `emitStoreChange()` pattern already used by `markRecentCompletion`/`clearRecentCompletionState`:

| Map | Set when | Cleared when |
| --- | --- | --- |
| `awaitingInputAtByConversationId` | `turnCompleted` with `state === 'ai_waiting_input'` | next `markGenerating` for that conversation |
| `recentFailureAtByConversationId` | `turnCompleted` with `state === 'error'` | conversation is opened, or next `markGenerating` |
| `recentCompletionAtByConversationId` | `turnCompleted` with any other `state` (i.e. not `ai_waiting_input`, `ai_waiting_confirmation`, or `error`) | 60s decay in the row, or next `markGenerating` |

The `done` trigger is specified as an **exclusion** rather than an allowlist because it is not yet confirmed which wire `state` a cleanly-finished turn actually reports — `'stopped'` and `'unknown'` are both plausible. Excluding the three states we do understand is correct regardless of the answer. First implementation step is to log real `turnCompleted` payloads and confirm; if a cleanly-finished turn turns out to report something surprising, only this one row of the table changes.

This is a **repurposing** of the existing map, not an extension: the `ai_waiting_input` trigger moves out of `recentCompletionAt` and into `awaitingInputAt`, and `recentCompletionAt` gains the genuine completion triggers it never had.

Clearing on `markGenerating` is what makes a new turn reset the row — all three are stale the moment the agent starts working again.

`recentFailureAt` additionally clears when the conversation is opened, via the existing `onConversationClick` path. A failure the user has looked at no longer needs to shout.

`TConversationRuntimeStateKind` is **not** extended with an error member. Failure is a property of the last completed turn, not of live runtime, and the wire event already carries it.

## Visual vocabulary

Two axes carry the meaning: **motion means the agent is alive; color means whether it is on you.**

|  | Doesn't need you | Needs you |
| --- | --- | --- |
| **Alive** | `running` — spinning arc | `needs_you` — pulsing brand badge |
| **Terminal** | `done` / `idle` | `failed` — static red |

| Mark | Glyph | Color token | Motion | Lifetime |
| --- | --- | --- | --- | --- |
| `running` | `<Spin size={16} />` (Arco, existing) | secondary | spins | while generating |
| `needs_you` | `Attention` `theme='filled'` (`!`) | `iconColors.brand` | 2s ease-in-out opacity pulse, 1 → 0.55 → 1 | until answered |
| `failed` | `CloseOne` `theme='filled'` (`×`) | `iconColors.danger` | static | until chat opened |
| `done` | `CheckOne` `theme='filled'` (`✓`) | `iconColors.success` | static | 60s, then → `idle` |
| `idle` | none | — | — | resting |

Icons come from `@icon-park/react`, consistent with the rest of the file.

### Two deliberate departures from the reference mockup

**`needs_you` is brand-colored, not red.** The mockup uses a filled red alert for "needs attention." Using error red for a healthy agent awaiting a click trains the user to discount red, which is exactly the signal that must stay expensive. Red now means only "broken."

**`needs_you` and `failed` differ in glyph shape, not only hue.** `!` versus `×`. Brand-versus-danger alone conveys nothing to a colorblind user, and these are the two states whose confusion is most costly.

### Motion budget

Only two glyphs move, and never on the same row simultaneously (`needs_you` outranks `running`). The pulse is opacity-only — no transform, no layout effect — and is defined in a CSS Module honoring `@media (prefers-reduced-motion: reduce)`, under which the badge renders static at full opacity.

## Row rendering changes

In `ConversationRow.tsx`:

- `renderConversationStatus()` switches on the resolved mark and returns one glyph per state. The cron and `batchMode` early-return stays exactly as it is.
- **The `Tag` branch is deleted.** The name always renders. The status glyph lives in the leading slot in both collapsed and expanded modes, which is also what removes the green-versus-warning contradiction — there is now one code path per state rather than one per state-and-mode.
- The `'!bg-fill-3': selected && (collapsed || !isWaitingApproval)` special case is simplified to `'!bg-fill-3': selected`, since the pill it was compensating for is gone.
- `COMPLETION_MARK_DURATION_MS` and its decay `useEffect` stay, now applying to `done` only.
- The tooltip gains a status line for every non-`idle` mark, not just collapsed-and-awaiting-approval.

`resolveConversationLeadingMark` / `renderLeadingIcon` remain for cron rows, batch mode, and the pinned-hover overlay. They are no longer the fallback for ordinary rows.

## Accessibility

- Each glyph carries `aria-label={`${conversationName} ${t('conversation.status.<mark>')}`}`.
- `data-testid={`conversation-status-<mark>-${conversation.id}`}` per state, replacing the current `-approval-` / `-running-` pair and the now-deleted `-approval-pill-`.
- Shape differs per state, so color is never the sole carrier of meaning.
- `prefers-reduced-motion` disables the pulse.

## i18n

`conversation.status` currently holds only `waitingApproval`. Add three keys across all 12 locales (`de-DE`, `en-US`, `es-ES`, `fa-IR`, `ja-JP`, `ko-KR`, `pt-BR`, `ru-RU`, `tr-TR`, `uk-UA`, `zh-CN`, `zh-TW`):

| Key | en-US |
| --- | --- |
| `conversation.status.running` | Working |
| `conversation.status.done` | Finished |
| `conversation.status.failed` | Failed |

`waitingApproval` ("Awaiting approval") is reused for `needs_you` and stays unchanged, so no existing translation is invalidated.

Run `bun run i18n:types` and `node scripts/check-i18n.js` after editing, per `AGENTS.md`.

## Testing

Unit — `conversationStatus.test.ts`:

- One case per mark.
- Priority table: `needs_you` beats `failed`, `failed` beats `running`, `running` beats `done`, `done` beats `idle`.
- `pending_confirmations > 0` with `runtime.state === 'running'` still resolves `needs_you`.
- Decay boundary: `recentCompletionAt` at exactly `now - 60_000` resolves `idle`; at `now - 59_999` resolves `done`.

Component — `ConversationRow` tests:

- Each mark renders its expected `data-testid`.
- The chat name is present in the DOM for every mark, including `needs_you` and expanded mode — this is the regression guard for the deleted pill.
- Cron rows and `batchMode` still render the leading icon, not a status mark.

Hook — `useConversationListSync` tests:

- `turnCompleted` with each of `ai_waiting_input`, `error`, `stopped` populates the correct map and only that map.
- `markGenerating` clears all three.
- Opening a conversation clears `recentFailureAt` and leaves the others alone.

## Accepted trade-offs

**`idle` renders no glyph.** The mockup's legend hedged between a check and a dot for the resting state. Rendering nothing preserves current behavior, keeps a long sidebar quiet, and costs no code; the slot is fixed-width so alignment is unaffected either way. If a visible resting marker is wanted later, it is a one-line addition to the `idle` case. Reversible, so specified as nothing for now.

**A user-cancelled run is indistinguishable from a never-run chat.** Both are `idle`. A green check on cancelled work would be a lie, and a fourth terminal glyph is not worth the vocabulary cost for a state the user themselves just created and therefore already knows about.

**`done` decays to `idle` after 60s.** A finished chat announces itself briefly, then stops. Without last-viewed tracking a permanent check would accumulate across the whole sidebar and stop meaning anything. This is the state most likely to want revisiting once unread tracking exists.

**`failed` does not decay.** A failure that silently disappears is worse than no indicator, so it persists until the user opens the chat.

## Files touched

| File | Change |
| --- | --- |
| `GroupedHistory/utils/conversationStatus.ts` | New — mark type + `resolveConversationStatusMark` |
| `GroupedHistory/utils/conversationStatus.module.css` | New — pulse keyframes + reduced-motion guard |
| `GroupedHistory/ConversationRow.tsx` | Switch on mark; delete `Tag` branch; simplify `selected` class |
| `GroupedHistory/hooks/useConversationListSync.ts` | Three timestamp maps; correct `turnCompleted` routing; clear-on-open; its inlined `wasWaitingApproval` check imports the shared derivation |
| `GroupedHistory/types.ts` | `ConversationRowProps` gains `awaitingInputAt`, `recentFailureAt` |
| `GroupedHistory/index.tsx` | Thread the two new props through |
| `services/i18n/locales/*/conversation.json` | Three new keys × 12 locales |
| `GroupedHistory/utils/conversationStatus.test.ts` | New — pure-function unit tests (node project) |
| `tests/unit/conversation/ConversationRow.dom.test.tsx` | New — per-state render tests (jsdom project) |

`conversationRuntimeViewStore.ts` is **not** touched.

### Test placement constraint

`vitest.config.ts` splits into two projects. Node tests match `packages/desktop/src/**/*.test.ts` and may be colocated. **jsdom tests match only `tests/unit/**/*.dom.test.tsx`** and therefore cannot be colocated with the component. There are currently no tests anywhere under `GroupedHistory/`, so both files are new.

## Open questions

None.
