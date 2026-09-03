# Chat Journal Improvement — Design

- **Date:** 2026-07-22
- **Branch:** `feat/chat-journal-improvement`
- **Status:** Approved design, ready for implementation planning
- **Scope:** Renderer-only. No LLM calls, no main-process changes, no new IPC.

## Problem

The chat journal (introduced in PR #27, "make work progress clear and conversational") is entirely rule-based. Every line the user reads is assembled from enums and counts:

- `buildTurnWorkRecap.ts` counts tool calls and picks a `status` enum (`completed` / `partial` / `failed` / `recovered` / `canceled` / `active`).
- `MessageToolGroupSummary.tsx` fills fixed i18n templates from that status: `Work completed (4 total)`, `This turn covered Project step (4)`, `Completed: 3 of 4. Actions needing another attempt: 1.`

Two concrete problems:

1. **It reads like a machine, not an assistant.** The agent already streams its real reasoning and plan, but `getSafeProviderNarration` (~150 lines of regex in `MessageToolGroupSummary.tsx`) rejects any line containing a path, command, or identifier and replaces it with the generic `Completed the project step`. The natural language is arriving and being thrown away.
2. **Errors over-alarm.** `pushWorkErrors` in `MessageList.tsx` emits a `work_error` item (rendered by `ToolActivityError.tsx` as a red banner: *"I couldn't complete the project step / The error details are available below. You can try this step again when you're ready."*) for failed steps — including steps the agent immediately recovered from and kept working past. The user sees a red alarm for a non-event.

## Goals

- The journal reads like the assistant talking **to the user**, in plain language.
- The agent's real thinking and plan are **surfaced live**, before the results land, instead of being suppressed.
- Recoverable failures never alarm; only a genuinely blocking, user-actionable failure surfaces, and it does so calmly.
- A warm, human closing recap replaces the count arithmetic.

## Non-goals

- No LLM calls anywhere in the journal (see "Decisions").
- No changes to the underlying agent backends, ACP protocol, or how messages are produced/persisted in main.
- No general refactor of `MessageList.tsx` beyond the journal pipeline.

## Decisions (locked with the user)

1. **Direction:** live authenticity + a warm closing recap ("show real thinking live, then a natural sign-off").
2. **Audience:** primarily **non-technical end users** (business/ops staff using assistants such as the HR letter tool). The main view stays plain; raw commands/paths live one click away in "Technical details."
3. **Close generation:** **template-based, no LLM** ("Option B"). The naturalness the user asked for (live thinking) is LLM-free by nature — it is the agent's own words. A model-written close ("Option A") was designed and deliberately deferred as an evidence-gated follow-up (see "Future work").
4. **Close length:** two beats — what got done + what it means / what's next.
5. **Error tone:** recoverable failures fold into the narration; blocking failures get a calm amber callout, never the red alarm.

## User-facing behavior

### While working (live)
The live view streams the agent's plan and clean thinking as plain one-liners, with a quiet spinner on the current step. No `Work in progress (N total)` headline, no counting.

### When done (closing recap)
A warm two-beat close leads: *"Google Drive is connected. I switched on the Drive API and confirmed your credentials are working, so reading and writing files will go through now. Just tell me which file you'd like to start with and I'll take it from there."* Below it, a plain-language breadcrumb of the steps; "Technical details" holds the raw command/output. Gone: the enum headline, the `This turn covered …` line, and `Completed: 3 of 4`.

### When something needs the user
A calm amber callout with the plain reason + the one action the user can take. The model close (here, template close) explains it in human terms first.

## Architecture

Entirely renderer-side. No model, no secrets, no new IPC. Model calls would have required the main process (`ClientFactory`); by choosing template closes we avoid that surface completely.

Data flow is unchanged up to the renderer: the agent stream (plan / thinking / tool calls) is persisted and delivered to the renderer as today. All changes live in the journal pipeline and its components.

## Component changes

All paths under `packages/desktop/src/`.

### `renderer/.../Messages/components/MessageToolGroupSummary.tsx`
- Replace the enum/count header block (`headline` + `activity` + `outcome`) with: (a) the live plain narration rows, and (b) the warm template close.
- Re-tune `getSafeProviderNarration`: it still routes genuinely technical tokens (commands, paths, telemetry) to "Technical details" — that filtering is **correct** for a non-technical audience. The fix is the fallback: when a line is rejected, do **not** collapse to the robotic generic `Completed the project step`. Prefer, in order: (1) the plan entry text (higher-level, plainer), (2) a friendly tool/category label derived from the action, (3) a warm generic label. Plan entries are the primary live-narration source because they are intent-level and plainest.
- Keep the "Technical details" expander and `ToolItemDetail` (raw input/output) unchanged.

### `renderer/.../Messages/components/toolActivity/buildTurnWorkRecap.ts`
- Demoted. No longer drives user-facing headline/outcome text. Its `status` + `categories` + `safeSubject` become **inputs to the close-template builder** and to error classification. Counts are no longer rendered to the user.

### New: close-template builder (`renderer/.../Messages/components/toolActivity/buildTurnClose.ts`)
- Pure function: `(recap, planEntries, safeSubject) => string`.
- Produces the two-beat close from real data — no LLM:
  - **Beat 1 (what got done):** stitched from the dominant category/subject and the plan's final state (e.g., the completed plan-entry text, or a friendly category summary keyed on `safeSubject`).
  - **Beat 2 (meaning / next):** status-driven — `completed` → "you're all set"; `recovered` → "…after a quick retry"; `partial` → "a couple of things still need another pass"; `failed`/blocked → "but I need you to …"; `canceled` → neutral "stopped here."
- **Variety:** multiple copy variants per status, selected by a stable hash of the turn (so re-renders are deterministic but the corpus doesn't feel same-y).
- Acknowledged ceiling: templates cannot fluidly narrate a genuinely novel outcome. That is the explicit tradeoff of Option B and the trigger for Future work.

### `renderer/.../Messages/MessageList.tsx` (the `processedList` pipeline)
- Retire per-step red-banner emission: `pushWorkErrors` no longer pushes `work_error` items into the stream. Error presentation moves to the work-summary level and is decided from `recap.status` at turn end (see "Error classification").
- The tier-3 calm callout renders within/adjacent to the work summary, not as an interleaved red banner.

### `renderer/.../Messages/components/toolActivity/ToolActivityError.tsx`
- Replaced by a calm callout presentation (amber, plain reason + one action). Either restyle in place or introduce a small `WorkNeedsYouCallout` component; the red `Attention` + `failedTitle` + `suggestion` treatment is removed.

### `common/chat/toolActivity/resolveToolAction.ts` + i18n labels
- Friendlier, plain-language `done`/`running` labels per category and tool (the text resolved by `useToolActionText`). These become the narration floor for non-technical users.

### i18n (`renderer/services/i18n/locales/*/messages.json`)
- Retire the count/outcome templates: `messages.toolActivity.recap.outcome.*`, `messages.toolActivity.recap.headline.*`, `messages.toolActivity.recap.activity`, and the `*.failedTitle` / `error.suggestion` red-alarm strings.
- Add: warm close-template variants (per status), the calm callout strings, and the friendlier tool/category labels.
- Run `bun run i18n:types` and `node scripts/check-i18n.js`; apply across all locales.

## Error classification (three tiers)

Classified at turn end (`isProcessing === false`) from signals already in the pipeline:

| Tier | Condition | Detection | User sees |
| --- | --- | --- | --- |
| 1 · hidden | Failed, then succeeded on retry | `supersededWorkErrorIds` (already tracked) | A normal completed step. No trace of the blip. |
| 2 · folded in | Failed, but the turn carried on and finished | `recap.status` is `recovered` or `partial` | A calm inline line ("hit a snag, worked around it"). No banner. |
| 3 · needs you | Turn ended blocked, work incomplete | `recap.status` is `failed` and turn not active | One calm amber callout: plain reason + the single action to take. |

`canceled` (user stopped the turn) is neutral — a plain "stopped here" note, not an error. During a live/active turn, an errored step never triggers a callout (it may still recover); classification only happens once the turn ends.

The red `I couldn't complete the project step` alarm is retired in all cases.

## Edge cases & fallbacks

- **Agents that emit little thinking/plan.** Live view degrades gracefully to the friendlier tool/category labels; nothing regresses to robotic counting. The close still works from `recap` + `safeSubject`.
- **Technical-but-natural thinking** (e.g., "service account lacks serviceUsageAdmin"). For the non-technical audience this jargon is intentionally kept out of the main view (routed to Technical details). We do **not** rephrase it — that would require an LLM. The user sees the plan intent + friendly labels instead.
- **Trivial single-action turns.** The close may be suppressed when the agent's own reply already says everything (a one-line completed turn does not need a redundant recap). Threshold pinned in tests.

## Test plan

Behavior change → focused coverage (per the `testing` skill). Framework: Vitest 4.

- Extend `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx`: the live view renders the agent's real thinking/plan (not the generic fallback); the two-beat close renders; none of the retired count strings (`Completed: N of M`, `Work completed (N total)`, `This turn covered …`) appear.
- New `tests/unit/chat/buildTurnClose.test.ts`: `completed` / `recovered` / `partial` / `failed` / `canceled` each produce warm copy that interpolates the real subject; variant selection is stable for a given turn.
- Error-reclassification tests on the `processedList` pipeline: tier 1 → hidden, tier 2 → folded (no `work_error` emitted), tier 3 → single calm callout; assert the old red-alarm title never fires for tiers 1–2.
- `tests/unit/chat/resolveToolAction.test.ts`: updated for the friendlier plain-language labels.
- i18n: `bun run i18n:types` and `node scripts/check-i18n.js` pass; retired keys removed, new keys present across all locales.
- Full gate before done: `bun run test`, `bunx tsc --noEmit`, `bun run lint:fix`.

## Future work (deferred, not in scope)

**Option A — model-written close.** A main-process close service (`ClientFactory` model call at turn end, persisted recap, template fallback) produces a more fluid close, especially for novel/blocked outcomes. Deferred because (a) the live view already delivers the bulk of the "natural" win LLM-free, (b) it adds main-process + IPC + persistence surface for one closing sentence, and (c) the audience is on shared keys where every call is real cost + latency. If the templated close feels flat in real use, revisit — ideally **targeted**: call the model only on `partial`/`failed` turns (where a human explanation earns its keep) and keep templates for the happy path.

## Risks

- **Template close monotony.** Mitigated by per-status variants + stable-hash rotation; bounded by design (accepted tradeoff of Option B).
- **Tier-2/3 boundary.** The precise "recovered vs. blocked" threshold depends on real message shapes; pinned by the reclassification tests against representative fixtures.
- **Over-hiding for technical users.** The audience decision optimizes for non-technical users; power users rely on "Technical details." If a future audience split is needed, curation level could become a setting (out of scope now).
