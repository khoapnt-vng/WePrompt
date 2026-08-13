# Creative Studio 2 — Phase 1: the Brief with enforced rules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Creative Studio brief from inert prose into a governing document: a small list of pinned rules that the Creative Director sees on every turn and that main refuses to spend money against, surfaced before the confirm button rather than after the charge.

**Architecture:** Rules live as a required `rules` array on the project record (`project.json`) — the same CAS/revision-guarded store main already owns as sole writer. One pure module shared by both processes (`creativeStudioRules.ts`) owns the rule vocabulary, the scope-precedence resolver, the predicate evaluator, and the text block that carries rules into the model's context. Main enforces at `jobManager.resolveProvider`, the one point where every paid request's prompt comes into existence and which the Director provably cannot bypass; the renderer runs the _same_ pure evaluator to show the breach inside the generation review before Confirm is pressable. Rules reach the Director two ways, both derived from `project.json` and neither authoritative: pushed per turn as a Studio-owned `pinned_context` entry, and pulled fresh per call by `read_storyboard`.

**Tech Stack:** TypeScript, Electron (main/renderer split, IPC via `ipcBridge`), React 18 + Arco Design + CSS Modules/UnoCSS, Zod at the IPC boundary, Vitest + jsdom + Testing Library, i18next across 12 locales, MCP (`@modelcontextprotocol/sdk`) for the Studio tool server.

---

## Assumptions this plan is built on — read before writing code

### A1. The on-disk project folder is a dependency to sequence, NOT part of Phase 1

Phase 1 enforces rules against `project.json` only. There is **no** `brief.md` source file, no first-run folder-location prompt, no filesystem sync tolerance, and no one-writer heartbeat. The design handoff §8 promises Phase 1 is cheap — "prompt assembly plus a check step, no new media stack" — and a hand-editable folder with a location prompt, sync tolerance and a heartbeat is a different order of cost.

**What changes when the folder lands:**

- `project.json` stops being the source of truth for _prose_. `brief.md` becomes the source; `project.brief` becomes a derived cache. `rules` stay in `project.json` because they are structured, validated, and CAS-guarded — a hand-edited rules file cannot be validated before it is read, and an unreadable rules file silently disarms the money gate.
- `read_storyboard` (`studioServer.ts:111`) reads `<projectDir>/project.json` directly. When the folder lands it must additionally read `brief.md`, or the Director sees a stale brief. **Nothing else in Phase 1 moves.**
- The pin builder (Task 5) reads `brief` off the renderer project; it would read the folder-backed brief instead. Signature unchanged.

State this assumption in the MR description. Do not relitigate it.

### A2. Not in Phase 1

The section/clip/take data model (phase 2), the first-frame chain (phase 3), the Table/Board/Cut shell (phase 4), TTS, and the Engine Strip (`docs/design/creative-studio-2-engine-strip.md`).

### A3. Two recon findings were wrong. Corrected here.

1. **There is no `PROJECT_KEYS`.** Verified: `grep -rn "PROJECT_KEYS" packages/desktop/src/` returns nothing. `validateProject` (`store.ts:953`) checks the project record **field by field with no `hasExactKeys` call**; the exact-key Sets are `ROUTING_KEYS`, `SCENE_KEYS`, `ASSET_KEYS`, `MANAGED_ASSET_KEYS`, `CUT_KEYS`, `CUT_CLIP_KEYS`, `NORMALISED_RECT_KEYS`, `CUT_FILTER_KEYS`, `JOB_KEYS`, the connection sets and the proposal sets. **Adding `rules` to the project record moves zero key sets and needs no schema-version bump.** The inverse hazard is real though: an unknown top-level project key is _accepted and persisted and never read_, so a misspelt or misnested field validates fine and does nothing. Task 2 adds explicit validation to close that.

2. **An unreadable project is not silently skipped.** Verified: `readProject` (`store.ts:1763`) throws `storage_error`; `readAllProjects` (`store.ts:1781`) catches it, pushes the id into `quarantinedProjectIds`, logs `[CreativeStudio] Quarantined corrupt project manifest`, and surfaces it through `listQuarantinedProjectIds`. The **silent-skip** class is the _pending record_ families: `readProposalRecords` logs `Ignoring malformed proposal record` and drops it with nothing reaching the user (`store.ts:1465`). So project-scope rules sit in the loud-failure zone; a Director-proposed rule (Task 6) sits in the silent zone and must be validated against the store's limits by the subprocess itself.

### A4. The design's stated context mechanism does not exist, and the substitute is asymmetric by choice

`preset_context` / `preset_rules` are **create-time only**. Verified: declared "System rules injected at initialization" (`storage.ts:480`) and "first-turn preset context" (`ipcBridge.ts:1995`); the only two write sites are inside `createOrRecoverConversation` (`useGuidSend.ts:788`, `:850`); `grep preset_context packages/desktop/src/process/` returns zero hits; the `POST /api/conversations/{id}/messages` body carries exactly `{content, files, loading_id, inject_skills, pinned_context}` (`ipcBridge.ts:363-372`) with no slot for it. Making it per-turn is an aioncore-fork change.

Worse: the Studio Director passes **neither**. `useBriefConversation.ts:106` sends `extra: { workspace: '', custom_workspace: false }`; `createStudioBriefConversation` adds only `studio_project_id` and the MCP selections (`studioBriefConversation.ts:82-87`). No assistant record, no `project_id`, so `resolveInjectedContext`'s global+project instructions never reach it either. **The Director today runs with no rules, no persona and no injected context whatsoever.** Phase 1 is "give the Director context for the first time".

The only per-turn field on the send wire is `pinned_context`, re-read fresh from the backend on **every** send (`AionrsSendBox.tsx:936` → `getConversationOrNull` → `GET /api/conversations/{id}`, then `getConversationPinnedContext` at `:941`).

**The real ceiling, measured:** `MAX_CONTEXT_PIN_LENGTH = 2_000` (`payloadSchemas.ts:25`) is a **per-item** cap — `contextPinSchema` applies it separately to one pin's `title` and one pin's `content` (`payloadSchemas.ts:89-98`, the two `z.string().max(MAX_CONTEXT_PIN_LENGTH)` at `:92-93`). `pinned_context` is an **array**: `z.array(contextPinSchema).max(MAX_CONTEXT_PINS)` with `MAX_CONTEXT_PINS = 20` (`payloadSchemas.ts:24`, applied at `:106`). So the ceiling on the whole channel is **20 × 2,000 = 40,000 characters**, and the 16 KB brief limit (`assertText(input.brief, 16 * 1024, …)`, `creativeStudioService.ts:477` — 16,384 characters) fits inside it with room to spare: `ceil(16384 / 2000) = 9` pins for the worst-case brief, out of 20.

**The brief therefore CAN be pushed per turn.** An earlier draft of this plan said it "can never fit" against a 2,000-character ceiling; that was wrong, and the requirement was downgraded on a constraint that does not exist. The split this plan implements — push the rules, pull the brief — is a **CHOICE**, not a limit of the wire. That choice has now been made: **pull-only.** The block below records it with its reasons, and the steps that would have moved under the rejected option stay marked so the road not taken remains visible to whoever revisits this.

> ### RECORDED DECISION — Phase 1 pushes the RULES only. The brief prose is PULLED.
>
> **Settled. Pull-only.** Both options are legal against the schema, so this is a judgement about cost, not a constraint found in code. The tasks below implement it, and every step that would have moved under the rejected option is marked **[Not taken — Option B would change this]**.
>
> **Option A — push the RULES, pull the BRIEF. CHOSEN.** One Studio pin, `studio_brief_rules`, carrying the rule lines plus one sentence pointing at `read_storyboard`, which already returns `brief` fresh from disk on every call (`studioServer.ts:143`).
>
> **Option B — push the RULES _and_ the BRIEF, chunked across pins. DECLINED.** One rules pin plus up to nine `studio_brief_prose_N` pins holding the prose, all rewritten in place by id.
>
> **Why pull-only. Two reasons, both about cost paid on turns that do not need it:**
>
> 1. **16 KB rides every send, including the sends that need none of it.** Roughly 4,000 tokens attached to a request as small as "make shot 3 shorter", against a Director turn already measured at **82 seconds** in use — an observed run of `read_storyboard` -> `studio_list_routes` -> `propose_storyboard` on 2026-08-12, `feedback.runtime.turn_terminal … elapsed_ms=82257 error_code=None` in the dev log, first visible output at 2.1s. A bigger prompt does not make that turn better or faster. `read_storyboard` fetches the brief on demand, for the turns that actually ask about it.
> 2. **Rules and brief share the same 20 slots, and the rules are the half that must never be dropped.** A worst-case brief takes 9 of 20 (`ceil(16384 / 2000)`), leaving the rules to compete for the remainder with anything else that ever pins to that conversation. The rules are what the money gate enforces; crowding them to carry prose a tool call already returns trades the guaranteed half of the feature for the optional half.
>
> **The strongest argument against this decision, recorded because it is real.** `buildStudioBriefRulesPin` returns `null` when the project has no rules (Step 1.6), so on a rules-free project there is no Studio pin at all — not even the sentence pointing at `read_storyboard`. On exactly those projects the _only_ always-present prompt for the brief is the `read_storyboard` tool description itself. That is why Step 4.3 exists and why it is not optional: under pull-only that description carries the whole burden, and this repo has learned before that a tool description is the sole prompt surface that decides whether a model uses a tool at all.
>
> **What the code says about the trade-off** — the facts the decision was made against, unchanged by it:
>
> - **Pin slots.** 20 total, shared with any other pin on that conversation. The chosen option takes 1; Option B would have taken up to 10 for a maximum-length brief. Today the collision risk is theoretical rather than real: the user cannot reach the pin UI on the Director conversation at all — it is filtered out of chat history (`ConversationHistoryContext.tsx:27`) and the Director pane never mounts `ContextHandoffPanel`. It stops being theoretical the moment that conversation becomes reachable, or compaction starts minting pins of its own.
> - **What happens when the set exceeds 20 pins, or one pin exceeds 2,000 characters.** This is the asymmetry that matters most, and it is not obvious: the 20-pin/2,000-character limits are enforced by `appOperationsContextCompactSchema` (`payloadSchemas.ts:99-110`, `pinned_context` at `:106`), i.e. on the **compaction** channel — not by `conversation.update`, which is how Task 5 writes the pin. So an over-long or over-numerous pin set is **accepted at write time and rejected the first time Studio ever compacts**. That is a latent failure, not a loud one, and it argues for staying well under both limits under either option. Pull-only leaves 19 slots of headroom; Option B would have left ~10 and no slack for a brief that grows.
> - **Per-turn token cost.** The pin set rides every send. Option B would push up to 16 KB on every Director turn, forever, for content one `read_storyboard` call fetches on demand. Nothing in this repo meters or caps that, and nothing warns the user. This is reason 1 above, stated as a code fact.
> - **Freshness.** The pin is written by a renderer effect after a project revision lands; `read_storyboard` re-reads `project.json` on every tool call (`studioServer.ts:108-109`). The pull channel is strictly fresher, so Option B would still have needed the pull channel for the case where the brief changed mid-turn — it adds a channel rather than replacing one.
> - **Settled since: `pinned_context` is inert.** aioncore's `SendMessageData` has no such field on either live branch and the payload does not deny unknown fields, so the desktop's pin is silently dropped (Step 5.0). Option B's chunker would have bought nothing; pull-only's one wasted pin costs one effect. This confirms the decision rather than reopening it — and it means **no channel injects per turn today**, so §3's claim fails for the rules as well as the prose.
>
> **What Option B would have changed, concretely** — kept so a later phase that revisits this inherits the analysis instead of re-deriving it:
>
> - **Task 1, Steps 1.5-1.6 [Not taken — Option B would change this].** `buildStudioBriefRulesPin(input): TContextHandoffItem | null` would become `buildStudioBriefContextPins(input: { rules; brief; now }): TContextHandoffItem[]`, plus: a prose chunker that splits on paragraph then line boundaries under `STUDIO_BRIEF_RULES_PIN_MAX_CHARS`, a `STUDIO_BRIEF_PROSE_PIN_MAX_COUNT` so Studio can never consume every slot, stable ids `studio_brief_prose_1…N`, and a "the brief continues — call read_storyboard" sentence on the last chunk when the cap truncates it. New tests: chunk boundaries, the count cap, id stability across rewrites, and that a shrunk brief emits fewer pins.
> - **Task 5, Steps 5.1-5.2 [Not taken — Option B would change this].** The effect would filter out every Studio-owned pin by id **prefix** rather than the one fixed id, append the returned array, and fold the brief text into the dedupe signature. Two more tests: editing the brief rewrites the prose pins, and shortening the brief removes the now-stale ones instead of orphaning them.
> - **Task 4, Step 4.3 [Not taken — Option B would change this].** The `read_storyboard` description would stop being the primary route to the brief and would call itself the authoritative, freshest one instead. The handler is unchanged either way — it already returns `brief`.
> - **Tasks 9, 10, 11 — unchanged either way.** Enforcement never reads the pin; it reads `project.rules` through `resolveEffectiveStudioRules`.
> - **Task 12 — unchanged either way.** The pin is model-facing English and is deliberately not localised (see Step 1.6). Option B adds no i18n key.
>
> Record this in the MR description **as a decision with these two reasons**, never as a constraint. The 40,000-character ceiling is the fact; the split is the judgement, and the judgement is pull-only.

**The consequence, stated plainly.** The handoff's §3 claim that the Brief "is loaded into every director turn, not read when opened" is, after this decision, **true of the RULES and false of the BRIEF PROSE.** Phase 1 must not claim otherwise anywhere — not in the MR, not in the tasks below, not in the Self-Review. The rules carry the enforceable guarantee: they ride every turn and main refuses to spend against them. The prose is fetched when the Director fetches it, through `read_storyboard`, which returns it fresh from disk on every call. Half of that sentence is delivered; the other half is deliberately not, and the two reasons above are why.

Raising `MAX_CONTEXT_PIN_LENGTH` itself stays out of scope under both options: it is an app-wide constant that the context-compaction schema enforces for every conversation in the product, and a single pin larger than 2,000 characters would break compaction everywhere, not just in Studio.

**What this repo cannot prove:** what aioncore does with `pinned_context` — whether it enters every turn's prompt, where, with what authority. Grep of `docs/` returns nothing. Phase 1's _acceptance_ therefore rests on the two channels this repo can prove — `read_storyboard` (pull) and the main-side gate (enforcement) — with the pin as an additive best-effort that degrades to a no-op. Task 5 includes the out-of-band verification step and what to do with each answer.

### A5. Scope precedence in Phase 1: the THREAD layer is the one dropped

The design says "what you say in the thread wins for that section, then project rules, then organisation rules (VNG-wide, locked)". **The layer Phase 1 does not build is `thread` — the design's highest-precedence one.** Organisation survives as a real code tier; it just ships empty. Read that first, because "two layers, not three" reads as if organisation were the casualty and it is not.

Thread precedence is inherently _per section_, and sections are the phase-2 data model. Organisation scope has **no home** either: `configKeys.ts` has no workspace/org/tenant tier, no admin channel, no server-side config fetch and no locking primitive anywhere — so it ships as a constant with nothing in it.

Phase 1 therefore ships:

- **organisation** — a constant, code-resident, currently **empty** layer (`ORGANISATION_STUDIO_RULES`). Always evaluated, never editable, never removable, never persisted on the project record (the store refuses `scope: 'organisation'`). Present so the precedence machinery and its UI are real; the missing piece is a distribution channel, named honestly in the UI copy.
- **project** — user-authored and Director-proposed. Blocking when it carries a predicate.
- **thread** — a thread statement can only _add_ a rule, by being pinned to project scope. It can never waive one. This is deliberate: letting chat text waive a money gate inverts "the assistant may never trigger a paid call on its own".

Precedence is encoded once, in `resolveEffectiveStudioRules`: organisation first, then project rules whose case-folded text does not duplicate a locked one. A lower layer can never remove a higher layer's rule.

**In production the machinery therefore runs with exactly one populated layer.** That is worth saying out loud rather than discovering: every precedence test in Task 1 passes `organisationRules` explicitly, because the shipped constant is empty and a test that relied on the default would assert nothing. The machinery is real and tested; the distribution channel is what is missing.

### A6. Convention debt, accepted deliberately

Two directories go from 10 to 11 direct children against the `.claude/skills/architecture` "max 10" rule: `packages/desktop/src/common/types/project/` and `packages/desktop/src/renderer/pages/studio/components/`. Every alternative pushes a _deeper_ directory over the same limit or buries a document-level surface inside a phase directory, and `common/` and `common/knowledge/` already sit at 12. The correct fix — a `creativeStudio/` subdirectory under `types/project/` — would touch ~40 import sites and is out of Phase 1 scope. Flag it in the MR description.

---

## File Structure

### Created

| Path                                                                                       | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/common/types/project/creativeStudioRules.ts`                         | The one shared, pure, dual-consumed module: rule/predicate types, `STUDIO_RULE_LIMITS`, the empty locked `ORGANISATION_STUDIO_RULES` layer, `resolveEffectiveStudioRules` (precedence), `foldForRuleMatch` + `evaluateStudioRules` (the predicate), `renderStudioRulesBlock` (model-facing text), `buildStudioBriefRulesPin` (the per-turn pin item). Imported by main (`jobManager`, `store`, `creativeStudioService`, `studioServer`) and renderer (`StudioPage`, `GenerationReviewModal`, `useBriefConversation`, the rules drawer). Follows the `creativeStudioOutputRole.ts` / `creativeStudioProposalDiff.ts` / `creativeStudioCanonicalTake.ts` precedent in the same directory. |
| `packages/desktop/src/renderer/pages/studio/components/Rules/StudioRulesDrawer.tsx`        | The persistent rules list: read, add, remove, scope badges, precedence explainer. An Arco `Drawer` opened from the work-area toolbar — the app frame, which survives the phase-4 Table/Board/Cut swap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/desktop/src/renderer/pages/studio/components/Rules/StudioRulesDrawer.module.css` | Drawer layout. Semantic colour tokens only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/desktop/src/renderer/pages/studio/components/Rules/index.ts`                     | Barrel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `tests/unit/process/creative-studio/types/rules.test.ts`                                   | Unit tests for the whole shared module: folding, tokenising, matching, precedence, block rendering, pin building.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx`                             | DOM tests for the drawer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `tests/unit/pages/studio/Storyboard/Brief/useBriefConversationPin.dom.test.ts`             | DOM tests for the per-turn pin: the patch shape, the no-change dedupe, and the recreated-conversation case.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Modified

| Path                                                                                                                                                                                                                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/common/types/project/creativeStudioTypes.ts`                                                                                                                                                                        | `rules: StudioBriefRule[]` **required** on `StudioProject` (:237-257) so the compiler forces every projection; `StudioProposalPayload` widened to a discriminated union; `StudioBriefRuleDraft` + `StudioSetBriefRulesRequest`; `'rule_breach'` added to `StudioCommandErrorCode`.                                                                                                                                                           |
| `packages/desktop/src/process/services/creative-studio/store.ts`                                                                                                                                                                          | `migrateSchemaV1Project` (:898) defaults `rules: []`; `validateProject` (:953) validates it; `createProjectFromInput` (:1097) seeds it; `validateProposalPayload` (:390) branches on `kind`; new `PROPOSAL_PIN_RULE_PAYLOAD_KEYS`.                                                                                                                                                                                                           |
| `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts`                                                                                                                                                          | `toRendererProject` (:737) carries `rules`; new `setBriefRules` command; `toRendererProposal` (:770-806) branches on `kind` — it is the ONLY path a proposal takes to the renderer; `applyProposalPayload` (:808) branches on `kind`; `rememberProposalDiff` (:967) skips non-storyboard payloads; `createRuleId` dep.                                                                                                                       |
| `packages/desktop/src/process/services/creative-studio/jobManager.ts`                                                                                                                                                                     | `'rule_breach'` added to `StudioJobManagerErrorCode` (:93); the gate inside `resolveProvider` (:578) immediately after the prompt is built and before `adapter.validateRequest`.                                                                                                                                                                                                                                                             |
| `packages/desktop/src/process/bridge/creativeStudioBridge.ts`                                                                                                                                                                             | `errorMessageKeys` (:26) gains `rule_breach`; the `setBriefRules` provider registration.                                                                                                                                                                                                                                                                                                                                                     |
| `packages/desktop/src/common/adapter/ipcBridge.ts`                                                                                                                                                                                        | `setBriefRules` provider declared next to `updateProject` (:1232).                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/desktop/src/common/adapter/native/constants.ts`                                                                                                                                                                                 | `'creative-studio.set-brief-rules'` in `NATIVE_BRIDGE_PROVIDER_KEYS` (:14-140), immediately after `'creative-studio.update-project'` (:87).                                                                                                                                                                                                                                                                                                  |
| `packages/desktop/src/common/adapter/native/payloadSchemas.ts`                                                                                                                                                                            | `studioSetBriefRulesSchema` + its map entry (:709+).                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/desktop/src/common/types/project/creativeStudioProposalDiff.ts`                                                                                                                                                                 | `computeStudioProposalDiff` narrowed to the storyboard payload variant.                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`                                                                                                                                                                       | `readProject` (:108-109) defaults `rules` to `[]` — the subprocess runs no migration; `read_storyboard` view (:140) carries `rules`; new `propose_brief_rule` tool + handler; `read_storyboard`'s description (:277) rewritten so the Director reads the brief and rules **before** drafting or critiquing — under A4's pull-only decision that description is the whole prompt surface for the brief (Step 4.3).                            |
| `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposalCard.tsx`                                                                                                                                                    | `resolveProposalDiff` (:58) narrowed; `accept()`'s scene-draft flush (:89) skipped for `pin_rule`; a `pin_rule` render branch.                                                                                                                                                                                                                                                                                                               |
| `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposals.tsx`                                                                                                                                                       | `StudioRuleBreachReport` + `describeRuleBreachInstruction`, and an exported `sendDirectorInstruction` that re-GETs the conversation before reading its pins; the private `repropose` is rewritten on top of it.                                                                                                                                                                                                                              |
| `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation.ts`                                                                                                                                   | The pin sync effect: builds the patch with `buildContextHandoffExtraPatch` (so the rest of `context_handoff` survives) and writes `buildStudioBriefRulesPin(...)` into `conversation.extra.context_handoff.pinned_context` on ready, on every rules change, and on every conversation identity change.                                                                                                                                       |
| `packages/desktop/src/renderer/pages/studio/components/PhaseShell/StudioPhaseHeader.tsx`                                                                                                                                                  | No signature change — the Rules button rides the existing `actions` slot.                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/desktop/src/renderer/pages/studio/components/PhaseShell/StudioPhaseShell.tsx`                                                                                                                                                   | `actions` becomes a fragment: the Rules button plus the phase CTA.                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/desktop/src/renderer/pages/studio/components/PhaseShell/types.ts`                                                                                                                                                               | `BriefPhaseController` untouched; `StudioPhaseControllers` gains `openRules`.                                                                                                                                                                                                                                                                                                                                                                |
| `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationReviewModal.tsx`                                                                                                                                              | `promptText` on `GenerationReviewScene`; `ruleBreachesBySceneId` + `onAskDirector` props with a module-scope `NO_RULE_BREACHES` default; per-scene breach alert; breach blocks Confirm for the whole batch; an "ask the Director" action, hidden when the handler is absent.                                                                                                                                                                 |
| `packages/desktop/src/renderer/pages/studio/components/index.ts`                                                                                                                                                                          | Re-export `./Rules`.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`                                                                                                                                                                               | `toReviewScene` supplies `promptText` (trimmed, mirroring `jobManager.ts:579`); the drawer is mounted and `openRules` wired; `setBriefRules` adopts through `refetch`; a new module-scope `StudioGenerationReview` consumer, and `<GenerationReviewModal>` moves inside `BriefConversationProvider` so the breach can reach the Director; the auto-submit path (:500-552) refuses on a breach, names the reason and falls back to the modal. |
| `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json` (12 files)                                                                                                                                                      | The new `rules` group (30 keys) plus `errors.ruleBreach`. No plural key.                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`                                                                                                                                                                              | Regenerated.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `tests/unit/pages/studio/studioI18n.test.ts`                                                                                                                                                                                              | `plannedGroups` gains `'rules'`; `rulesKeys` presence list; 17 `streamFullSentenceKeys` additions. `pluralLogicalKeys` unchanged — the group has no plural key.                                                                                                                                                                                                                                                                              |
| `tests/unit/process/creative-studio/store.test.ts`                                                                                                                                                                                        | Migration, validation and proposal-payload-union coverage.                                                                                                                                                                                                                                                                                                                                                                                   |
| `tests/unit/process/creative-studio/creativeStudioService.test.ts`                                                                                                                                                                        | `studioServerProjectFixture` gains `rules: []`; `read_storyboard` rules payload and the pre-rules-manifest case; `setBriefRules`; the `propose_brief_rule` handler and rule-proposal accept; the end-to-end migration proof.                                                                                                                                                                                                                 |
| `tests/unit/process/creative-studio/jobManager.test.ts`                                                                                                                                                                                   | A new `StudioJobManager pinned rule gate` describe: submit, reference plate, retry, and a no-predicate control.                                                                                                                                                                                                                                                                                                                              |
| `tests/unit/process/bridge/nativePayloadSchemas.test.ts`                                                                                                                                                                                  | `VALID_PAYLOADS` and the invalid-payload lists.                                                                                                                                                                                                                                                                                                                                                                                              |
| `tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx`                                                                                                                                                                   | Breach display and the Confirm block.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx`                                                                                                                                                                         | The `pin_rule` card, asserted against the file's key-echoing `t` mock.                                                                                                                                                                                                                                                                                                                                                                       |
| `tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx`                                                                                                                                                                            | `describeRuleBreachInstruction`, and the re-GET that carries the rules pin into the breach turn. The existing repropose assertion at `:237` becomes `await waitFor(…)`, because the send now happens after an awaited re-GET.                                                                                                                                                                                                                |
| `tests/unit/pages/studio/StudioPhaseShell.dom.test.tsx`, `StudioAccessibleCopy.dom.test.tsx`, `tests/unit/e2e/creativeStudioSelectors.dom.test.tsx`, `tests/unit/pages/studio/Storyboard/Brief/BriefPhase.dom.test.tsx`                   | The four `StudioPhaseControllers` fixtures gain `openRules`. **Tests are not typechecked** (`tsconfig.json` `include` is `packages/desktop/src/**/*` only), so a missed fixture is a runtime `undefined`, not a compile error.                                                                                                                                                                                                               |
| `tests/unit/pages/studio/StudioPage.dom.test.tsx` (`project()` :103), `tests/unit/pages/studio/StudioExport.dom.test.tsx` (`project()` :103), `tests/unit/pages/studio/Storyboard/Brief/BriefConversation.dom.test.tsx` (`project()` :66) | Three `StudioRendererProject` fixtures gain `rules: []`. Same untypechecked-fixture class as the row above and as `studioServerProjectFixture`: the first two render the real `StudioPage`, so Task 8's drawer reads `project.rules.length` on them (Step 8.3); the third drives the real `useBriefConversation`, so Task 5's effect reads `project.rules` on it (Step 5.2). Each edit lands in the task that first breaks it.               |

---

## Task 1 — The shared rules module: vocabulary, precedence, predicate

**Files**

- Create: `packages/desktop/src/common/types/project/creativeStudioRules.ts`
- Create: `tests/unit/process/creative-studio/types/rules.test.ts`

### Step 1.1 — Write the failing test for folding and matching

- [ ] Create `tests/unit/process/creative-studio/types/rules.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { StudioBriefRule } from '@/common/types/project/creativeStudioRules';
import { evaluateStudioRules, STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';

const rule = (overrides: Partial<StudioBriefRule> = {}): StudioBriefRule => ({
  id: 'rule_1',
  scope: 'project',
  text: 'Never show a competitor logo.',
  predicate: { kind: 'forbidden_terms', terms: ['acme'] },
  createdAt: '2026-08-13T00:00:00.000Z',
  ...overrides,
});

describe('evaluateStudioRules', () => {
  it('reports no breach when no rule carries a predicate', () => {
    const verdict = evaluateStudioRules([rule({ predicate: null })], 'An ACME billboard at dusk');

    expect(verdict.breaches).toEqual([]);
  });

  it('returns early on an empty rule list, so a shot with no prompt yet cannot throw', () => {
    // No fixture in this repo is typechecked, so `promptText` really can arrive undefined. With zero
    // rules there is nothing to check and nothing to tokenise.
    expect(evaluateStudioRules([], undefined as unknown as string).breaches).toEqual([]);
  });

  it('matches a forbidden term regardless of case', () => {
    const verdict = evaluateStudioRules([rule()], 'An ACME billboard at dusk');

    expect(verdict.breaches).toEqual([
      { ruleId: 'rule_1', ruleText: 'Never show a competitor logo.', scope: 'project', matchedTerm: 'acme' },
    ]);
  });

  it('does not match a term buried inside a longer word', () => {
    const verdict = evaluateStudioRules(
      [rule({ predicate: { kind: 'forbidden_terms', terms: ['logo'] } })],
      'A logotype study'
    );

    expect(verdict.breaches).toEqual([]);
  });

  it('matches a multi-word term only as a contiguous run', () => {
    const forbidden = rule({ predicate: { kind: 'forbidden_terms', terms: ['red carpet'] } });

    expect(evaluateStudioRules([forbidden], 'A red carpet at night').breaches).toHaveLength(1);
    expect(evaluateStudioRules([forbidden], 'A red rug and a carpet').breaches).toEqual([]);
  });

  it('does not fold diacritics, so accented words stay distinct', () => {
    const forbidden = rule({ predicate: { kind: 'forbidden_terms', terms: ['ca'] } });

    expect(evaluateStudioRules([forbidden], 'một con cá').breaches).toEqual([]);
    expect(evaluateStudioRules([forbidden], 'một ca nhạc').breaches).toHaveLength(1);
  });

  it('reports one breach per rule, naming the first term that matched', () => {
    const forbidden = rule({ predicate: { kind: 'forbidden_terms', terms: ['acme', 'globex'] } });

    expect(evaluateStudioRules([forbidden], 'ACME and GLOBEX together').breaches).toEqual([
      { ruleId: 'rule_1', ruleText: 'Never show a competitor logo.', scope: 'project', matchedTerm: 'acme' },
    ]);
  });

  it('caps rule text and term length so a rule cannot smuggle a prompt', () => {
    expect(STUDIO_RULE_LIMITS).toEqual({ maxRules: 24, text: 240, maxTerms: 8, term: 64 });
  });
});
```

- [ ] Run it and see it fail on the missing module:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: `Failed to resolve import "@/common/types/project/creativeStudioRules"` and `Test Files  1 failed (1)`.

### Step 1.2 — Write the module's vocabulary and evaluator

- [ ] Create `packages/desktop/src/common/types/project/creativeStudioRules.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TContextHandoffItem } from '@/common/config/storage';

/**
 * The executable part of the brief.
 *
 * Prose in `project.brief` is context the Director reads. A rule with a predicate is a check run
 * against every visual prompt before it renders, in the main process, where the Director cannot
 * reach it. A rule with `predicate: null` is prose that happens to be listed: the Director sees it,
 * nothing enforces it.
 *
 * Field names are deliberately plain. `containsForbiddenRendererField` (store.ts) walks the whole
 * project record recursively and refuses any key named path/filepath/url/apikey/credential/bytes/
 * base64 at any depth, and a project record that trips it becomes unreadable and is quarantined.
 */
export const STUDIO_RULE_LIMITS = {
  /** Total effective rules, organisation layer included. */
  maxRules: 24,
  /** One rule's human-readable sentence. */
  text: 240,
  maxTerms: 8,
  term: 64,
} as const;

/**
 * `organisation` rules are code-resident and locked; the store refuses them on a project record.
 * See A5 in the plan: there is no org-scope store, admin channel or locking primitive in this app,
 * so the layer exists to make precedence real, not to distribute anything yet.
 */
export type StudioBriefRuleScope = 'project' | 'organisation';

export type StudioBriefRulePredicate = {
  kind: 'forbidden_terms';
  terms: string[];
};

export type StudioBriefRule = {
  id: string;
  scope: StudioBriefRuleScope;
  text: string;
  predicate: StudioBriefRulePredicate | null;
  createdAt: string;
};

/** What the renderer sends when it replaces the project's rule list. Main mints scope and createdAt. */
export type StudioBriefRuleDraft = {
  id: string;
  text: string;
  predicate: StudioBriefRulePredicate | null;
};

export type StudioRuleBreach = {
  ruleId: string;
  ruleText: string;
  scope: StudioBriefRuleScope;
  matchedTerm: string;
};

export type StudioRuleVerdict = {
  breaches: StudioRuleBreach[];
};

/**
 * The VNG-wide layer. Empty on purpose — see A5. Rules added here apply to every project on the
 * machine, cannot be edited or removed in the UI, and are evaluated before project rules.
 */
export const ORGANISATION_STUDIO_RULES: readonly StudioBriefRule[] = [];

/**
 * Case-folds only. Diacritics are deliberately NOT stripped: folding them merges distinct
 * Vietnamese words (ca / cà / cá), and this product ships in Vietnamese. A user who wants both
 * forms forbidden lists both terms.
 */
export const foldForRuleMatch = (value: string): string => value.toLowerCase();

/**
 * Unicode word tokens. `\b` is ASCII-word-based and mis-segments Vietnamese and CJK, so it is not
 * used anywhere in this module.
 */
const RULE_TOKEN = /[\p{L}\p{N}]+/gu;

const tokenise = (value: string): string[] =>
  Array.from(foldForRuleMatch(value).matchAll(RULE_TOKEN), (match) => match[0]);

const containsRun = (haystack: readonly string[], needle: readonly string[]): boolean => {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
  }
  return false;
};

/**
 * Runs every rule that has a predicate against one resolved prompt.
 *
 * Pure, synchronous and free: it is called in main before a paid request is built, and again in the
 * renderer to say the consequence before the user presses Confirm. Both callers must see the same
 * verdict, which is why this is one module and not two implementations.
 *
 * At most one breach per rule — the first term that matched. Listing every match would bury the
 * rule the user has to act on.
 */
export const evaluateStudioRules = (rules: readonly StudioBriefRule[], prompt: string): StudioRuleVerdict => {
  // Before touching `prompt`, because the zero-rule case is every project until the user pins one
  // and the renderer calls this once per reviewed shot. It is also a guard: no test fixture in this
  // repo is typechecked, so a `GenerationReviewScene` built without `promptText` reaches here as
  // `undefined`, and tokenising it would turn a memo into a TypeError for a project with no rules.
  if (rules.length === 0) return { breaches: [] };
  const promptTokens = tokenise(prompt);
  const breaches: StudioRuleBreach[] = [];
  for (const rule of rules) {
    if (rule.predicate === null) continue;
    const matched = rule.predicate.terms.find((term) => containsRun(promptTokens, tokenise(term)));
    if (matched === undefined) continue;
    breaches.push({
      ruleId: rule.id,
      ruleText: rule.text,
      scope: rule.scope,
      matchedTerm: foldForRuleMatch(matched.trim()),
    });
  }
  return { breaches };
};
```

- [ ] Run it and see it pass:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  8 passed (8)`.

### Step 1.3 — Write the failing test for precedence

- [ ] Append to `tests/unit/process/creative-studio/types/rules.test.ts` (and add `resolveEffectiveStudioRules` and `ORGANISATION_STUDIO_RULES` to the import at the top):

```ts
describe('resolveEffectiveStudioRules', () => {
  it('ships with an empty organisation layer, because there is nowhere to distribute one from', () => {
    expect(ORGANISATION_STUDIO_RULES).toEqual([]);
  });

  it('puts organisation rules first, then project rules', () => {
    const organisation = [rule({ id: 'org_1', scope: 'organisation', text: 'No competitor brands.' })];
    const project = [rule({ id: 'rule_2', text: 'Keep the kits generic.' })];

    const effective = resolveEffectiveStudioRules(project, organisation);

    expect(effective.map((entry) => entry.id)).toEqual(['org_1', 'rule_2']);
  });

  it('drops a project rule that duplicates a locked one, so the locked one always wins', () => {
    const organisation = [rule({ id: 'org_1', scope: 'organisation', text: 'No competitor brands.' })];
    const project = [rule({ id: 'rule_2', text: '  no COMPETITOR brands.  ', predicate: null })];

    const effective = resolveEffectiveStudioRules(project, organisation);

    expect(effective.map((entry) => entry.id)).toEqual(['org_1']);
  });

  it('truncates at the cap with organisation rules kept, so a locked rule can never be pushed out', () => {
    const organisation = [rule({ id: 'org_1', scope: 'organisation', text: 'Locked.' })];
    const project = Array.from({ length: STUDIO_RULE_LIMITS.maxRules }, (_, index) =>
      rule({ id: `rule_${index}`, text: `Project rule ${index}.` })
    );

    const effective = resolveEffectiveStudioRules(project, organisation);

    expect(effective).toHaveLength(STUDIO_RULE_LIMITS.maxRules);
    expect(effective[0].id).toBe('org_1');
  });
});
```

- [ ] Run it and see it fail:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: the whole file fails to link, not four individual failures — the spec now imports a named export the module does not have, and Vite's ESM transform rejects that at link time: `does not provide an export named 'resolveEffectiveStudioRules'`, with `Test Files  1 failed (1)` and `Tests  no tests`.

### Step 1.4 — Implement precedence

- [ ] Append to `creativeStudioRules.ts`:

```ts
/**
 * Scope precedence, in one place.
 *
 * Organisation first, then project. A project rule whose text duplicates a locked one is dropped —
 * the locked rule is unremovable, so keeping both would show the user a rule they cannot delete
 * next to an identical one they can. A lower layer can never remove a higher layer's rule; the
 * thread layer (see A5) can only add, by being pinned to project scope.
 *
 * The `.slice` is a cap on EVALUATION, and while ORGANISATION_STUDIO_RULES is empty it can never
 * bite: the store already refuses a 25th project rule. It matters the day the org layer is
 * populated, because then a project rule past position 24 silently stops being enforced with no
 * signal anywhere. The drawer counts org + project against the same 24 (Step 8.2.2's `atLimit`) while
 * the store validator caps project rules at 24 alone, so the two layers disagree about the ceiling
 * by exactly ORGANISATION_STUDIO_RULES.length. Whoever fills that constant must reconcile them —
 * most likely by capping the store at `maxRules - ORGANISATION_STUDIO_RULES.length`.
 */
export const resolveEffectiveStudioRules = (
  projectRules: readonly StudioBriefRule[],
  organisationRules: readonly StudioBriefRule[] = ORGANISATION_STUDIO_RULES
): StudioBriefRule[] => {
  const locked = new Set(organisationRules.map((rule) => foldForRuleMatch(rule.text.trim())));
  const effective = [
    ...organisationRules,
    ...projectRules.filter((rule) => !locked.has(foldForRuleMatch(rule.text.trim()))),
  ];
  return effective.slice(0, STUDIO_RULE_LIMITS.maxRules);
};
```

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: `Tests  12 passed (12)`.

### Step 1.5 — Write the failing test for the context block and the pin

> **[Not taken — Option B would change this]** — see A4's RECORDED DECISION. Under the declined
> Option B the pin builder would return an array and gain a prose chunker, so these tests and Step
> 1.6's implementation would change shape. Pull-only was chosen, so they are correct as written.

- [ ] Append (and extend the import with `renderStudioRulesBlock`, `buildStudioBriefRulesPin`, `STUDIO_BRIEF_RULES_PIN_ID`, `STUDIO_BRIEF_RULES_PIN_MAX_CHARS`):

```ts
describe('renderStudioRulesBlock', () => {
  it('says nothing when there are no rules, so an empty list costs no context', () => {
    expect(renderStudioRulesBlock([])).toBe('');
  });

  it('numbers the rules, marks the enforced ones and names their terms', () => {
    const block = renderStudioRulesBlock([
      rule({
        id: 'org_1',
        scope: 'organisation',
        text: 'No competitor brands.',
        predicate: { kind: 'forbidden_terms', terms: ['acme', 'globex'] },
      }),
      rule({ id: 'rule_2', text: 'Keep the kits generic.', predicate: null }),
    ]);

    expect(block).toBe(
      [
        'PROJECT RULES — enforced before any paid render. A visual prompt that breaks an enforced rule is refused before it costs anything.',
        '1. [organisation, enforced] No competitor brands. (forbidden words: acme, globex)',
        '2. [project, context only] Keep the kits generic.',
      ].join('\n')
    );
  });
});

describe('buildStudioBriefRulesPin', () => {
  it('carries the rules and points at read_storyboard for the brief prose', () => {
    const pin = buildStudioBriefRulesPin({ rules: [rule({ predicate: null })], now: 1_700_000_000_000 });

    expect(pin).not.toBeNull();
    expect(pin?.id).toBe(STUDIO_BRIEF_RULES_PIN_ID);
    expect(pin?.source).toBe('manual');
    expect(pin?.created_at).toBe(1_700_000_000_000);
    expect(pin?.content).toContain('1. [project, context only] Never show a competitor logo.');
    expect(pin?.content).toContain('Call read_storyboard for the full brief.');
  });

  it('keeps the newlines, because the pinned-context helpers would collapse them', () => {
    const pin = buildStudioBriefRulesPin({ rules: [rule()], now: 1 });

    expect(pin?.content.split('\n').length).toBeGreaterThan(2);
  });

  it('returns null when there are no rules, so no pin is written at all', () => {
    expect(buildStudioBriefRulesPin({ rules: [], now: 1 })).toBeNull();
  });

  it('stays inside the per-pin character ceiling and says how many rules it dropped', () => {
    const rules = Array.from({ length: STUDIO_RULE_LIMITS.maxRules }, (_, index) =>
      rule({ id: `rule_${index}`, text: 'x'.repeat(STUDIO_RULE_LIMITS.text) })
    );

    const pin = buildStudioBriefRulesPin({ rules, now: 1 });

    expect(pin?.content.length).toBeLessThanOrEqual(STUDIO_BRIEF_RULES_PIN_MAX_CHARS);
    expect(pin?.content).toMatch(/\+\d+ more rules? — call read_storyboard\./);
  });
});
```

- [ ] Run and see it fail:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: a link-time failure again, naming the first missing export — `does not provide an export named 'renderStudioRulesBlock'` — with `Test Files  1 failed (1)` and no tests run.

### Step 1.6 — Implement the block and the pin

> **[Not taken — Option B would change this]** — under the declined Option B
> `buildStudioBriefRulesPin` becomes `buildStudioBriefContextPins` returning `TContextHandoffItem[]`.
> Nothing else in this step would move.

- [ ] Append to `creativeStudioRules.ts`:

```ts
const RULES_BLOCK_HEADING =
  'PROJECT RULES — enforced before any paid render. A visual prompt that breaks an enforced rule is refused before it costs anything.';
const RULES_BLOCK_FOOTER = 'Call read_storyboard for the full brief.';

const ruleLine = (rule: StudioBriefRule, position: number): string => {
  const enforcement = rule.predicate === null ? 'context only' : 'enforced';
  const terms = rule.predicate === null ? '' : ` (forbidden words: ${rule.predicate.terms.join(', ')})`;
  return `${position}. [${rule.scope}, ${enforcement}] ${rule.text}${terms}`;
};

/**
 * The model-facing rendering of the rules.
 *
 * English, not i18n. It is prompt text, like `propose_storyboard`'s tool description and
 * `REPROPOSE_INSTRUCTION` — every other model-facing literal in Studio is English, and localising
 * one of them makes the model's behaviour depend on the UI language.
 */
export const renderStudioRulesBlock = (rules: readonly StudioBriefRule[]): string =>
  rules.length === 0 ? '' : [RULES_BLOCK_HEADING, ...rules.map((rule, index) => ruleLine(rule, index + 1))].join('\n');

/** A fixed id so the Studio-owned pin is rewritten in place and can never be confused for a user pin. */
export const STUDIO_BRIEF_RULES_PIN_ID = 'studio_brief_rules';

/**
 * `MAX_CONTEXT_PIN_LENGTH` in payloadSchemas.ts. Restated here rather than imported because that
 * module is the IPC schema layer, but the number is the same and the context-compaction schema
 * enforces it — a longer pin would be rejected the first time Studio ever compacts.
 */
export const STUDIO_BRIEF_RULES_PIN_MAX_CHARS = 2_000;

/**
 * The one per-turn context surface Studio can reach without an aioncore change.
 *
 * `pinned_context` is re-read fresh from the backend on every send (AionrsSendBox), so a pin
 * written here rides every subsequent Director turn with no send-path patch. Two facts are
 * load-bearing:
 *
 * - 2,000 characters is the cap on ONE pin's content (`MAX_CONTEXT_PIN_LENGTH`), and
 *   `pinned_context` holds up to 20 of them (`MAX_CONTEXT_PINS`), so the channel's real ceiling is
 *   ~40,000 characters and a 16 KB brief WOULD fit across ~9 pins. This builder emits one pin
 *   carrying the rules and a pointer sentence because that is the CHOICE recorded in A4's RECORDED
 *   DECISION — push the rules, pull the prose — not because the brief cannot travel this way. If a
 *   later phase reverses that decision, this is the function that changes shape.
 * - `addPinnedContext`/`updatePinnedContext` in pinnedContext.ts run `cleanText`, which collapses
 *   ALL whitespace including newlines. This builder returns the item literally so the caller can
 *   bypass those helpers; a rules list flattened to one line is unreadable to the model and to us.
 *
 * The pushed channel degrades to a pointer well before the 24-rule cap: at 240-character rule texts
 * only about six lines fit 2,000 characters and the rest collapse into
 * `+N more rules — call read_storyboard.`. That is deliberate, and it is another reason acceptance
 * rests on the pull channel and the main-side gate rather than on this one.
 */
export const buildStudioBriefRulesPin = (input: {
  rules: readonly StudioBriefRule[];
  now: number;
}): TContextHandoffItem | null => {
  if (input.rules.length === 0) return null;
  const kept: StudioBriefRule[] = [];
  let used = RULES_BLOCK_HEADING.length + RULES_BLOCK_FOOTER.length + 2;
  let dropped = 0;
  input.rules.forEach((rule, index) => {
    const line = ruleLine(rule, index + 1);
    // 48 characters reserved for the overflow line this may still have to add.
    if (dropped > 0 || used + line.length + 1 > STUDIO_BRIEF_RULES_PIN_MAX_CHARS - 48) {
      dropped += 1;
      return;
    }
    kept.push(rule);
    used += line.length + 1;
  });
  const overflow = dropped === 0 ? [] : [`+${dropped} more rule${dropped === 1 ? '' : 's'} — call read_storyboard.`];
  return {
    id: STUDIO_BRIEF_RULES_PIN_ID,
    title: 'Project rules',
    // The block is rendered by renderStudioRulesBlock, not re-assembled here: one definition of the
    // model-facing rule format, and the pin is a consumer of it rather than a second implementation
    // that can drift. The numbering matches because dropping is suffix-only — once `dropped > 0`
    // every later rule is dropped too, so `kept` is always a prefix of `input.rules` and
    // renderStudioRulesBlock's 1..n numbering is the same numbering measured above.
    content: [renderStudioRulesBlock(kept), ...overflow, RULES_BLOCK_FOOTER].join('\n'),
    // `contextPinSchema` is .strict() with source: z.enum(['manual','context_md']). A Studio-specific
    // value would be rejected by the context-compaction schema, so the pin reuses 'manual' and is
    // identified by its fixed id instead.
    source: 'manual',
    created_at: input.now,
    updated_at: input.now,
  };
};
```

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: `Tests  18 passed (18)` — 8 from Step 1.1, 4 from Step 1.3, 6 from Step 1.5 (2 for the block, 4 for the pin).

### Step 1.7 — Commit

- [ ] `git add packages/desktop/src/common/types/project/creativeStudioRules.ts tests/unit/process/creative-studio/types/rules.test.ts`
- [ ] `git commit -m "feat(creative-studio): add the brief rules vocabulary, precedence and predicate"`

---

## Task 2 — Persist rules on the project record, in migration order

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (:237-257)
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts` (:170-183, :898-933, :953-1086, :1097-1114)
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts` (:737-768)
- Test: `tests/unit/process/creative-studio/store.test.ts`

**The order is load-bearing.** `readProject` runs `migrateSchemaV1Project(raw)` at `store.ts:1768` and _then_ `validateProject(migrated)` at `:1769`. `migrateSchemaV1Project` returns the value untouched only when `!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.jobs)` — and any record failing those also fails `validateProject` for unrelated reasons. So defaulting `rules` in the migrator makes it safe to validate `rules` as **required** in the same change: every record that could otherwise have passed now arrives with the field. Do not invert this. Tightening validation first makes every existing `project.json` throw `storage_error` and get quarantined.

### Step 2.1 — Write the failing migration test

The file's setup is a `beforeEach` with closure-scoped `rootDir` and `store` (`store.test.ts:253-262`) plus a module-scope `makeInput()` (`:52-59`) — there is **no** `createStore()` and no `projectInput()`. Manifest edits go through the **sync** `readFileSync`/`writeFileSync` imported from `node:fs` (`:7-17`); there is no `fs` namespace in this file, so `fs.readFile` does not resolve. Copy the shape of the existing manifest-editing tests at `:968-986` and `:988-998`.

- [ ] Add to `tests/unit/process/creative-studio/store.test.ts`, inside `describe('creative studio project store')` so `store` and `rootDir` are in scope:

```ts
it('reads a project written before rules existed and defaults them to an empty list', async () => {
  const project = await store.createProject(makeInput());
  const file = path.join(rootDir, project.id, 'project.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  delete raw.rules;
  writeFileSync(file, JSON.stringify(raw));

  const reread = await store.getProject(project.id);

  expect(reread?.rules).toEqual([]);
  expect(await store.listQuarantinedProjectIds()).toEqual([]);
});

it('refuses a rules array that breaks the shape, rather than persisting it unread', async () => {
  const project = await store.createProject(makeInput());
  const file = path.join(rootDir, project.id, 'project.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  raw.rules = [
    {
      id: 'rule_1',
      scope: 'project',
      text: 'x',
      predicate: { kind: 'nope', terms: [] },
      createdAt: '2026-08-13T00:00:00.000Z',
    },
  ];
  writeFileSync(file, JSON.stringify(raw));

  await expect(store.getProject(project.id)).rejects.toMatchObject({ code: 'storage_error' });
});

it('refuses an organisation-scoped rule on the project record, because that layer is code-resident', async () => {
  const project = await store.createProject(makeInput());
  const file = path.join(rootDir, project.id, 'project.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  raw.rules = [
    { id: 'rule_1', scope: 'organisation', text: 'x', predicate: null, createdAt: '2026-08-13T00:00:00.000Z' },
  ];
  writeFileSync(file, JSON.stringify(raw));

  await expect(store.getProject(project.id)).rejects.toMatchObject({ code: 'storage_error' });
});
```

`readFileSync`, `writeFileSync`, `path` and `makeInput` are all already in this file. If the local names have drifted since this plan was written, read the top of the file and match them exactly rather than adding parallel helpers.

- [ ] Run and see it fail:

```
bun run test tests/unit/process/creative-studio/store.test.ts
```

Expected: the first new test fails with `expected undefined to deeply equal []`; the other two fail because a malformed/organisation rules array is accepted.

### Step 2.2 — Declare the field, required

- [ ] In `creativeStudioTypes.ts`, add the import and the field:

```ts
import type { StudioBriefRule } from './creativeStudioRules';
```

and inside `StudioProject`, immediately after `brief: string;`:

```ts
  /**
   * The executable part of the brief. REQUIRED, not optional: `StudioRendererProject` is
   * `Omit<StudioProject, 'jobs' | 'routing'> & …` and `toRendererProject` declares that return
   * type, so a required field makes omitting it from the projection a tsc error. Optional and it
   * would be persisted, validated, visible to the MCP tools and silently invisible to the renderer —
   * the documented `outputRole` trap (see the warning at :144-149).
   */
  rules: StudioBriefRule[];
```

- [ ] Also re-export the rule types from this module so consumers have one import site:

```ts
export type {
  StudioBriefRule,
  StudioBriefRuleDraft,
  StudioBriefRulePredicate,
  StudioBriefRuleScope,
  StudioRuleBreach,
  StudioRuleVerdict,
} from './creativeStudioRules';
```

- [ ] Confirm the compiler now names every site that must move:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: errors at `store.ts` `createProjectFromInput` (missing `rules`) and `creativeStudioService.ts` `toRendererProject` (missing `rules`). If `toRendererProject` is NOT flagged, stop — the field was declared optional and the silent-drop trap is live.

### Step 2.3 — Migrate, validate, seed

- [ ] In `store.ts`, add to the imports:

```ts
import { STUDIO_RULE_LIMITS, type StudioBriefRule } from '@/common/types/project/creativeStudioRules';
```

- [ ] Add the key sets next to `PROPOSAL_SCENE_KEYS` (~:195):

```ts
const BRIEF_RULE_KEYS = new Set(['id', 'scope', 'text', 'predicate', 'createdAt']);
const BRIEF_RULE_PREDICATE_KEYS = new Set(['kind', 'terms']);
```

- [ ] Add the validators next to `validateProposalScene` (~:372):

```ts
const validateBriefRulePredicate = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    hasExactKeys(value, BRIEF_RULE_PREDICATE_KEYS) &&
    value.kind === 'forbidden_terms' &&
    Array.isArray(value.terms) &&
    value.terms.length > 0 &&
    value.terms.length <= STUDIO_RULE_LIMITS.maxTerms &&
    value.terms.every((term) => isNonEmptyString(term) && term.length <= STUDIO_RULE_LIMITS.term) &&
    new Set(value.terms).size === value.terms.length);

/**
 * A rule on the project record is always project-scoped. The organisation layer is code-resident
 * (ORGANISATION_STUDIO_RULES) and is refused here on purpose: a locked rule cached on disk could be
 * edited out of the file by hand, which is exactly what "locked" must not mean.
 */
const validateBriefRule = (value: unknown): value is StudioBriefRule =>
  isRecord(value) &&
  hasExactKeys(value, BRIEF_RULE_KEYS) &&
  isSafeId(value.id) &&
  value.scope === 'project' &&
  isNonEmptyString(value.text) &&
  value.text.length <= STUDIO_RULE_LIMITS.text &&
  validateBriefRulePredicate(value.predicate) &&
  isCanonicalIsoTimestamp(value.createdAt);

const validateBriefRules = (value: unknown): value is StudioBriefRule[] =>
  Array.isArray(value) &&
  value.length <= STUDIO_RULE_LIMITS.maxRules &&
  value.every(validateBriefRule) &&
  new Set(value.map((rule) => (rule as StudioBriefRule).id)).size === value.length;
```

- [ ] Extend `migrateSchemaV1Project`. Replace its final `return` (`store.ts:932`) with:

```ts
// Defaulted here, before validateProject runs at readProject, so a manifest written before rules
// existed reads back rather than being quarantined. The migrator is unconditional for any record
// that could otherwise pass validation, which is what makes it safe to validate `rules` as
// required in the same change.
const rulesMissing = !Object.hasOwn(value, 'rules');
return changed || routing !== value.routing || rulesMissing
  ? { ...value, jobs, routing, ...(rulesMissing ? { rules: [] } : {}) }
  : value;
```

- [ ] In `validateProject`, add to the second condition block (after `!isString(value.brief) ||`):

```ts
    !validateBriefRules(value.rules) ||
```

- [ ] In `createProjectFromInput`, add after `brief: input.brief,`:

```ts
  rules: [],
```

- [ ] Run and see the store tests pass:

```
bun run test tests/unit/process/creative-studio/store.test.ts
```

Expected: `Test Files  1 passed (1)`, all three new tests green.

### Step 2.4 — Carry rules through the renderer projection

- [ ] In `creativeStudioService.ts` `toRendererProject`, add after `brief: project.brief,`:

```ts
    rules: project.rules.map((rule) => ({
      ...rule,
      predicate: rule.predicate === null ? null : { ...rule.predicate, terms: [...rule.predicate.terms] },
    })),
```

- [ ] Confirm the compiler is clean:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: no output.

### Step 2.5 — Commit

- [ ] `git commit -am "feat(creative-studio): persist brief rules on the project record"`

---

## Task 3 — The set-rules command, end to end

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/common/adapter/native/constants.ts` (:87, inside `NATIVE_BRIDGE_PROVIDER_KEYS` at :14-140)
- Modify: `packages/desktop/src/common/adapter/native/payloadSchemas.ts` (:434-448 region, :709+ map)
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts` (:1232)
- Modify: `packages/desktop/src/process/bridge/creativeStudioBridge.ts` (:323)
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts`
- Test: `tests/unit/process/bridge/nativePayloadSchemas.test.ts`, `tests/unit/process/creative-studio/creativeStudioService.test.ts`

**Why a dedicated command and not `update_project`.** `flushProjectDraft` (`useStoryboardEditor.ts:1245`) resends **every** draft field on every flush and dirty-tracks per _field_, so a rules array would be one field clobbered wholesale whenever a Director pin races a brief keystroke. `bindBriefConversation` (`creativeStudioService.ts:1336`) is the precedent: its own command, its own CAS on `expectedRevision`, no draft involvement.

### Step 3.1 — Write the failing schema test

- [ ] In `tests/unit/process/bridge/nativePayloadSchemas.test.ts`, add to `VALID_PAYLOADS` right after the `'creative-studio.update-project'` entry (:242):

```ts
  'creative-studio.set-brief-rules': {
    projectId: 'project_1',
    expectedRevision: 1,
    rules: [{ id: 'rule_1', text: 'Keep the kits generic.', predicate: { kind: 'forbidden_terms', terms: ['acme'] } }],
  },
```

- [ ] Add to the invalid-payload list that starts at :1064:

```ts
  ['creative-studio.set-brief-rules', 'missing expected revision', { projectId: 'project_1', rules: [] }],
  [
    'creative-studio.set-brief-rules',
    'unknown predicate kind',
    {
      projectId: 'project_1',
      expectedRevision: 1,
      rules: [{ id: 'rule_1', text: 'x', predicate: { kind: 'regex', terms: ['x'] } }],
    },
  ],
  [
    'creative-studio.set-brief-rules',
    'too many rules',
    {
      projectId: 'project_1',
      expectedRevision: 1,
      rules: Array.from({ length: 25 }, (_, index) => ({ id: `rule_${index}`, text: 'x', predicate: null })),
    },
  ],
```

- [ ] Run and see it fail:

```
bun run test tests/unit/process/bridge/nativePayloadSchemas.test.ts
```

Expected: `every manifested provider has a payload schema` fails naming `creative-studio.set-brief-rules`, and the manifest-parity assertion fails because the key is absent from `NATIVE_BRIDGE_PROVIDER_KEYS`.

### Step 3.2 — Declare the request type

- [ ] In `creativeStudioTypes.ts`, next to `StudioBindBriefConversationRequest`:

```ts
/** Replaces the project's whole rule list. Main mints scope and createdAt; ids come from the caller. */
export type StudioSetBriefRulesRequest = StudioProjectRequest & {
  expectedRevision: number;
  rules: StudioBriefRuleDraft[];
};
```

### Step 3.3 — Register the channel and its schema

- [ ] In `constants.ts`, add after `'creative-studio.update-project',`:

```ts
  'creative-studio.set-brief-rules',
```

- [ ] In `payloadSchemas.ts`, add above `studioUpdateProjectSchema` (:434):

```ts
const studioBriefRulePredicateSchema = z
  .object({
    kind: z.literal('forbidden_terms'),
    terms: z.array(z.string().trim().min(1).max(64)).min(1).max(8),
  })
  .strict();
const studioSetBriefRulesSchema = z
  .object({
    projectId: safeIdSchema,
    expectedRevision: studioExpectedRevisionSchema,
    rules: z
      .array(
        z
          .object({
            id: safeIdSchema,
            text: z.string().trim().min(1).max(240),
            predicate: studioBriefRulePredicateSchema.nullable(),
          })
          .strict()
      )
      .max(24),
  })
  .strict();
```

- [ ] Add to the schema map after `'creative-studio.update-project': studioUpdateProjectSchema,`:

```ts
  'creative-studio.set-brief-rules': studioSetBriefRulesSchema,
```

- [ ] In `ipcBridge.ts`, add after the `updateProject` provider (:1234):

```ts
  setBriefRules: bridge.buildProvider<StudioCommandResult<StudioRendererProject>, StudioSetBriefRulesRequest>(
    'creative-studio.set-brief-rules'
  ),
```

and add `StudioSetBriefRulesRequest` to the type import from `creativeStudioTypes`.

- [ ] Run and see the schema test pass:

```
bun run test tests/unit/process/bridge/nativePayloadSchemas.test.ts
```

Expected: `Test Files  1 passed (1)`.

### Step 3.4 — Write the failing service test

There is **no** `createService()` helper in this file: services are constructed inline as `createCreativeStudioService({ store, onProjectUpdated, storyboardPlanner: makePlanner() })` at `:331-335` and at ten further sites, against the `store`/`rootDir`/`service` variables the `beforeEach` at `:323-336` sets up. The project-input helper is `makeInput()` (`:55-62`). A test that needs a deterministic `createRuleId` builds its own service inline rather than reaching for a helper that does not exist.

- [ ] In `tests/unit/process/creative-studio/creativeStudioService.test.ts`, add:

```ts
it('replaces the rule list, stamps project scope, and preserves createdAt for a rule that stays', async () => {
  const ruled = createCreativeStudioService({
    store,
    onProjectUpdated,
    storyboardPlanner: makePlanner(),
    createRuleId: () => 'rule_minted',
  });
  const project = await ruled.createProject(makeInput());

  const first = await ruled.setBriefRules({
    projectId: project.id,
    expectedRevision: project.revision,
    rules: [{ id: 'rule_1', text: '  Keep the kits generic.  ', predicate: null }],
  });
  const createdAt = first.rules[0].createdAt;

  const second = await ruled.setBriefRules({
    projectId: project.id,
    expectedRevision: first.revision,
    rules: [
      { id: 'rule_1', text: 'Keep the kits generic.', predicate: null },
      { id: 'rule_2', text: 'No competitor logos.', predicate: { kind: 'forbidden_terms', terms: ['acme'] } },
    ],
  });

  expect(second.rules).toEqual([
    { id: 'rule_1', scope: 'project', text: 'Keep the kits generic.', predicate: null, createdAt },
    {
      id: 'rule_2',
      scope: 'project',
      text: 'No competitor logos.',
      predicate: { kind: 'forbidden_terms', terms: ['acme'] },
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    },
  ]);
});

it('refuses a stale revision rather than clobbering a concurrent edit', async () => {
  const project = await service.createProject(makeInput());

  await expect(
    service.setBriefRules({ projectId: project.id, expectedRevision: project.revision + 5, rules: [] })
  ).rejects.toMatchObject({ code: 'stale_project' });
});
```

`service`, `store`, `onProjectUpdated` and `makePlanner()` all come from the file's own `beforeEach` and module scope (`:296-335`); `createCreativeStudioService` is already imported at `:34-37`.

- [ ] Run and see it fail:

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: `service.setBriefRules is not a function`.

### Step 3.5 — Implement the service command and the provider

- [ ] In `creativeStudioService.ts`, add `createRuleId?: () => string;` to `CreativeStudioServiceDeps` (~:205) and inside the factory next to `createSceneId` (:955):

```ts
const createRuleId = deps.createRuleId ?? randomUUID;
```

- [ ] Add `setBriefRules(input: StudioSetBriefRulesRequest): Promise<StudioRendererProject>;` to the `CreativeStudioService` interface, and the implementation next to `bindBriefConversation` (:1336):

```ts
    async setBriefRules(input: StudioSetBriefRulesRequest): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (!Array.isArray(input.rules) || input.rules.length > STUDIO_RULE_LIMITS.maxRules) {
        throw invalid('Invalid Studio rule list');
      }
      if (new Set(input.rules.map((rule) => rule.id)).size !== input.rules.length) {
        throw invalid('Invalid Studio rule list');
      }
      for (const rule of input.rules) {
        assertSafeId(rule.id, 'rule id');
        assertText(rule.text, STUDIO_RULE_LIMITS.text, 'rule text', true);
        if (rule.predicate === null) continue;
        if (
          rule.predicate.kind !== 'forbidden_terms' ||
          !Array.isArray(rule.predicate.terms) ||
          rule.predicate.terms.length === 0 ||
          rule.predicate.terms.length > STUDIO_RULE_LIMITS.maxTerms
        ) {
          throw invalid('Invalid Studio rule predicate');
        }
        for (const term of rule.predicate.terms) assertText(term, STUDIO_RULE_LIMITS.term, 'rule term', true);
      }
      const timestamp = new Date().toISOString();
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (project) => {
            const existing = new Map(project.rules.map((rule) => [rule.id, rule]));
            return {
              ...project,
              rules: input.rules.map((draft) => ({
                id: draft.id,
                scope: 'project' as const,
                text: draft.text.trim(),
                predicate:
                  draft.predicate === null
                    ? null
                    : { kind: 'forbidden_terms' as const, terms: draft.predicate.terms.map((term) => term.trim()) },
                createdAt: existing.get(draft.id)?.createdAt ?? timestamp,
              })),
            };
          },
          input.expectedRevision
        )
      );
    },
```

Add `STUDIO_RULE_LIMITS` and `StudioSetBriefRulesRequest` to the imports. `createRuleId` is unused here on purpose — Task 6 uses it.

- [ ] In `creativeStudioBridge.ts`, add after the `updateProject` provider (:325):

```ts
ipcBridge.creativeStudio.setBriefRules.provider((input) =>
  runCommand(() => dependencies.getService().setBriefRules(input))
);
```

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: `Test Files  1 passed (1)`.

### Step 3.6 — Commit

- [ ] `git commit -am "feat(creative-studio): add the set-brief-rules command"`

---

## Task 4 — `read_storyboard` carries the rules

**Files**

- Modify: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts` (:108-109 `readProject`, :111-156 `createReadStoryboardHandler`, :277 the description string inside the `server.tool('read_storyboard', …)` registration at :275-280)
- Test: `tests/unit/process/creative-studio/creativeStudioService.test.ts` (the `read_storyboard` handler block, ~:4537, and the module-scope `studioServerProjectFixture` at :174-202)

The frozen `AIONUI_STUDIO_ROUTE_CATALOG` env snapshot is the reason rules must not go anywhere near the MCP env: verified that the descriptor is serialised at `creativeStudioService.ts:1158`, persisted into `conversation.extra.session_mcp_servers` at `studioBriefConversation.ts:86`, and never rewritten anywhere in the repo — and because `briefConversationId` is persisted on the project, the conversation survives restarts and is never recreated. Anything in the env is frozen at first project open for the life of the project. `readProject` (`studioServer.ts:108`) re-reads `project.json` on **every** tool call. Rules go there.

**The subprocess does NOT run the store's migration, and this is the trap in Task 4.** `studioServer.readProject` (`studioServer.ts:108-109`) is a bare `JSON.parse(await readFile(...)) as StudioProject` — no `migrateSchemaV1Project`, no `validateProject`. Task 2's default is applied by `store.readProject` (`store.ts:1768`) **in memory only**; nothing rewrites `project.json` on open, and `briefConversationId` is already persisted so no bind re-persists it either. So for every manifest written before this change, `project.rules` is `undefined` inside the MCP handlers, `resolveEffectiveStudioRules(undefined)` throws on `projectRules.filter`, the surrounding `try/catch` converts it to `errorResult('Creative Studio project is unavailable: …')`, and the Director loses `read_storyboard` **entirely** — for the one channel A4 names as the acceptance-bearing one. Task 6's `project.rules.length` fails the same way. Step 4.2 therefore normalises once, inside `readProject`, so every present and future handler is covered by construction rather than by remembering a `?? []` at each call site.

The proof is inside the repo, not hypothetical: `studioServerProjectFixture` (`creativeStudioService.test.ts:174-202`) has no `rules` key and feeds six existing handler tests (:4321, :4503, :4539, :4556, :4591, :4625). Without the normalisation, Step 4.2's stated `Test Files 1 passed (1)` is unachievable.

### Step 4.1 — Write the failing test

The existing `read_storyboard` handler tests do **not** go through a service: they write `studioServerProjectFixture` to a temp directory and call the handler against that directory (see `creativeStudioService.test.ts:4537-4550`). Match that pattern exactly — the handler reads the file, so the file is the whole fixture.

- [ ] Add `rules: []` to the module-scope `studioServerProjectFixture` (`creativeStudioService.test.ts:174-202`), immediately after `brief:`. This is what the store now writes, so the shared fixture must say so; the second test below deletes it again on purpose to prove the legacy path.

- [ ] Locate the `read_storyboard` handler test (search for `read_storyboard returns revision, settings and scenes`) and add alongside it:

```ts
it('shows the Director the project rules, fresh from disk on every call', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
  await writeFile(
    path.join(dir, 'project.json'),
    JSON.stringify({
      ...studioServerProjectFixture,
      rules: [
        {
          id: 'rule_1',
          scope: 'project',
          text: 'No competitor logos.',
          predicate: { kind: 'forbidden_terms', terms: ['acme'] },
          createdAt: '2026-08-13T00:00:00.000Z',
        },
      ],
    })
  );
  const handler = createReadStoryboardHandler({
    projectId: 'project_1',
    projectDir: dir,
    pendingDir: '',
    referencePendingDir: '',
  });

  const view = JSON.parse((await handler({})).content[0].text) as { rules: unknown };

  expect(view.rules).toEqual([
    { scope: 'project', text: 'No competitor logos.', enforced: true, forbiddenTerms: ['acme'] },
  ]);
});

it('reads a manifest written before rules existed as an empty list, not an unavailable project', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
  const raw = { ...studioServerProjectFixture } as Record<string, unknown>;
  delete raw.rules;
  await writeFile(path.join(dir, 'project.json'), JSON.stringify(raw));
  const handler = createReadStoryboardHandler({
    projectId: 'project_1',
    projectDir: dir,
    pendingDir: '',
    referencePendingDir: '',
  });

  const result = await handler({});

  // The subprocess does not run migrateSchemaV1Project, and nothing rewrites project.json on open.
  // Without the normalisation in readProject this returns isError: true and the Director loses
  // read_storyboard for every project that predates this change.
  expect(result.isError).toBeUndefined();
  const view = JSON.parse(result.content[0].text) as { rules: unknown; sceneOrder: string[] };
  expect(view.rules).toEqual([]);
  expect(view.sceneOrder).toEqual(['scene_1']);
});
```

`createReadStoryboardHandler`, `mkdtemp`, `tmpdir`, `path` and `writeFile` are all already imported in this file (`:9-11`, `:44-51`). The neighbouring handler tests omit `routeCatalog` from the config object; match them.

- [ ] Run and see both fail:

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: the first fails with `expected undefined to deeply equal [ … ]` (no `rules` in the view yet); the second fails the same way, because the view has no `rules` key at all yet rather than because of the missing normalisation. Both go green in Step 4.2 — and the second is the one that stays meaningful afterwards, because it is the only test in the repo that proves a pre-rules manifest still reads.

### Step 4.2 — Add rules to the tool view

- [ ] In `studioServer.ts`, add the import:

```ts
import { resolveEffectiveStudioRules } from '@/common/types/project/creativeStudioRules';
```

- [ ] **First, normalise `rules` in `readProject` (:108-109).** Replace the whole two-line arrow:

```ts
/**
 * The subprocess reads project.json raw: no migrateSchemaV1Project, no validateProject. Main's
 * `rules: []` default (store.ts:1768) is in-memory only and nothing rewrites the manifest on open,
 * so every project written before rules existed still has no `rules` key on disk. Defaulting it here
 * — once, at the single read point every handler shares — is what stops `read_storyboard` and
 * `propose_brief_rule` throwing on `undefined` and reporting the project as unavailable. Doing it at
 * the call sites instead means every future handler has to remember.
 */
const readProject = async (config: StudioServerEnv): Promise<StudioProject> => {
  const raw = JSON.parse(await readFile(path.join(config.projectDir, 'project.json'), 'utf8')) as StudioProject;
  return Array.isArray(raw.rules) ? raw : { ...raw, rules: [] };
};
```

The `Array.isArray` test rather than `?? []` is deliberate: a manifest whose `rules` is a non-array (hand-edited, or a half-written file) would otherwise reach `.filter` and throw exactly the way the missing key does. The subprocess never validates, so it must never assume.

- [ ] Inside `createReadStoryboardHandler`, immediately before `const view = {`:

```ts
// Rule ids are not exposed: the Director never addresses a rule by id, and an id in the
// context is one more thing it can hallucinate back at us. Text is the handle.
const rules = resolveEffectiveStudioRules(project.rules).map((rule) => ({
  scope: rule.scope,
  text: rule.text,
  enforced: rule.predicate !== null,
  ...(rule.predicate === null ? {} : { forbiddenTerms: rule.predicate.terms }),
}));
```

- [ ] Add `rules,` to the `view` object, immediately after `brief: project.brief,`.

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: `Test Files  1 passed (1)`. All six existing tests that feed `studioServerProjectFixture` (:4321, :4503, :4539, :4556, :4591, :4625) stay green — they do so because of the `readProject` normalisation, not because the fixture gained the field, which is why the second new test deletes it again.

### Step 4.3 — Rewrite the tool description, because pull-only makes it the whole prompt surface

**This step is load-bearing, not cosmetic, and it exists because of A4's RECORDED DECISION.** Under pull-only, whether the brief reaches the model depends entirely on whether the Director _chooses_ to call `read_storyboard`, and the only lever on that choice is the tool's own description. This repo has learned that lesson once already: for the project knowledge base, the tool description turned out to be the sole prompt surface that shapes whether the model uses the tool at all. Worse here, `buildStudioBriefRulesPin` returns `null` on a rules-free project (Step 1.6), so on those projects this description is the **only** always-present instruction about the brief that exists anywhere. A description that merely announces the tool exists is not enough; it has to tell the Director to read before it drafts.

**[Not taken — Option B would change this]** — under the declined Option B the sentence would stop calling itself the route to the brief and would call itself the authoritative, freshest one instead. The handler body is identical either way.

**This string is model-facing and is therefore NOT localised**, exactly like `renderStudioRulesBlock` (Step 1.6), `REPROPOSE_INSTRUCTION` and `describeRuleBreachInstruction` (Task 11): every model-facing literal in Studio is English, and localising one makes the model's behaviour depend on the UI language. It adds no i18n key and does not touch Task 12.

- [ ] Replace the `read_storyboard` description string (`studioServer.ts:277`) with:

```ts
    "Read this project's brief, its governing rules and its current script: revision, settings, the brief prose, the pinned rules, and every scene's editable fields plus whether it has a reference image and a selected take. Read this BEFORE you draft a script, critique one, propose any change, or answer any question about what this project may or may not show — do not answer from memory. The brief prose is not carried in your context; it lives here, and this call is the freshest and authoritative copy of both the brief and the rules. A rule marked enforced is checked against every visual prompt before anything is generated: a prompt that breaks one is refused and nothing is charged, so satisfy the rules while you write the prompt rather than after it is refused.",
```

- [ ] Confirm nothing asserts the old string:

```
grep -rn "Always call this before proposing" packages/desktop/src tests
```

Expected: no output — the phrase is unique to the sentence you just replaced, so an empty result proves the old description is gone. Do NOT grep "current script: revision, settings": the replacement text contains that phrase too, so the check could never pass. No test in this repo asserts `read_storyboard`'s description text, so this step reds nothing — which is also the reason nothing would have caught the description going stale, as `propose_storyboard`'s "reviews in Brief" sentence (`studioServer.ts:289`) proves.

### Step 4.4 — Commit

- [ ] `git commit -am "feat(creative-studio): show the Director its project rules through read_storyboard"`

---

## Task 5 — The per-turn pin

**Files**

- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation.ts`
- Create: `tests/unit/pages/studio/Storyboard/Brief/useBriefConversationPin.dom.test.ts` — a new sibling, not an addition to the existing spec. `BriefConversation.dom.test.tsx` already occupies that directory and covers the create/bind lifecycle with its own harness; the pin is a separate effect with a different mock surface.
- Modify: `tests/unit/pages/studio/Storyboard/Brief/BriefConversation.dom.test.tsx` — its `project()` fixture (`:66-84`) gains `rules: []`. It drives the **real** hook, so Task 5's effect breaks all 11 of its tests without this. See Step 5.2.

### Step 5.0 — ANSWERED: the pin is inert. Read this before writing Task 5.

**The out-of-band question is settled, against source.** The backend is `github.com/khoapnt-vng/aioncore`
(public; the decision record's `code.vng.vn/dto/aioncore` is the GitLab mirror). Checked on **both**
`security/pilot-hardening-d01-d06` (workspace version 0.1.54, ahead of this repo's pinned 0.1.51 and
the bundled 0.1.53) and `fix/mcp-oauth-discovery`:

- `pinned_context` does not appear anywhere in the repository — 688 Rust files, zero matches. The only
  `pinned` identifiers are conversation list-pinning (`pinned`, `pinned_at`) and unrelated prose about
  pinned toolchains.
- `SendMessageData` (`crates/aionui-ai-agent/src/types.rs:12`), the carrier for a user message to an
  agent, has exactly five fields: `content`, `msg_id`, `turn_id`, `files`, `inject_skills`. Identical
  on both branches.
- `#[serde(deny_unknown_fields)]` appears only on team MCP tool inputs and team API types, never on
  the message payload — so the desktop's `pinned_context` is **silently dropped**, not rejected. That
  is why nothing has ever errored.

**Therefore the pin reaches nothing.** Write Task 5 anyway — it is one effect, it is correct, and it
begins working the day the backend adds the field — but do not let the MR, the design record or a
stakeholder conversation claim that rules are injected per turn. They are not.

- [ ] Put this in the MR verbatim: **Phase 1 does not deliver "the brief is loaded into every director
      turn."** Nothing is. The Director sees the brief and rules only when it calls `read_storyboard`.
- [ ] Do not block the rest of the plan on this. Nothing else depends on the answer.
- [ ] **Do not write "the brief cannot fit in a pin" into the MR.** It can: 20 pins × 2,000 characters against a 16 KB brief (A4). The MR states the split as a decision with its two reasons — A4's RECORDED DECISION, pull-only — not as a limit of the wire. Equally, **do not write that the brief is loaded into every turn.** After the pull-only decision that is true of the rules and false of the prose; A4's "consequence, stated plainly" paragraph is the wording to reuse.
- [ ] The answer grades the decision rather than reopening it: because the pin is inert, the declined Option B's chunker would have bought **nothing at all**, at the cost of a chunker and two more tests. Pull-only was the right bet against the unknown, and is now the right bet against the known.
- [ ] **What Phase 1 still delivers, and it is the enforceable half.** The gate in `resolveProvider` (Task 9) checks every visual prompt against the rules in main, before spend, where the Director cannot reach it. That works whether or not the model ever sees a rule. The pin and the tool description are about getting the Director to comply _proactively_ instead of being refused; enforcement does not depend on either. Say it that way round in the MR.

### Step 5.1 — Write the failing test

> **[Not taken — Option B would change this]** — see A4's RECORDED DECISION. Under the declined
> Option B the effect would filter Studio pins by id **prefix**, append an array, fold the brief text
> into the dedupe signature, and this spec would gain two tests (a brief edit rewrites the prose pins;
> a shortened brief removes the stale ones). Pull-only was chosen, so it is correct as written.

- [ ] Create `tests/unit/pages/studio/Storyboard/Brief/useBriefConversationPin.dom.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `vi.hoisted`, not four bare `const … = vi.fn()`. `vi.mock` calls are hoisted above every top-level
 * declaration, and the factories below dereference these spies immediately (`invoke: harness.update`
 * is evaluated when the factory runs, which is when the statically imported hook first pulls the
 * mocked module in). Plain consts are still in their temporal dead zone at that moment and the file
 * dies with `Cannot access 'update' before initialization`. The sibling spec in this same directory
 * uses exactly this shape for exactly this reason (`BriefConversation.dom.test.tsx:22-32`).
 */
const harness = vi.hoisted(() => ({
  update: vi.fn(async () => true),
  getBriefSessionServer: vi.fn(),
  bindBriefConversation: vi.fn(),
  createStudioBriefConversation: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { update: { invoke: harness.update }, create: { invoke: vi.fn() } },
    creativeStudio: {
      getBriefSessionServer: { invoke: harness.getBriefSessionServer },
      bindBriefConversation: { invoke: harness.bindBriefConversation },
    },
  },
}));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: [], error: null }),
}));
/**
 * `modelList` must be NON-EMPTY. `noModelConfigured` is `providersResolved && modelList.length === 0`
 * (useBriefConversation.ts:151-152), and the start effect returns on it before it ever creates
 * anything (`:155-159`) — so an empty list makes the third test's `recreate()` a no-op that reports a
 * missing model instead of minting a conversation.
 */
/*
 * MODULE SCOPE, NOT INLINE LITERALS — this is what keeps the third test from hanging.
 * `current_model` is a dep of the start effect (useBriefConversation.ts:195). A factory returning a
 * fresh object each call changes identity on every render, so the effect re-runs every render; after
 * `recreate()` sets `ignoredConversationId`, `resolveBoundState` returns `absent` (`:35`) so the
 * effect no longer early-returns at `:155`, re-subscribes to the settled promise, and `setState` at
 * `:182` renders again — forever. Stable identities break the loop. The sibling spec already does
 * this deliberately: `BriefConversation.dom.test.tsx:23` holds its array in module scope.
 */
const currentModel = { id: 'p', use_model: 'm' };
const modelList = [currentModel];
vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => ({ current_model: currentModel, modelList }),
}));
/**
 * Mocked because the third test drives the REAL `recreate()`, which goes through the create path.
 * Nothing else in this spec reaches it: the first two tests resolve to `ready` straight from
 * `resolveBoundState` and never start.
 */
vi.mock('@/renderer/pages/studio/components/PhaseShell/phases/studioBriefConversation', () => ({
  createStudioBriefConversation: harness.createStudioBriefConversation,
}));

/**
 * The conversation already carries a populated `context_handoff` — a user pin, a snapshot revision
 * and an exported context file. That is the regression guard for the patch shape: `merge_extra`
 * merges at the `extra` level, NOT inside `context_handoff`, so a bare
 * `{ context_handoff: { pinned_context } }` would replace the whole sub-object and wipe every one of
 * these fields on every rules change.
 */
const contextHandoff = {
  pinned_context: [
    {
      id: 'pin_user',
      title: 'User pin',
      content: 'Remember the launch date.',
      source: 'manual' as const,
      created_at: 1,
      updated_at: 1,
    },
  ],
  revision: 4,
  context_file_path: '/tmp/context.md',
  context_file_name: 'context.md',
  turns_since_compaction: 2,
};

const conversation = {
  id: 'conversation_brief',
  type: 'aionrs' as const,
  extra: {
    workspace: '',
    custom_workspace: false,
    studio_project_id: 'project_1',
    context_handoff: contextHandoff,
  },
};

/** What `recreate()` produces: a different conversation id, the same project, the same rules. */
const recreatedConversation = { ...conversation, id: 'conversation_brief_recreated' };

/* Module scope for the same reason as `currentModel` above: `boundState` is a `useMemo` keyed on
 * `allConversations` (useBriefConversation.ts:130-133), so a fresh array per render re-runs the
 * start effect on every render and the third test never settles. */
const allConversations = [conversation, recreatedConversation];
vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({ allConversations }),
}));

import {
  forgetDirectorConversationStart,
  useBriefConversation,
} from '@/renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation';

// `briefConversationId` is fixed: the recreated conversation is reached through `recreate()`, not by
// handing the hook a different id — see the third test.
const project = (revision: number, rules: unknown[]) =>
  ({
    id: 'project_1',
    name: 'Launch film',
    revision,
    briefConversationId: 'conversation_brief',
    rules,
  }) as never;

const rule = {
  id: 'rule_1',
  scope: 'project',
  text: 'No competitor logos.',
  predicate: null,
  createdAt: '2026-08-13T00:00:00.000Z',
};

type UpdatePayload = {
  id: string;
  merge_extra?: boolean;
  updates: {
    extra: {
      context_handoff: {
        pinned_context: { id: string; content: string }[];
        revision?: number;
        context_file_path?: string;
        turns_since_compaction?: number;
      };
    };
  };
};

/** Everything `recreate()`'s create path needs; only the third test reaches any of it. */
const descriptor = {
  id: 'studio-brief-project_1',
  name: 'aionui-creative-studio',
  transport: { type: 'stdio' as const, command: 'node', args: ['/tmp/builtin-mcp-studio.js'] },
};

describe('the Studio brief rules pin', () => {
  beforeEach(() => {
    harness.update.mockClear();
    // `startedProjects` is module scope and survives every test in this file, so a start attempt from
    // one test would make the next one's `recreate()` reuse a settled promise (useBriefConversation.ts:59).
    forgetDirectorConversationStart();
    harness.getBriefSessionServer.mockReset().mockResolvedValue({ ok: true, data: descriptor });
    harness.bindBriefConversation.mockReset().mockResolvedValue({ ok: true, data: {} });
    harness.createStudioBriefConversation.mockReset().mockResolvedValue(recreatedConversation);
  });

  it('writes the rules into pinned_context without disturbing the rest of context_handoff', async () => {
    renderHook(() => useBriefConversation(project(3, [rule])));

    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(1));
    const [payload] = harness.update.mock.calls[0] as [UpdatePayload];
    expect(payload.id).toBe('conversation_brief');
    expect(payload.merge_extra).toBe(true);
    const patched = payload.updates.extra.context_handoff;
    expect(patched.pinned_context.map((pin) => pin.id)).toEqual(['pin_user', 'studio_brief_rules']);
    expect(patched.pinned_context[1].content).toContain('No competitor logos.');
    // Everything the patch must NOT drop.
    expect(patched.revision).toBe(4);
    expect(patched.context_file_path).toBe('/tmp/context.md');
    expect(patched.turns_since_compaction).toBe(2);
  });

  it('does not rewrite the pin when nothing about the rules changed', async () => {
    const { rerender } = renderHook(
      ({ revision }: { revision: number }) => useBriefConversation(project(revision, [rule])),
      {
        initialProps: { revision: 3 },
      }
    );

    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(1));
    rerender({ revision: 4 });
    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(1));
  });

  it('writes the pin into a recreated conversation even though the rules did not change', async () => {
    const { result } = renderHook(() => useBriefConversation(project(3, [rule])));

    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(1));
    expect((harness.update.mock.calls[0][0] as UpdatePayload).id).toBe('conversation_brief');

    // The REAL recreate path, not a prop change. `recreate()` forgets the start guard, marks the old
    // conversation ignored, resets `state` to `absent` and bumps `attempt`
    // (useBriefConversation.ts:197-205); the start effect then runs and installs the new conversation
    // at `:182`. A prop rerender cannot reach this state and would make this test assert nothing: the
    // hook deliberately refuses to re-derive `state` from `boundState` once it is ready (`:143-147`),
    // so `state.conversation.id` — and with it the effect's `conversationId` — would never move.
    act(() => result.current.recreate());

    // With a content-only dedupe signature the rules text is unchanged, the signature matches, the
    // effect returns early, and the new conversation carries no Studio pin for the rest of the
    // renderer's life. The conversation id inside the signature is the whole reason this second write
    // happens.
    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(2));
    expect((harness.update.mock.calls[1][0] as UpdatePayload).id).toBe('conversation_brief_recreated');
  });
});
```

All five mocked specifiers are the hook's own, verified against `useBriefConversation.ts:8-14`: `@/common`, `@/renderer/hooks/agent/useModelProviderList`, `@/renderer/pages/guid/hooks/useGuidModelSelection`, `@/renderer/hooks/context/ConversationHistoryContext` and `../studioBriefConversation`. The hook imports that last one **relatively** (`useBriefConversation.ts:14`); mocking it by alias still intercepts, because vitest matches on the resolved module — the same trick `StudioPage.dom.test.tsx:84` uses to mock this very hook.

For the first two tests the create path never runs at all: the conversation is already in `allConversations` and `project.briefConversationId` matches it, so `resolveBoundState` returns `ready` on the first render (`useBriefConversation.ts:30-38`) — the `extra` shape must satisfy that function's `conversation?.type === 'aionrs'` check. The third test is the only one that starts, and it does so through the real `recreate()`, which is why `createStudioBriefConversation`, `getBriefSessionServer` and `bindBriefConversation` all have to resolve successfully: `startDirectorConversation` reads `descriptorResult.data.id` for the allowlist (`:104`) and returns `dangling` rather than `ready` if the bind reports `ok: false` (`:119-120`), and either would leave `state` un-ready and the second write unmade for the wrong reason.

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/Storyboard/Brief/useBriefConversationPin.dom.test.ts
```

Expected: `expected "spy" to be called 1 times, but got 0 times` on all three.

### Step 5.2 — Implement the pin sync

> **[Not taken — Option B would change this]** — under the declined Option B exactly three lines
> move: the `buildStudioBriefRulesPin(...)` call becomes `buildStudioBriefContextPins(...)`, the
> `item.id !== STUDIO_BRIEF_RULES_PIN_ID` filter becomes a Studio-id-prefix filter, and the
> `signature` expression folds in the brief text. Nothing else in the effect would change.

**First, fix the one existing spec this effect breaks.** `tests/unit/pages/studio/Storyboard/Brief/BriefConversation.dom.test.tsx` drives the **real** hook, and its `project()` fixture (`:66-84`) has no `rules` key. Tests are not typechecked, so `resolveEffectiveStudioRules(project.rules)` — which runs on every render of this hook, before any state guard — reaches `.filter` on `undefined` and turns all 11 of that file's tests into TypeErrors. It is the same defect class Task 4 fixed on the main side, on the renderer side, and Task 5 is the task that introduces it.

- [ ] Add `rules: [],` to that fixture immediately after `brief: 'A mountain coffee story',` (`:71`). Nothing else in the file changes: with no rules the pin is `null`, and the effect's no-op early return below means `ipcBridge.conversation.update` is never reached, so that file's `@/common` mock (`:34-45`, which declares only `conversation.create` and `conversation.sendMessage`) needs no `update` entry.

- [ ] In `useBriefConversation.ts`, add the imports:

```ts
import {
  buildStudioBriefRulesPin,
  resolveEffectiveStudioRules,
  STUDIO_BRIEF_RULES_PIN_ID,
} from '@/common/types/project/creativeStudioRules';
import { buildContextHandoffExtraPatch } from '@/renderer/pages/conversation/contextHandoff/contextConversationUpdate';
import { getConversationPinnedContext } from '@/renderer/pages/conversation/contextHandoff/pinnedContext';
```

`TChatConversation` is already imported in this file (`useBriefConversation.ts:9`).

- [ ] Add, inside `useBriefConversation` after `const [attempt, setAttempt] = useState(0);`:

```ts
/**
 * Keeps one Studio-owned entry in the Director conversation's `pinned_context`.
 *
 * `pinned_context` is the only field on the send wire that is recomputed from a fresh server read
 * on every message (AionrsSendBox re-GETs the conversation, then forwards the pins), so a write
 * here rides every subsequent turn with no send-path patch. `preset_context`/`preset_rules` cannot
 * do this: they are captured once at conversation create and the send body has no slot for them.
 *
 * Five details are load-bearing:
 * - `merge_extra` merges at the `extra` level, NOT inside `context_handoff`. So the patch must be
 *   built with `buildContextHandoffExtraPatch`, which spreads the conversation's current
 *   `context_handoff` first (contextConversationUpdate.ts:35-40). Writing a bare
 *   `{ context_handoff: { pinned_context } }` replaces the whole sub-object and drops `snapshot`,
 *   `revision`, `context_file_path`/`_name`, `last_budget_status`, `last_exported_at`,
 *   `last_compacted_turn_id` and `turns_since_compaction` on every rules change. Every existing
 *   writer goes through this helper for exactly that reason (ContextHandoffPanel.tsx:169,
 *   useContextCompaction.ts:336-340).
 * - Non-Studio pins are preserved and the Studio pin is replaced in place by its fixed id, so a
 *   user pin can never be clobbered and the Studio pin can never be duplicated.
 * - The pin ITEM is still built literally rather than through addPinnedContext/updatePinnedContext,
 *   whose `cleanText` collapses ALL whitespace including newlines and would flatten the rule list
 *   (pinnedContext.ts:25). `buildContextHandoffExtraPatch` does not run `cleanText`, so it is safe
 *   for the patch while the item stays hand-built.
 * - The dedupe signature carries the conversation ID, not only the pin text. `recreate()` mints a
 *   NEW conversation with unchanged rules (`:197-205`, installed at `:182`); a content-only signature
 *   would match, return early, and leave that conversation with no Studio pin for the rest of the
 *   renderer's life.
 * - Zero rules and no stale Studio pin means NO write at all, not an empty one — see the guard below.
 *
 * Re-asserted on every rules change, whenever the conversation becomes ready, and whenever the
 * conversation's identity changes — which covers the realistic ways the pin could be lost: this
 * store is not CAS-guarded and Studio does not own it.
 *
 * `state.conversation` is `StudioBriefConversation = Extract<TChatConversation, { type: 'aionrs' }>`,
 * which is exactly the parameter type `buildContextHandoffExtraPatch` takes, so no cast is needed on
 * the way in — only on the way out, where `updates.extra` is typed against the whole union.
 */
const lastSyncedPinRef = useRef<string | null>(null);
const conversationId = state.kind === 'ready' ? state.conversation.id : null;
const effectiveRules = useMemo(() => resolveEffectiveStudioRules(project.rules), [project.rules]);

useEffect(() => {
  if (conversationId === null || state.kind !== 'ready') return;
  const pin = buildStudioBriefRulesPin({ rules: effectiveRules, now: Date.now() });
  const signature = `${conversationId} ${pin === null ? '' : pin.content}`;
  if (lastSyncedPinRef.current === signature) return;
  lastSyncedPinRef.current = signature;
  const current = getConversationPinnedContext(state.conversation);
  const existing = current.filter((item) => item.id !== STUDIO_BRIEF_RULES_PIN_ID);
  // Nothing to write: no rules to push, and no stale Studio pin to clear. Without this the effect
  // issues a `conversation.update` on every open of every project that has no rules — which is every
  // project until the user pins one — for a patch identical to what is already stored. It also keeps
  // `conversation.update` off the wire entirely for those projects, which is what lets
  // `BriefConversation.dom.test.tsx` keep its existing `@/common` mock shape.
  if (pin === null && existing.length === current.length) return;
  const patch = buildContextHandoffExtraPatch(state.conversation, {
    pinned_context: pin === null ? existing : [...existing, pin],
  });
  void ipcBridge.conversation.update
    .invoke({
      id: conversationId,
      merge_extra: true,
      updates: { extra: patch as TChatConversation['extra'] },
    })
    // A failed pin write costs the Director its rule list for this turn, nothing more: the money
    // gate is in main and read_storyboard still carries the rules. Retrying on the next change.
    .catch(() => {
      lastSyncedPinRef.current = null;
    });
}, [conversationId, effectiveRules, state]);
```

If `useMemo`/`useRef` are not already imported in this file, add them (they are — `useBriefConversation.ts:7`).

- [ ] Run and see it pass:

```
bun run test tests/unit/pages/studio/Storyboard/Brief/useBriefConversationPin.dom.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  3 passed (3)`.

- [ ] Run the whole Brief directory, because the fixture edit above is the half that is easy to skip:

```
bun run test tests/unit/pages/studio/Storyboard/Brief
```

Expected: no failures — `BriefConversation.dom.test.tsx`'s 11 tests included. If they fail with `Cannot read properties of undefined (reading 'filter')`, the `rules: []` fixture edit was skipped.

The nesting is **verified, not a guess**: `buildContextHandoffExtraPatch` returns `{ context_handoff: TContextHandoffExtra }` (`contextConversationUpdate.ts:35-40`), and the only two existing callers pass it as `updates: { extra: patch }` with `merge_extra: true` (`ContextHandoffPanel.tsx:169`, `useContextCompaction.ts:336-340`). So the test asserts `payload.updates.extra.context_handoff.pinned_context`, which is what Step 5.1 does.

### Step 5.3 — Commit

- [ ] `git commit -am "feat(creative-studio): carry the brief rules into every Director turn"`

---

## Task 6 — The Director proposes a rule, on the existing propose/accept protocol

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (:274-278)
- Modify: `packages/desktop/src/common/types/project/creativeStudioProposalDiff.ts` (:46-53)
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts` (:194, :390-405)
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts` (:808-840, :967-978, :1194-1204)
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`
- Test: `tests/unit/process/creative-studio/store.test.ts`, `tests/unit/process/creative-studio/creativeStudioService.test.ts`

**Reuse is viable, verified, and cheap.** `writeProposalRecord` (`studioProposalWriter.ts:28`) is already generic over `StudioProposalPayload`; `store.acceptProposal` (`store.ts:2182`) takes the apply function as a **parameter**; the `list-proposals` / `accept-proposal` / `reject-proposal` channels and their schemas already exist, so this task adds **zero** IPC and needs no `nativePayloadSchemas` edit; and the card already mounts in the Director pane, which survives phase change. Four things block it and all four are in code we own:

1. `PROPOSAL_PAYLOAD_KEYS` is exact and `validateProposalPayload` requires `kind === 'replace_storyboard'` and `sceneOrder.length > 0`. A rule payload would be written to disk and then **skipped with only a log line** (`store.ts:1465`) — the silent-failure class. Fixed by branching the validator on `kind` in this task, before any rule record can be written.
2. `computeStudioProposalDiff` reads `payload.sceneOrder` unconditionally. `tsc` catches it once the union lands (discriminated-union narrowing works with `strict` off — `tsconfig.json` sets only `noImplicitAny`).
3. Rule and storyboard proposals share one 50-slot queue (`STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT`, `store.ts:212`; `MAX_PENDING_PER_PROJECT`, `studioPendingRecordWriter.ts:13`). Accepted: rule proposals are rare and single-record, and the tool refuses on `capacity` with a message the Director can read.
4. **`acceptProposal` CASes hard on `proposal.baseRevision`, and for rules that has a consequence worth naming rather than waving through.** Verified: `store.acceptProposal` (`store.ts:2182-2214`) passes `proposal.baseRevision` straight into `updateProjectInsideQueue` (`store.ts:2204-2209`). Two rule pins offered in one Director turn share one `baseRevision`, so accepting the first bumps the project revision and the second becomes stale — even though rules are additive and order-independent, so nothing about the second depends on the first. That degrades the headline flow ("the Director offers to pin it") to "redraft it" the moment the Director offers two rules at once, which the tool invites because it takes one rule per call.

   **Decision: accept the limit for Phase 1, and make the tool say so.** The alternative is a store change — a revision-independent apply for kinds whose result does not depend on the base revision — and that is a change to the one CAS every Studio write depends on, for a case the tool description can simply avoid. So `propose_brief_rule`'s description tells the Director to offer one rule per turn (Step 6.6), and the MR records the limit as a known Phase-1 constraint with that mitigation. If it turns out in use that the Director routinely offers several at once, the store change is the fix and it needs its own step with a test that accepts two `pin_rule` proposals in sequence; do not bolt it on here.

### Step 6.1 — Write the failing store test

- [ ] Add to `tests/unit/process/creative-studio/store.test.ts`:

```ts
it('accepts a pin_rule proposal record and refuses one with an unknown key', async () => {
  const project = await store.createProject(makeInput());
  const pendingDir = path.join(rootDir, project.id, 'proposals', 'pending');
  mkdirSync(path.join(rootDir, project.id, 'proposals', 'slots'), { recursive: true });
  mkdirSync(pendingDir, { recursive: true });

  const good = {
    schemaVersion: 1,
    id: 'proposal_rule',
    projectId: project.id,
    status: 'pending',
    baseRevision: project.revision,
    payload: { kind: 'pin_rule', rule: { text: 'Keep the kits generic.', predicate: null } },
    createdAt: '2026-08-13T00:00:00.000Z',
    decidedAt: null,
  };
  writeFileSync(path.join(pendingDir, 'proposal_rule.json'), JSON.stringify(good));
  writeFileSync(
    path.join(pendingDir, 'proposal_bad.json'),
    JSON.stringify({ ...good, id: 'proposal_bad', payload: { ...good.payload, sceneOrder: [] } })
  );

  const proposals = await store.listProposals(project.id);

  expect(proposals.map((proposal) => proposal.id)).toEqual(['proposal_rule']);
});
```

`mkdirSync` and `writeFileSync` are imported from `node:fs` at `store.test.ts:7-17`; `store`, `rootDir` and `makeInput` come from the same `describe` scope as Step 2.1's tests.

Add **no** `@ts-expect-error` test to `tests/unit/process/creative-studio/types/proposalDiff.test.ts`. It would be vacuous: `vitest.config.ts` declares no `typecheck` block and `tsconfig.json`'s `include` covers only `packages/desktop/src/**/*` plus a few configs, so **no test file in this repo is typechecked by anything** (the same fact the File Structure table states). A `@ts-expect-error` directive inside a test is never validated, so the test cannot fail before the change or after it, and the "Unused '@ts-expect-error' directive" failure an earlier draft predicted would never appear. The narrowing is proved where tsc actually reads: Step 6.2 runs `bunx tsc --noEmit` and the five errors it enumerates **are** the proof.

- [ ] Run the store test and see it fail:

```
bun run test tests/unit/process/creative-studio/store.test.ts
```

Expected: `expected [] to deeply equal [ 'proposal_rule' ]` — today's `validateProposalPayload` requires `kind === 'replace_storyboard'`, so it rejects **both** records, not just the malformed one. That is the silent-failure class from A3: each rejected record costs one `[CreativeStudio] Ignoring malformed proposal record` log line and nothing reaches the user.

### Step 6.2 — Widen the payload union

- [ ] In `creativeStudioTypes.ts`, replace `StudioProposalPayload` (:274-278) with:

```ts
/** A complete replacement for the editable storyboard region named by a proposal. */
export type StudioReplaceStoryboardProposalPayload = {
  kind: 'replace_storyboard';
  sceneOrder: string[];
  scenes: Record<string, StudioEditableScene>;
};

/**
 * One rule the Director wants pinned to the project.
 *
 * A rule pin rides the proposal protocol rather than a new pending-record family: the writer, the
 * slot reservation, the CAS on accept, the decision ledger, the three IPC channels and the card in
 * the Director pane all already exist and are all kind-agnostic. What is NOT kind-agnostic is
 * `validateProposalPayload` — see store.ts — which is why the discriminant must be validated
 * per-kind before any record of this shape reaches disk.
 */
export type StudioPinRuleProposalPayload = {
  kind: 'pin_rule';
  rule: {
    text: string;
    predicate: StudioBriefRulePredicate | null;
  };
};

export type StudioProposalPayload = StudioReplaceStoryboardProposalPayload | StudioPinRuleProposalPayload;
```

- [ ] In `creativeStudioProposalDiff.ts`, change the import and the signature:

```ts
import type {
  StudioEditableScene,
  StudioEditableSceneField,
  StudioProposalDiff,
  StudioProposalSceneChange,
  StudioReplaceStoryboardProposalPayload,
} from './creativeStudioTypes';
```

```ts
export const computeStudioProposalDiff = (
  current: StudioProposalDiffSource,
  payload: StudioReplaceStoryboardProposalPayload
): StudioProposalDiff => {
```

- [ ] Run the compiler to enumerate the narrow sites:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: five sites, every one of them a real behavioural change and not just a cast:

1. `creativeStudioService.ts` `rememberProposalDiff` (:967) — `computeStudioProposalDiff(project, proposal.payload)` no longer accepts the union. Fixed in Step 6.4.4.
2. `creativeStudioService.ts` `applyProposalPayload` (:808) — `payload.sceneOrder`. Fixed in Step 6.4.3.
3. **`creativeStudioService.ts` `toRendererProposal` (:770-806)** — `proposal.payload.sceneOrder` and `.scenes`, read unconditionally. This is the one an implementer would not predict, and the only one that is a functional hole rather than a type complaint: `toRendererProposal` is the sole path proposals take to the renderer (`listProposals` :1172, `acceptProposal` :1201, `rejectProposal` :1210), it rebuilds the payload field by field, and a `pin_rule` payload crossing it today loses `rule` entirely while gaining an invented `sceneOrder`/`scenes`. Task 7's card would then dereference `rule.text` on `undefined`, and Step 6.5's assertion `expect(proposal.payload).toEqual({ kind: 'pin_rule', … })` — which reads through this projection — could never pass. Fixed in Steps 6.4.1-6.4.2.
4. `DirectorProposalCard.tsx` `resolveProposalDiff` (:58) — fixed in Task 7.
5. `DirectorProposalCard.tsx`'s `payload.sceneOrder` list render — narrowed by Task 7's early return.

### Step 6.3 — Branch the store validator

- [ ] In `store.ts`, replace `const PROPOSAL_PAYLOAD_KEYS = new Set(['kind', 'sceneOrder', 'scenes']);` with:

```ts
const PROPOSAL_STORYBOARD_PAYLOAD_KEYS = new Set(['kind', 'sceneOrder', 'scenes']);
const PROPOSAL_PIN_RULE_PAYLOAD_KEYS = new Set(['kind', 'rule']);
const PROPOSAL_RULE_KEYS = new Set(['text', 'predicate']);
```

- [ ] Replace `validateProposalPayload` (:390-405) with:

```ts
const validateStoryboardProposalPayload = (value: Record<string, unknown>): boolean => {
  if (!isRecord(value.scenes) || !hasExactKeys(value, PROPOSAL_STORYBOARD_PAYLOAD_KEYS)) return false;
  const scenes = value.scenes;
  const sceneOrder = value.sceneOrder;
  if (!asArrayOfSafeIds(sceneOrder)) return false;
  const sceneIds = Object.keys(scenes);
  return (
    sceneOrder.length > 0 &&
    sceneOrder.length <= 24 &&
    new Set(sceneOrder).size === sceneOrder.length &&
    sceneIds.length === sceneOrder.length &&
    sceneIds.every((sceneId) => sceneOrder.includes(sceneId) && validateProposalScene(scenes[sceneId]))
  );
};

const validatePinRuleProposalPayload = (value: Record<string, unknown>): boolean =>
  hasExactKeys(value, PROPOSAL_PIN_RULE_PAYLOAD_KEYS) &&
  isRecord(value.rule) &&
  hasExactKeys(value.rule, PROPOSAL_RULE_KEYS) &&
  isNonEmptyString(value.rule.text) &&
  value.rule.text.length <= STUDIO_RULE_LIMITS.text &&
  validateBriefRulePredicate(value.rule.predicate);

const validateProposalPayload = (value: unknown): value is StudioProposalPayload => {
  if (!isRecord(value) || containsForbiddenRendererField(value)) return false;
  if (value.kind === 'replace_storyboard') return validateStoryboardProposalPayload(value);
  if (value.kind === 'pin_rule') return validatePinRuleProposalPayload(value);
  return false;
};
```

- [ ] Run and see the store test pass:

```
bun run test tests/unit/process/creative-studio/store.test.ts
```

Expected: `Test Files  1 passed (1)`.

### Step 6.4 — Branch the renderer projection, the service apply, and skip the diff

Five separate edits, all in `creativeStudioService.ts`, split into their own sub-steps because each is an independent behavioural change and one checkbox for all five is too coarse to review or resume. Do them in this order — the projection first, because Step 6.5's `expect(proposal.payload).toEqual({ kind: 'pin_rule', … })` reads through it. `tsc` stays red until Step 6.4.5, and that is expected: Step 6.2 enumerated the five sites precisely so this step could close them one at a time.

#### Step 6.4.1 — Extract the payload projection

- [ ] In `creativeStudioService.ts`, extract the payload projection out of `toRendererProposal` (:770-806) and branch it per kind. Insert immediately above `toRendererProposal`:

```ts
/**
 * The whitelist every proposal crosses on its way to the renderer.
 *
 * It is exhaustive by construction — it rebuilds the payload field by field and aliases nothing — so
 * a payload kind that is NOT branched here reaches the card with its own fields stripped and the
 * storyboard fields invented. `toRendererProposal` is the only path (listProposals :1172,
 * acceptProposal :1201, rejectProposal :1210), so this function is the whole contract.
 *
 * Keep the no-alias discipline the storyboard branch already uses: `terms` is copied, not shared. A
 * renderer holding a reference into a store-owned array is the `outputRole` trap's twin.
 */
const toRendererProposalPayload = (payload: StudioProposalPayload): StudioProposalPayload =>
  payload.kind === 'pin_rule'
    ? {
        kind: 'pin_rule',
        rule: {
          text: payload.rule.text,
          predicate:
            payload.rule.predicate === null
              ? null
              : { kind: payload.rule.predicate.kind, terms: [...payload.rule.predicate.terms] },
        },
      }
    : {
        kind: 'replace_storyboard',
        sceneOrder: [...payload.sceneOrder],
        scenes: Object.fromEntries(
          Object.entries(payload.scenes).map(([sceneId, scene]) => [
            sceneId,
            {
              title: scene.title,
              purpose: scene.purpose,
              visualPrompt: scene.visualPrompt,
              narration: scene.narration,
              onScreenText: scene.onScreenText,
              mediaKind: scene.mediaKind,
              durationSeconds: scene.durationSeconds,
              referenceAssetId: scene.referenceAssetId,
            },
          ])
        ),
      };
```

#### Step 6.4.2 — Route `toRendererProposal` through it

- [ ] Replace `toRendererProposal`'s whole `payload: { … }` literal (the `kind`/`sceneOrder`/`scenes` block at :776-793) with one line:

```ts
  payload: toRendererProposalPayload(proposal.payload),
```

Nothing else in `toRendererProposal` changes: `schemaVersion`, `id`, `projectId`, `status`, `baseRevision`, `createdAt`, `decidedAt` and the optional `diff` spread all stay exactly as they are.

#### Step 6.4.3 — Branch `applyProposalPayload`

- [ ] Replace `applyProposalPayload`'s signature and prepend the branch:

```ts
const applyProposalPayload = (
  project: StudioProject,
  payload: StudioProposalPayload,
  minted: { ruleId: string; timestamp: string }
): StudioProject => {
  if (payload.kind === 'pin_rule') {
    const text = payload.rule.text.trim();
    // Idempotent: accepting a duplicate is a no-op rather than an error, because the user pressing
    // Accept twice, or pinning a rule they already had, is not a failure they can act on.
    const duplicate = resolveEffectiveStudioRules(project.rules).some(
      (rule) => foldForRuleMatch(rule.text.trim()) === foldForRuleMatch(text)
    );
    if (duplicate) return project;
    if (project.rules.length >= STUDIO_RULE_LIMITS.maxRules) throw invalid('Studio rule limit reached');
    return {
      ...project,
      rules: [
        ...project.rules,
        {
          id: minted.ruleId,
          scope: 'project' as const,
          text,
          predicate:
            payload.rule.predicate === null
              ? null
              : { kind: 'forbidden_terms' as const, terms: payload.rule.predicate.terms.map((term) => term.trim()) },
          createdAt: minted.timestamp,
        },
      ],
    };
  }
  const proposedIds = new Set(payload.sceneOrder);
  // …existing body unchanged from here…
```

Add `foldForRuleMatch` and `resolveEffectiveStudioRules` to the imports.

#### Step 6.4.4 — Narrow `rememberProposalDiff`

- [ ] Narrow `rememberProposalDiff` (:967). Insert immediately after `if (frozen !== undefined) return frozen;`:

```ts
// Only a storyboard replace has an order to diff. A rule pin has no positional shape at all.
if (proposal.payload.kind !== 'replace_storyboard') return undefined;
```

#### Step 6.4.5 — Mint the rule id at the accept call site, and close the compiler

- [ ] Update the accept call site (:1197):

```ts
const accepted = await deps.store.acceptProposal(input.projectId, input.proposalId, (project, payload) =>
  applyProposalPayload(project, payload, { ruleId: createRuleId(), timestamp: new Date().toISOString() })
);
```

- [ ] Run the compiler:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: only `DirectorProposalCard.tsx` errors remain (fixed in Task 7).

### Step 6.5 — Write the failing MCP-tool test

- [ ] Add to `tests/unit/process/creative-studio/creativeStudioService.test.ts`:

```ts
it('records a rule the user reviews, and generates nothing', async () => {
  const ruled = createCreativeStudioService({
    store,
    onProjectUpdated,
    storyboardPlanner: makePlanner(),
    createRuleId: () => 'rule_minted',
  });
  const project = await ruled.createProject(makeInput());
  const projectDir = path.join(rootDir, project.id);
  const pendingDir = path.join(projectDir, 'proposals', 'pending');
  await mkdir(pendingDir, { recursive: true });
  await mkdir(path.join(projectDir, 'proposals', 'slots'), { recursive: true });
  const handler = createProposeBriefRuleHandler({
    projectId: project.id,
    projectDir,
    pendingDir,
    referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
  });

  const result = await handler({
    base_revision: project.revision,
    text: 'Keep the kits generic.',
    forbidden_terms: ['acme'],
  });

  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toContain('recorded for user review');
  const [proposal] = await ruled.listProposals({ projectId: project.id });
  // This assertion reads through `toRendererProposal` → `toRendererProposalPayload`, so it is also
  // the guard on Step 6.4.1's projection branch: without it, `rule` is stripped here.
  expect(proposal.payload).toEqual({
    kind: 'pin_rule',
    rule: { text: 'Keep the kits generic.', predicate: { kind: 'forbidden_terms', terms: ['acme'] } },
  });

  const accepted = await ruled.acceptProposal({ projectId: project.id, proposalId: proposal.id });
  expect(accepted.project.rules).toEqual([
    {
      id: 'rule_minted',
      scope: 'project',
      text: 'Keep the kits generic.',
      predicate: { kind: 'forbidden_terms', terms: ['acme'] },
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    },
  ]);
});

it('refuses a rule drafted against a stale revision instead of pinning the wrong thing', async () => {
  const project = await service.createProject(makeInput());
  const projectDir = path.join(rootDir, project.id);
  const handler = createProposeBriefRuleHandler({
    projectId: project.id,
    projectDir,
    pendingDir: path.join(projectDir, 'proposals', 'pending'),
    referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
  });

  const result = await handler({ base_revision: project.revision + 1, text: 'x', forbidden_terms: [] });

  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('read_storyboard');
});
```

Add `createProposeBriefRuleHandler` to the existing `@process/resources/builtinMcp/studioServer` import block at `:44-51`. `mkdir` is already imported from `node:fs/promises` at `:9`. The `proposals/slots` directory is created because `writeProposalRecord` reserves a slot before writing — the neighbouring `propose_storyboard` test does the same (`:4557-4559`).

- [ ] Run and see it fail:

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: `createProposeBriefRuleHandler is not exported by …/studioServer.ts`.

### Step 6.6 — Add the MCP tool

- [ ] In `studioServer.ts`, add the imports:

```ts
import { STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';
```

- [ ] Add the input type next to `ProposeStoryboardInput` (:43):

```ts
export type ProposeBriefRuleInput = {
  base_revision: number;
  text: string;
  forbidden_terms: string[];
};
```

- [ ] Add the handler after `createProposeStoryboardHandler`:

```ts
/**
 * Records a rule for the user to pin. The tool never writes the project: main is the sole writer of
 * the CAS-guarded store, and the user decides.
 *
 * Every limit here is the store's limit, not this tool's preference. The record goes straight to the
 * pending directory and is validated only when the store reads it back, so a field this schema
 * admits and `validateBriefRulePredicate` refuses is written to disk, reported to the Director as
 * "recorded for user review", and then dropped on read with nothing but a log line — see the
 * warning above STUDIO_EDITABLE_SCENE_LIMITS, which `purpose` learned the hard way.
 */
export function createProposeBriefRuleHandler(
  config: StudioServerEnv | null
): (input: ProposeBriefRuleInput) => Promise<StudioToolResult> {
  return async ({ base_revision, text, forbidden_terms }) => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    const trimmed = text.trim();
    if (trimmed.length === 0) return errorResult('A rule needs text.');
    if (trimmed.length > STUDIO_RULE_LIMITS.text) {
      return errorResult(`A rule must be at most ${STUDIO_RULE_LIMITS.text} characters.`);
    }
    const terms = forbidden_terms.map((term) => term.trim()).filter((term) => term.length > 0);
    if (new Set(terms).size !== terms.length) return errorResult('forbidden_terms must not repeat a word.');
    try {
      const project = await readProject(config);
      if (project.revision !== base_revision) {
        return errorResult(
          `The project is at revision ${project.revision}; you proposed against ${base_revision}. ` +
            'Call read_storyboard and redraft.'
        );
      }
      // `project.rules` is always an array here because Step 4.2 normalised it inside readProject.
      // Without that, a manifest written before rules existed throws on `.length` and this tool
      // reports the project as unavailable — do not reorder Task 4 after Task 6.
      if (project.rules.length >= STUDIO_RULE_LIMITS.maxRules) {
        return errorResult(`This project already holds the maximum of ${STUDIO_RULE_LIMITS.maxRules} rules.`);
      }
      const record = await writeProposalRecord({
        pendingDir: config.pendingDir,
        projectId: config.projectId,
        baseRevision: base_revision,
        payload: {
          kind: 'pin_rule',
          rule: { text: trimmed, predicate: terms.length === 0 ? null : { kind: 'forbidden_terms', terms } },
        },
      });
      return {
        content: [
          {
            type: 'text',
            text: `Rule ${record.id} recorded for user review; nothing is pinned until the user accepts it.`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof StudioProposalWriteError) return errorResult(error.message);
      return errorResult(
        `Creative Studio rule could not be recorded: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

- [ ] Register it in `registerStudioTools`, after `propose_storyboard`:

```ts
server.tool(
  'propose_brief_rule',
  'Record one project rule for the user to pin. Use it when the user states a standing constraint ("keep the kits generic", "never show a competitor logo") — offer to pin it, then call this. Requires base_revision from your latest read_storyboard. A rule with forbidden_terms is ENFORCED: main refuses any visual prompt containing one of those words before anything is generated, so only list words that must never appear. Leave forbidden_terms empty for a rule that is guidance you should follow but nothing can check. Offer ONE rule per turn: two rules recorded against the same base_revision cannot both be accepted, because accepting the first moves the project past the revision the second was drafted against. If the user states several constraints at once, record the most important one and offer the rest after they answer. This pins nothing on its own; the user decides.',
  {
    base_revision: z
      .number()
      .int()
      .positive()
      .describe('The revision you saw in read_storyboard. Re-read if your last read is stale.'),
    text: z
      .string()
      .min(1)
      .max(STUDIO_RULE_LIMITS.text)
      .describe('One sentence, in the user’s own words where possible.'),
    forbidden_terms: z
      .array(z.string().min(1).max(STUDIO_RULE_LIMITS.term))
      .max(STUDIO_RULE_LIMITS.maxTerms)
      .describe('Words that must never appear in a visual prompt. Empty for an unenforced rule.'),
  },
  createProposeBriefRuleHandler(config)
);
```

- [ ] **Separate commit, not part of this task.** The stale sentence in `propose_storyboard`'s description (`studioServer.ts:289`) says `"a proposal the user reviews in Brief"`; proposals moved to the Director pane and the tool has been lying to the model since. Fixing it is right, but it is unrelated to Phase 1 and AGENTS.md forbids a plan creating extra cleanup scope, so it rides its own commit or is dropped:

```
git commit -m "fix(creative-studio): stop propose_storyboard telling the model proposals are reviewed in Brief"
```

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio
```

Expected: `Test Files  16 passed (16)` — that directory holds 15 spec files today (`find tests/unit/process/creative-studio -name "*.test.ts*"`) plus `types/rules.test.ts` from Task 1. No failures.

### Step 6.7 — Commit

- [ ] `git commit -am "feat(creative-studio): let the Director propose a rule through the proposal protocol"`

---

## Task 7 — The proposal card renders a rule pin

**Files**

- Modify: `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposalCard.tsx` (:58-63, :143-170)
- Test: `tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx`

### Step 7.1 — Write the failing DOM test

**This file never sees real English, and the assertions must not pretend otherwise.** `DirectorProposalCard.dom.test.tsx` mocks `react-i18next` so `t` echoes the key, appending `(name=value,…)` when interpolation values are present (`:23-34`); the only key that resolves to real copy is `proposalFieldSeparator`, which returns `', '`. The fixtures are `project()` and `proposal()` (`:57`, `:89`), and `renderCard` returns **`void`** (`:122-133`) — destructuring it throws. So: assert the echoed keys, use `screen.*`, and call the fixtures by their real names.

- [ ] Add to `tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx`, inside the existing `describe('DirectorProposalCard')` block so `renderCard` is in scope:

```ts
it('shows a rule pin as the rule itself, with its enforced words, and no shot diff', () => {
  renderCard({
    proposal: proposal({
      payload: {
        kind: 'pin_rule',
        rule: { text: 'Keep the kits generic.', predicate: { kind: 'forbidden_terms', terms: ['acme', 'globex'] } },
      },
    }),
  });

  expect(screen.getByText('conversation.creativeStudio.rules.proposalTitle')).toBeInTheDocument();
  expect(screen.getByText('conversation.creativeStudio.rules.proposalBody')).toBeInTheDocument();
  expect(screen.getByText('Keep the kits generic.')).toBeInTheDocument();
  // `fieldSeparator` is the one key the mock resolves for real, so the joined terms read as ', '.
  expect(screen.getByText('conversation.creativeStudio.rules.proposalTerms(terms=acme, globex)')).toBeInTheDocument();
  // Nothing from the storyboard branch: no diff summary, no per-scene change list, no scene titles.
  expect(screen.queryByText(/proposalSummary/)).not.toBeInTheDocument();
  expect(screen.queryByText(/proposalSceneChange/)).not.toBeInTheDocument();
});

it('does not compute a shot diff for a rule pin, even at a stale revision', () => {
  renderCard({
    project: project({ revision: 9 }),
    proposal: proposal({
      baseRevision: 3,
      payload: { kind: 'pin_rule', rule: { text: 'Keep the kits generic.', predicate: null } },
    }),
  });

  // The storyboard branch would render proposalDiffUnavailable here, because revision 9 ≠ base 3.
  expect(screen.queryByText('conversation.creativeStudio.brief.proposalDiffUnavailable')).not.toBeInTheDocument();
  expect(screen.getByText('conversation.creativeStudio.rules.proposalTitle')).toBeInTheDocument();
});
```

Because the mock echoes keys, **these two tests are complete as written and are not blocked on Task 12.** Do not later "update them to the real en-US strings" — under this mock no English string can ever match.

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx
```

Expected: `Unable to find an element with the text: conversation.creativeStudio.rules.proposalTitle`. Both new tests fail; every pre-existing test in the file passes.

### Step 7.2 — Branch the card

- [ ] In `DirectorProposalCard.tsx`, narrow `resolveProposalDiff`:

```ts
const resolveProposalDiff = (project: StudioRendererProject, proposal: StudioProposal): StudioProposalDiff | null => {
  // A rule pin has no positional shape, so there is nothing to diff and nothing to be unknowable about.
  if (proposal.payload.kind !== 'replace_storyboard') return null;
  const frozen = normaliseStudioProposalDiff(proposal.diff);
  if (frozen !== undefined) return frozen;
  if (project.revision !== proposal.baseRevision) return null;
  return computeStudioProposalDiff(project, proposal.payload);
};
```

- [ ] Skip the scene-draft flush for a rule pin. `accept()` currently flushes drafts first and bails with `proposalFlushRefused` if the flush fails (`DirectorProposalCard.tsx:83-96`), which is right for a whole-script replacement and meaningless for a rule: pinning a sentence cannot conflict with an unsaved scene edit, and a refused flush would be a dead end the user cannot connect to anything they did. Change the guard at `:89`:

```ts
      if (proposal.payload.kind !== 'pin_rule' && editor.hasUnsavedSceneDrafts) {
```

- [ ] Add a rule branch. Immediately before the existing `return (` at the end of the component, insert:

```ts
  if (proposal.payload.kind === 'pin_rule') {
    const { rule } = proposal.payload;
    return (
      <Card title={t('conversation.creativeStudio.rules.proposalTitle')}>
        <p>{t('conversation.creativeStudio.rules.proposalBody')}</p>
        <p>{rule.text}</p>
        {rule.predicate !== null && (
          <p>{t('conversation.creativeStudio.rules.proposalTerms', { terms: rule.predicate.terms.join(fieldSeparator) })}</p>
        )}
        <div className='flex gap-8px'>
          <Button type='primary' loading={pending} onClick={() => void accept()}>
            {t('conversation.creativeStudio.brief.proposalAccept')}
          </Button>
          <Button disabled={pending} onClick={() => void reject()}>
            {t('conversation.creativeStudio.brief.proposalReject')}
          </Button>
        </div>
        {messageKey !== null && (
          <div role='status' aria-live='polite'>
            {t(messageKey)}
          </div>
        )}
        {stale && (
          <Button onClick={() => void onRepropose()}>{t('conversation.creativeStudio.brief.proposalRepropose')}</Button>
        )}
      </Card>
    );
  }
```

- [ ] Confirm the compiler is clean:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: no output. `proposal.payload.sceneOrder` in the storyboard branch is now narrowed by the early return.

- [ ] Run the DOM test:

```
bun run test tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx
```

Expected: `Test Files  1 passed (1)` — **green now, not later**. This file's `react-i18next` mock echoes keys, so the assertions never needed real copy and this task is not blocked on Task 12.

### Step 7.3 — Commit

- [ ] `git commit -am "feat(creative-studio): render a rule pin in the Director proposal card"`

---

## Task 8 — The rules drawer

**Files**

- Create: `packages/desktop/src/renderer/pages/studio/components/Rules/StudioRulesDrawer.tsx`, `StudioRulesDrawer.module.css`, `index.ts`
- Create: `tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/index.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/types.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/StudioPhaseShell.tsx` (:104-137)
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`
- Modify the four `StudioPhaseControllers` fixtures
- Modify: `tests/unit/pages/studio/StudioPage.dom.test.tsx`, `tests/unit/pages/studio/StudioExport.dom.test.tsx` — their `StudioRendererProject` fixtures gain `rules: []`, because both render the real `StudioPage` and the drawer reads `project.rules.length` unconditionally

**Why not in Brief.** `docs/design/creative-studio-2-engine-strip.md:54` already disqualified Brief for the engine picker on exactly this test — "CS2's shell is Table / Board / Cut and Brief is not one of the three", and the three-pane record calls Brief's work panel "explicitly provisional" (`creative-studio-three-pane-design.md:158`). The same sentence disqualifies it here. Brief is also a _draft_ surface: anything sited next to the brief textarea inherits `beforeMutation` (`StudioPage.tsx:300-306`), which force-saves the user's prose mid-sentence and silently refuses the write when a flush fails. Rules govern the document, so they belong to the frame (category 2 in the three-pane sorting rule at `:340-361`).

**Why not the Director pane.** The pane is a fixed 352px and `.proposals` is already capped at `max-height: 45%` with its own scroll (`DirectorPane.module.css:42-50`). An unbounded list there fights the proposal card for half a column. The pane is right for the _card_, wrong for the _list_.

### Step 8.1 — Write the failing DOM test

- [ ] Create `tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { StudioRulesDrawer } from '@/renderer/pages/studio/components/Rules';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const project = (rules: unknown[] = []) => ({ id: 'project_1', revision: 4, rules }) as never;

describe('StudioRulesDrawer', () => {
  it('lists the locked organisation layer as unremovable and the project rules as removable', () => {
    render(
      <StudioRulesDrawer
        visible
        project={project([
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Keep the kits generic.',
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ])}
        organisationRules={[
          {
            id: 'org_1',
            scope: 'organisation',
            text: 'No competitor brands.',
            predicate: { kind: 'forbidden_terms', terms: ['acme'] },
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ]}
        onClose={vi.fn()}
        onSetRules={vi.fn()}
      />
    );

    expect(screen.getByText('No competitor brands.')).toBeInTheDocument();
    expect(screen.getByText('Keep the kits generic.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'conversation.creativeStudio.rules.removeAccessible' })).toHaveLength(
      1
    );
  });

  it('sends the whole list with the new rule appended, carrying the project revision', async () => {
    const onSetRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer
        visible
        project={project([
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Keep the kits generic.',
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ])}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
      />
    );

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.textLabel'), {
      target: { value: 'No competitor logos.' },
    });
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.termsLabel'), {
      target: { value: 'acme, globex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    await waitFor(() => expect(onSetRules).toHaveBeenCalledTimes(1));
    expect(onSetRules.mock.calls[0][0]).toEqual([
      { id: 'rule_1', text: 'Keep the kits generic.', predicate: null },
      {
        id: expect.any(String),
        text: 'No competitor logos.',
        predicate: { kind: 'forbidden_terms', terms: ['acme', 'globex'] },
      },
    ]);
  });

  it('explains what each badge means, so the two enforcement states are not a guess', () => {
    render(
      <StudioRulesDrawer visible project={project()} organisationRules={[]} onClose={vi.fn()} onSetRules={vi.fn()} />
    );

    expect(screen.getByText('conversation.creativeStudio.rules.enforcedHelp')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.rules.contextOnlyHelp')).toBeInTheDocument();
  });

  it('refuses an empty rule and never calls the command', () => {
    const onSetRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer visible project={project()} organisationRules={[]} onClose={vi.fn()} onSetRules={onSetRules} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.invalidText');
    expect(onSetRules).not.toHaveBeenCalled();
  });

  it('reads the adopted project on the next write, so add-then-remove never resends the pre-add list', async () => {
    const onSetRules = vi.fn(async () => true);
    // Stands in for StudioPage: the command succeeds, the page awaits refetch, and the drawer
    // re-renders against the adopted project. Without that adoption the second write would carry
    // the pre-add list AND a stale expectedRevision, which surfaces as `stale_project` in the
    // drawer's error slot with no way forward but closing the project.
    //
    // This harness advances only `rules` and holds `revision: 4` fixed, deliberately rather than by
    // omission: `onSetRules(drafts)` carries no revision, so the drawer has no way to observe one
    // moving — the CAS lives in StudioPage, which reads `project.revision` at call time (Step 8.3).
    // What this test proves is the half the drawer owns: the second write is built from the ADOPTED
    // list rather than the pre-add one. The revision half is proved elsewhere, by Step 8.3's
    // `await refetch()` and by Task 13's end-to-end test asserting `persisted.revision` equals the
    // revision the write returned.
    const Harness: React.FC = () => {
      const [rules, setRules] = React.useState<unknown[]>([]);
      return (
        <StudioRulesDrawer
          visible
          project={project(rules)}
          organisationRules={[]}
          onClose={vi.fn()}
          onSetRules={async (drafts) => {
            setRules(drafts.map((draft) => ({ ...draft, scope: 'project', createdAt: '2026-08-13T00:00:00.000Z' })));
            return onSetRules(drafts);
          }}
        />
      );
    };
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.textLabel'), {
      target: { value: 'No competitor logos.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));
    await waitFor(() => expect(screen.getByText('No competitor logos.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.removeAccessible' }));

    await waitFor(() => expect(onSetRules).toHaveBeenCalledTimes(2));
    expect(onSetRules.mock.calls[1][0]).toEqual([]);
  });

  it('refuses to add past the cap, so the store never rejects a write the UI allowed', () => {
    const onSetRules = vi.fn(async () => true);
    const rules = Array.from({ length: 24 }, (_, index) => ({
      id: `rule_${index}`,
      scope: 'project',
      text: `Rule ${index}.`,
      predicate: null,
      createdAt: '2026-08-13T00:00:00.000Z',
    }));
    render(
      <StudioRulesDrawer
        visible
        project={project(rules)}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
      />
    );

    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' })).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.rules.limitReached')).toBeInTheDocument();
  });
});
```

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx
```

Expected: `Failed to resolve import "@/renderer/pages/studio/components/Rules"`.

### Step 8.2 — Build the drawer

Three sub-steps: the stylesheet, the component, then the wiring and the two gates. Split because the stylesheet and the component are ~100 and ~170 lines respectively and one checkbox for both is not a reviewable unit — nothing about the content changes.

#### Step 8.2.1 — The stylesheet

- [ ] Create `packages/desktop/src/renderer/pages/studio/components/Rules/StudioRulesDrawer.module.css`:

```css
.body {
  composes: body from '../../StudioTypography.module.css';
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
}

.description {
  margin: 0;
  color: var(--color-text-2);
}

.list {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rule {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--color-border-2);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--color-bg-2);
}

.ruleCopy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
}

.ruleText {
  margin: 0;
  color: var(--text-primary);
}

.ruleMeta {
  composes: meta from '../../StudioTypography.module.css';
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--color-text-3);
}

.legend {
  composes: meta from '../../StudioTypography.module.css';
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  color: var(--color-text-3);
  list-style: none;
}

.legendRow {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}

.form {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--color-border-2);
  padding-top: 16px;
}

.label {
  composes: meta from '../../StudioTypography.module.css';
}

.help,
.limit {
  margin: 0;
  color: var(--color-text-3);
  font-size: 12px;
}

.error {
  color: var(--color-danger-6);
  font-size: 12px;
}
```

#### Step 8.2.2 — The component

- [ ] Create `packages/desktop/src/renderer/pages/studio/components/Rules/StudioRulesDrawer.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Drawer, Input, Tag } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ORGANISATION_STUDIO_RULES,
  STUDIO_RULE_LIMITS,
  type StudioBriefRule,
  type StudioBriefRuleDraft,
} from '@/common/types/project/creativeStudioRules';
import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import styles from './StudioRulesDrawer.module.css';

export type StudioRulesDrawerProps = {
  visible: boolean;
  project: Pick<StudioRendererProject, 'id' | 'revision' | 'rules'>;
  /** Injected so tests can exercise the locked layer while it ships empty. */
  organisationRules?: readonly StudioBriefRule[];
  pending?: boolean;
  errorMessageKey?: string | null;
  onClose: () => void;
  onSetRules: (rules: StudioBriefRuleDraft[]) => Promise<boolean>;
};

const toDraft = (rule: StudioBriefRule): StudioBriefRuleDraft => ({
  id: rule.id,
  text: rule.text,
  predicate: rule.predicate === null ? null : { kind: 'forbidden_terms', terms: [...rule.predicate.terms] },
});

const parseTerms = (value: string): string[] => {
  const terms = value
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  return [...new Set(terms)];
};

/**
 * The document's rule list.
 *
 * It lives in the app frame rather than in a phase for two reasons written down elsewhere: CS2's
 * shell is Table / Board / Cut and Brief is not one of the three (engine-strip.md:54), and Brief is
 * a draft surface whose every mutation forces a project-draft flush (StudioPage beforeMutation).
 * Rules govern the whole document, so the frame owns them and they survive the phase-4 swap.
 *
 * Writes go through the dedicated set-brief-rules command, never through the project draft: the
 * draft resends every field on every flush and dirty-tracks per field, so a rules array there is
 * clobbered wholesale whenever a Director pin races a brief keystroke.
 */
export const StudioRulesDrawer: React.FC<StudioRulesDrawerProps> = ({
  visible,
  project,
  organisationRules = ORGANISATION_STUDIO_RULES,
  pending = false,
  errorMessageKey = null,
  onClose,
  onSetRules,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [terms, setTerms] = useState('');
  const [invalid, setInvalid] = useState<'text' | 'terms' | null>(null);
  const parsedTerms = parseTerms(terms);
  const atLimit = organisationRules.length + project.rules.length >= STUDIO_RULE_LIMITS.maxRules;

  const add = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > STUDIO_RULE_LIMITS.text) {
      setInvalid('text');
      return;
    }
    if (
      parsedTerms.length > STUDIO_RULE_LIMITS.maxTerms ||
      parsedTerms.some((term) => term.length > STUDIO_RULE_LIMITS.term)
    ) {
      setInvalid('terms');
      return;
    }
    setInvalid(null);
    const draft: StudioBriefRuleDraft = {
      id: window.crypto.randomUUID().replaceAll('-', '_'),
      text: trimmed,
      predicate: parsedTerms.length === 0 ? null : { kind: 'forbidden_terms', terms: parsedTerms },
    };
    if (await onSetRules([...project.rules.map(toDraft), draft])) {
      setText('');
      setTerms('');
    }
  };

  const remove = async (ruleId: string): Promise<void> => {
    await onSetRules(project.rules.filter((rule) => rule.id !== ruleId).map(toDraft));
  };

  return (
    <Drawer
      visible={visible}
      title={t('conversation.creativeStudio.rules.title')}
      width={480}
      footer={null}
      onCancel={onClose}
    >
      <div className={styles.body}>
        <p className={styles.description}>{t('conversation.creativeStudio.rules.description')}</p>
        <p className={styles.description}>{t('conversation.creativeStudio.rules.precedence')}</p>

        {organisationRules.length === 0 && project.rules.length === 0 ? (
          <p className={styles.description}>{t('conversation.creativeStudio.rules.empty')}</p>
        ) : (
          <ul className={styles.list}>
            {[...organisationRules, ...project.rules].map((rule) => (
              <li key={rule.id} className={styles.rule}>
                <div className={styles.ruleCopy}>
                  <p className={styles.ruleText}>{rule.text}</p>
                  <div className={styles.ruleMeta}>
                    <Tag>
                      {t(
                        rule.scope === 'organisation'
                          ? 'conversation.creativeStudio.rules.scope.organisation'
                          : 'conversation.creativeStudio.rules.scope.project'
                      )}
                    </Tag>
                    <Tag>
                      {t(
                        rule.predicate === null
                          ? 'conversation.creativeStudio.rules.contextOnlyBadge'
                          : 'conversation.creativeStudio.rules.enforcedBadge'
                      )}
                    </Tag>
                    {rule.scope === 'organisation' && (
                      <Tag>{t('conversation.creativeStudio.rules.scope.organisationLocked')}</Tag>
                    )}
                    {rule.predicate !== null && <span>{rule.predicate.terms.join(', ')}</span>}
                  </div>
                </div>
                {rule.scope === 'project' && (
                  <Button
                    type='text'
                    status='danger'
                    disabled={pending}
                    aria-label={t('conversation.creativeStudio.rules.removeAccessible', { rule: rule.text })}
                    onClick={() => void remove(rule.id)}
                  >
                    {t('conversation.creativeStudio.rules.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/*
          The two enforcement states are the whole point of the list, and a bare chip does not say
          which one costs money. Rendered once as a legend rather than per rule, so the sentence is
          not repeated N times, and statically rather than as a hover tooltip: Arco renders tooltip
          content into a portal only while hovered, which makes it invisible to
          StudioAccessibleCopy's raw-key sweep and unassertable in jsdom.
        */}
        <ul className={styles.legend}>
          <li className={styles.legendRow}>
            <Tag>{t('conversation.creativeStudio.rules.enforcedBadge')}</Tag>
            <span>{t('conversation.creativeStudio.rules.enforcedHelp')}</span>
          </li>
          <li className={styles.legendRow}>
            <Tag>{t('conversation.creativeStudio.rules.contextOnlyBadge')}</Tag>
            <span>{t('conversation.creativeStudio.rules.contextOnlyHelp')}</span>
          </li>
        </ul>

        <div className={styles.form}>
          <label htmlFor='studio-rule-text' className={styles.label}>
            {t('conversation.creativeStudio.rules.textLabel')}
          </label>
          <Input
            id='studio-rule-text'
            value={text}
            error={invalid === 'text'}
            maxLength={STUDIO_RULE_LIMITS.text}
            placeholder={t('conversation.creativeStudio.rules.textPlaceholder')}
            aria-label={t('conversation.creativeStudio.rules.textLabel')}
            onChange={setText}
          />
          {invalid === 'text' && (
            <span role='alert' className={styles.error}>
              {t('conversation.creativeStudio.rules.invalidText')}
            </span>
          )}

          <label htmlFor='studio-rule-terms' className={styles.label}>
            {t('conversation.creativeStudio.rules.termsLabel')}
          </label>
          <Input
            id='studio-rule-terms'
            value={terms}
            error={invalid === 'terms'}
            placeholder={t('conversation.creativeStudio.rules.termsPlaceholder')}
            aria-label={t('conversation.creativeStudio.rules.termsLabel')}
            onChange={setTerms}
          />
          <p className={styles.help}>{t('conversation.creativeStudio.rules.termsHelp')}</p>
          {invalid === 'terms' && (
            <span role='alert' className={styles.error}>
              {t('conversation.creativeStudio.rules.invalidTerms')}
            </span>
          )}

          {atLimit && <p className={styles.limit}>{t('conversation.creativeStudio.rules.limitReached')}</p>}
          {errorMessageKey !== null && (
            <span role='alert' className={styles.error}>
              {t(errorMessageKey)}
            </span>
          )}
          <Button type='primary' loading={pending} disabled={atLimit || pending} onClick={() => void add()}>
            {t('conversation.creativeStudio.rules.add')}
          </Button>
        </div>
      </div>
    </Drawer>
  );
};
```

#### Step 8.2.3 — The barrel, the re-export, and the two gates

- [ ] Create `packages/desktop/src/renderer/pages/studio/components/Rules/index.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export { StudioRulesDrawer, type StudioRulesDrawerProps } from './StudioRulesDrawer';
```

- [ ] Add `export * from './Rules';` to `packages/desktop/src/renderer/pages/studio/components/index.ts`.

- [ ] Run and see it pass:

```
bun run test tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx
```

Expected: `Test Files  1 passed (1)` / `Tests  6 passed (6)`. This spec mocks `t` to echo the key, so it is green now and Task 12 changes nothing about it.

- [ ] Run the stylesheet gate, which reads every `composes:` path off disk:

```
bun run test tests/unit/pages/studio/studioStylesheetComposes.test.ts
```

Expected: `Test Files  1 passed (1)`. If it fails, the `composes` relative path is wrong — `Rules/` sits two levels under `pages/studio`, so `../../StudioTypography.module.css` is correct.

### Step 8.3 — Mount it from the frame

- [ ] In `components/PhaseShell/types.ts`, add to `StudioPhaseControllers`:

```ts
  /** Opens the document's rule list. The frame owns it, so every phase can reach it. */
  openRules: () => void;
```

- [ ] In `StudioPhaseShell.tsx`, change the `actions` prop:

```tsx
        actions={
          <>
            <Button size='small' disabled={navigationDisabled} onClick={controller.openRules}>
              {t('conversation.creativeStudio.rules.open')}
            </Button>
            {headerAction}
          </>
        }
```

`Button` is already imported there; check and add if not. "Rules" does not match the e2e's `phaseCtaPattern` (`/^(Start writing|Continue to Produce|Review cut|Prepare handoff)$/`), so `page.getByRole('button', { name: phaseCtaPattern })).toHaveCount(1)` (`creative-studio.e2e.ts:261`) stays satisfied.

- [ ] In `StudioPage.tsx`, add state, the handler, and the mount:

```tsx
const [rulesOpen, setRulesOpen] = useState(false);
const [rulesPending, setRulesPending] = useState(false);
const [rulesErrorMessageKey, setRulesErrorMessageKey] = useState<string | null>(null);

const setBriefRules = useCallback(
  async (rules: StudioBriefRuleDraft[]): Promise<boolean> => {
    if (project === null) return false;
    setRulesPending(true);
    setRulesErrorMessageKey(null);
    try {
      const result = await ipcBridge.creativeStudio.setBriefRules.invoke({
        projectId: project.id,
        expectedRevision: project.revision,
        rules,
      });
      if (result.ok === false) {
        setRulesErrorMessageKey(result.error.messageKey);
        return false;
      }
      // Adopt the bumped revision before returning, so the drawer's NEXT write CASes against the
      // revision this one produced. `refetch` is the handle the page already destructures at :271
      // and already passes to useStoryboardEditor, useStudioJobs and useStudioModels for exactly
      // this purpose; it reloads `loadedProject`, which flows back through
      // `newestProject(studioJobs.project, editor.project, loadedProject)` at :281.
      //
      // There is no `applyProject` to call: `adoptProject` is private to useStoryboardEditor
      // (:494) and is not on `UseStoryboardEditorResult`, `creativeStudio.updateProject.invoke` is
      // only ever called from inside that hook (:1249, :1386) and never from this page, and
      // `useStudioProject` exposes only `refetch` (useStudioProject.ts:180-188). Do not widen the
      // editor hook's API to satisfy a call that was never needed.
      //
      // `setBriefRules` also goes through main's `notify` (creativeStudioService.ts:979-982), which
      // fires `onProjectUpdated` → `creativeStudio.projectUpdated.emit` → `useStudioJobs`'s
      // subscription (useStudioJobs.ts:392) → the same `refetch`. That path would adopt eventually;
      // awaiting here makes it deterministic instead, which is what add-then-remove in one drawer
      // session needs.
      await refetch();
      return true;
    } finally {
      setRulesPending(false);
    }
  },
  [project, refetch]
);
```

Then, next to `<GenerationReviewModal … />`:

```tsx
{
  project !== null && (
    <StudioRulesDrawer
      visible={rulesOpen}
      project={project}
      pending={rulesPending}
      errorMessageKey={rulesErrorMessageKey}
      onClose={() => setRulesOpen(false)}
      onSetRules={setBriefRules}
    />
  );
}
```

and add `openRules: () => setRulesOpen(true),` to the controllers object.

- [ ] Add `openRules: vi.fn(),` to all four `StudioPhaseControllers` fixtures:
  - `tests/unit/e2e/creativeStudioSelectors.dom.test.tsx` (:181-213)
  - `tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx` (:141-261)
  - `tests/unit/pages/studio/StudioPhaseShell.dom.test.tsx`
  - `tests/unit/pages/studio/Storyboard/Brief/BriefPhase.dom.test.tsx`

- [ ] **Add `rules: [],` to the two `StudioRendererProject` fixtures that feed the real `StudioPage`.** This is the same untypechecked-fixture defect Task 4 fixed on the main side, arriving on the renderer side, and Task 8 is the task that triggers it: the drawer computes `atLimit` from `project.rules.length` in the component body, **on every render regardless of `visible`**, so mounting it in `StudioProjectShell` throws `Cannot read properties of undefined (reading 'length')` against a fixture with no `rules`. Both specs import `StudioPage` and render it through a real router, so both crash:
  - `tests/unit/pages/studio/StudioPage.dom.test.tsx` — `project()` at `:103-...`; add `rules: [],` after `brief: 'A short launch video',` (`:108`). Imports `StudioPage` at `:25`, renders it at `:303`.
  - `tests/unit/pages/studio/StudioExport.dom.test.tsx` — `project()` at `:103-...`; add `rules: [],` after `brief: 'A short launch video',` (`:111`). Imports `StudioPage` at `:19`, renders it at `:149`.

  Neither needs anything else: both already mock `useBriefConversation` wholesale (`StudioPage.dom.test.tsx:84-86`, `StudioExport.dom.test.tsx:65-71`), so Task 5's effect never runs in them and no `conversation.update` mock is required. Task 10 would break them a second time on `resolveEffectiveStudioRules(project.rules)`; fixing them here covers both, and Step 10.3's whole-directory run is the check that it held.

**Tests are not typechecked** (`tsconfig.json` `include` is `packages/desktop/src` only), so a missed fixture yields a runtime `undefined` handler, not a compile error. Grep to be sure: `grep -rln "requestTransition" tests/unit | sort`.

That grep returns **seven** files, not four. The three extra — `Generation/ProducePhase.dom.test.tsx`, `Generation/ReviewPhase.dom.test.tsx`, `Storyboard/WritePhase.dom.test.tsx` — build their own local controller shapes and never render `StudioPhaseShell`, so they need no `openRules` and must not be edited. Open each hit and check whether it constructs a full `StudioPhaseControllers` for the shell; only the four listed above do.

- [ ] Run the fixtures' owners:

```
bun run test tests/unit/pages/studio tests/unit/e2e/creativeStudioSelectors.dom.test.tsx
```

Expected: **no failures at all.** Every studio DOM spec mocks `react-i18next` so `t` echoes the key, so none of them is waiting on Task 12's copy. In particular `resolves every layout selector in the spec to exactly one element` and `matches nothing when no shell advisory is raised` must both stay green — the Rules button adds no `role="alert"` and no `data-studio-*` hook. If `StudioAccessibleCopy.dom.test.tsx` fails here it is a real regression, not missing copy: that spec asserts the _absence_ of raw `conversation.creativeStudio.` strings, and the drawer is not mounted by it.

Two specific failure signatures to read rather than debug: `Cannot read properties of undefined (reading 'length')` from `StudioPage.dom.test.tsx` or `StudioExport.dom.test.tsx` means the `rules: []` fixture edit above was skipped, and `controller.openRules is not a function` means one of the four `StudioPhaseControllers` fixtures was.

### Step 8.4 — Commit

- [ ] `git commit -am "feat(creative-studio): add the document rules drawer to the work-area toolbar"`

---

## Task 9 — The gate main cannot be talked out of

**Files**

- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts` (:93-100, :575-590)
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (:503-520)
- Modify: `packages/desktop/src/process/bridge/creativeStudioBridge.ts` (:26-45)
- Test: `tests/unit/process/creative-studio/jobManager.test.ts` (a new `StudioJobManager pinned rule gate` describe; `StudioBriefRule` added to the type import at :15-23)

**Why `resolveProvider` and nowhere else.** It is the only point where `(project, scene, resolved prompt, output role, resolved route)` are all in hand: `baseRequest.prompt = (output.role === 'reference' ? output.referencePrompt : scene.visualPrompt).trim()` at `jobManager.ts:579`. It is on **both** paid entry points — `submitScenes` (`:1297`) and `retryJob` (`:1498`) — so a check in `creativeStudioService.submitScenes` would miss retry entirely. And for `outputRole: 'reference'` the prompt exists **only in the request**, never on the durable record (see the comment at `:1436`), so a check reading `scene.visualPrompt` from the store cannot see reference-plate prompts at all. It runs before `persistPreparedJobs` (`:1300`) and before `trackRun(… runSubmission …)` (`:1302`), so a breach costs nothing.

**Why the renderer is not enough.** `StudioPage.tsx:500-552` auto-submits Director-queued reference requests **with no modal and no human confirm**. The Director itself cannot submit — `registerStudioTools` exposes four (now five) tools and none is a paid call — but the renderer path it triggers is real spend.

Also do not repeat `batchSceneIsReady`'s mistake: it is applied only when `input.mode === 'batch'` (`creativeStudioService.ts:1911`), so single-mode submissions skip it. `resolveProvider` covers single, batch and retry by construction.

### Step 9.1 — Write the failing test

**Read the harness before writing anything.** It is `createHarness(adapter: GenerationProviderAdapter, options: HarnessOptions = {})` (`jobManager.test.ts:210`) — the adapter argument is **required** and constructs the whole fake provider — returning the local `Harness` type — `{ rootDir, store, mediaStore, project, manager }` (`:176-182`; `:186-203` is `HarnessOptions`, which is a different thing and easy to read as the return). There is no `setRules`, `setScenePrompt`, `submitScene`, `failJob`, `getProject` or `harness.adapter`. Every existing test drives it as `harness.manager.submitScenes({…})` / `harness.manager.retryJob({…})`, sets scene fields through `options.scenes`, and edits the project through `harness.store.updateProject`. The block below uses only that surface.

- [ ] Add `StudioBriefRule` to the type import from `@/common/types/project/creativeStudioTypes` at the top of `tests/unit/process/creative-studio/jobManager.test.ts` (`:15-23`). `provider`, `route`, `selectionFor`, `scene()`, `catalog()`, `waitFor()` and the local `Harness` type are already in scope.

- [ ] Append a new describe block to `tests/unit/process/creative-studio/jobManager.test.ts`:

```ts
describe('StudioJobManager pinned rule gate', () => {
  // Same shape as the file's other local adapter helpers (:1365-1377, :1670-1682): the id must be
  // 'weprompt-image-v1' because that is what `route` resolves to.
  const adapterWithSubmit = (submit: ReturnType<typeof vi.fn>): GenerationProviderAdapter => ({
    id: 'weprompt-image-v1',
    validateConnection: async () => ({ ok: true }),
    validateRequest: (request) => ({
      ok: true,
      normalized: {
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        durationSeconds: request.durationSeconds,
      },
    }),
    submit,
  });

  const enforcedRule: StudioBriefRule = {
    id: 'rule_1',
    scope: 'project',
    text: 'No competitor logos.',
    predicate: { kind: 'forbidden_terms', terms: ['acme'] },
    createdAt: '2026-08-13T00:00:00.000Z',
  };

  /** Pins rules the only way anything pins them: through the store, which bumps the revision. */
  const withRules = (harness: Harness, rules: StudioBriefRule[]): Promise<StudioProject> =>
    harness.store.updateProject(harness.project.id, (current) => ({ ...current, rules }));

  it('refuses a submission whose visual prompt breaks an enforced rule, before anything is spent', async () => {
    const submit = vi.fn();
    const harness = await createHarness(adapterWithSubmit(submit), {
      scenes: [scene({ visualPrompt: 'An ACME billboard at dusk' })],
    });
    const guarded = await withRules(harness, [enforcedRule]);

    await expect(
      harness.manager.submitScenes({
        projectId: guarded.id,
        expectedRevision: guarded.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'rule_breach' });

    expect(submit).not.toHaveBeenCalled();
    // The gate sits before persistPreparedJobs (:1300) and trackRun (:1302), so the refusal leaves
    // no job record and no scene linkage behind either.
    const after = (await harness.store.getProject(guarded.id))!;
    expect(Object.keys(after.jobs)).toEqual([]);
    expect(after.scenes.scene_1.jobIds).toEqual([]);
  });

  it('refuses a reference plate whose own prompt breaks a rule, which the durable record never holds', async () => {
    const submit = vi.fn();
    const harness = await createHarness(adapterWithSubmit(submit), {
      scenes: [scene({ visualPrompt: 'A clean studio plate' })],
    });
    const guarded = await withRules(harness, [enforcedRule]);

    await expect(
      harness.manager.submitScenes({
        projectId: guarded.id,
        expectedRevision: guarded.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: 'An ACME logo, centred' }],
      })
    ).rejects.toMatchObject({ code: 'rule_breach' });

    expect(submit).not.toHaveBeenCalled();
    // This is the test that justifies the gate's placement: scene.visualPrompt is clean, the breach
    // exists only in baseRequest.prompt, and a store-side check would wave this through.
    expect((await harness.store.getProject(guarded.id))!.scenes.scene_1.visualPrompt).toBe('A clean studio plate');
  });

  it('refuses a retry that would resend a breaching prompt', async () => {
    const submit = vi.fn();
    const harness = await createHarness(adapterWithSubmit(submit), {
      scenes: [scene({ visualPrompt: 'An ACME billboard at dusk' })],
      jobIds: ['job_2'],
      idempotencyKeys: ['key_2'],
    });
    // Seeded exactly as the file's other retry tests do (:4001-4028): a failed job written straight
    // onto the record, plus the rule pinned in the same write. That is the real sequence — the user
    // reads the failure, pins the rule, and only then presses Retry.
    const failed = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'failed',
        provider: selectionFor(route),
        idempotencyKey: 'key_1',
        providerJobId: null,
        cancellationPolicy: 'none',
        outputAssetIds: [],
        error: { code: 'no_output', messageKey: 'conversation.creativeStudio.jobs.errors.noOutput' },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds.push('job_1');
      next.scenes.scene_1.reviewState = 'blocked';
      next.rules = [enforcedRule];
      return next;
    });

    await expect(
      harness.manager.retryJob({ projectId: failed.id, jobId: 'job_1', expectedRevision: failed.revision })
    ).rejects.toMatchObject({ code: 'rule_breach' });

    expect(submit).not.toHaveBeenCalled();
    expect((await harness.store.getProject(failed.id))!.jobs.job_2).toBeUndefined();
  });

  it('lets a prompt through when the rule carries no predicate', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const harness = await createHarness(adapterWithSubmit(submit), {
      scenes: [scene({ visualPrompt: 'A generic kit on a plain background' })],
    });
    const guarded = await withRules(harness, [
      {
        id: 'rule_1',
        scope: 'project',
        text: 'Keep the kits generic.',
        predicate: null,
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    ]);

    const [job] = await harness.manager.submitScenes({
      projectId: guarded.id,
      expectedRevision: guarded.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });

    expect(job).toMatchObject({ id: 'job_1', sceneId: 'scene_1' });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  });
});
```

- [ ] Run and see it fail:

```
bun run test tests/unit/process/creative-studio/jobManager.test.ts
```

Expected: the first three fail with `promise resolved "[ { …job… } ]" instead of rejecting` — the gate does not exist yet, so the submission goes through. The fourth **passes already**, and it must: a control that fails before the gate exists would be testing the harness, not the gate.

### Step 9.2 — Add the code and the gate

- [ ] In `creativeStudioTypes.ts`, add to `StudioCommandErrorCode` after `'invalid_route'`:

```ts
  | 'rule_breach'
```

- [ ] In `jobManager.ts`, add to `StudioJobManagerErrorCode` after `'invalid_route'`:

```ts
  | 'rule_breach'
```

`toCommandError` (`creativeStudioBridge.ts:55`) maps `StudioJobManagerError.code` straight through for every code except `invalid_request`, so no mapping change is needed — but `errorMessageKeys` is a `Record` over the union and the compiler will demand the entry.

- [ ] In `creativeStudioBridge.ts`, add to `errorMessageKeys`:

```ts
  rule_breach: 'conversation.creativeStudio.errors.ruleBreach',
```

- [ ] In `jobManager.ts`, add the import:

```ts
import { evaluateStudioRules, resolveEffectiveStudioRules } from '@/common/types/project/creativeStudioRules';
```

- [ ] Insert the gate in `resolveProvider`, immediately after `if (!baseRequest.prompt) invalidRequest();` (:586):

```ts
/**
 * The money gate for pinned rules.
 *
 * Here and nowhere else: this is the only point where the resolved prompt exists for BOTH paid
 * entry points (submitScenes and retryJob) and for both output roles — a reference plate's
 * prompt lives only in the request, never on the durable record, so a check that read
 * scene.visualPrompt from the store would not see it. It is also strictly before
 * persistPreparedJobs and trackRun, so a breach costs nothing.
 *
 * The renderer runs the same evaluator to say the consequence before Confirm is pressable. This
 * one exists because the Director's queued reference requests are auto-submitted with no modal.
 */
const breaches = evaluateStudioRules(resolveEffectiveStudioRules(project.rules), baseRequest.prompt).breaches;
if (breaches.length > 0) throw new StudioJobManagerError('rule_breach');
```

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio/jobManager.test.ts
```

Expected: `Test Files  1 passed (1)`.

- [ ] Confirm the compiler is clean:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: no output.

### Step 9.3 — Commit

- [ ] `git commit -am "feat(creative-studio): refuse a paid render that breaks a pinned rule"`

---

## Task 10 — Say the consequence before it runs

**Files**

- Modify: `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationReviewModal.tsx` (:37-45, :159-215, :270-350)
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx` (:82-124, :500-552)
- Test: `tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx`
- No fixture work here: `StudioPage.dom.test.tsx` and `StudioExport.dom.test.tsx` already gained `rules: []` in Step 8.3, which is what keeps `resolveEffectiveStudioRules(project.rules)` from throwing in them. Do not re-add it.

The breach alert goes **inside the modal**, which Arco portals to `body`. It must not be a direct child of the phase shell: the e2e asserts `[data-studio-phase-shell] > [role="alert"]` has count 0 when no advisory is raised (`creative-studio.e2e.ts:588`, guarded by `creativeStudioSelectors.dom.test.tsx:325`), and `assertStudioInvariants` caps visible alerts at one. Reuse the existing per-scene `<Alert type='error'>` shape and the existing `disabledReason` `role="status"` slot; add no new alert outside the modal.

### Step 10.1 — Write the failing DOM test

**This file also never sees real English, and it has no `renderModal`/`reviewScene` helpers.** Its `react-i18next` mock echoes the key and appends `:name=value,name=value` — a **colon**, not parentheses (`GenerationReviewModal.dom.test.tsx:18-27`). Rendering is `render(<GenerationReviewModal {...createProps({…})} />)` with `createProps` at `:71-85` and the scene fixture `mixedScenes()` at `:52-69`. Match that surface.

- [ ] Add `promptText` to both entries of `mixedScenes()` (`:52-69`) — `'A paper airplane crossing a sunrise'` for `scene-image` and `'A product turning slowly'` for `scene-video` — because `GenerationReviewScene.promptText` becomes required in Step 10.2 and every existing test builds its scenes from this helper.

- [ ] Add to `tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx`:

```ts
const breach = { ruleId: 'rule_1', ruleText: 'No competitor logos.', scope: 'project' as const, matchedTerm: 'acme' };

const breachingScene = (): GenerationReviewScene => ({
  ...mixedScenes()[0]!,
  id: 'scene-image',
  title: 'Opening image',
  promptText: 'An ACME billboard at dusk',
});

it('names the breached rule on the shot and blocks Confirm before anything is charged', () => {
  render(
    <GenerationReviewModal
      {...createProps({ mode: 'single', scenes: [breachingScene()], ruleBreachesBySceneId: { 'scene-image': [breach] } })}
    />
  );

  expect(
    screen.getByText('conversation.creativeStudio.rules.breachScene:rule=No competitor logos.,term=acme')
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeDisabled();
  expect(screen.getByText('conversation.creativeStudio.rules.breachBlockedConfirm')).toBeInTheDocument();
});

it('offers to hand the breach to the Director rather than leaving a dead end', () => {
  const onAskDirector = vi.fn();
  render(
    <GenerationReviewModal
      {...createProps({
        mode: 'single',
        scenes: [breachingScene()],
        ruleBreachesBySceneId: { 'scene-image': [breach] },
        onAskDirector,
      })}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.breachAskDirector' }));

  expect(onAskDirector).toHaveBeenCalledTimes(1);
});

it('hides the ask-the-Director affordance when the page cannot supply it', () => {
  render(
    <GenerationReviewModal
      {...createProps({ mode: 'single', scenes: [breachingScene()], ruleBreachesBySceneId: { 'scene-image': [breach] } })}
    />
  );

  // Task 10 ships before Task 11 wires the sender, so `onAskDirector` is absent in between. A button
  // that does nothing is worse than no button.
  expect(
    screen.queryByRole('button', { name: 'conversation.creativeStudio.rules.breachAskDirector' })
  ).not.toBeInTheDocument();
});

it('blocks Confirm for the whole batch when one shot breaches, and says so', () => {
  render(<GenerationReviewModal {...createProps({ ruleBreachesBySceneId: { 'scene-image': [breach] } })} />);

  // main aborts the entire submitScenes call on the first breach (jobManager.ts:1297), so a
  // per-shot reading of this copy would be wrong.
  expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeDisabled();
  expect(screen.getByText('conversation.creativeStudio.rules.breachBlockedConfirm')).toBeInTheDocument();
});

it('leaves Confirm alone when no rule is breached', () => {
  render(<GenerationReviewModal {...createProps({ mode: 'single', scenes: [mixedScenes()[0]!] })} />);

  expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeEnabled();
  expect(screen.queryByText(/rules\.breachScene/)).not.toBeInTheDocument();
});
```

These five are complete as written and are **not** blocked on Task 12 — the mock echoes keys, so no English string could ever match here.

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx
```

Expected: the first four fail with `Unable to find an element with the text: conversation.creativeStudio.rules.breachScene:rule=No competitor logos.,term=acme` (and the disabled-Confirm assertion), and the fifth passes already. Every pre-existing test in the file stays green — `promptText` is additive.

### Step 10.2 — Wire the modal

- [ ] In `GenerationReviewModal.tsx`, add to `GenerationReviewScene`:

```ts
/**
 * The exact string main will send as the prompt: the reference plate's own prompt for
 * outputRole 'reference', the scene's visual prompt otherwise. It mirrors jobManager's
 * `output.role === 'reference' ? output.referencePrompt : scene.visualPrompt`, because a rule
 * verdict computed against a different string than main checks is worse than no verdict.
 */
promptText: string;
```

- [ ] Add to `GenerationReviewModalProps`:

```ts
  /** Breaches computed by the page with the same shared evaluator main uses. */
  ruleBreachesBySceneId?: Record<string, StudioRuleBreach[]>;
  /** Hands the breach to the Director. Absent hides the affordance. */
  onAskDirector?: () => void;
```

and import `StudioRuleBreach` from `@/common/types/project/creativeStudioRules`.

- [ ] Add a module-scope constant for the default and destructure against it:

```ts
/**
 * Hoisted, not inlined as `= {}`. A fresh object literal in the destructuring default is a new
 * identity on every render, and this value goes into the review `useMemo`'s dependency array — an
 * inline default would defeat that memo for every project with no rules, which is all of them until
 * the user pins one.
 */
const NO_RULE_BREACHES: Record<string, StudioRuleBreach[]> = {};
```

- [ ] Destructure `ruleBreachesBySceneId = NO_RULE_BREACHES` and `onAskDirector` in the component signature.

- [ ] Inside the `useMemo`, add before the `return`:

```ts
const ruleBreached = scenes.some((scene) => (ruleBreachesBySceneId[scene.id] ?? []).length > 0);
```

add `ruleBreached,` to the returned object, add `&& !ruleBreached` to `canConfirm`, and add `ruleBreachesBySceneId` to the dependency array.

- [ ] Inside the per-scene `<article>`, after the existing invalid-route `<Alert>` block, add:

```tsx
{
  (ruleBreachesBySceneId[scene.id] ?? []).map((breach) => (
    <Alert
      key={breach.ruleId}
      className='mt-10px'
      type='error'
      content={t('conversation.creativeStudio.rules.breachScene', {
        rule: breach.ruleText,
        term: breach.matchedTerm,
      })}
    />
  ));
}
```

- [ ] Replace the `disabledReason` derivation with:

```ts
const disabledReason = review.ruleBreached
  ? 'conversation.creativeStudio.rules.breachBlockedConfirm'
  : review.missingRoute || review.invalidRoute
    ? 'conversation.creativeStudio.review.disabledMissingRoutes'
    : null;
```

- [ ] Add the escape hatch next to `disabledReason`'s render:

```tsx
{
  review.ruleBreached && onAskDirector !== undefined && (
    <div>
      <Button onClick={onAskDirector}>{t('conversation.creativeStudio.rules.breachAskDirector')}</Button>
    </div>
  );
}
```

- [ ] Run and see it pass:

```
bun run test tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx
```

Expected: `Test Files  1 passed (1)`.

### Step 10.3 — Supply the prompt and the verdict from the page

- [ ] In `StudioPage.tsx` `toReviewScene`, add after `durationSeconds: scene.durationSeconds,`:

```ts
    promptText: (outputRole === 'reference' ? (referencePrompt ?? '') : scene.visualPrompt).trim(),
```

The `.trim()` is not cosmetic: main's expression is `(output.role === 'reference' ? (output.referencePrompt ?? '') : scene.visualPrompt).trim()` (`jobManager.ts:579`), and the field's own comment claims it mirrors main exactly. Token-based matching makes the difference invisible today, which is precisely why it would rot silently.

- [ ] Add the verdict, memoised on the review and the project's rules:

```tsx
const effectiveRules = useMemo(() => (project === null ? [] : resolveEffectiveStudioRules(project.rules)), [project]);
const ruleBreachesBySceneId = useMemo(() => {
  if (generationReview === null) return {};
  const breaches: Record<string, StudioRuleBreach[]> = {};
  for (const scene of generationReview.scenes) {
    const verdict = evaluateStudioRules(effectiveRules, scene.promptText);
    if (verdict.breaches.length > 0) breaches[scene.id] = verdict.breaches;
  }
  return breaches;
}, [effectiveRules, generationReview]);
```

- [ ] Pass the verdict to the modal — one prop, on the existing `<GenerationReviewModal … />` element at `StudioPage.tsx:1259`:

```tsx
ruleBreachesBySceneId = { ruleBreachesBySceneId };
```

Do **not** pass `onAskDirector` here. The page cannot build it: the handler needs the Director conversation, and `StudioPage` renders `BriefConversationProvider` (`:1231`) rather than consuming it, while the modal is mounted as a sibling outside it (`:1259`). Task 11 supplies the affordance by moving the modal inside the provider behind a small consumer component; until then `onAskDirector` is absent and `GenerationReviewModal` hides the button by its own `onAskDirector !== undefined` guard. That is the intended intermediate state, and Task 10's DOM test covers both halves of it (the button appears when the prop is passed directly in the test, and Confirm is blocked whether or not it is).

- [ ] Guard the auto-submit path. In the queued-reference effect (:500-552), insert immediately after `const submission = collectSubmittableRoutes(review.scenes);` and its null check:

```ts
// The Director's queued reference requests are the one paid path with no human confirm, so the
// rule check happens here too. Main refuses this batch anyway; going through the modal instead
// means the user sees WHICH rule blocked WHICH shot rather than a bare refusal, and the queued
// requests survive to be answered.
const breached = review.scenes.some(
  (scene) => evaluateStudioRules(resolveEffectiveStudioRules(project.rules), scene.promptText).breaches.length > 0
);
if (breached) {
  // Say WHY the batch stopped. Redirecting the user into a review they did not ask for, with no
  // statement that a rule caused it, is exactly the "say the consequence before it runs" failure
  // this phase exists to fix. The modal's own error slot is the surface: both
  // `studioJobs.clearIssue()` and `setGenerationReviewIssueMessageKey(null)` ran earlier in this
  // effect (:479-480), and the modal falls back to `generationReviewIssueMessageKey` whenever
  // `studioJobs.issue` is not a `submit_scenes` issue (:1279-1283), so this key is what renders.
  setGenerationReviewIssueMessageKey('conversation.creativeStudio.rules.autoSubmitBlocked');
  openQueuedReferenceReview();
  return;
}
```

- [ ] Add the imports (`evaluateStudioRules`, `resolveEffectiveStudioRules`, `type StudioRuleBreach`, `type StudioBriefRuleDraft`, `StudioRulesDrawer`) and `useMemo` if missing.

**One honest gap in this step's coverage, stated rather than left to be discovered.** All five of Task 10's DOM tests target `GenerationReviewModal`; none of them renders this page effect, so **nothing asserts that `setGenerationReviewIssueMessageKey('…rules.autoSubmitBlocked')` line.** `rulesKeys` (Step 12.1) stops the key being deleted, but no test stops this call being deleted — the guard would silently go back to redirecting the user with no reason given. Covering it means driving `StudioPage`'s queued-reference effect through `StudioPage.dom.test.tsx`, which is a page-level test with its own bridge harness; that is deliberately out of Phase 1's scope, and this note is here so a reviewer does not read the wired key as proof the wire is tested.

- [ ] Run and see it pass:

```
bun run test tests/unit/pages/studio
```

Expected: **no failures at all** — these specs echo i18n keys rather than resolving them, so nothing here is blocked on Task 12.

### Step 10.4 — Commit

- [ ] `git commit -am "feat(creative-studio): surface a rule breach before the money gate"`

---

## Task 11 — The breach feedback loop

**Files**

- Modify: `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposals.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx` (a new module-scope `StudioGenerationReview` component, and the modal moves inside `BriefConversationProvider`)
- Test: `tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx`

**No new file, and no fixture _shape_ changes.** `BriefConversationProvider` keeps its `project` prop, so `WritePhase.dom.test.tsx:322`/`:345` and the two `useBriefConversationContext` mocks in `DirectorPane.dom.test.tsx:24-26` / `DirectorProposals.dom.test.tsx:39-41` are untouched. One existing **assertion** does have to move, in Step 11.2 — see the `waitFor` note there — because routing `repropose` through `sendDirectorInstruction` puts an `await` in front of the send.

This is the channel that works regardless of what aioncore does with `pinned_context`: when a prompt breaks a rule, the Director is told, in the turn where it matters, with the rule quoted. `DirectorProposals.repropose` (`:58-63`) is the exact shape — a verbatim instruction sent through `conversation.sendMessage` with `pinned_context` attached.

### Step 11.1 — Write the failing test

This file already mocks `@/common` down to `{ ipcBridge: { conversation: { sendMessage: { invoke: sendMessage } } } }` (`:27-29`, the spy declared at `:25`) and imports the component module with a top-level `await import(…)` (`:57-58`). `sendDirectorInstruction` now also calls `getConversationOrNull`, so that module needs a mock too.

- [ ] Add the mock alongside the existing ones, above the `await import`:

```ts
const conversationCache = vi.fn(async () => null);

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: conversationCache,
}));
```

- [ ] Add `describeRuleBreachInstruction` and `sendDirectorInstruction` to the destructured `await import('@renderer/pages/studio/components/Shell/DirectorProposals')` at `:57-58`, then add:

```ts
it('quotes the rule and the shot when handing a breach to the Director', async () => {
  await sendDirectorInstruction({
    conversation: conversation(),
    instruction: describeRuleBreachInstruction([
      { sceneTitle: 'Opening', ruleText: 'No competitor logos.', matchedTerm: 'acme' },
    ]),
  });

  expect(sendMessage).toHaveBeenCalledTimes(1);
  const [payload] = sendMessage.mock.calls[0] as [{ input: string; conversation_id: string }];
  expect(payload.conversation_id).toBe('conversation_brief');
  expect(payload.input).toContain('No competitor logos.');
  expect(payload.input).toContain('Opening');
  expect(payload.input).toContain('acme');
  expect(payload.input).toContain('Rewrite');
  // Does not ask the Director to remove the rule — the whole point of the instruction.
  expect(payload.input).toContain('Do not ask to remove the rule');
});

it('re-reads the conversation so the rules pin travels with the breach turn', async () => {
  const stale = conversation();
  const fresh = {
    ...stale,
    extra: {
      ...stale.extra,
      context_handoff: {
        pinned_context: [
          {
            id: 'studio_brief_rules',
            title: 'Project rules',
            content: 'PROJECT RULES',
            source: 'manual' as const,
            created_at: 1,
            updated_at: 1,
          },
        ],
      },
    },
  };
  conversationCache.mockResolvedValueOnce(fresh as never);

  // The stale in-memory handle still carries only the user's `pin-1`; the server copy carries the
  // Studio pin. The pin Task 5 wrote through IPC is exactly this case, and this is the turn where the
  // rules matter most.
  await sendDirectorInstruction({ conversation: stale, instruction: 'x' });

  const [payload] = sendMessage.mock.calls[0] as [{ pinned_context: TContextHandoffItem[] }];
  expect(payload.pinned_context.map((pin) => pin.id)).toEqual(['studio_brief_rules']);
});
```

The fixture is `conversation()` (`:122-131`) — the same one this file already feeds to `harness.result.state` in its top-level `beforeEach` (`:152-159`). Call it rather than declaring a second fixture. **Do not strip its `context_handoff`.** It deliberately carries `context_handoff: { pinned_context: [pinnedItem] }` (`:130`, `pinnedItem` at `:113-120`), and the file's existing repropose test asserts exactly that at `:249` (`expect(payload.pinned_context).toEqual([pinnedItem])`) — removing it reds a passing test. Keeping it also makes the second new test **sharper**, not vacuous: `conversationCache.mockResolvedValueOnce(fresh)` returns only `studio_brief_rules`, so the assertion distinguishes the fresh server copy from the stale handle's `pin-1` rather than distinguishing "something" from "nothing". `TContextHandoffItem` is already imported at `:11`.

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx
```

Expected: `does not provide an export named 'describeRuleBreachInstruction'` — a link-time failure, because the destructured `await import` names an export the module does not have yet.

### Step 11.2 — Extract the sender and add the instruction

- [ ] In `DirectorProposals.tsx`, replace the private `repropose` with an exported helper and add the breach instruction:

```ts
export type StudioRuleBreachReport = {
  sceneTitle: string;
  ruleText: string;
  matchedTerm: string;
};

/**
 * Sent verbatim when a rule blocked a render. English, like REPROPOSE_INSTRUCTION and every other
 * model-facing literal in Studio: localising the model's instructions makes its behaviour depend on
 * the UI language. This is also the channel that does not depend on anything aioncore does with
 * pinned_context — the Director learns the rule at the moment it matters.
 */
export const describeRuleBreachInstruction = (reports: readonly StudioRuleBreachReport[]): string =>
  [
    'A pinned project rule blocked this render before anything was charged. Nothing was generated.',
    ...reports.map(
      (report) =>
        `- Shot "${report.sceneTitle}" breaks the rule "${report.ruleText}" (the word "${report.matchedTerm}").`
    ),
    'Rewrite the visual prompts so they satisfy the rule, then propose the change. Do not ask to remove the rule.',
  ].join('\n');

/**
 * One send site for every Studio-initiated Director turn, so pinned_context is never forgotten.
 *
 * The conversation is re-GET before the pins are read, exactly as AionrsSendBox does
 * (`AionrsSendBox.tsx:936` → `:941`). The in-memory record from ConversationHistoryContext can lag
 * the pin Task 5 just wrote through IPC, and the breach-feedback turn is the one turn where the
 * rules matter most — sending it without them would be the worst possible time to be stale. A failed
 * re-GET falls back to what we hold rather than dropping the message.
 */
export const sendDirectorInstruction = async (input: {
  conversation: StudioBriefConversation;
  instruction: string;
}): Promise<void> => {
  const latest = (await getConversationOrNull(input.conversation.id)) ?? input.conversation;
  await ipcBridge.conversation.sendMessage.invoke({
    input: input.instruction,
    conversation_id: input.conversation.id,
    files: [],
    pinned_context: getConversationPinnedContext(latest),
  });
};
```

Add the import, the same one `AionrsSendBox.tsx:70` uses:

```ts
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
```

It returns `TChatConversation | null`, so the `?? input.conversation` fallback is doing real work; `getConversationPinnedContext` also accepts `null | undefined` (`pinnedContext.ts:71-76`), but falling back to the handle we already hold is strictly better than sending no pins at all.

- [ ] Rewrite the component's `repropose` to use it:

```ts
const repropose = async (): Promise<void> => {
  if (conversation.state.kind !== 'ready') return;
  await sendDirectorInstruction({ conversation: conversation.state.conversation, instruction: REPROPOSE_INSTRUCTION });
};
```

Import `StudioBriefConversation` from `../PhaseShell/phases/brief/useBriefConversation`.

- [ ] **Make the one pre-existing assertion this rewrite breaks await.** Today `repropose` calls `ipcBridge.conversation.sendMessage.invoke` as its first statement after the ready guard (`DirectorProposals.tsx:56-64`, the invoke at `:58-63`), so the send happens synchronously on click. Routing it through `sendDirectorInstruction` puts `await getConversationOrNull(...)` in front of it, and the existing test `asks the Director to redraft against the current script, in the Director conversation` (`DirectorProposals.dom.test.tsx:232-250`) fires the click and asserts on the next line with no await. In that file:
  - add `waitFor` to the `@testing-library/react` import at `:7`;
  - change `:237` from `expect(sendMessage).toHaveBeenCalledOnce();` to `await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());` and make the test callback `async`.

  Everything after that line — including `expect(payload.pinned_context).toEqual([pinnedItem])` at `:249` — still holds, because `getConversationOrNull` is mocked to resolve `null` and `sendDirectorInstruction` falls back to the handle it was given. Leave `stays silent when there is no Director conversation to ask` (`:252-260`) synchronous: it asserts `not.toHaveBeenCalled()` on a path that returns before any await, and adding a `waitFor` there would only make it slower and weaker.

**StudioPage cannot hold the conversation handle, and this is the trap in Task 11.** Verified: `BriefConversationProvider` owns the `useBriefConversation(project)` call (`BriefConversationContext.tsx:25-31`) and `StudioPage` is the component that _renders_ that provider (`StudioPage.tsx:1231`), so it cannot consume its own context. And `<GenerationReviewModal … />` is mounted as a **sibling outside** the provider (`StudioPage.tsx:1259`), so the affordance's owner is not in the subtree either. Calling `useBriefConversation` a second time is not the way out: it guards one _start_ per project with a module-scope map (`useBriefConversation.ts:53-59`), but a second instance is still a second subscriber with its own `state`.

So the modal moves **inside** the provider and a small consumer supplies the send. Chosen over the alternative — hoisting `useBriefConversation` into `StudioPage` and giving `BriefConversationProvider` a `value` prop — because that alternative deletes a guard: `WritePhase.dom.test.tsx` renders `<BriefConversationProvider project={project}>` (`:322`, `:345`) and asserts `writeConversationHarness.providedProjectIds` to prove the provider calls the hook with the right project (`:41-46`). Under a `value` prop the provider stops calling the hook and that assertion has no subject and no new home. This route touches no existing fixture.

- [ ] In `StudioPage.tsx`, add a module-scope consumer component immediately above `StudioProjectShell` (`:260`). It goes in this file rather than a new one because `StudioPage.tsx` already holds two components (`StudioProjectShell` and `StudioPage`), and `components/Generation/` should not grow a file for six lines of wiring:

```tsx
/**
 * The generation review, plus the one thing it needs from the Director conversation.
 *
 * `BriefConversationProvider` owns the single `useBriefConversation` instance, and the page renders
 * that provider — so the page cannot read the context it supplies. This component sits INSIDE the
 * provider and reads it, which is why the modal moved inside too. Everything else the send needs
 * (which shots breached, which rules) is page state and arrives as `reports`.
 *
 * `onAskDirector` is left undefined when there is nothing to report, so the modal hides the
 * affordance rather than offering a button that does nothing.
 */
const StudioGenerationReview: React.FC<
  GenerationReviewModalProps & { reports: readonly StudioRuleBreachReport[]; onAsked: () => void }
> = ({ reports, onAsked, ...modalProps }) => {
  const briefConversation = useBriefConversationContext();
  const askDirector = useCallback((): void => {
    if (briefConversation.state.kind !== 'ready' || reports.length === 0) return;
    void sendDirectorInstruction({
      conversation: briefConversation.state.conversation,
      instruction: describeRuleBreachInstruction(reports),
    });
    onAsked();
  }, [briefConversation.state, onAsked, reports]);

  return <GenerationReviewModal {...modalProps} onAskDirector={reports.length === 0 ? undefined : askDirector} />;
};
```

Add to `StudioPage.tsx`'s imports: `useBriefConversationContext` from `./components/Shell/BriefConversationContext`, `describeRuleBreachInstruction`, `sendDirectorInstruction` and `type StudioRuleBreachReport` from `./components/Shell/DirectorProposals` (the file is already imported at `:45` for `DirectorProposals`/`pendingDirectorProposals`), and `type GenerationReviewModalProps` from `./components/Generation` (`GenerationReviewModal` is already imported at `:29`).

- [ ] In `StudioProjectShell`, derive the reports next to `ruleBreachesBySceneId` (Task 10):

```tsx
const breachReports = useMemo<StudioRuleBreachReport[]>(() => {
  if (generationReview === null) return [];
  return generationReview.scenes.flatMap((scene) =>
    (ruleBreachesBySceneId[scene.id] ?? []).map((breach) => ({
      sceneTitle: scene.title,
      ruleText: breach.ruleText,
      matchedTerm: breach.matchedTerm,
    }))
  );
}, [generationReview, ruleBreachesBySceneId]);
```

- [ ] Move the `<GenerationReviewModal … />` element (`StudioPage.tsx:1259`) **inside** `<BriefConversationProvider>`, after `</StudioShell>`, and rename it to `StudioGenerationReview` with two extra props. The provider renders no DOM of its own (`BriefConversationContext.tsx:30`) and Arco portals the modal to `body`, so nothing about the rendered output moves:

```tsx
      </StudioShell>
      <StudioGenerationReview
        reports={breachReports}
        onAsked={() => setGenerationReview(null)}
        ruleBreachesBySceneId={ruleBreachesBySceneId}
        visible={generationReview !== null}
        mode={generationReview?.mode ?? 'single'}
        scenes={generationReview?.scenes ?? []}
      />
    </BriefConversationProvider>
```

Then move the remaining props across verbatim. The element currently at `StudioPage.tsx:1259-1303` already spells all of them out — `excludedScenes`, `aspectRatio`, `resolution`, `targetDurationSeconds`, `selectedDurationSeconds`, `projectDurationSeconds`, `submitting`, `submissionBlocked`, `errorMessageKey`, `onCancel`, `onConfirm` and the rest — and **not one of them changes**. Cut and paste; do not retype. `onAskDirector` is supplied by `StudioGenerationReview` itself, so the page never passes it: Task 10's `onAskDirector={askDirectorAboutBreaches}` line is superseded and must not be added.

Keep `<StoryboardDraftModal … />` exactly where it is — it needs no conversation.

- [ ] Run and see it pass:

```
bun run test tests/unit/pages/studio
```

Expected: **no failures at all**, for the same reason: every studio DOM spec mocks `t` to echo the key.

### Step 11.3 — Commit

- [ ] `git commit -am "feat(creative-studio): tell the Director which rule blocked which shot"`

---

## Task 12 — The i18n work

**Files**

- Modify: `packages/desktop/src/renderer/services/i18n/locales/{zh-CN,en-US,ja-JP,zh-TW,ko-KR,tr-TR,ru-RU,uk-UA,pt-BR,de-DE,es-ES,fa-IR}/conversation.json`
- Modify: `tests/unit/pages/studio/studioI18n.test.ts` — `plannedGroups` (:16-40), a new `rulesKeys` list next to `briefKeys` (:42), `streamFullSentenceKeys` (:246-270), and the presence loop inside the planned-group test (:383-388). **`pluralLogicalKeys` (:229-244) is not touched.**
- Modify: `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts` (generated)

**Measured budget, not estimated.** Verified against the repo today: 12 locales, reference `en-US`, 463 string leaves under `conversation.creativeStudio`, **429** after filtering plural variants (that is the cap denominator), so the cap is `Math.max(4, floor(429 × 0.05)) = 21`. Copied-English leaves per locale right now: de-DE 12 (headroom 9), tr-TR 8, pt-BR 8, es-ES 5, ru-RU 4, uk-UA 4, ko-KR 2, zh-CN/zh-TW/ja-JP/fa-IR 1.

This task adds **31 reference keys**: 30 under a new `rules` group and one, `errors.ruleBreach`, in the existing `errors` group. The denominator becomes 460, so the cap rises to `floor(460 × 0.05) = 23` and de-DE's headroom becomes 11 — already partly spent by existing loanwords. **Machine-copying English fails the build.** 17 of the 31 are full sentences and go on `streamFullSentenceKeys`, where the tolerance is zero, no cap (`studioI18n.test.ts:546-549`).

**Not one plural key, and that is deliberate.** An earlier draft carried `rules.breachSummary` (`"{{count}} shots break a rule."`) and priced it at **38 authored strings on its own** — 26 variants across the 12 locales, measured with `Intl.PluralRules`, plus 12 mandatory bases (`:598-601`) — with ru-RU/uk-UA `_one`/`_few`/`_many` required to be mutually distinct (`:660-666`). Nothing rendered it: the modal shows one `<Alert>` per breaching shot, not a count. It is cut, which removes the whole plural-gate surface from this task. `pluralLogicalKeys` therefore gains **nothing**.

**Every key in the list below is rendered by code in Tasks 7-11.** An earlier draft carried nine that were not: copy no user could ever see, permanently required in twelve files by the presence list that pinned them — the exact orphan class `removedWriteAssistantKeys` (`studioI18n.test.ts:318-332`) exists to police. Three were wired to the surface their name implies and six were cut, and the six that went account for **98 authored strings**: five plain keys across twelve locales (5 × 12 = 60) plus `breachSummary`'s plural family (26 variants plus 12 mandatory bases = 38).

| Key                               | Resolution                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules.autoSubmitBlocked`         | **Wired** (Step 10.3). It was the one that changed behaviour: the guard previously called `openQueuedReferenceReview()` and returned, silently redirecting the user with no reason given.   |
| `rules.enforcedHelp`              | **Wired** (Step 8.2.2) as a static badge legend in the drawer.                                                                                                                              |
| `rules.contextOnlyHelp`           | **Wired** (Step 8.2.2), same legend.                                                                                                                                                        |
| `rules.saveFailed`                | **Cut.** `StudioPage` sets `rulesErrorMessageKey` from `result.error.messageKey`, which is always an `errors.*` key from `errorMessageKeys` (Step 8.3). This key could never be reached.    |
| `rules.breachHeading`             | **Cut.** The breach renders as a per-scene `<Alert type='error'>` whose content is `breachScene`; there is no heading element above it.                                                     |
| `rules.breachSummary`             | **Cut**, with its `_one`/`_other` variants. See above.                                                                                                                                      |
| `rules.breachAsked`               | **Cut.** `onAsked` closes the modal, which returns the user to the Director pane where the sent turn and the reply are both visible. A separate confirmation would duplicate what they see. |
| `rules.proposalDuplicate`         | **Cut.** `applyProposalPayload` makes a duplicate accept an idempotent no-op (Step 6.4.3) and the card disappears; the rule the user asked for is in the list. There is nothing to report.  |
| `rules.organisationUndistributed` | **Cut.** The drawer renders `rules.empty` when both layers are empty, and `rules.precedence` already says organisation rules apply everywhere and cannot be changed here.                   |

Totals: **372 strings authored, 341 of them non-English** (31 × 12 and 31 × 11). Budget the translation pass accordingly; it is still the largest single cost in this plan, and it is **98 strings smaller** than the version that priced dead copy — that draft's 37 keys came to 36 × 12 + 38 = 470.

**One new group, not four nested homes.** The vocabulary genuinely spans Brief (authoring), the Director pane (the pin card) and the money gate (the breach). Scattering one concept across `phase.brief` / `brief` / `errors` / `phase.shared` is how the "four distinct keys all reading Report Issue" collision class gets made. One line in `plannedGroups` now beats a permanent naming hazard — and moving keys later costs a second 12-locale round.

### Step 12.1 — Write the failing gate edits

- [ ] In `studioI18n.test.ts`, add `'rules',` to `plannedGroups` in sorted position (between `'routing'` and `'scene'`).

- [ ] Add the presence list next to `briefKeys` (:42):

```ts
/**
 * Every entry is rendered by code in Tasks 7-11, and each is named next to its render site so the
 * list cannot quietly outlive a surface. `check-i18n.js` has no unused-key detection, and this
 * presence loop *pins* whatever it lists into all twelve locales — so an entry added here for a
 * surface that never ships is permanent dead copy nothing complains about.
 */
const rulesKeys = [
  'rules.title', // StudioRulesDrawer, Drawer title
  'rules.open', // StudioPhaseShell, the Rules button
  'rules.description', // StudioRulesDrawer
  'rules.precedence', // StudioRulesDrawer
  'rules.empty', // StudioRulesDrawer, both layers empty
  'rules.textLabel', // StudioRulesDrawer, label + aria-label
  'rules.textPlaceholder', // StudioRulesDrawer
  'rules.termsLabel', // StudioRulesDrawer, label + aria-label
  'rules.termsPlaceholder', // StudioRulesDrawer
  'rules.termsHelp', // StudioRulesDrawer
  'rules.add', // StudioRulesDrawer, submit
  'rules.remove', // StudioRulesDrawer, per-rule button text
  'rules.removeAccessible', // StudioRulesDrawer, per-rule aria-label
  'rules.invalidText', // StudioRulesDrawer, role=alert
  'rules.invalidTerms', // StudioRulesDrawer, role=alert
  'rules.limitReached', // StudioRulesDrawer, at the cap
  'rules.scope.project', // StudioRulesDrawer, scope Tag
  'rules.scope.organisation', // StudioRulesDrawer, scope Tag
  'rules.scope.organisationLocked', // StudioRulesDrawer, locked Tag
  'rules.enforcedBadge', // StudioRulesDrawer, enforcement Tag + legend
  'rules.enforcedHelp', // StudioRulesDrawer, badge legend
  'rules.contextOnlyBadge', // StudioRulesDrawer, enforcement Tag + legend
  'rules.contextOnlyHelp', // StudioRulesDrawer, badge legend
  'rules.breachScene', // GenerationReviewModal, per-scene Alert
  'rules.breachBlockedConfirm', // GenerationReviewModal, disabledReason
  'rules.breachAskDirector', // GenerationReviewModal, the escape hatch
  'rules.autoSubmitBlocked', // StudioPage, queued-reference guard → the modal's error slot
  'rules.proposalTitle', // DirectorProposalCard, pin_rule Card title
  'rules.proposalBody', // DirectorProposalCard, pin_rule
  'rules.proposalTerms', // DirectorProposalCard, pin_rule, predicate present
  'errors.ruleBreach', // creativeStudioBridge errorMessageKeys.rule_breach
] as const;
```

- [ ] In the `defines the complete planned group…` test, add the loop next to the `briefKeys` one:

```ts
for (const key of rulesKeys) {
  expect(leaves[key], `Missing conversation.creativeStudio.${key}`).toBeTruthy();
}
```

- [ ] Leave `pluralLogicalKeys` (:229) **untouched**. This task adds no plural key — see the budget note above.

- [ ] Add the 17 full sentences to `streamFullSentenceKeys` (:246):

```ts
  'rules.description',
  'rules.precedence',
  'rules.empty',
  'rules.textPlaceholder',
  'rules.termsPlaceholder',
  'rules.termsHelp',
  'rules.removeAccessible',
  'rules.invalidText',
  'rules.invalidTerms',
  'rules.limitReached',
  'rules.enforcedHelp',
  'rules.contextOnlyHelp',
  'rules.breachScene',
  'rules.breachBlockedConfirm',
  'rules.autoSubmitBlocked',
  'rules.proposalBody',
  'errors.ruleBreach',
```

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/studioI18n.test.ts
```

Expected: `expected [ … 23 groups ] to deeply equal [ … 24 groups ]` plus `Missing conversation.creativeStudio.rules.title` and 30 more.

### Step 12.2 — Author the reference copy

- [ ] Add to `en-US/conversation.json` under `creativeStudio`, in sorted group position:

```json
    "rules": {
      "title": "Rules",
      "open": "Rules",
      "description": "Rules are the part of your brief that gets checked. A rule with forbidden words is enforced: a shot whose prompt contains one is refused before it costs anything.",
      "precedence": "Organisation rules apply everywhere and cannot be changed here. Project rules apply to this project. Anything you say in the conversation becomes a rule only when you pin it.",
      "empty": "No rules yet. Add one here, or tell the Director what to keep to and it will offer to pin it.",
      "textLabel": "Rule",
      "textPlaceholder": "One sentence, for example: keep the kits generic.",
      "termsLabel": "Forbidden words",
      "termsPlaceholder": "Separate words with commas, for example: acme, globex",
      "termsHelp": "Leave this empty for guidance the Director should follow but nothing can check.",
      "add": "Pin rule",
      "remove": "Remove",
      "removeAccessible": "Remove the rule {{rule}}",
      "invalidText": "A rule needs one sentence of up to 240 characters.",
      "invalidTerms": "Use up to 8 forbidden words, each of at most 64 characters.",
      "limitReached": "This project already holds the maximum of 24 rules. Remove one to add another.",
      "scope": {
        "project": "Project",
        "organisation": "Organisation",
        "organisationLocked": "Locked"
      },
      "enforcedBadge": "Enforced",
      "enforcedHelp": "Checked against every shot's prompt before anything is generated.",
      "contextOnlyBadge": "Context only",
      "contextOnlyHelp": "The Director reads this rule, but nothing checks it automatically.",
      "breachScene": "This shot breaks the rule “{{rule}}” — its prompt contains “{{term}}”.",
      "breachBlockedConfirm": "Nothing has been charged, and nothing in this batch will run until every rule is satisfied. Change the prompt, or ask the Director to rewrite it.",
      "breachAskDirector": "Ask the Director to fix it",
      "autoSubmitBlocked": "The Director asked for reference images that break a rule, so nothing was generated. Review them here.",
      "proposalTitle": "Rule to pin",
      "proposalBody": "The Director suggests adding this rule to the project. Nothing is pinned until you accept.",
      "proposalTerms": "Forbidden words: {{terms}}"
    },
```

`breachBlockedConfirm` names the **batch**, not the shot, because that is what main does: `resolveProvider` throws inside `submitScenes`'s preparation loop (`jobManager.ts:1297`), so one breaching shot aborts the whole call. The modal matches it — `ruleBreached` is `scenes.some(…)` (Step 10.2) — and copy that read as per-shot would be a lie about which shots are blocked.

- [ ] Add to the existing `errors` group in `en-US/conversation.json`:

```json
      "ruleBreach": "A pinned rule blocked this render, and nothing was charged. Open Rules to see which one.",
```

- [ ] Run and confirm the reference is complete but the other locales are not:

```
bun run test tests/unit/pages/studio/studioI18n.test.ts
```

Expected: the planned-group assertion and the `rulesKeys` presence loop both pass; the parity test fails with `zh-CN is missing: errors.ruleBreach, rules.add, …` for all 11 non-reference locales. **Every key in `rulesKeys` must resolve to a leaf in this JSON** — the loop asserts `expect(leaves[key]).toBeTruthy()`, and there is no plural key in the group, so no `_one`/`_other` variant needs a separate base leaf. (An earlier draft added `breachSummary_one`/`_other` with no base `breachSummary`, which failed this loop _and_ reported every locale as "copies new English full-sentence keys" because `undefined === undefined` on both sides of the copied-English check at `:546`. Both defects are gone with the key.)

### Step 12.3 — Translate all 11 non-reference locales

- [ ] For each of `zh-CN, ja-JP, zh-TW, ko-KR, tr-TR, ru-RU, uk-UA, pt-BR, de-DE, es-ES, fa-IR`, add the same `rules` group and `errors.ruleBreach` with **genuine translations**. Non-negotiable constraints, each enforced by a specific assertion:
  - Every `{{placeholder}}` must appear, spelled identically, in the same order (`studioI18n.test.ts:534-542`).
  - No value may equal its English counterpart for any of the 17 `streamFullSentenceKeys` additions (`:546-549`) — zero tolerance, no cap.
  - Total copied-English leaves per locale must stay at or under `max(4, floor(460 × 0.05)) = 23` (`:552`). The pre-existing counts are the starting point, not zero: de-DE begins at 12.
  - No value may be empty or whitespace (`:530-532`).
  - The `“ ”` curly quotes in `breachScene` are fine to replace with the locale's own quotation marks (e.g. `「」` for ja-JP, `«»` for ru-RU) — that is expected, not a placeholder mismatch.
  - **No plural work at all.** The `rules` group has no plural key, so nothing in this task touches `_one`/`_few`/`_many`/`_other`, and the plural-fallback and ru-RU/uk-UA mutual-distinctness assertions (`:598-601`, `:660-666`) see no new subject.

- [ ] Run the whole i18n gate:

```
bun run test tests/unit/pages/studio/studioI18n.test.ts
```

Expected: `Test Files  1 passed (1)`. Any `leaves too much English copy` failure names the exact keys — translate those, do not raise the cap.

### Step 12.4 — Regenerate the key types and run the repo-wide copy sweeps

- [ ] Regenerate and verify:

```
bun run i18n:types && node scripts/check-i18n.js
```

Expected: `i18n:types` rewrites `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`; `check-i18n.js` prints no errors and exits 0. Both run in the CI gate (`.github/workflows/sprint3-pr-gate.yml:77-79`), so a stale generated file reds the build.

- [ ] Run the raw-key sweep, which renders all four phases in all 12 locales and fails on any visible `conversation.creativeStudio.` string or accessible name:

```
bun run test tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx
```

Expected: `Test Files  1 passed (1)`. Note it renders **without** `BriefConversationProvider` (the hook is mocked at `:60-66`), so any new surface reading a React context must degrade like `BriefConversationContext`'s `ABSENT` fallback (`:45-60`) rather than throw. The drawer reads no context, so this should pass unchanged.

- [ ] Re-run the three studio DOM specs this task's copy could plausibly have moved:

```
bun run test tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx
```

Expected: all three green, and green **unchanged** — they were already green before this task. All three mock `react-i18next` so `t` echoes the key, so none of them can see the copy Task 12 adds. **Do not rewrite any assertion to a real en-US string:** under those mocks no English string can match, and doing so is the exact mistake that would red the specs while looking like a fix. The only file in this repo that asserts against real localised copy is `StudioAccessibleCopy.dom.test.tsx`, and it asserts the _absence_ of raw keys rather than the presence of particular sentences.

### Step 12.5 — Commit

- [ ] `git commit -am "feat(creative-studio): add the rules copy in twelve locales"`

---

## Task 13 — Migration proof and the whole-suite gate

**Files**

- Test: `tests/unit/process/creative-studio/store.test.ts`, `tests/unit/process/creative-studio/creativeStudioService.test.ts`
- Modify: `docs/design/creative-studio-2-phase-1-brief-rules-plan.md` (this file — record the Step 5.0 answer)

The handoff promises a migration per phase and no user is ever asked to export and reimport. Task 2 delivered it (`migrateSchemaV1Project` defaults `rules: []` before validation). This task proves it end to end and closes the gate.

### Step 13.1 — Write the end-to-end migration test

- [ ] Add to `tests/unit/process/creative-studio/creativeStudioService.test.ts`:

```ts
it('opens a project written before rules existed, and the first rule write rewrites the record', async () => {
  const project = await service.createProject(makeInput());
  const file = path.join(rootDir, project.id, 'project.json');
  const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  delete raw.rules;
  await writeFile(file, JSON.stringify(raw), 'utf8');

  // `getProject(projectId: string)` — a bare id, not a request object (creativeStudioService.ts:156)
  // — and it returns `StudioRendererProject | null`.
  const reopened = await service.getProject(project.id);
  expect(reopened?.rules).toEqual([]);
  // `listProjects()` returns a bare `StudioProjectSummary[]` (:154), so quarantine is asserted where
  // it actually lives, on the store.
  expect(await store.listQuarantinedProjectIds()).toEqual([]);

  const written = await service.setBriefRules({
    projectId: project.id,
    expectedRevision: reopened!.revision,
    rules: [{ id: 'rule_1', text: 'Keep the kits generic.', predicate: null }],
  });
  const persisted = JSON.parse(await readFile(file, 'utf8')) as { rules: unknown[]; revision: number };

  expect(persisted.rules).toHaveLength(1);
  expect(persisted.revision).toBe(written.revision);
});
```

`readFile` and `writeFile` are imported from `node:fs/promises` at `creativeStudioService.test.ts:9`; `store`, `service`, `rootDir` and `makeInput` come from the file's own `beforeEach` and module scope.

- [ ] Run and see it pass (Task 2 already implemented the behaviour; this proves it at the service boundary):

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: `Test Files  1 passed (1)`.

### Step 13.2 — Close the gate

- [ ] Run the whole suite in one invocation, never just the touched directory:

```
bun run test
```

Expected: `Test Files` all passed, `Tests` all passed with the pre-existing skips. Baseline before this work was **624 files / 8,126 passed / 19 skipped** — re-measure on `main` if the number differs rather than assuming a regression, and remember that BUG-043's readiness hardlink guard is a known intermittent that occasionally reds the job. Re-run once before investigating.

- [ ] Run the rest of the gate, in the CI order:

```
bunx tsc --noEmit -p tsconfig.json && bun run lint && bun run format:check && bun run i18n:types && node scripts/check-i18n.js
```

Expected: no output from `tsc`; `oxlint` reports no errors; `oxfmt --check` reports no files needing formatting; `check-i18n.js` exits 0. If `format:check` complains, run `bun run format` and re-commit — do not hand-fix.

- [ ] Prove the e2e specs still compile and resolve (no display needed):

```
bunx playwright test --list tests/e2e/features/workspaces/creative-studio.e2e.ts
```

Expected: the spec's test titles listed with no import or compile error. `--list` is the only e2e signal available without a display, and no test file in this repo is typechecked by `tsc`.

### Step 13.3 — Record the Step 5.0 answer and commit

- [ ] Write the aioncore `pinned_context` answer from Step 5.0 into this document's A4 section and into the MR description, together with the two convention-debt overages from A6.
- [ ] `git commit -am "test(creative-studio): prove the rules migration and close the gate"`
- [ ] **Do not push.** This worktree is explicitly no-push.

---

## Self-Review

### Spec coverage against the Phase 1 definition

| Requirement (from the handoff)                                                                 | Where it is implemented                                                                                                                                  | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "A CLAUDE.md, not a form" — small, human-readable, always in context                           | Task 1 (`renderStudioRulesBlock`), Task 4 (`read_storyboard` view), Task 5 (the pin)                                                                     | Met, **asymmetrically**: rules are pushed every turn, brief prose is pulled. That asymmetry is a **choice**, settled as A4's RECORDED DECISION with its two reasons — not a constraint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| "Loaded into every director turn, not read when opened"                                        | Task 5 (`pinned_context`, the only per-turn field on the send wire) + Task 4 (fresh per tool call) + Task 11 (told at the moment it matters)             | **Met for RULES. NOT met for BRIEF PROSE, deliberately.** The handoff's sentence is half delivered and Phase 1 says so rather than claiming it whole: rules ride every turn and main refuses to spend against them; prose is fetched when the Director fetches it. Pushing the prose was **legal and declined** — the channel holds 20 pins × 2,000 characters ≈ 40,000, so a 16 KB brief fits across ~9 pins (`payloadSchemas.ts:24-25`, `:89-98`, `:106`; brief limit `creativeStudioService.ts:477`) — for the two reasons in A4's RECORDED DECISION: 16 KB on every send against an 82-second turn, and 9 of 20 slots taken from the half that must never be dropped. Consequence: on a rules-free project there is no pin at all, so the `read_storyboard` description (Step 4.3) is the only always-present prompt for the brief. Both channels ride the same unknown — Step 5.0's aioncore question. |
| "Accumulates from conversation — the director offers to pin it as a rule"                      | Task 6 (`propose_brief_rule` + payload union), Task 7 (the card)                                                                                         | Met, on the existing propose/accept protocol. Four blockers verified and each addressed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| "Scope levels with explicit precedence"                                                        | Task 1 (`resolveEffectiveStudioRules`, `ORGANISATION_STUDIO_RULES`), Task 8 (scope badges + `rules.precedence`)                                          | Met for project + organisation. **Thread precedence is deferred**, with the reason in A5: it is inherently per-section and sections are phase 2. Organisation ships as a locked, empty layer because no distribution channel exists in this codebase.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| "Rules are the executable part — predicates run against every visual prompt before it renders" | Task 9 (`resolveProvider`), Task 10 (renderer pre-flight)                                                                                                | Met. Covers single, batch, retry and reference plates; the Director cannot bypass it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| "Everything else in the brief is context the director reads"                                   | `predicate: null` rules and `project.brief` — Task 1's `contextOnlyBadge`, Task 4's `enforced: false`                                                    | Met.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| "New sections inherit format, length, look references and cast"                                | —                                                                                                                                                        | **Gap, deliberate.** Sections are the phase-2 data model. Also collides with `propose_storyboard` being a whole-script replacement (`studioServer.ts:289`): an accepted proposal replaces every scene, so per-section inheritance needs the apply path to preserve section state, which does not exist yet. Recorded here so phase 2 inherits the constraint rather than rediscovering it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| "Say the consequence before it runs, never after"                                              | Task 10 (breach named on the shot, Confirm disabled, inside the modal, before submit)                                                                    | Met.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| "Free is direct; money asks once"                                                              | Task 9 (the check is a pure synchronous function before `persistPreparedJobs` and `trackRun`)                                                            | Met — the check costs nothing and runs before the charge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| "The assistant may never trigger a paid call on its own"                                       | Unchanged: the five MCP tools are all proposers. Task 10 additionally makes the auto-submit path fall back to the modal on a breach instead of spending. | Met, and strengthened.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| "§8: cheap — prompt assembly plus a check step, no new media stack"                            | No media code touched. The costs are the 372-string i18n pass (Task 12) and the payload-union widening (Task 6).                                         | Met, with the real cost centre named rather than hidden — and 98 strings smaller once the nine keys no code rendered were wired or cut (the six cut ones: 5 × 12 plain + 38 plural).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A migration per phase; no user exports and reimports                                           | Task 2 (defaulted in `migrateSchemaV1Project`, which runs before `validateProject`), Task 13 (proved end to end)                                         | Met.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Placeholder scan

Every task states its files, shows real code for every step that changes code, and gives a real command with its expected output. Checked specifically for the failure modes named in the brief:

- **No "TBD", no "add appropriate error handling", no "write tests for the above".** Every test body is written out.
- **No "similar to Task N".** The `pinned_context` write is spelled out in Task 5; the `sendDirectorInstruction` shape is spelled out again in Task 11 rather than cross-referenced. Both `createProposeBriefRuleHandler` config objects in Step 6.5 are written in full, as are both `createReadStoryboardHandler` configs in Step 4.1. The one place this document says "unchanged from here" is `applyProposalPayload`'s existing body in Step 6.4.3, and it names the exact line the prepend stops at.
- **Every type and function is defined before use.** `StudioBriefRule`, `StudioBriefRuleDraft`, `StudioBriefRulePredicate`, `StudioRuleBreach`, `StudioRuleVerdict`, `STUDIO_RULE_LIMITS`, `ORGANISATION_STUDIO_RULES`, `foldForRuleMatch`, `evaluateStudioRules`, `resolveEffectiveStudioRules`, `renderStudioRulesBlock`, `buildStudioBriefRulesPin`, `STUDIO_BRIEF_RULES_PIN_ID`, `STUDIO_BRIEF_RULES_PIN_MAX_CHARS` — all Task 1. `StudioSetBriefRulesRequest` — Task 3, before its provider. `StudioReplaceStoryboardProposalPayload` / `StudioPinRuleProposalPayload` — Task 6, before the validator branches; `toRendererProposalPayload` — Step 6.4.1, immediately above its only caller. `ProposeBriefRuleInput` / `createProposeBriefRuleHandler` — Task 6, before registration. `NO_RULE_BREACHES` — Step 10.2, at module scope above the component that defaults against it. `StudioRuleBreachReport` / `describeRuleBreachInstruction` / `sendDirectorInstruction` — Task 11, before `StudioGenerationReview` calls them, and `StudioGenerationReview` itself is declared at `StudioPage.tsx` module scope above `StudioProjectShell`, which renders it.
- **No DOM test is left red across tasks.** An earlier draft claimed the `DirectorProposalCard` and `GenerationReviewModal` specs were "deliberately red until Task 12's copy". That was wrong: both files mock `react-i18next` so `t` echoes the key (`DirectorProposalCard.dom.test.tsx:23-34`, `GenerationReviewModal.dom.test.tsx:18-27`), so they never see real copy and Task 12 could not have fixed them — they assert echoed keys and go green in their own task. The drawer spec mocks `t` the same way. Step 12.4 now says explicitly **not** to rewrite those assertions to English.
- **No step is left red by an untypechecked fixture, and the sweep is closed rather than sampled.** Because `rules` is required and no test file is typechecked, every fixture that builds a `StudioProject`/`StudioRendererProject` literal and reaches new code is a runtime TypeError waiting to happen. The complete set is **four fixtures**, each fixed in the task that first breaks it: `studioServerProjectFixture` (`creativeStudioService.test.ts:174-202`) in Step 4.1; `BriefConversation.dom.test.tsx`'s `project()` (`:66-83`) in Step 5.2, because it drives the real `useBriefConversation`; and `StudioPage.dom.test.tsx`'s and `StudioExport.dom.test.tsx`'s `project()` (both `:103`) in Step 8.3, because they are the **only two** specs in the repo that import and render the real `StudioPage` — `grep -rln "import StudioPage from" tests` returns exactly those two, which is what makes this a closed set rather than a spot check. Every other spec that names `StudioRendererProject` either mocks `useBriefConversation` wholesale, builds its own controller shape, or never mounts the drawer.
- **One thing genuinely spans tasks**, and the step says so: `onAskDirector` is absent until Task 11 moves the modal inside `BriefConversationProvider`, and `GenerationReviewModal` hides the affordance while it is. Task 10's third DOM test pins that intermediate state rather than leaving it unasserted.
- **One assertion in an existing spec has to move, and the step that causes it says so.** Routing `repropose` through `sendDirectorInstruction` puts an awaited re-GET in front of the send, so `DirectorProposals.dom.test.tsx:237` becomes `await waitFor(…)` (Step 11.2). No other pre-existing assertion changes anywhere in this plan.
- **Exactly two places instruct the implementer to read the repo rather than trust this document**, and neither is a guess about an API: the `makeInput`/`readFileSync`/`writeFileSync` names in `store.test.ts` (Step 2.1, in case they drift after this plan is written), and the exact insertion points inside `StudioPage.tsx`'s 1,376 lines (Steps 8.3, 10.3, 11.2). Both say what to look at and what the failure looks like if it is guessed wrong. That is a deliberate instruction, not a placeholder. Five hedges an earlier draft carried are gone, each replaced by a verified fact with its file:line: the `merge_extra` nesting (Step 5.2), the page's project-adoption call — it is `refetch` (Step 8.3), the `jobManager.test.ts` harness signature (Step 9.1), the mocked specifiers in the new pin spec (Step 5.1), and `createService`, which does not exist and is now the file's real inline `createCreativeStudioService({…})` everywhere.

### Type consistency across tasks

- `StudioProject.rules` is **required** (Task 2). This is what makes `toRendererProject`'s omission a compile error, because `StudioRendererProject` is `Omit<StudioProject, 'jobs' | 'routing'> & {…}` and `toRendererProject` declares that return type. Step 2.2 includes an explicit stop-check: if `tsc` does not flag the projection, the field was declared optional and the silent-drop trap is live.
- `StudioBriefRule.scope` is `'project' | 'organisation'` in the type; the store validator admits only `'project'` (Step 2.3), and the organisation layer is code-resident. A store test asserts the refusal, so the two cannot drift silently.
- `renderStudioRulesBlock` is **not** a dead export: `buildStudioBriefRulesPin` calls it for the lines that fit (Step 1.6), so there is exactly one definition of the model-facing rule format and the pin cannot drift from it. An earlier draft re-assembled the block inside the builder, which left the export live only in its own two tests — the isolated-test-keeps-dead-code pattern this repo has been bitten by before.
- `evaluateStudioRules` is called with the **effective** rule list in all four call sites (Task 9 main, Task 10 modal verdict, Task 10 auto-submit, Task 5 pin), always via `resolveEffectiveStudioRules`. Calling it with raw `project.rules` would skip the organisation layer; that is the one consistency invariant a reviewer should check by grep: `grep -rn "evaluateStudioRules" packages/desktop/src` must show `resolveEffectiveStudioRules` on every line or the line above.
- `GenerationReviewScene.promptText` (Task 10) mirrors `jobManager.ts:579` exactly, **including the trim** — `(outputRole === 'reference' ? (referencePrompt ?? '') : scene.visualPrompt).trim()`. A different expression here would show a verdict against a different string than main checks, which is worse than showing none. The comment on the field says so, and the trim is what keeps that comment true.
- `'rule_breach'` is added to **both** `StudioJobManagerErrorCode` and `StudioCommandErrorCode` (Task 9). `toCommandError` passes job-manager codes straight through for everything but `invalid_request`, and `errorMessageKeys` is a `Record` over the command union, so the compiler forces the copy key. Verified against the actual mapping at `creativeStudioBridge.ts:55-75`.
- `StudioProposalPayload`'s union means `computeStudioProposalDiff` takes only the storyboard variant. **Five** sites narrow, and Step 6.2 runs `tsc` explicitly to enumerate them rather than trusting this list: `rememberProposalDiff` (early return, Step 6.4.4), `applyProposalPayload` (kind branch, Step 6.4.3), `toRendererProposal` via the new `toRendererProposalPayload` (kind branch, Steps 6.4.1-6.4.2), `resolveProposalDiff` (early return, Task 7), and the card's `payload.sceneOrder` list render (narrowed by Task 7's early return). `toRendererProposal` is the one that needs new **behaviour** rather than an early return: it is the only path a proposal takes to the renderer, so an unbranched `pin_rule` payload arrives with `rule` stripped and `sceneOrder`/`scenes` invented, and Step 6.5's `expect(proposal.payload).toEqual({ kind: 'pin_rule', … })` is the assertion that catches it because it reads through this projection.
- `buildStudioBriefRulesPin` returns `TContextHandoffItem | null` with `source: 'manual'` and a fixed `id`. Both are forced by facts, not taste: `contextPinSchema` is `.strict()` with `source: z.enum(['manual','context_md'])` (`payloadSchemas.ts:89-97`), so a Studio-specific source would be rejected by the compaction schema the moment Studio ever compacts; and the fixed id is the only way to rewrite in place without touching user pins, since the Director pane never mounts `ContextHandoffPanel` and the user cannot reach the pin UI (the conversation is filtered out of chat history by `ConversationHistoryContext.tsx:27`).

### Fixed during review

- The pin originally carried a **truncated brief head** alongside the rules. Removed, and the reason still holds: a 16 KB brief cut to whatever fits beside the rules in one 2,000-character pin is a misleading half-brief, and `read_storyboard` returns the whole thing fresh. **This is not the same as Option B.** A truncated head is wrong at any pin count; chunking the whole brief across ~9 pins is legal, costed, and **declined on cost** — see A4's RECORDED DECISION. An earlier draft of this plan conflated the two and wrote down that the brief "can never fit"; that claim was false and is corrected in A4.
- `evaluateStudioRules` originally folded diacritics. Removed: folding merges distinct Vietnamese words (ca / cà / cá) and this product ships in Vietnamese. A test pins the behaviour and the code says why.
- The rules list was originally sited in `BriefPhase`. Moved to the frame after finding that `engine-strip.md:54` had already disqualified Brief on the identical shell-survival test, and that anything next to the brief textarea inherits the `beforeMutation` force-flush.
- Rules were originally going to ride `StudioProjectDraft`. Removed: `flushProjectDraft` resends every draft field on every flush and dirty-tracks per field, so a Director pin racing a brief keystroke would clobber the whole array. Replaced with the dedicated CAS'd `set-brief-rules` command modelled on `bindBriefConversation`.
- Both recon reports listed `PROJECT_KEYS` as an exact-key Set that must move. It does not exist. Corrected in A3; the correction removes a schema-version bump and a migration hazard from the cost,
