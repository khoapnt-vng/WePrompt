# Creative Studio 3 — Beat and Shot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the schema-1 scene/phase prototype with a Beat → Shot → Take workspace whose
Table, Board, and beat panel share one revisioned state; whose Beat panel owns shot-level trims and
takes while one film-level Cut owns Beat order, bed, Match To, and export; whose first-frame chain is
explicit, quoted, and recoverable; and whose paid generation stays behind a reviewed human
confirmation that shows what it will cost.

**Architecture:** Land a clean, additive schema-2 foundation first, then atomically switch the
runtime, bridge, and renderer to it. One pure reducer in main owns every free renderer and Director
mutation. The project store remains the only durable writer. Table, Board, and the beat panel consume
the same sanitized projection. The Director is one persistent conversation in a collapsible docked
rail — it is not the workspace's centre. Schema-1 manifests and sidecars are read-only unsupported
prototype data: never migrated, repaired, replayed, quarantined as corrupt, or used to start provider
work.

**Tech Stack:** TypeScript, Electron main/renderer separation, React 18, Arco Design, Icon Park,
CSS Modules and UnoCSS, native bridge schemas, MCP SDK, Vitest, Testing Library/jsdom, Playwright,
i18next across 12 locales, repository-managed media URLs.

**Spec:**
[creative-studio-3-direction-and-answers.md](./creative-studio-3-direction-and-answers.md) (§1–§13),
SHA-256 `f4b89684ec17fb94560632254744e5443a57a4ed3c16b48450c148848fe0df0e`; frozen visual reference
[creative-studio-3-beat-and-shot-reference.html.txt](./creative-studio-3-beat-and-shot-reference.html.txt),
SHA-256 `642c8b16a56c2799d119c6077c7282969c1d612bd9aca606e39da51c710846ee`. The reference is the
offline bundle of the prototype the review was conducted against; the direction document refers to
it by its authoring name, `Creative Studio 3 - Beat and Shot.dc.html`.

> **Authority record.** The direction document was originally transcribed into the repository rather
> than exported from its authoring copy. On 2026-08-18 the product owner explicitly approved the
> repository text as authoritative, including the parked-shot amendment recorded at its top. That
> approval supersedes the earlier authoring-copy comparison requirement for this revision. Any later
> semantic edit still requires explicit product approval, an independent contract review, and a new
> pin. On 2026-08-23 the product owner approved the independently audited BUG-095 contract now
> recorded in §13.6; the §1–§13 hash above is its new pin and supersedes the former §1–§11 pin. A hash
> is only an anchor if it names the file everyone approved.

**Execution baseline:** `7176e3f6b` on `codex/creative-studio-table-board-ui-design` — CS2 Tasks 1–5
complete and Gate 1 closed after the independent review/fix sequence through `12a8d7fe7`. The three
CS3 documentation commits were transplanted onto that lineage before this amendment; do not begin
implementation from the divergent pre-review docs fork.

**Continuation baseline:**
`b37e00e4f6c2ca88b1f0b5a47cbb568ff4df92af` (`refactor(studio): rename persisted and wire names to
beat and shot`). Tasks 1A and 1B are historical-complete at that exact commit; continue with Task 1C,
do not replay either rename. Verify `7176e3f6b` and then `b37e00e4f` are ancestors and the worktree is
clean before Task 1C. The earlier Task 1A/1B checklists remain as evidence and recovery instructions,
not pending execution.

**Authorization boundary:** This document is an implementation plan, not implementation, merge,
default-enablement, release, profile-deletion, provider-run, or customer-migration authorization.

---

## Relationship to CS2 — what is salvaged, what is rewritten

CS2 completed Tasks 1–5. CS3 is not a new product; it is CS2's model corrected on vocabulary, on
where the cut lives, and on the division of labour between director and human. This plan supersedes
`creative-studio-2-table-board-implementation-plan.md`.

**The pivot is a rename, not a rewrite — measured, not estimated.** Across the whole CS2 schema-2
effort (12,824 production lines, 18,874 test lines), the CS3 vocabulary touches roughly **6%**. In
the 10,224 production lines of Tasks 4–5, only about 400 carry any renamed identifier: `clipId` on
218 lines, `sectionId` on 70, `shelf` on 6, `cut` on 17, `scene` on 12, `Cut` on none. Fixture IDs
such as `clip_1` are opaque safe IDs and need no change. Everything else — the Director command
mailbox, processor and spend fences, the four MCP record writers, `v2Service`, `jobManager`,
`mediaStore`, the store's schema sniff and quarantine path — is vocabulary-independent and carries
over untouched.

**Nothing built so far is UI.** CS2 never reached its cutover task, so the IPC bridge, the native
payload schemas and manifest, and the renderer have never seen the Section/Clip vocabulary. That is
the expensive, hard-to-unwind surface, and it is still unwritten. Gate 1's check that V2 code remains
unregistered from the renderer bridge is what certifies this.

**The only genuine write-off is the cut machinery** — `cuts.ts` (227 lines) and `cuts.test.ts` (400)
— and it is a CS3 _design_ cost, not a pivot cost: collapsing the Cut into `bedAssetId` and
`matchToShotId` deletes that code whenever CS3 is adopted, so finishing CS2 first would not save a
line of it.

| CS2 artefact                                                                                     | Fate in CS3                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 1 types (`StudioSection`, `StudioClip`, `StudioShelfItem`)                                  | **Renamed** to Beat/Shot/Bin and extended. Same file, same schema version.                                                                                                                                                                                                                      |
| Task 1 `schema2/validation.ts` (795 lines)                                                       | **Renamed and extended.** Structure, exactness, and roughly half the file (assets, jobs, provider, rules, timestamps) are untouched by the rename.                                                                                                                                              |
| Task 1 **Fix Round 1** (`0191d0216`) — `ownValue`, iterative retry walk, per-kind shelf maxima   | **Carried as code.** These are totality fixes, not schema; they transfer to a Beat/Shot validator directly. Nine of ten review findings closed here.                                                                                                                                            |
| CS2 **Amendment 1** (validator totality and lookup rules)                                        | **Carried verbatim.** Schema-independent; see the frozen contract below.                                                                                                                                                                                                                        |
| Task 2 reducer `mutations.ts` (674 lines)                                                        | **Renamed and extended**, not rewritten. Its batch machinery — ordered application, later-op visibility, immutability, rollback, capacity precedence, collision rejection, permutation checks, created-ID ordering — is vocabulary-independent. CS3 keeps analogues of all 15 ops and adds ~12. |
| Task 2 `cuts.ts` (227) + `cuts.test.ts` (400)                                                    | **Deleted.** The Cut collapses into project fields; cut-clip identity, `orderMode` reconciliation, and clamping have no home. The only genuine write-off.                                                                                                                                       |
| Task 3 store inspection, schema sniff, V1 no-touch guarantees, quarantine path, CAS, fsync facts | **Carried.** Only the seam type signatures change.                                                                                                                                                                                                                                              |
| Task 4 `jobManager`, `mediaStore`, `renderService`, `v2Service` (4,358 production lines)         | **Renamed.** `clipId` → `shotId` over logic that stays valid: idempotency, submission ambiguity, download recovery, cancellation policy, retry lineage. Chain sequencing is **additive on top**, not a replacement.                                                                             |
| Task 5 Director mailbox, processor, spend fences, MCP record writers (6,212 production lines)    | **Renamed.** `studioServer.ts` already exposes `studio_apply_edits` over a `mutation_batch` — the "every hand gesture as an MCP op" surface exists; CS3 renames it and adds to it. `requiredAction` appears zero times, so dropping required actions costs nothing.                             |
| CS2 Task 6 atomic cutover                                                                        | **Never started.** No bridge, manifest, or renderer work exists — the pivot happens before the expensive surface.                                                                                                                                                                               |
| CS2 Task 8 Director layout system (docked/split/narrow without remounting)                       | **Never started, and now cancelled.** Replaced by one collapsible docked rail.                                                                                                                                                                                                                  |
| CS2 Cut UI removal                                                                               | **Reversed.** CS3 has a Cut, narrowed to film-level work.                                                                                                                                                                                                                                       |

**Schema version: CS3 claims `schemaVersion: 2`.** No user has ever persisted a schema-2 record —
the cutover never happened, and Studio is behind `AIONUI_ENABLE_CREATIVE_STUDIO`, off by default.
There is no version 3, no third sniff branch, and no second unsupported state. Internal
`Forge-Dev-2` profiles holding CS2-shaped schema-2 records will fail validation into the existing
loud quarantine path, which is correct and already specified.

---

## Global constraints

1. **Clean cutover, no migration.** Do not write a V1→V2 converter, a compatibility projection, a
   reset button, or startup cleanup. `schemaVersion: 1` returns `unsupported_prototype_schema` and
   its complete project tree remains byte-for-byte unchanged.
2. **No unsupported-profile side effects.** Before summary repair, `.part` cleanup, proposal or
   reference reaping, command mailbox creation, watchers, job recovery, resolver access, adapter
   access, polling, or protocol installation, classify the project as supported V2 or unsupported
   V1. Poison every forbidden dependency in tests.
3. **Temporary additive staging is not product compatibility.** Tasks 1–6 may introduce V2 types and
   unregistered V2 seams while the V1 UI still compiles. They must not project V1 as V2 or expose two
   user-selectable contracts. Task 7 atomically switches every existing legacy/free/read/reference
   public path and deletes the scene providers/types/tests before Gate 2 review. The brand-new paid
   `prepare_submission`/`confirm_submission` pair remains jointly absent through Task 7 and lands
   together with its reviewed gate and sanitized projection in Task 8; it never has a legacy public
   half to cut over.
4. **One free mutation authority.** Renderer free-authoring IPC and Director processing call the same
   pure ordered reducer inside the store queue. The reducer imports no filesystem, IPC, renderer, job
   manager, provider resolver, adapter registry, polling, retry, cancel, or render code.
5. **Reviewed spend only.** The only paid boundary is main's `prepare` → human `confirm` protocol.
   Director reference/generation requests are queued for human review. Accepting a proposal may
   populate a gate but never confirms it. No Director path may submit, retry, cancel, download,
   render, resolve routes/providers, invoke adapters, or mint a spend authorization.
6. **Free operations may create future spend, and must say so.** New in CS3. Tail-trimming a
   non-final shot and reordering shots inside a beat are free at the moment they happen but mark
   downstream frames stale. Any surface that performs one must show the staleness it created, and the
   render gate must quote the cascade as a distinct priced option — never fold it into a flat total.
7. **Nothing authored or paid for is destroyed.** Park, do not delete. Beats, shots, and takes are
   removed from the film by lifting them to the Bin. Authored text that is replaced goes to the
   beat's line history. A shot that has takes cannot be deleted at all.
8. **One revision, no replay.** Each successful free batch writes one project revision and one
   durable result. Any operation failure rolls back the entire batch. Stale and ambiguous outcomes
   never auto-retry.
9. **Film words for what the user authors; machine words for what the machine consumes.** Beat, shot,
   take, cut, coverage, continuity are film words and appear in the UI. Prompt, seed, route, first
   frame, render are machine words and stay in the code and the technical readouts. Do not dress
   "prompt" up as "direction".
10. **The director acts before the picture exists; the human decides after it does.** Director scope
    is anything derivable from text or stills. Motion judgements — whether a cut works, which take is
    good, rhythm — are the human's and are never automated.
11. **No hidden legacy UI.** Final source has Table, Board, beat panel, and Cut only. Delete the
    scene-based Write, Produce, Review, Export, and auto-submit UI rather than leaving it compiled
    but unreachable.
12. **Directory ratchet.** Add no peer under directories already above ten children. Keep every new
    directory at two to ten direct children. Re-audit counts at every delivery gate.
13. **Keys land with the string; translation is deferred on purpose.** Every renderer-visible string
    added by a task ships as an i18n key under `creativeStudio.workspace.*` with `en-US` authored,
    placeholder and plural parity included. Hardcoded strings are a hard blocker per AGENTS.md, and
    `i18n-keys.d.ts` is generated, so keys are compile-time checked — skipping them means an
    extraction retrofit across the whole UI later, and it makes every upstream AionUi locale merge
    worse. The other eleven locales are **explicitly deferred to one named pass before release**:
    `check-i18n.js` reports missing non-reference keys as a warning rather than an error, and
    `i18n-config.json` sets `fallbackLanguage: "en-US"` with the loader doing
    `mergeWithFallback`, so an untranslated key renders English rather than a key or a crash.
    Persian uses logical CSS and bidi isolation regardless, since layout is not translation.

    **Budget that deferred pass as design work, not translation.** The film vocabulary is
    load-bearing — Beat, Shot, Look, Action, Coverage, Slate, Bin, Lifted, hard cut versus continuity
    break — and several strings are themselves the explanation ("Reading order is play order"). A
    literal translation can break the model the same way "Clip" broke it in English, so that pass
    needs a designer in the room with the translator.

14. **Strict TDD.** For each behavior: write the smallest failing test, run it and record the exact
    failure, implement the minimum production change, rerun focused tests, kill at least one risky
    mutation, restore, then run the task gate. Never weaken a timeout or assertion to obtain green.
15. **Independent reviews.** After each delivery gate, freeze an exact commit and obtain read-only
    diff review. Critical/Important findings block the next gate.
16. **Feature/release boundary.** Preserve `AIONUI_ENABLE_CREATIVE_STUDIO`; do not enable Studio by
    default, remove the flag, claim packaged acceptance, or launch a provider as part of this plan.
17. **Per-file coverage ratchet.** Keep
    `vitest.creative-studio-coverage.config.ts` equal to the executable production diff for each
    delivery head. Every listed file must remain at least 80% lines and 80% branches; a root
    aggregate percentage is not a substitute.

---

## Frozen schema-2 contract

This is the **final Gate-1 contract**. Tasks 1C–5 form one atomic schema-2 core tranche because the
project shape, reducer, store, pricing authority, and generation lifecycle are one compile-time and
durability strongly connected component. Task 1C freezes the names and validators; Tasks 2–5 install
their only truthful consumers. Do not commit or publish an intermediate schema-2 shape, add duplicate
legacy/final fields, make required paid fields optional, or weaken exact validation merely to obtain
an artificial per-task green point. The tranche ends with one full-suite-green commit after Task 5.

Later tasks may not rename or reinterpret these contracts without a spec amendment and a new
independent contract review.

### Limits and text bounds

```ts
export const STUDIO_PROJECT_SCHEMA_VERSION = 2 as const;
export const STUDIO_MAX_BEATS = 24;
export const STUDIO_MAX_SHOTS_PER_BEAT = 8;
export const STUDIO_MAX_SHOTS_PER_PROJECT = 96;
export const STUDIO_MAX_BIN_BEAT_ITEMS = 24;
export const STUDIO_MAX_BIN_SHOT_ITEMS = 96;
export const STUDIO_MAX_BIN_TAKE_ITEMS = 96;
export const STUDIO_MAX_LINE_HISTORY_PER_BEAT = 20;
export const STUDIO_MAX_UNDO_ENTRIES = 20;
export const STUDIO_MAX_UNDO_PATCHES_PER_ENTRY = 2 + STUDIO_MAX_BEATS + STUDIO_MAX_SHOTS_PER_PROJECT;
export const STUDIO_MAX_UNDO_LABEL_LENGTH = 256;
export const STUDIO_MIN_SHOT_SECONDS = 4;
export const STUDIO_MAX_SHOT_SECONDS = 15;
export const STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION = 4;
export const STUDIO_MAX_GENERATION_PROMPT_LENGTH = 32 * 1024;
export const STUDIO_LOOK_SOFT_WORD_LIMIT = 25;
export const STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST = 24;
export const STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST = 2 * STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST;
export const STUDIO_PREPARED_QUOTE_TTL_SECONDS = 5 * 60;
export const STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT = 4;
export const STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL = 16;
export const STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES = 8 * 1024 * 1024;
export const STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT = 16 * 1024 * 1024;
export const STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL = 64 * 1024 * 1024;
export const STUDIO_MAX_EXPORTS_PER_SHAPE = 5;
export const STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT = STUDIO_MAX_SHOTS_PER_PROJECT + 8;
export const STUDIO_MAX_EXPORT_DIRECTORY_DEPTH = 4;
export const STUDIO_BED_FADE_OUT_SECONDS = 2;
export const STUDIO_MAX_REFERENCE_REQUEST_SHOTS = 24;
export const STUDIO_MAX_DIRTY_SHOTS_REPORTED = 96;
export const STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SHOT = 24;
export const STUDIO_MAX_MUTATION_OPERATIONS = 32;
```

- IDs match the existing safe-ID contract: 1–256 ASCII letters, digits, `_`, or `-`.
- Project name 256; brief 16 KiB.
- Beat title 256; **action** 4 KiB; **look** 8 KiB.
- Shot **line** 8 KiB; narration 4 KiB; on-screen text 1 KiB.
- Shot duration is an integer **4–15 seconds**. There is no image-duration branch: every shot is
  video, and stills are takes on the image route.
- **Project `targetDurationSeconds` is an integer 5–1440 seconds.** CS2's 5–60 bound was already
  wrong — 96 shots at 15s is 24 minutes — and a three-minute film makes it visible. Widen it in the
  validator _and_ in the summary schema; the two must agree.
- Beat `targetSeconds` is null or an integer 1–1440. Null means authored duration is still pending;
  zero is never a hidden substitute for null.
- **Bin capacity is enforced per kind, and only per kind.** There is no independently meaningful
  total. This replaces CS2's arrangement, where a 120-item total was enforced and the per-kind
  maximum that mattered was not. The Beat and Shot Bin maxima equal their project-total record
  maxima, so they remain structural persisted-state bounds but cannot be a separate runtime blocker
  for parking another valid active record. The Take Bin maximum is independently reachable and is a
  park-time blocker; per-Beat Shot capacity is independently reachable on Shot restore.
- **The 25-word Look limit is soft.** The counter warns; word 26 is allowed. Rules are hard;
  guidance is soft, and the Look is guidance.
- Asset duration is media-exact. Images omit `durationSeconds`; video and audio require a finite value
  greater than `0` and at most `Number.MAX_SAFE_INTEGER`. A canonical video Take persists its probed
  source duration; it need not equal the owner's later editable `StudioShot.durationSeconds`.
  `StudioShot.durationSeconds` is next-generation/planning intent, while a selected canonical Take's
  asset duration is played/export/conditioning/trim authority. Bed audio may be longer than film and
  is trimmed/faded by the frozen Cut rule. `Number.MAX_VALUE` is not a bound: it admits `1e308` and
  makes trim comparisons vacuously true.

Generation, reference-request, dirty-report, and MCP projection limits remain independently named
even when values coincide, and **each validator consumes the constant named for its own contract**.
`STUDIO_PROJECT_SCHEMA_VERSION` is the only source of the persisted version literal in validators and
factories. Every constant added must have at least one consumer by the end of its owning task; an
unreferenced limit is not centralized. Task 5 owns every prepared-quote cache limit and Task 13 owns
every export limit even though Task 1C stages their frozen declarations inside the atomic contract.

### Persisted entities

```ts
export type StudioBeat = {
  id: string;
  title: string;
  action: string; // the one thing you write
  look: string; // conditioning inherited by every shot
  actionRevision: number; // bumped on every action edit; derivation staleness anchor
  targetSeconds: number | null; // authored intent, never a constraint
  shotOrder: string[];
  lineHistory: StudioLineHistoryEntry[];
};

export type StudioLineHistoryEntry = {
  id: string;
  shotOrdinal: number; // historical 1..8 provenance; may exceed the current shot count
  text: string;
  capturedAt: string;
};

export type StudioShot = {
  id: string;
  line: string;
  derivation: 'derived' | 'detached';
  derivedFromActionRevision: number | null; // null when detached
  narration: string;
  onScreenText: string;
  durationSeconds: number; // 4–15, what it generates
  trimInSeconds: number | null; // head trim, what it plays
  trimOutSeconds: number | null; // tail trim, what it plays
  chainBreak: 'none' | 'hard_cut'; // author-chosen; never system-set
  seedStillId: string | null; // explicit image-take pin; null derives latest or seed-pending
  selectedTakeId: string | null; // selected video take only
  assetIds: string[];
  jobIds: string[];
};

export type StudioBinItem =
  | { kind: 'beat'; beatId: string; reason: 'lifted' | 'alternate' }
  | { kind: 'shot'; beatId: string; shotId: string; reason: 'lifted' }
  | { kind: 'take'; assetId: string; reason: 'lifted' | 'alternate' };

export type StudioProposedShot = {
  shotId: string; // an existing ID to preserve, or a safe caller-minted new ID
  line: string;
  narration: string;
  onScreenText: string;
  durationSeconds: number;
  chainBreak: 'none' | 'hard_cut';
};

export type StudioFixedShotReasonV2 =
  | 'owned_asset'
  | 'owned_job'
  | 'selected_take'
  | 'seed_still'
  | 'conditioning_frame'
  | 'conditioning_input'
  | 'match_to'
  | 'narration'
  | 'on_screen_text';

export type StudioFixedShotReviewV2 = {
  shotId: string;
  reasons: StudioFixedShotReasonV2[];
};

export type StudioCoverageApplyResult = {
  beatId: string;
  createdShotIds: string[];
  retainedShotIds: string[];
  removedShotIds: string[];
  fixedShotIds: string[];
};

export type StudioPlanningShotBoundaryV2 = {
  shotId: string;
  startSeconds: number;
  endSeconds: number;
};

export type StudioConditioningInputSnapshot =
  | { kind: 'seed_still'; assetId: string }
  | {
      kind: 'predecessor_frame';
      predecessorShotId: string;
      takeAssetId: string;
      frameAssetId: string;
      endpointSeconds: number;
    };

export type StudioGenerationReferenceInputSnapshot = {
  assetId: string;
  sha256: string;
};

export type StudioGenerationRequestSnapshot = {
  prompt: string;
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  durationSeconds: number;
  referenceInput: StudioGenerationReferenceInputSnapshot | null;
  conditioningInput: StudioConditioningInputSnapshot | null;
};

export type StudioAuthorizedConditioningDependency =
  | { kind: 'authorized_seed'; upstreamItemId: string; shotId: string }
  | {
      kind: 'authorized_predecessor';
      upstreamItemId: string;
      predecessorShotId: string;
    };

export type StudioGenerationRequestTemplate = Omit<StudioGenerationRequestSnapshot, 'conditioningInput'>;

export type StudioGenerationRequestPlan =
  | { kind: 'resolved'; snapshot: StudioGenerationRequestSnapshot }
  | {
      kind: 'after_take_selection';
      template: StudioGenerationRequestTemplate;
      dependency: StudioAuthorizedConditioningDependency;
    };

export type StudioFrameExtraction = {
  id: string;
  shotId: string;
  takeAssetId: string;
  endpointSeconds: number;
  frameAssetId: string | null;
  status: 'pending' | 'extracting' | 'ready' | 'failed';
  errorCode: 'decode_failed' | 'source_missing' | 'storage_error' | null;
};

export type StudioSpendPolicy = {
  currency: string;
  maxPerBatchMinorUnits: number;
};

export type StudioQuotedGeneration = {
  id: string;
  shotId: string;
  purpose: 'seed_still' | 'video_take';
  routeId: string;
  generationCount: number;
  requestPlan: StudioGenerationRequestPlan;
  rateUnit: 'generation' | 'second';
  rateMinorUnits: number;
};

export type StudioSubmissionQuoteCore = {
  projectId: string;
  projectRevision: number;
  originReferenceHandoffId: string | null;
  rateCardDigest: string;
  currency: string;
  baseItems: StudioQuotedGeneration[];
  cascadeItems: StudioQuotedGeneration[];
  lowerMinorUnits: number;
  upperMinorUnits: number;
};

export type StudioSubmissionQuote = StudioSubmissionQuoteCore & {
  id: string;
  expiresAt: string;
};

export type StudioPrepareGenerationChoiceV2 = {
  shotId: string;
  purpose: 'seed_still' | 'video_take';
  generationCount: number;
  referenceAssetId: string | null;
};

export type StudioPrepareSubmissionRequestV2 = {
  projectId: string;
  expectedRevision: number;
  originReferenceHandoffId: string | null;
  baseChoices: StudioPrepareGenerationChoiceV2[];
  cascadeChoices: StudioPrepareGenerationChoiceV2[];
};

export type StudioConfirmSubmissionRequestV2 = {
  projectId: string;
  quoteId: string;
  expectedRevision: number;
};

export type StudioConfirmSubmissionResultV2 = {
  projectId: string;
  projectRevision: number;
};

export type StudioSubmissionCacheErrorCodeV2 =
  | 'quote_not_found'
  | 'quote_in_use'
  | 'quote_cache_full'
  | 'quote_too_large';

export type StudioPreparedSubmissionOptionsV2 = {
  baseOnly: StudioSubmissionQuote;
  withCascade: StudioSubmissionQuote | null;
};

export type StudioRendererQuotedGenerationV2 = {
  shotId: string;
  purpose: 'seed_still' | 'video_take';
  route: StudioRendererMediaModelRef;
  generationCount: number;
  durationSeconds: number | null;
  oneGenerationMinorUnits: number;
  requestedTotalMinorUnits: number;
  waitsForTakeSelection: boolean;
};

export type StudioRendererBudgetVerdictV2 =
  | { kind: 'no_policy' }
  | { kind: 'within_cap'; policyCurrency: string; maxPerBatchMinorUnits: number }
  | { kind: 'over_cap'; policyCurrency: string; maxPerBatchMinorUnits: number }
  | { kind: 'currency_mismatch'; policyCurrency: string; maxPerBatchMinorUnits: number };

export type StudioRendererSubmissionQuoteV2 = {
  id: string;
  projectId: string;
  projectRevision: number;
  expiresAt: string;
  currency: string;
  baseItems: StudioRendererQuotedGenerationV2[];
  cascadeItems: StudioRendererQuotedGenerationV2[];
  lowerMinorUnits: number;
  upperMinorUnits: number;
  budget: StudioRendererBudgetVerdictV2;
};

export type StudioRendererPreparedSubmissionOptionsV2 = {
  baseOnly: StudioRendererSubmissionQuoteV2;
  withCascade: StudioRendererSubmissionQuoteV2 | null;
};

export type StudioProposalCommitAttributionV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  proposalId: string;
  projectId: string;
  baseRevision: number;
  appliedRevision: number;
  beforeProjectSha256: string;
  afterProjectSha256: string;
  createdBeatIds: string[];
  createdShotIds: string[];
  decidedAt: string;
};

export type StudioReferenceRequestDecisionV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  requestId: string;
  projectId: string;
  decidedAt: string;
  outcome:
    | { kind: 'rejected' }
    | { kind: 'expired' }
    | { kind: 'imported_reference'; assetId: string; projectRevision: number }
    | { kind: 'generation_gate'; handoffId: string; shotIds: string[] };
};

export type StudioReferenceGenerationHandoffReceiptV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  handoffId: string;
  requestId: string;
  completedAt: string;
  result: { kind: 'dismissed' } | { kind: 'confirmed'; authorizationId: string };
};

export type StudioRendererReferenceGenerationHandoffV2 = {
  handoffId: string;
  requestId: string;
  shotIds: string[];
  decidedAt: string;
  status: 'open' | 'dismissed' | 'confirmed';
  completedAt: string | null;
};

export type StudioDismissReferenceGenerationHandoffRequestV2 = {
  projectId: string;
  expectedRevision: number;
  handoffId: string;
};

export type StudioDismissReferenceGenerationHandoffResultV2 = {
  status: 'dismissed';
  completedAt: string;
};

export type StudioCascadeProgressV2 = {
  dependentShotId: string;
  upstreamShotId: string;
  eligiblePrimaryAssetIds: string[];
  canRetryConditioningFrame: boolean;
  canCancelWaiting: boolean;
  waitingReason:
    | 'upstream_running'
    | 'choose_seed'
    | 'choose_take'
    | 'conditioning_frame'
    | 'conditioning_failed'
    | 'dependency_failed'
    | 'cancelled';
};

export type StudioCascadeBarrierActionRequestV2 = {
  projectId: string;
  expectedRevision: number;
  dependentShotId: string;
};

export type StudioParkBeatRequestV2 = {
  projectId: string;
  expectedRevision: number;
  beatId: string;
};

export type StudioRestoreBeatRequestV2 = StudioParkBeatRequestV2 & { beforeBeatId: string | null };

export type StudioParkShotRequestV2 = {
  projectId: string;
  expectedRevision: number;
  shotId: string;
};

export type StudioRestoreShotRequestV2 = StudioParkShotRequestV2 & { beforeShotId: string | null };

export type StudioTakeActionRequestV2 = {
  projectId: string;
  expectedRevision: number;
  shotId: string;
  assetId: string;
};

export type StudioReorderBinRequestV2 = {
  projectId: string;
  expectedRevision: number;
  bin: StudioBinItem[];
};

export type StudioImportSeedStillRequestV2 = {
  projectId: string;
  expectedRevision: number;
  shotId: string;
};

export type StudioImportBedAudioRequestV2 = {
  projectId: string;
  expectedRevision: number;
};

export type StudioDetachBedAudioRequestV2 = StudioImportBedAudioRequestV2 & { assetId: string };

export type StudioSetBedRequestV2 = StudioImportBedAudioRequestV2 & { assetId: string | null };

export type StudioSetMatchToRequestV2 = StudioImportBedAudioRequestV2 & { shotId: string | null };

export type StudioImportManagedMediaResultV2 =
  | { status: 'cancelled' }
  | { status: 'imported'; assetId: string; projectRevision: number };

export type StudioDetachManagedMediaResultV2 = {
  status: 'detached';
  projectRevision: number;
};

export type StudioEditProjectSettingsRequestV2 = {
  projectId: string;
  expectedRevision: number;
  changes: StudioEditableProjectSettingsChanges;
};

export type StudioSetRulesRequestV2 = {
  projectId: string;
  expectedRevision: number;
  rules: StudioBriefRuleDraft[];
};

export type StudioRendererAuthoringOperationV2 = Extract<
  StudioMutationOperationV2,
  {
    kind:
      | 'set_brief'
      | 'add_beat'
      | 'edit_beat'
      | 'reorder_beats'
      | 'add_binned_beat'
      | 'add_shot'
      | 'edit_shot'
      | 'delete_shot'
      | 'reorder_shots'
      | 'set_hard_cut'
      | 'set_seed_still'
      | 'trim_shot'
      | 'redetach_line'
      | 'restore_line'
      | 'set_routes'
      | 'set_spend_policy';
  }
>;

export type StudioApplyAuthoringBatchRequestV2 = {
  projectId: string;
  expectedRevision: number;
  operations: StudioRendererAuthoringOperationV2[];
};

export type StudioRendererProjectCommitResultV2 = {
  projectId: string;
  projectRevision: number;
  createdBeatIds: string[];
  createdShotIds: string[];
};

export type StudioUndoLastRequestV2 = {
  projectId: string;
  expectedRevision: number;
  entryId: string;
};

export type StudioRendererChainConditioningFailureV2 = {
  dependentShotId: string;
  reason: 'conditioning_failed';
  canRetry: true;
};

export type StudioRendererChainStatusV2 = {
  projectId: string;
  projectRevision: number;
  conditioningFailures: StudioRendererChainConditioningFailureV2[];
};

export type StudioGetChainStatusRequestV2 = { projectId: string };

export type StudioRendererDirtyShotV2 = {
  shotId: string;
  causes: ('continuity_stale' | 'generation_out_of_date')[];
};

export type StudioRendererParkBlockerCodeV2 =
  | 'current_match_to'
  | 'own_nonterminal_job'
  | 'own_pending_frame'
  | 'downstream_nonterminal_job'
  | 'downstream_pending_frame'
  | 'waiting_authorization_dependency'
  | 'bound_nonterminal_request'
  | 'current_selected_take'
  | 'current_seed_still'
  | 'nonterminal_conditioning_use'
  | 'take_bin_capacity_reached'
  | 'beat_shot_capacity_reached';

export type StudioRendererParkBlockerV2 = {
  shotId: string | null;
  code: StudioRendererParkBlockerCodeV2;
};

export type StudioRendererParkEligibilityV2 = {
  subject: 'beat' | 'shot' | 'take';
  action: 'park' | 'restore';
  beatId: string;
  shotId: string | null;
  assetId: string | null;
  allowed: boolean;
  blockers: StudioRendererParkBlockerV2[];
};

export type StudioGetWorkspaceStatusRequestV2 = { projectId: string };

export type StudioRendererWorkspaceStatusV2 = {
  projectId: string;
  projectRevision: number;
  undoTop: StudioRendererUndoTopV2 | null;
  dirtyShots: StudioRendererDirtyShotV2[];
  cascadeProgress: StudioCascadeProgressV2[];
  parkEligibility: StudioRendererParkEligibilityV2[];
};

export type StudioSpendAuthorization = StudioSubmissionQuote & {
  confirmedAt: string;
  providerBindings: { itemId: string; provider: StudioProviderRef }[];
  idempotencyKeys: { itemId: string; generationIndex: number; key: string }[];
};

export type StudioSpendReceipt = {
  authorizationId: string;
  itemId: string;
  jobId: string;
  purpose: 'seed_still' | 'video_take';
  routeId: string;
  currency: string;
  rateUnit: 'generation' | 'second';
  rateMinorUnits: number;
  durationSeconds: number | null;
  generationIndex: number;
  generationCount: number;
  totalMinorUnits: number;
};

export type StudioMediaKindV2 = 'image' | 'video' | 'audio';

export type StudioManagedAssetRefV2 = {
  collection: 'assets' | 'imports' | 'thumbnails' | 'conditioningFrames';
  fileName: string;
};

export type StudioAssetV2 = Omit<
  StudioAsset,
  | 'sceneId'
  | 'mediaKind'
  | 'managedAsset'
  | 'sourceVisualPrompt'
  | 'sourceReferenceAssetIds'
  | 'sourceAspectRatio'
  | 'sourceResolution'
> & {
  shotId: string | null;
  mediaKind: StudioMediaKindV2;
  managedAsset: StudioManagedAssetRefV2;
  sourceLook?: string;
};

export type StudioExportShapeV2 = 'editor_folder' | 'still' | 'script';

export type StudioManagedExportRefV2 = {
  collection: 'exports';
  fileName: string;
};

export type StudioExportArtifactV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  id: string;
  projectId: string;
  sourceRevision: number;
  shape: StudioExportShapeV2;
  payloadKind: 'directory' | 'file';
  managedExport: StudioManagedExportRefV2;
  byteSize: number;
  fileCount: number;
  manifestSha256: string;
  createdAt: string;
};

export type StudioExportCatalogV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  projectId: string;
  revision: number;
  artifacts: StudioExportArtifactV2[];
};

export type StudioRendererExportArtifactV2 = Pick<
  StudioExportArtifactV2,
  'id' | 'sourceRevision' | 'shape' | 'byteSize' | 'fileCount' | 'createdAt'
>;

export type StudioRendererExportCatalogV2 = {
  revision: number;
  artifacts: StudioRendererExportArtifactV2[];
};

export type StudioExportArtifactRequestV2 = {
  projectId: string;
  expectedCatalogRevision: number;
  artifactId: string;
};

export type StudioCopyExportResultV2 = { status: 'cancelled' } | { status: 'copied' };

export type StudioRevealExportResultV2 = { status: 'revealed' };

export type StudioCreateExportRequestV2 =
  | { projectId: string; expectedRevision: number; expectedCatalogRevision: number; shape: 'editor_folder' }
  | {
      projectId: string;
      expectedRevision: number;
      expectedCatalogRevision: number;
      shape: 'still';
      shotId: string;
    }
  | { projectId: string; expectedRevision: number; expectedCatalogRevision: number; shape: 'script' };

export type StudioListExportsRequestV2 = { projectId: string };

export type StudioEditorFolderTimelineEntryV2 =
  | {
      kind: 'shot';
      shotId: string;
      takeAssetId: string;
      relativePath: string;
      timelineStartSeconds: number;
      sourceInSeconds: number;
      sourceOutSeconds: number;
      durationSeconds: number;
      chainBreak: 'none' | 'hard_cut';
    }
  | {
      kind: 'slate';
      relativePath: 'media/slate.png';
      timelineStartSeconds: number;
      durationSeconds: number;
    };

export type StudioEditorFolderTimelineBeatV2 = {
  beatId: string;
  title: string;
  timelineStartSeconds: number;
  durationSeconds: number;
  entries: StudioEditorFolderTimelineEntryV2[];
};

export type StudioEditorFolderTimelineV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  projectId: string;
  sourceRevision: number;
  name: string;
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  durationSeconds: number;
  beats: StudioEditorFolderTimelineBeatV2[];
  bed: null | {
    assetId: string;
    relativePath: string;
    sourceInSeconds: 0;
    sourceOutSeconds: number;
    fadeOutStartSeconds: number;
    fadeOutEndSeconds: number;
  };
};

export type StudioJobOutputAssetIdsByRoleV2 = {
  primary: string | null;
  poster: string | null;
};

export type StudioJobStatusV2 = StudioJobStatus | 'waiting_for_conditioning';
export type StudioJobErrorV2 = Omit<StudioJobError, 'code'> & {
  code: StudioJobErrorCode | 'dependency_failed';
};

export type StudioJobV2 = Omit<StudioJob, 'sceneId' | 'status' | 'error' | 'outputRole' | 'referenceInputSnapshot'> & {
  shotId: string;
  status: StudioJobStatusV2;
  error: StudioJobErrorV2 | null;
  purpose: 'seed_still' | 'video_take';
  authorizationId: string;
  authorizationItemId: string;
  generationIndex: number; // zero-based within the quoted item
  requestPlan: StudioGenerationRequestPlan;
  requestSnapshot: StudioGenerationRequestSnapshot | null;
  spendReceipt: StudioSpendReceipt | null;
  outputAssetIdsByRole: StudioJobOutputAssetIdsByRoleV2;
};

export type StudioUndoPatch =
  | {
      kind: 'project_fields';
      before: {
        name: string;
        aspectRatio: StudioAspectRatio;
        resolution: StudioResolution;
        targetDurationSeconds: number;
        brief: string;
        rules: StudioBriefRule[];
        beatOrder: string[];
        imageRouteId: string | null;
        videoRouteId: string | null;
        spendPolicy: StudioSpendPolicy | null;
        bedAssetId: string | null;
        matchToShotId: string | null;
      };
      afterDigest: string;
    }
  | {
      kind: 'beat_fields';
      beatId: string;
      before: StudioBeat | null;
      afterDigest: string;
    }
  | {
      kind: 'shot_fields';
      shotId: string;
      before: Omit<StudioShot, 'assetIds' | 'jobIds'> | null;
      beforeBeatId: string | null;
      beforeIndex: number | null;
      afterDigest: string;
    }
  | { kind: 'bin'; before: StudioBinItem[]; afterDigest: string };

export type StudioUndoEntry = {
  id: string;
  sourceRevision: number;
  label: string;
  patches: StudioUndoPatch[];
};

export type StudioMutationReducerContextV2 = {
  mutationId: string;
  capturedAt: string;
};

export type StudioProjectV2 = Omit<
  StudioProject,
  'schemaVersion' | 'sceneOrder' | 'scenes' | 'cuts' | 'activeCutId' | 'assets' | 'jobs' | 'routing' | 'ruleListUndo'
> & {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  beatOrder: string[];
  beats: Record<string, StudioBeat>;
  shots: Record<string, StudioShot>;
  bin: StudioBinItem[];
  bedAssetId: string | null;
  matchToShotId: string | null;
  spendPolicy: StudioSpendPolicy | null;
  spendAuthorizations: StudioSpendAuthorization[];
  frameExtractions: Record<string, StudioFrameExtraction>;
  undoHistory: StudioUndoEntry[];
  imageRouteId: string | null;
  videoRouteId: string | null;
  assets: Record<string, StudioAssetV2>;
  jobs: Record<string, StudioJobV2>;
};

export type StudioRendererJobV2 = Omit<
  StudioJobV2,
  | 'provider'
  | 'idempotencyKey'
  | 'providerJobId'
  | 'remoteStartedAt'
  | 'cancellationPolicy'
  | 'authorizationId'
  | 'authorizationItemId'
  | 'requestPlan'
  | 'requestSnapshot'
  | 'spendReceipt'
> & {
  provider: StudioRendererMediaModelRef;
  canCancel: boolean;
  canRetryDownload: boolean;
  spendReceipt: StudioRendererSpendReceiptV2 | null;
};

export type StudioRendererSpendReceiptV2 = Pick<
  StudioSpendReceipt,
  | 'purpose'
  | 'routeId'
  | 'currency'
  | 'rateUnit'
  | 'rateMinorUnits'
  | 'durationSeconds'
  | 'generationIndex'
  | 'generationCount'
  | 'totalMinorUnits'
>;

export type StudioRendererUndoTopV2 = {
  entryId: string;
  label: string;
  sourceRevision: number;
};

export type StudioRendererProjectV2 = Omit<
  StudioProjectV2,
  'jobs' | 'spendAuthorizations' | 'frameExtractions' | 'undoHistory'
> & {
  jobs: Record<string, StudioRendererJobV2>;
};

export type StudioEditableBeat = Pick<StudioBeat, 'title' | 'action' | 'look' | 'targetSeconds'>;
export type StudioEditableShot = Pick<StudioShot, 'line' | 'narration' | 'onScreenText' | 'durationSeconds'>;
export type StudioEditableProjectSettings = Pick<
  StudioProjectV2,
  'name' | 'aspectRatio' | 'resolution' | 'targetDurationSeconds'
>;
export type StudioEditableProjectSettingsChanges = StudioNonEmptyPartial<StudioEditableProjectSettings>;
export type StudioEditableBeatChanges = StudioNonEmptyPartial<StudioEditableBeat>;
export type StudioEditableShotChanges = StudioNonEmptyPartial<StudioEditableShot>;
```

`edit_project` is the one V2 mutation for the existing human project-settings surface. Its exact
nonempty changes object may update name, aspect ratio, resolution, and project target duration under
their frozen validators. Name and target changes are non-generative; target intent never rescales a
Beat, Shot, slate, take, trim, or request. Aspect-ratio/resolution changes preserve all lineage but
mark affected generated results `generation_out_of_date` through canonical request comparison. They
refuse while a concretely bound nonterminal request would have its immutable request authority
changed; name/target-only edits do not. All four fields are part of the `project_fields` undo fragment
and after-digest. The current Director capability rejects this mixed human settings operation; the
full MCP catalog still parses it for future policy.

Reducer-created state is exact. `add_beat` and `add_binned_beat` create a Beat with
`actionRevision: 1`, `lineHistory: []`, and `shotOrder: []`; neither operation accepts or manufactures
a first Shot. Ordered later operations in the same batch may add coverage through `add_shot` or
`apply_coverage`, so a spine-only Beat is a first-class no-coverage state rather than a placeholder
Shot. A new shot starts `derived` from its owner's current `actionRevision`, with null trims,
`chainBreak: 'none'`, null seed/selected-take IDs, and empty asset/job arrays. `add_shot` and newly
created `apply_coverage` shots synthesize those values.

Coverage geometry is planning geometry. The shared pure
`studioPlanningShotBoundariesV2(beat, shots)` helper walks the active `shotOrder` and returns dense
`StudioPlanningShotBoundaryV2` rows whose cumulative start/end values use only each current Shot's
integer planning `durationSeconds`; it never reads a selected Take, probed media duration, or trim.
For a proposed complete coverage result, the same calculation uses the proposal durations. Fixed
boundary comparison and the Beat-panel boundary bar both consume this helper; pixel mapping may be
renderer-local, but boundary arithmetic may not be reimplemented there. Playback actual, export,
conditioning, and edge trims continue to use selected-Take media duration under the distinct frozen
duration rule.
For a retained dependency-free ID, `apply_coverage` writes the proposed authored
line/narration/on-screen-text/duration/chain-break values while preserving trims, pins/selections,
assets/jobs, and every operational lineage field. If the proposed line differs, it archives a
displaced detached line and marks the replacement derived from the current action revision; an
identical line preserves its existing derivation. A fixed ID preserves every field and cumulative
boundary, and every caller-supplied authored field for that fixed entry must equal the current shot
or the whole proposal is stale/refused. Editing a shot's line detaches it and clears
`derivedFromActionRevision`; accepted
`rederive_line` with an explicit replacement is the only path back to `derived`.

The pure reducer receives one main-issued `StudioMutationReducerContextV2` as an explicit third
argument. `mutationId` is a fresh safe ID for that one attempted commit and becomes the undo entry ID;
`capturedAt` is one canonical timestamp shared by every line-history entry created by the batch.
Neither value appears in native, renderer, MCP, or proposal payloads. `sourceRevision` is the one
resulting project revision (`expectedRevision + 1`), not a requirement that no later paid-lifecycle
revision exists. Single-operation undo labels are the exact operation-kind token; a multi-operation
batch uses `mutation_batch`, and UI maps those persisted tokens to i18n labels.

`createStudioLineHistoryId` deterministically returns `history_` plus lowercase SHA-256 of the UTF-8
bytes
`creative-studio/line-history/v1\0${mutationId}\0${operationIndex}\0${shotId}\0${entryIndex}` with
actual U+0000 separators and canonical nonnegative integer strings. The frozen vector
`{ mutationId: 'mutation_1', operationIndex: 2, shotId: 'shot_1', entryIndex: 0 }` produces
`history_6de52eed6dd73f96558ed4f600d761c3089082271dfc568ebfacdce5043bfc65`. Replaying the same
project/batch/context is byte-identical; a CAS retry never silently remints context or duplicates
history/undo IDs.

Every operation that would replace or remove a _different_ detached line first archives the displaced
value with its pre-operation ordinal and the shared context. This includes line-changing `edit_shot`
or `redetach_line`, `rederive_line`, `restore_line`, retained/removed `apply_coverage` entries, and
`delete_shot`; derived machine text needs no archive. `restore_line` copies the chosen history value
without consuming it and an identical replacement creates no duplicate. Oldest-first cap eviction is
part of the same draft and rolls back with any later failure. `rederive_line` must carry the reviewed
replacement line; the pure reducer never calls an LLM or falsely relabels the unchanged handwritten
text as derived.

Structural coverage operations never discard the other two authored Shot text fields. A shot with
nonempty `narration` or `onScreenText` is fixed for `apply_coverage` even when it has no media/job
dependency, and `delete_shot` refuses it. Its proposed fixed entry must repeat both fields exactly.
Only an explicit `edit_shot` authored-text change may intentionally replace either value, and that
commit remains covered by the normal exact undo fragment; re-split/delete cannot use bounded undo as
a substitute for retaining the current value.

Proposal acceptance uses a durable, exact-key `StudioProposalCommitAttributionV2` sidecar—not the
existing process-local project-commit observer. Under the project queue, main evaluates the reducer
once, serializes the exact before and candidate project bytes, and writes/fsyncs the attribution in a
proposal-commit directory before replacing the project. `beforeProjectSha256` and
`afterProjectSha256` are lowercase SHA-256 over those exact serialized manifest bytes;
`appliedRevision === baseRevision + 1`, created-ID arrays equal the reducer result, and `decidedAt`
is the timestamp later copied into the accepted decision. Main then commits exactly the candidate
bytes, publishes the accepted decision, and only afterward quarantines the attribution and releases
the matching slot, with directory fsync at every rename boundary.

Restart sandwiches attribution, proposal, slot, decision, project identity, and directory generation.
If the project revision/digest equals the exact after facts, it repairs the accepted decision without
calling the reducer or notifying twice. If the project still equals the exact before facts and no
decision exists, it removes the uncommitted attribution and returns the unchanged pending proposal to
normal review. An already matching accepted decision permits cleanup only. Any other revision,
digest, replacement, created-ID, timestamp, or decision mismatch is loud, preserves every byte, and
grants no cleanup/reapply authority. Rejected and expired proposals never create an attribution.

An attribution is also a persistent per-project live-write fence, not a restart-only repair hint.
Every V2 project load/status, authoring mutation, paid confirm, lifecycle/recovery write, delete, and
project-byte publication enters the same project queue and resolves any attribution before reading
renderer-visible state, advancing revision, or deleting/replacing bytes. Exact-after repair
must durably publish the accepted decision (and finish safe cleanup) before later work proceeds;
exact-before cleanup may return the proposal to pending. If repair cannot complete, every later
state exposure or byte-changing operation for that project fails closed and no newer revision/delete
can make the journal irreparable. Already durable paid jobs retain their existing idempotent provider
recovery contract, but any resulting project write must pass this fence; the attribution grants no
new provider authority. No process-local flag is part of the fence.

**`StudioBinItem` is reference-only and has exactly three kinds: `beat`, `shot`, and `take`.** Every
kind names an existing record. Beat and take entries may be `lifted` or `alternate`; a shot entry is
`lifted` only because there is no add-alternate-shot product path. Authored text never enters the Bin
— it goes to the owning beat's `lineHistory`.

Beat and shot IDs are immutable and unique within a project. Every beat is either in `beatOrder` or
in one beat Bin item, exactly once. Every shot is either in exactly one beat's `shotOrder` or in
exactly one shot Bin item, never both and never neither. A shot Bin item stores the `beatId` of the
shot's owner at park time; that beat must still exist, may itself be active or binned, and is the only
beat into which the shot may be restored. The reducer records this ownership edge while the shot is
active, and validation treats the persisted `beatId` as the parked shot's authoritative owner. A take
Bin alias points to a canonical take owned by exactly one shot and cannot name a current selected
take, seed, or nonterminal/waiting conditioning input. Exact terminal historical conditioning
provenance remains valid after lifting that take and makes the affected active chain stale. Every
shot-owned asset, job, receipt, frame, and take relation continues
to resolve to that shot while it is binned. Validation rejects orphaned, duplicated, cross-owned, or
active-and-binned identities.

`StudioAssetV2.mediaKind` is widened to `'image' | 'video' | 'audio'`. Audio is imported managed
media only in this plan; `bedAssetId` must resolve to a canonical project-owned audio asset.
`StudioAssetV2.shotId` is null only for project-owned imported Brief references and imported bed audio.
An active Brief reference is a canonical image import with the existing
paired cast/Look classification. A generation request freezes its safe asset ID and SHA-256 digest by
value; while a nonterminal authorized job needs it, the live canonical import and exact managed bytes
must still resolve and detach is refused. After every referencing job is terminal, detach may delete
the record/bytes because historical plans retain identity and digest without claiming the media still
exists. Bed audio is an unclassified canonical import. Generated image/video takes, posters, and
conditioning frames remain shot-owned. A human-imported seed still is also a shot-owned canonical
image Take in the V2 `imports` collection, with no Brief cast/Look classification and no job,
authorization, or receipt. Its safe ID is appended once to that shot's asset membership in the same
crash-safe media/project commit. With no explicit `seedStillId` pin it participates in the same
latest-eligible-image default as a generated still and therefore closes `seed_pending`. Image seed stills and
video takes remain distinct by media kind even though both are shot-owned. Video generation jobs
persist `purpose: 'video_take'`, `authorizationId`, `authorizationItemId`, `generationIndex`, their
immutable authorization-time request template, and a nullable exact concrete provider request;
image generation jobs persist `purpose: 'seed_still'` with the same authorization link.
Conditioning-frame extraction is represented by `StudioFrameExtraction`, not by a provider job
status.

Bed import is a distinct main-picker transaction. `import_bed_audio` accepts only
`StudioImportBedAudioRequestV2`; the renderer supplies no path, filename, MIME, asset ID, duration,
or managed reference. Both local import providers return only
`StudioImportManagedMediaResultV2`: cancel returns the exact no-data branch; success returns the safe
created asset ID and committed `expectedRevision + 1`, never a path or managed reference. After the
user picks a file, main opens/probes it under the media-store safety
rules, requires one supported decoded audio stream with finite exact duration, admits the bytes
against the existing managed-byte cap, and stages one unclassified project-owned canonical audio
record in `imports`. Under the project queue it rechecks `expectedRevision`, media identity, bytes,
and capacity, adds that record to the in-memory draft, and applies exactly one `set_bed` reducer
operation with a main-issued mutation context before committing the asset, bed selection, and normal
free-authoring undo entry in one project revision. Undo restores the prior bed ID/null but deliberately
retains the newly imported unselected asset and managed bytes for later reuse or explicit detach.
Cancel, unsupported/multi-stream media, unsafe/replaced input, byte-cap failure, stale CAS, and close
publish no asset and do not change the existing bed. Replacing a bed retains the prior import as an
unselected managed asset; it is deleted only through exact human-native `detach_bed_audio` after it
is no longer selected or referenced. That provider accepts only
`StudioDetachBedAudioRequestV2`, returns only `StudioDetachManagedMediaResultV2`, and rejects current
bed, wrong/classified/cross-project media, a live export retention claim, unsafe/replaced bytes,
stale CAS, or close before mutation. It uses the existing crash-safe media detach journal: persist the
exact validated asset/managed identity and expected revision, commit one revision without the asset,
then quarantine/fsync the exact now-unreferenced bytes and clear the journal. Restart removes an
uncommitted intent while preserving a still-referenced asset, or completes quarantine only when the
committed project no longer contains that exact record; mismatches fail loud and preserve bytes.
Import/detach/export/project-delete share the Task-13 lock order. No resolver, adapter, generation
job, authorization, receipt, or provider is reachable from either audio media action.

V1 has no stitched-film output in this plan, so V2 has no project-output `StudioAssetV2` producer.
Exports are separate `StudioExportArtifactV2` sidecar records in the dedicated `exports` collection,
never asset records and never members of `StudioProjectV2.assets`. Export retention acts only on
those exact records; it cannot infer eviction authority from a null `shotId`, a media collection, or
an output-looking file name.

An absent schema-2 export catalog is the logical, non-writing initial state
`{ schemaVersion: 2, projectId, revision: 1, artifacts: [] }`; list returns that value without mkdir
or write. Every successful artifact publication, retention change, or repair that replaces the
catalog increments its prior safe revision exactly once, including the first publication (to 2).
List, copy, reveal, quarantine/reap that does not change catalog membership, and every refusal are
revision-neutral. `Number.MAX_SAFE_INTEGER` overflow refuses before artifact/catalog mutation. The
catalog is ordered by `(createdAt, id)`, has at most five records per shape, and every artifact's
project/source revision and managed identity are exact. Artifact IDs and
`managedExport.fileName` values are each unique across the whole catalog and form a one-to-one
mapping; two active artifacts may not resolve to the same opened directory identity. Publication
requires `sourceRevision === expectedRevision ===` the current project revision. Thereafter a
retained artifact remains valid through later edits when its source revision is a safe integer in
`1..currentProjectRevision`; zero or a future revision is invalid. Restart derives the same
logical/physical catalog revision rather than renumbering it.

Each export is a self-contained managed artifact directory named by the safe
`StudioManagedExportRefV2.fileName`; renderer/API callers never supply or receive that name. Its
exact `artifact.json`, exact `manifest.json`, and payload are indexed by one exact per-project `exports-v2.json`
`StudioExportCatalogV2`. `editor_folder` requires `payloadKind: 'directory'`; `still` and `script`
require `'file'`. A file shape has exactly one payload file. A directory shape has 1–
`STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT` regular files at no more than
`STUDIO_MAX_EXPORT_DIRECTORY_DEPTH` safe relative segments. Absolute paths, empty/`.`/`..` segments,
backslashes, controls, symlinks, special files, duplicate paths, duplicate opened identities, and
post-open replacement are storage failures.

Every payload regular file must have `nlink === 1`. Across the whole active catalog, every opened
artifact-root directory identity and every opened payload-file `(dev, ino)` identity is globally
disjoint; validation, repair, copy, reveal, and retention build and re-prove that catalog-wide set.
Thus two different artifact directories cannot share a payload inode through a hard link, nor can an
artifact alias bytes outside its own managed directory.

`manifest.json` contains the canonical dense array of exact-key
`{ relativePath, byteSize, sha256 }` records sorted by UTF-8 relative-path bytes, serialized as the
exact UTF-8 bytes of `JSON.stringify(manifest)` with no trailing newline. Each file is opened
no-follow and inode/metadata-reproved while hashing; every manifest path bijects to one payload
regular file and no payload file is omitted. `manifestSha256` is lowercase SHA-256 over those exact
`manifest.json` bytes. `fileCount` equals the array length and `byteSize` is its checked safe-integer
sum. Both cover payload files only; `artifact.json`, `manifest.json`, the catalog, and staging
metadata are excluded from those two content facts. The existing `projectMaxBytes` admission check
includes staged payload, `manifest.json`, artifact record, and catalog bytes and refuses before
active publication. Restart exact-key parses `manifest.json`, re-proves its digest and payload
bijection, and rejects substitution, omission, aliases, or extra payload bytes.

Publish is recoverable and export-only: write and fsync a unique quarantine artifact plus its exact
record, atomically rename/fsync it into the active exports directory, then atomically replace/fsync
the exact catalog containing the new record and at most the newest
`STUDIO_MAX_EXPORTS_PER_SHAPE` per shape ordered by `(createdAt, id)`. Only after that catalog commit
may unreferenced/evicted export directories move to recoverable quarantine and later be reaped.
Restart re-proves the catalog and every referenced artifact; an unreferenced fully published export
is quarantined, a catalog reference to missing/replaced bytes fails closed, and an interrupted
post-catalog eviction is completed. Repair never adopts hostile bytes and never scans, renames, or
deletes `assets`, `imports`, `thumbnails`, or `conditioningFrames`; V1 directories and sidecars are
unsupported no-touch data.

Every V2 export create, catalog replacement, explicit artifact command, repair, and project deletion
uses one lock order: acquire the existing per-project mutation/delete queue, then the per-project
export-catalog lock; no export code acquires them in reverse. Payload rendering may stage only into an
unpublished quarantine before those locks, but immediately before artifact/catalog publication main
re-proves the same schema-2 project and exact `sourceRevision`, recomputes current managed-byte
admission including concurrent media/export changes, and rereads/increments the exact catalog
revision. Concurrent exports therefore serialize and cannot lose an entry or exceed retention/bytes.
Project delete wins by preventing publication and quarantining staged output, or export wins with a
fully catalogued artifact that deletion then removes through the same authority. Artifact copy/reveal
resolves `StudioExportArtifactRequestV2` against the exact current catalog revision and ID;
no caller-provided managed name participates.

The public V2 provider set is exact: `create_export`, `list_exports`, `copy_export`, and
`reveal_export`. Create accepts only `StudioCreateExportRequestV2`; list accepts only
`StudioListExportsRequestV2`; copy/reveal accept only `StudioExportArtifactRequestV2`. Destination
selection for copy is a main-owned system picker and never a renderer path. A `still` request names
one active shot and main derives that revision's canonical Board cover (selected video's canonical
poster, otherwise its current seed still); missing/ambiguous cover refuses before staging. Editor
folder and script derive the complete active film at `expectedRevision`. Create also requires the
exact current `expectedCatalogRevision`; concurrent/double-click creation cannot silently add two
artifacts. Create returns the refreshed
sanitized catalog, list returns `StudioRendererExportCatalogV2`, and copy/reveal do not mutate project
or catalog. Copy returns only `StudioCopyExportResultV2`: system-picker cancellation is the exact
`cancelled` branch and a completed copy is `copied`, with no destination/path/name fact in either
branch. Reveal returns only `StudioRevealExportResultV2`; a successful system reveal is `revealed`
and no managed path/name crosses. No V2 provider reuses schema-1 `choose-and-export-assets` or its
external-folder payload.

An `editor_folder` is a non-stitched, self-describing edit package. Its payload contains exact
`timeline.json` bytes equal to UTF-8 `JSON.stringify(StudioEditorFolderTimelineV2)` with no trailing
newline, selected canonical video primaries at deterministic `media/shot-001.<ext>` paths in active
`beatOrder`/`shotOrder`, one shared deterministic lossless black `media/slate.png` only when at least
one no-coverage beat needs it, and an optional copied `media/bed.<ext>`. Binned beats, binned shots,
unselected takes, posters, seed stills, provider data, spend data, and managed source paths are absent.
An active beat with nonempty `shotOrder` is covered: every active shot in it must resolve one
selected canonical video primary with re-proved managed bytes or export refuses before staging,
including the zero-selected and partially selected cases. Only a beat whose `shotOrder` is empty is
no-coverage and emits one slate entry of its exact non-null target duration; a null target is
`duration_pending` and refuses the whole export. The slate image is generated locally once at the
project resolution, contains no text or remote content, and is reused by every slate entry.

Timeline beats and entries preserve active film order. Starts are checked cumulative sums. A shot
entry's `sourceInSeconds` is its exact trim-in, `sourceOutSeconds` is canonical source duration minus
trim-out, and `durationSeconds === sourceOutSeconds - sourceInSeconds`; its chain break is frozen by
value. A slate entry contributes its target duration. Each beat duration equals its entry sum and the
film duration equals the beat sum, with safe finite arithmetic and no overlap, gap, or binned entry.
Every distinct entry `relativePath` resolves one corresponding manifest payload file; shot and bed
paths are unique, while multiple slate entries alone may intentionally share the one exact
`media/slate.png` payload.

When `bedAssetId` is non-null, its canonical audio import and managed bytes must resolve and its
source duration must be at least the film duration. The timeline freezes source in `0`, source out
equal to film duration, fade end equal to film duration, and fade start
`max(0, filmDuration - STUDIO_BED_FADE_OUT_SECONDS)`; a longer bed is trimmed and faded, while a
shorter bed refuses. At maximum capacity the payload has 96 shot media files plus `timeline.json`,
one slate, and one bed—99 files, below the frozen 104-file admission cap. `still` copies only the
derived canonical Board cover. `script` emits canonical UTF-8/LF `script.md` from the Brief and
active Beat/Shot authored text, with no Bin, provider, spend, or managed-path data.

The widening is **V2-only**. Schema 1 keeps its existing `StudioMediaKind`, managed-asset type, and
collection set and must continue to reject `audio` and `conditioningFrames`. V2 defines its own
media kind, managed reference, and collection set as shown above; sharing the widened set with the
V1 store validator would violate the no-touch boundary.

Persisted output membership and output role are separate. `outputAssetIds` retains every committed
job output. `outputAssetIdsByRole.primary` identifies the canonical take or seed still and
`outputAssetIdsByRole.poster` identifies optional representative artwork; each non-null role ID must
also occur exactly once in `outputAssetIds`, the two roles must be distinct, and each must resolve to
the correct owned collection/media kind. A succeeded job has one primary; every other status has a
null primary and poster. Additional output IDs are allowed and do not change either role.
`canonicalVideoPosterV2` reads the role map, never an array position. A seed-still request plan has a
resolved snapshot with null conditioning input and at most one explicitly selected canonical
project-owned active image import frozen as `{ assetId, sha256 }`;
a directly runnable video-take resolved plan has an exact non-null concrete conditioning input and null
`referenceInput`. Both freeze the exact nonempty composed prompt, aspect ratio, resolution, and the
shot's numeric 4–15-second provider request duration, bounded by
`STUDIO_MAX_GENERATION_PROMPT_LENGTH`. `authorizationItemId` resolves one exact item in the named
authorization; the job's shot, purpose, provider route, immutable request plan, generation index,
and idempotency key must equal that item and its exact indexed key. The authorization carries exactly
one main-only provider binding per item, and every sibling job's concrete `provider` equals it by
value; pure schema validation never resolves the opaque route ID. A resolved plan has an equal
non-null `requestSnapshot`; an `after_take_selection` plan starts with a null snapshot and
`waiting_for_conditioning`, then binds one concrete snapshot and moves to `queued_local` together.
No provider path may run while the snapshot is null. `spendReceipt` is written once the provider has confirmed
billable generation completion, before fallible local download/persistence. The receipt itself is the
durable billable-completion marker. It therefore remains present when post-completion validation or
persistence ends in `failed/no_output` or `failed/download_failed`; in V2, `no_output` means the
provider reported success but yielded no acceptable canonical primary (including missing-role and
wrong-media cases), never a precompletion provider failure. A crash-recovery `running` job may also
carry the receipt only while local output work remains. It stays null for refusal,
provider-declared/pre-dispatch failure, cancellation before completion, or submission uncertainty.
The receipt's
`authorizationId`, `itemId`, job ID, purpose, route, generation index/count, rate, duration, currency,
and total must match the job and authorization by value.

Project route selection persists only stable opaque choice IDs in `imageRouteId` and
`videoRouteId`. The ID is the existing deterministic main-issued choice identity; provider,
adapter, model, credentials, and rate bindings stay main-only. UI/native choice payloads are resolved
and revalidated before the pure reducer receives this persisted shape.

The Gate-1 renderer projection is intentionally narrower than the durable project. It never carries
raw `spendAuthorizations`, undo before-fragments, provider credentials, idempotency keys, remote job
IDs, cancellation authority, authorization IDs/item IDs, or generation-request authority. A completed
job may carry only the explicit `StudioRendererSpendReceiptV2` cost projection; authorization,
item, and job correlation IDs never cross with it. Task 8 builds the workspace's richer sanitized
view from explicit service projections rather than widening this raw renderer project type.
Main separately returns the current undo top only inside `StudioRendererWorkspaceStatusV2`; patches,
before-fragments, digests, abandoned history, and paid authority never cross. It is re-derived after
every load/commit. Execution still sends the top `entryId` plus expected project revision and
re-proves the authoritative journal/digests inside the project queue.

The service/cache uses full main-only `StudioPreparedSubmissionOptionsV2`; the native/bridge prepare
result is only `StudioRendererPreparedSubmissionOptionsV2`, built by one main projector. Its rows
contain sanitized route display identity and already checked per-generation/requested totals, but no
item ID, route ID, rate-card digest, request plan/snapshot, prompt, reference digest, conditioning
asset/frame, origin handoff, provider binding, or authorization correlation. Confirm uses the opaque
quote ID and re-derives from the internal cache; renderer data is never round-tripped as authority.
Its success result is exactly `StudioConfirmSubmissionResultV2`; it exposes only the committed
project ID/revision and the renderer refetches sanitized project/workspace projections. No project,
job, authorization/item ID, internal quote, receipt, provider, or request authority is returned.
Each safe option also carries the exact main-derived `StudioRendererBudgetVerdictV2` for that quote's
project revision, computed by the same Task-4 policy predicate used by confirm. The verdict exposes
only its stable kind and, when a policy exists, its canonical currency/cap for display; renderer never
recomputes it from project state. A stale projection cannot authorize—confirm still re-reads policy
and fails closed.
Likewise the durable handoff receipt remains main-only: list/watch/cards expose only
`StudioRendererReferenceGenerationHandoffV2`, never its confirmed `authorizationId`. Export listings
use only `StudioRendererExportCatalogV2`; managed export names and paths remain main-only, and copy/
open commands accept artifact ID plus project/revision authority rather than a path.

The four cache-specific service errors are exactly `StudioSubmissionCacheErrorCodeV2` and retain
their keys through native/bridge mapping. `quote_not_found` means the scoped session is absent,
expired, evicted, or lost on restart; `quote_in_use` means that exact session is already claimed by
one confirmer; `quote_cache_full` means non-evictable claims leave no bounded admission room; and
`quote_too_large` means the one exact prepared session exceeds its per-session byte cap. None is a
spend, project, or provider failure, and no layer aliases one to another.

Cascade progress crosses only as `StudioCascadeProgressV2`: dependent/upstream shot IDs, canonical
eligible primary asset IDs, and one safe waiting reason. It contains no authorization, item,
idempotency, provider, receipt, or request-plan identity. Main derives entries in active film order,
deduplicates assets, and caps eligible primaries by the upstream item's frozen generation count
(1–4). Reason precedence is exact at item scope: `cancelled` only when every generation sibling is
cancelled; otherwise `dependency_failed` wins when any remaining unbound sibling was terminalized by
upstream failure; otherwise an unbound item reports `upstream_running`, then `choose_seed` or
`choose_take` once a selectable primary exists, then `conditioning_frame` after human selection while
the required frame is pending/extracting or `conditioning_failed` when its exact extraction is
failed. A bound/runnable item has no waiting entry. Cancelled siblings stay
cancelled when the remaining siblings bind or dependency-fail. Dependency-failed and all-cancelled
entries have no eligible assets. This is the durable `PART DONE`/restart seam; UI never infers it
from raw jobs. For each active `(dependentShotId, 'video_take')`, only the latest item in persisted
authorization/item order is eligible to project; older cancelled/dependency-failed history is
suppressed, and a latest bound, runnable, failed-after-attempt, or succeeded item emits no waiting
row. `canRetryConditioningFrame` is true only for that row's exact current failed extraction.
`canCancelWaiting` is true only when main can derive one current unbound item and every non-cancelled
sibling is still unattempted and cancellable; both flags are false for every other reason/state.

The exact read-only human-native provider `get_workspace_status` accepts only
`StudioGetWorkspaceStatusRequestV2` and returns only `StudioRendererWorkspaceStatusV2` for the
current project revision. It is the sole renderer transport for the undo top, authorized cascade
progress, dirty-shot causes, and Beat/Shot/Take park/restore eligibility. Dirty rows are unique active
shots in film order, capped at `STUDIO_MAX_DIRTY_SHOTS_REPORTED`; causes are dense, unique, and
ordered `continuity_stale` then `generation_out_of_date`. Park-eligibility rows cover active park
targets followed by Bin-order restore targets. `allowed` is true exactly when `blockers` is empty;
blockers are deduplicated in contained-shot film order and then the frozen code order, with a null
`shotId` only for an aggregate Beat-level capacity cause. `assetId` is non-null only for a Take
subject and names the canonical owner-checked Take. The exact identity allowlist is project/Beat/Shot
subject IDs, those Take-subject asset IDs, `undoTop.entryId`, and the bounded canonical
`eligiblePrimaryAssetIds` inside
cascade rows so the human can select one reviewed Take. No other Take identity, frame/job/item/
authorization/provider/request/receipt/managed-file identity, undo patch/digest/before-fragment, or
mutation payload crosses. Every read first passes the shared proposal-attribution fence. On the clean
path projection is revision-consistent, by value, and performs zero project/sidecar mutation, retry,
resolver, adapter, or provider work. An exact-after interrupted proposal commit may perform only the
frozen accepted-decision publication and attribution/slot cleanup before taking the snapshot; it may
not advance project revision or touch paid/provider state. Failed repair returns no status.

Authorized barrier rows and post-cancellation active-chain failures are separate projections. The
exact read-only human-native provider `get_chain_status` accepts only
`StudioGetChainStatusRequestV2` and returns only `StudioRendererChainStatusV2`. Main emits at most one
`StudioRendererChainConditioningFailureV2` per active dependent shot, in film order, only when the
current predecessor, selected canonical primary, and played endpoint resolve the exact failed
deterministic extraction and no newer nonterminal authorization item owns that dependency. It emits
no row after the input changes or the same extraction becomes pending, extracting, or ready. The
projection never exposes a frame, take, job, item, authorization, provider, or managed-file ID;
retry still accepts only the dependent shot and re-derives authority under the project queue. This
read uses the same attribution-fence exception: clean reads mutate nothing; exact proposal sidecar
repair may finish first, and failed repair exposes no chain snapshot.

Every quote and job carries the same immutable **authorization-time request plan**. A `resolved` plan
contains the complete concrete provider snapshot, including the exact composed prompt and canonical
reference `{ assetId, sha256 }` needed to reproduce seed generation after restart, not merely its
price. A same-authorization cascade item instead carries an `after_take_selection` plan with the
complete non-conditioning template and exactly one symbolic `authorized_seed` or
`authorized_predecessor` dependency on an earlier item in the same ordered authorization.
Dependencies form a forward, beat-segment-scoped acyclic graph; they never name a generation index or
auto-select an output. A symbolic predecessor freezes no endpoint because its future selected
primary's media-exact duration is unknown; the one-time human binding derives the concrete endpoint
from that selected Take and the then-current tail trim under the project queue. Confirm therefore
persists every priced job before the first provider call
while its concrete `requestSnapshot` is null only in `waiting_for_conditioning` for that symbolic
human choice.

Request composition has one pure authority:
`schema2/generation/generationRequest.ts`. It exports canonical non-conditioning template composition, resolved
plan construction, current-request comparison, and one-time concrete materialization from a validated
human binding. Chain freshness, quote derivation/re-derivation, authorization validation, lifecycle
binding, and dispatch all import it; none reconstructs prompts, references, Match To contribution,
aspect/resolution/duration, or conditioning equality independently. The module imports no filesystem,
store, resolver, adapter, provider, IPC, or renderer code.

The main-only prepare request carries the user's ordered base/cascade `(shotId, purpose,
generationCount)` choices and a nullable active Brief `referenceAssetId` only for each seed item.
Main derives the eligible item graph itself and rejects missing, extra, reordered, wrong-purpose, or
wrong-reference choices; video choices require null reference IDs. It resolves each seed reference to
an active classified canonical import and freezes `{ assetId, sha256 }` into the request plan.
Prepare returns two independently cached quote options when a cascade exists: `baseOnly` has an empty
`cascadeItems`, while `withCascade` repeats the byte-equal base items plus the exact downstream graph.
They have distinct quote IDs and totals. Confirming one quote ID authorizes only that option; there is
no renderer-supplied include-cascade flag and confirm sends only the routing identity `projectId`,
the selected `quoteId`, and `expectedRevision`—never choices, graph, provider, rate, or cascade flags.

`originReferenceHandoffId` is null for an ordinary gate. A non-null value names one exact durable
accepted `generation_gate` decision with no handoff receipt and authorizes only that seed review: the
decision's ordered `shotIds` must byte-equal the ordered base-choice shot IDs, there is exactly one
`seed_still` base choice per ID, and `cascadeChoices` is empty. Subsets, supersets, reordering,
duplicates, `video_take`, and cascade work refuse; broader video/cascade review starts an ordinary
origin-null gate. The value is frozen through quote core and authorization. A mere prepare/open
creates no receipt, so restart/cache loss safely recreates the card. Explicit dismiss writes one
`dismissed` receipt. Successful confirm publishes one `confirmed` receipt linked to the durable
authorization; if that sidecar write is interrupted after project commit, restart repairs it from
the authorization's frozen origin ID rather than reopening or resubmitting. An imported-reference
outcome instead selects an already-imported, active, classified Brief image and freezes that
asset/current revision directly in its decision; it has no generation handoff. New media must be
imported through the ordinary human media action before this decision, so reference-request
acceptance never owns an ambiguous asset-file commit.

Handoff identity is project-scoped and one-to-one. Every `generation_gate` decision in one project
has a unique `handoffId`; a receipt repeats both that exact handoff ID and its decision's `requestId`,
and no second decision/receipt may reuse either relation. A non-null authorization origin resolves
exactly one such decision and at most one authorization may name it; its eventual confirmed receipt
names that same authorization. The same opaque handoff ID in another project is isolated and never
resolves cross-project. Collision, duplicate directory entry, replacement, or ambiguous decision/
receipt/origin input refuses before prepare, resolver access, project mutation, or sidecar cleanup.

Dismiss is the exact Task-8 human-native provider `dismiss_reference_generation_handoff`. It accepts
only `StudioDismissReferenceGenerationHandoffRequestV2`, then under the same project-queue/sidecar
authority as confirm re-proves expected project revision, the exact accepted unreceipted handoff, and
decision/receipt generations before publishing `dismissed`. Unknown/replaced/already-receipted,
stale, close, or confirm-winning states preserve bytes and fail closed. Retrying the exact completed
dismiss is idempotent and returns the original receipt time as the exact
`StudioDismissReferenceGenerationHandoffResultV2`; it never returns the durable receipt or an
authorization ID, overwrites `confirmed`, mutates the project, prepares a quote, or touches
resolver/adapter/provider code.

Quote re-derivation is deterministic. The cache stores the immutable prepared quote, its canonical
prepare choices, and main-only provider bindings resolved for every item. Confirm looks up that exact
ID, checks the cached `expiresAt` against the current clock, recomputes only
`StudioSubmissionQuoteCore`, re-resolves the current provider bindings, and byte-compares both with
the cache. It checks the clock again immediately before the durable write; resolver/rate/config delay
cannot carry confirmation across exact expiry. It never regenerates the quote ID, moves or extends expiry, or trusts cached
project/rate/request/provider content. On success it persists the original full quote by value with
`confirmedAt` and the exact provider bindings, then copies each item's binding to every job for that
item. Restart intentionally loses unconfirmed cache entries.

A prepared **session** is the exact immutable tuple of its prepare request, sibling quote options,
and provider bindings; both quote IDs address and consume that one session. Main stamps one
`preparedAt`, gives both options the same `expiresAt = preparedAt +
STUDIO_PREPARED_QUOTE_TTL_SECONDS`, and admits neither caller-supplied timestamp nor TTL. Cache byte
size is `Buffer.byteLength(JSON.stringify(exactSessionTuple), 'utf8')` over the already constructed
exact-key tuple; the cached value is parsed from those same serialized bytes so accounting and stored
content cannot diverge, then deeply frozen and never returned by reference. A session larger than
`STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES` refuses
without caching. Before each prepare or confirm, main removes expired sessions. Before inserting a
new session, it evicts only idle unconfirmed sessions oldest-first by
`(preparedAt, projectId, baseOnly.id)` until
the per-project count/byte limits and global count/byte limits would all remain satisfied, then inserts
the new session. Eviction never authorizes, mutates, dispatches, or consumes a reference handoff; a
later confirm of an expired, evicted, or unknown ID returns `quote_not_found` and requires prepare
again. Restart begins with an empty cache. These count, byte, and TTL limits are main-memory admission
controls, not spend policy and not renderer-tunable.

Confirm atomically claims the exact session under one cache mutex before any resolver await or
project-queue acquisition. A claimed session and its bytes remain in every per-project/global count,
are non-evictable, keep their original expiry, and may have only one confirming caller; a sibling or
duplicate confirm receives `quote_in_use`. Prepare may reclaim idle entries but returns
`quote_cache_full` if the claimed set leaves insufficient count/bytes after all idle eviction. The
confirm holds the same deeply frozen cached object—never an uncounted clone—through re-derivation and
the durable transaction. Success consumes the whole session; exact expiry removes it; a precommit
refusal/throw releases the claim without extending TTL; close disposes the cache. Cache-mutex →
project-queue is the only lock order and no project-queued callback enters the cache. Thus delayed
resolver/config calls cannot be evicted into untracked live objects or multiplied beyond the frozen
session/byte caps.

Cache lookup is scoped by the request's exact `projectId`; the selected cached quote core must carry
that same project ID. Quote IDs are unique within a project cache, sibling IDs must differ, and an
attempted same-project collision refuses admission without replacing either session. The same opaque
ID in another project cannot authorize, evict, consume, or reveal this project's session.

After an upstream item completes, the human must select or pin the canonical `primary` output of one
of that exact item's succeeded generation jobs. Posters and unroled extra outputs are never eligible.
Under the project queue, lifecycle code proves the role/output/job/item/authorization relation,
derives or verifies the exact trim-aware frame, and binds each direct dependent job once by replacing
its null `requestSnapshot` with the concrete snapshot implied by its immutable template. One
selection binds every non-cancelled waiting generation job of a directly dependent item atomically to
the same concrete snapshot; cancelled waiting siblings remain null, and no commit may leave a mixed
waiting/bound or mixed-snapshot item. Binding is paid-lifecycle bookkeeping, not a new authorization,
and is crash-recoverable from the persisted
selection plus authorization graph. It occurs before dispatch, never after any provider attempt, and
can neither choose an output nor alter prompt, route, rate, duration, count, or idempotency. Selecting
an unrelated or older take leaves the dependent job blocked. Once a nonterminal job is concretely
bound, free edits that would change its selected seed/predecessor/take/frame input are refused; after
it is terminal, later edits merely make the historical result stale. This is the one-confirm,
human-selected cascade required by the approved direction and is what makes mid-chain restart
truthful without a second charge or an automatic motion judgment.

A failed required conditioning-frame extraction does not silently fail or abandon the already
authorized dependent jobs. They remain unbound `waiting_for_conditioning`, and the safe progress
reason is `conditioning_failed`. The explicit main-owned `retryConditioningFrameV2` action accepts
one exact `StudioCascadeBarrierActionRequestV2`, then under the project queue uses its dependent shot
ID to derive and re-prove the one exact current-active-chain failed extraction. While an authorization
item is nonterminal, that record must be the one required by its still-waiting dependency; after the
item is cancelled/terminal, retry may instead derive it from the active predecessor, current selected
primary, and exact played endpoint only when no newer nonterminal item exists. It rejects zero/
multiple, binned, stale-input, or merely historical failed candidates and atomically resets the same ID from
`failed` to `pending` with null frame/error. It creates no quote, authorization, job, receipt,
provider call, or charge; restart resumes the pending extraction. The author may instead select a
different eligible primary, which schedules that primary/endpoint's different deterministic
extraction ID. No automatic retry loop exists.

`cancelWaitingCascadeV2` accepts the same exact `StudioCascadeBarrierActionRequestV2` as retry. Under
the project queue, main derives the sole latest current unbound item for the active dependent shot and
requires every non-cancelled sibling to remain `waiting_for_conditioning` with null snapshot,
provider-attempt identity, receipt, and output. It atomically marks all such siblings cancelled,
retains the immutable authorization/jobs, and applies the existing transitive `dependency_failed`
transition to later unbound dependents. Zero/multiple, bound, attempted, mixed, stale-revision, or
receipt-bearing candidates refuse without mutation or provider access. It never accepts a job/item/
authorization ID from renderer, never calls cancel on a provider that was not attempted, and never
creates a quote, receipt, refund, or charge. A later retry of generation requires a fresh reviewed
prepare/confirm after the current conditioning frame is ready (or an alternate eligible primary is
selected); cancellation alone never makes a failed frame quoteable.

If every job for an upstream item becomes terminal without one selectable succeeded primary output,
main atomically marks every still-unbound transitive dependent `failed` with
`dependency_failed`, a null snapshot, null receipt, null `providerJobId`/`remoteStartedAt`, no
progress/attempt state, and no output. The configured provider binding remains frozen from the
matching persisted authorization `providerBindings` entry on every job. The
authorization and failed graph remain immutable history. A fresh quote may restart at that failed
frontier, but it creates new jobs/keys only under a new confirmation and can never rebind the old
dependents across authorizations. Partial upstream success keeps dependents waiting for the human;
mere delay or lack of selection is not failure.

Frame-extraction identity is exact. `createStudioFrameExtractionId` returns `frame_` plus lowercase
SHA-256 hex of the UTF-8 bytes below, where each `\0` denotes one actual U+0000 byte rather than the
two printable characters backslash and zero:
`creative-studio/frame-extraction/v1\0${shotId}\0${takeAssetId}\0${Number.prototype.toString.call(endpointSeconds)}`.
Inputs must already be safe IDs and a finite positive, non-negative-zero endpoint no greater than
`Number.MAX_SAFE_INTEGER`. The frozen vector `{ shotId: 'shot_1', takeAssetId: 'take_1', endpointSeconds: 8 }`
produces `frame_0a087cffc07fb3b12302860164c56b5a160c509171b8ebbb19b3bf7c8876c0d1`. Scheduling,
validation, recovery, and tests import the same helper; no second hashing implementation is allowed.

Quoted-item identity is equally deterministic. `createStudioQuotedGenerationId` returns `item_` plus
lowercase SHA-256 hex of the UTF-8 bytes
`creative-studio/quoted-generation/v1\0${projectId}\0${projectRevision}\0${shotId}\0${purpose}`,
again using actual U+0000 separators and `Number.prototype.toString.call(projectRevision)`. Inputs
must be safe IDs, a valid revision, and one frozen purpose. The vector
`{ projectId: 'project_1', projectRevision: 7, shotId: 'shot_1', purpose: 'video_take' }` produces
`item_bf91f6360d990f6083c2e7c754fcd431a657e84f4f20220a9305b4104a5fcbfe`. Because one quote cannot
repeat `(shotId,purpose)`, IDs are unique inside the option; byte-equal base items deliberately keep
the same IDs in the sibling base-only/combined options. A second prepare at the same project revision
may reproduce those item IDs, but revision CAS plus sibling-cache consumption permits at most one
option to become durable. Prepare, confirm re-derivation, structural validation, and tests import one
shared helper; cached item IDs are never trusted or regenerated randomly.

Structural validation freezes the remaining scalar bounds needed before pricing and undo behavior
exist: every added timestamp uses the existing canonical timestamp predicate; project/source
revisions are safe integers at least one; currency is exactly three uppercase ASCII letters; digests
are 64 lowercase hex characters; minor-unit values are safe nonnegative integers; rates are positive
safe integers; generation counts are 1–4 and generation indices are zero-based and less than their
count. Quote arrays are dense, item IDs are unique across base and cascade, each shot has at most one
item per purpose, and
`lowerMinorUnits <= upperMinorUnits`; seed receipts use generation pricing with null billable duration
and null conditioning input even though the provider request retains the shot duration; video
receipts use second pricing with the same integer 4–15 duration and non-null input. An authorization's
idempotency entries are the exact complete set of `(itemId, generationIndex)` pairs implied by every
quoted item's `0..generationCount-1` range, with unique safe keys. Reject any unsafe intermediate
addition or multiplication. Task 4 adds rate-card lookup, recomputed totals, quote equality, and
current-project comparisons without changing the persisted shape.

Every persisted authorization names its containing project exactly. Its `projectRevision` is the
pre-confirm snapshot revision and is strictly less than the containing project's current revision;
its `confirmedAt` is strictly earlier than its canonical `expiresAt`, because confirmation at exact
expiry is refused. Each item ID recomputes from that project/revision/shot/purpose. Independently of
the current rate card, project validation recomputes lower as one per-generation amount for every
item and upper as each per-generation amount times its frozen generation count, using checked safe
integer arithmetic; stored totals that differ by one are invalid. A later policy/rate-card change does
not rewrite historical authorization values.

The combined ordered `baseItems` plus `cascadeItems` set contains 1–
`STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST` unique active shot IDs and 1–
`STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST` unique item IDs. A shot may contribute one seed item, one
video item, or both; two items are valid only as distinct purposes, and a video item depending on a
same-shot seed uses `authorized_seed`. Its exact durable authorization/job set is therefore bounded
by `STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST *
STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION`; the two arrays are not separate allowances.
Every deferred dependency names an earlier item in the combined order, stays inside one beat chain
segment, matches the required upstream purpose/shot, and participates in no cycle. A `resolved` plan
produces `queued_local` jobs with equal non-null snapshots at confirm. An `after_take_selection` plan
produces `waiting_for_conditioning` jobs with null snapshots until the exact one-time binding described
above; waiting jobs retain the configured provider binding but have null
`providerJobId`/`remoteStartedAt`, no progress/attempt state, receipt, or output. The only other
null-snapshot state is
terminal `failed/dependency_failed` after the exact upstream all-failed transition or an explicitly
`cancelled` job that was stopped before binding; both retain the same
no-attempt/no-receipt/no-output facts. A resolved or already-bound job cancelled before billable
completion retains its non-null immutable snapshot and the attempt/cancellation metadata permitted by
the existing cancellation policy, but has null receipt and output; cancellation never clears or
rewrites a snapshot. Once billable completion is proven, cancellation is no longer an allowed
transition and local output recovery owns the job. Cancelling every job in an upstream item triggers
the same dependent-failure rule. All other plan/status/snapshot combinations are invalid.

All jobs for one authorization item repeat the same immutable request plan. Once that item is bound,
every non-cancelled job and every sibling cancelled after binding has the same concrete request
snapshot; generation index and idempotency key are the only request-external per-job differences. A
sibling cancelled before binding may retain null. The validator rejects mixed waiting/bound siblings,
two concrete snapshots for one item, or a partial bind after any sibling provider attempt.

`generationCount` is the exact count the quote will authorize for that item. The lower total is the
informational one-generation-per-item entry point; the upper total is the exact sum of the requested
counts and is the amount this quote authorizes. Confirm always creates the full exact
`generationCount` job/key set; it never chooses an unknown count inside the range. Choosing fewer
generations means preparing a new quote with smaller counts.

A receipt is per job/generation, not per quoted item: seed
`totalMinorUnits = rateMinorUnits`; video
`totalMinorUnits = rateMinorUnits * durationSeconds`. `generationCount` records the containing
item's reviewed count but is never multiplied into an individual receipt. Quote item totals multiply
that per-generation amount by `generationCount`, so summing receipts cannot count the item twice.

Authorization IDs are unique within the project. After confirm, every authorization item/index and
its one idempotency key correspond to exactly one durable job with the same authorization ID,
authorization item ID, generation index, and key, and every authorized job has exactly one such
entry. Authorization-entry keys are globally unique across the project, not merely within one
authorization. The paired job repeats its one entry's key by design; no job key may match any other
logical entry/job pair. A succeeded job and a `failed/no_output | download_failed` job require a
receipt. During the crash-safe
provider-complete-to-download window, a running job may already carry that receipt and recovery may
only finish local output persistence; every other queued, submitting, remote, needs-attention,
failed-for-another-reason, or cancelled state requires it to be null. `no_output` and
`download_failed` without a receipt are invalid, as is a receipt on any precompletion failure. Once a
receipt exists, no path may submit or cancel that generation again.

`providerBindings` is a dense exact one-per-item map in combined quote order: every item ID occurs
once, no unknown/duplicate item occurs, and each provider value satisfies the exact main provider
shape. Every job linked to that item byte-equals its binding, including waiting,
dependency-failed, and cancelled jobs. Structural validation compares job to persisted binding, never
opaque `routeId` to provider. Prepare/confirm own resolver revalidation; renderer projection omits the
authorization and therefore every concrete binding.

Before the first provider attempt for a queued/bound job, main re-resolves that item's current route
and requires byte equality with the persisted binding; missing/changed binding moves the job to a
fail-closed attention state and never substitutes a new provider. Once a remote attempt identity is
durable, poll/download/cancel recovery uses the already persisted binding and task identity so a later
catalog edit cannot orphan or repeat charged work.

Across the project, at most one authorization item may have a nonterminal job set for a given
`(shotId,purpose)`. Generation-count siblings belong to that one item. Prepare treats every queued,
waiting, submitting, remote, running, or needs-attention item as in-flight context and cannot quote a
second item for it; terminal dependency-failed/cancelled/failed/succeeded history does not block a new
review. This makes the sanitized dependent/upstream progress identity unambiguous without exposing an
authorization or item ID.

Undo labels use `STUDIO_MAX_UNDO_LABEL_LENGTH`; an entry carries 1–
`STUDIO_MAX_UNDO_PATCHES_PER_ENTRY` dense patches; project and Bin patches occur at most once; Beat
and Shot target IDs are unique within the entry; and every `afterDigest` is a 64-character lowercase
hex digest. Historical before-fragments are validated structurally, not against current ownership or
selection. Tasks 2 and 14 own canonical authored-fragment hashing, top-of-stack/current-revision
CAS checks, conflict semantics, and application. Paid lifecycle revisions may advance beyond an
entry's `sourceRevision`; that alone is not conflict because patch digests and paid-field exclusion
are the authoring authority.

The project persists `spendPolicy`, `spendAuthorizations`, `frameExtractions`, and a capped
`undoHistory`. Prepared quotes live only in a bounded main-process cache and expire; restart requires
a new prepare and cannot spend an old UI payload. Confirm copies the re-derived quote by value into
`spendAuthorizations` in the same revision as its jobs. A successful free authoring batch writes its
inverse in the same project revision. Paid lifecycle bookkeeping and local recovery maintenance do
not create undo entries; undo never reverses external spend.

### Duration: authored target, derived actual

- **`actual`** = the sum of each active shot's _played_ duration. With a selected canonical video
  Take, that is the Take asset's probed `durationSeconds` minus trims. With no selected Take, it is the
  Shot's planning `durationSeconds`, and trims must be null. Derived, never persisted as a competing
  author-editable value.
- **`targetSeconds`** = nullable authored intent. Never constrains shot durations; the engine never
  has to satisfy it. It is what the director works toward when proposing coverage.
- **A beat with empty `shotOrder` has no coverage.** With a non-null target it contributes
  `targetSeconds` to the film because it exports as a slate of that length. A no-coverage/null-target
  beat is `duration_pending`: valid authoring state, but not renderable. A nonempty `shotOrder` is
  covered even before takes are selected; missing selected video makes export unready rather than
  turning authored shot boundaries into a slate.
- The film-duration projection is therefore `{ knownSeconds, unresolvedBeatIds }`, where
  `knownSeconds = Σ (actual if covered else target when present)`. The under/over readout and film
  render are available only when `unresolvedBeatIds` is empty; no code coerces null to zero.
- Target and actual **must render distinctly** (`~24s target` versus `24s`). Rendering them
  identically is the defect this split exists to prevent.

### The chain

- **Chains are strictly beat-scoped.** Beats are therefore the unit of parallelism: a project at the
  cap is 24 parallelisable groups, never one long series. Freeze this as an invariant.
- The **head of a chain segment** conditions on a still (`seedStillId`); every other shot conditions
  on the previous shot's trim-aware conditioning frame. A shot heads a segment if it is first in
  `shotOrder` **or** its `chainBreak` is `hard_cut`. `seedStillId` is an explicit pin; when null, the
  effective seed is the eligible completed image take with greatest `createdAt`, breaking ties by
  lexical asset ID. A head with neither pin nor eligible take is valid `seed_pending` authoring state
  and blocks video submission rather than persistence.
- **`hard_cut` is author-chosen; continuity break is system-detected.** They are different things and
  must never share a name or a visual treatment. A continuity break means the frame a shot was
  generated from no longer exists — upstream was re-rendered or tail-trimmed.
- **Re-rendering shot N marks N+1…end stale, not invalid.** Stale shots still play. Cascade is opt-in
  and must be separately priced at the gate. One quote may include “this shot and the downstream” by
  persisting an ordered symbolic dependency graph: runnable items carry concrete inputs, while each
  later item names one earlier authorized seed/predecessor item and waits for the human to select one
  canonical `primary` produced by one of that item's succeeded generation jobs. Posters and unroled
  outputs never bind a dependency. The provider never receives a symbolic input, and no output is
  auto-selected. The one exception is §13.6's paid hard-cut topology transition: its downstream
  replacement graph is mandatory through the next hard cut and has no base-only quote.
- **Trim asymmetry:** head trims are always free and never break continuity. Tail trims break
  continuity unless the shot is last in its chain segment.
- **Reordering shots inside a beat rewrites the chain and is not free.** Reordering beats is free.
  The UI must not make the two look alike.
- **No chain advance without the exact frame asset on disk.** Each video job stores its immutable
  request snapshot, including its conditioning input. Staleness is a pure comparison between that
  input and the current
  predecessor/selected-take/trim endpoint or selected seed; no process-local flag is authoritative.
- **Continuity stale and generation out of date are separate derivations.** Continuity compares the
  concrete conditioning input with the current seed/predecessor/take/frame/endpoint. Generation
  freshness recomposes the complete non-conditioning request and route from the current Brief,
  rules, Beat Look, Shot line, Match To, aspect ratio, resolution, and route, then compares it with
  the producing job's immutable plan/snapshot. A seed job's historical per-item reference remains
  fresh only while that exact asset is still an active classified import with the same digest; there
  is no project-global or inferred current-reference selection. Either state is playable; both are
  quote inputs, not schema-invalid flags. The sanitized service projection reports unique active
  shots in film order with explicit causes, capped by
  `STUDIO_MAX_DIRTY_SHOTS_REPORTED`; binned shots and in-flight context are not dirty work to bill.

### Derivation

- Shot lines are `derived` from the beat's action, or `detached`. Editing a line detaches it.
- **Detach is reversible.** Re-deriving writes the hand-written line to the beat's `lineHistory`,
  never to nothing.
- Editing the action bumps `actionRevision`, leaves detached lines untouched, and marks derived lines
  stale by comparison against `derivedFromActionRevision`.
- Derived text is **stored, not recomputed** — it must survive offline and be diffable. It is
  readable as `script.md`, which is an **on-demand export shape**, not a file kept at the project
  root. Nothing is written to disk that looks editable but silently discards edits: this repo's
  `Knowledge Base/` folder trained users that a visible file is the source of truth, and a generated
  `script.md` sitting beside it would read as the same contract while being the opposite. It is also
  why `script.md` is never ingested — the reducer stays the only writer.
- **Re-splitting coverage may only change dependency-free shot boundaries.** Shots with any asset,
  job, selected/seed media, conditioning-frame dependency, match target, or other persisted
  reference are fixed points; so is any shot with nonempty narration or on-screen text.
  `StudioProposedShot` is the complete ordered result. Its
  existing IDs preserve identity; new safe IDs are caller-minted. The reducer derives the fixed set,
  requires the proposal's `fixedShots` review rows to match it exactly, and requires every fixed
  shot's cumulative start/end boundary to remain unchanged. Each row contains the Shot ID plus every
  applicable reason, deduplicated in the frozen union order: nonempty asset/job membership; current
  selected Take or seed pin; an owned conditioning-frame record; an inbound persisted conditioning
  input; current Match To; nonempty narration; and nonempty on-screen text. Those are the exhaustive
  schema-2 fixed-reference families; adding another persisted Shot reference requires adding its
  reason before the schema can accept it. Rows follow current active film order. The reviewed rows
  are persisted by value in the `apply_coverage` proposal/operation so a restarted review card is
  self-contained, while acceptance re-derives and exact-compares them at the base revision rather
  than trusting the display. Removed dependency-free detached lines enter beat-scoped history. The
  apply result returns ordered `createdShotIds`, `retainedShotIds`, `removedShotIds`, and
  `fixedShotIds`.
  Created, retained, and fixed IDs follow proposal order; removed IDs follow the prior `shotOrder`.

### The Cut

The Cut is film-level only: beat order, one bed, match-to, export. It cannot reach inside a beat.
Trims, retiming, and take selection live in the beat panel.

**The Cut is not a record.** `cuts` and `activeCutId` do not exist. Because the Cut only reorders
beats and the project already has a beat order, that order _is_ the film. The project carries
`bedAssetId: string | null` and `matchToShotId: string | null` and nothing else. This deletes the
cut-clip record, its validator, and the dormancy rule that kept binned beats' cut entries alive.

Human Cut choices use two narrow queued reducer providers: `set_bed` accepts only
`StudioSetBedRequestV2`, and `set_match_to` accepts only `StudioSetMatchToRequestV2`. Each validates
the current canonical target, applies its same-named operation with one main-issued context, appends
normal authoring undo, and commits one expected-revision CAS. Null explicitly clears the choice.
Renderer never sends a generic mutation batch, and the current Director capability rejects both Cut
operations before reducer or media access.

- `MATCH TO` in v1 is **prompt-level**, therefore a re-render, therefore costed, and the UI must say
  so. A real colour pipeline is a separate later decision.
- The bed **fades out at the cut's end**. Never extend, never hard-truncate.
- **`AUTO-DUCKED` must not ship.** There is no voice track to duck for until TTS lands. `narration`
  and `onScreenText` are retained as authored fields with no downstream consumer.
- Export retention keeps the last **5 per shape**, ordered and evicted by `(createdAt, id)`, listed in
  the assets drawer from the sanitized export-catalog projection with size and source revision. The
  existing `projectMaxBytes` write-admission cap remains a fail-before-mutation safety
  bound for every managed write; it is not a user budget and never authorizes eviction of authored
  or paid media.
- **Retention reaches exports only — never takes, never conditioning frames.** "A missing frame is
  always re-derivable" holds only while the take video survives; eviction that reaches takes turns
  recovery into a re-render that charges.

### The conditioning frame is not the poster

The Board poster is representative artwork in `thumbnails`. The conditioning frame is chain input
in `conditioningFrames`, keyed by the selected immutable take and its played endpoint. They have
different provenance and retention authority and may not alias merely because an untrimmed provider
output happens to contain the same pixels.

The endpoint is exactly `take.durationSeconds - (trimOutSeconds ?? 0)`; head trim is irrelevant.
Extraction identity is the stable digest of canonical `{ shotId, takeAssetId, endpointSeconds }`, so
restart and duplicate scheduling converge on one record. A ready record is authoritative only when
its managed frame inode/bytes and all three provenance fields still match.

- **Read outputs by role, never by position.** `jobManager` already filters
  `outputs.filter((o) => o.role === 'poster')`. The fragile code is `canonicalVideoPosterV2` reading
  `outputAssetIds[1]`; fix that instead of constraining output count. This replaces any
  "exactly two outputs" rule — with role-addressed reads, a third output is harmless.
- **Extraction is a named local lifecycle, not a provider job.** An untrimmed take may adopt a
  provider-returned last frame after proving exact take provenance. Every other route/endpoint is
  decoded by main. The durable extraction state is `pending | extracting | ready | failed`; it has
  no provider route, adapter, receipt, retry charge, or `StudioJobStatus` value.
- **No chain advance without the frame asset on disk.** Because takes are immutable and on disk, a
  missing frame is always re-derivable, so closing the window mid-chain stalls the chain rather than
  losing it, and recovery asks "is the exact selected-take/endpoint frame there?" rather than
  re-rendering. Tail trim or take selection creates a new extraction key before downstream work.
- Conditioning frames are ineligible for take selection, seed selection, and the Bin by collection.
- **Storage:** flat `fileName`, location encoded by the collection. `isSafeFileName` rejects path
  separators, and the store quarantines any record carrying a path-shaped key at any depth, so a
  take-relative path may never appear in the record.
- Failure in an authorized multi-shot batch keeps the partial, bills only provider-completed
  generations, and resumes only the remaining jobs in the persisted authorization graph. A
  concretely bound job resumes its exact snapshot; an unbound dependent remains blocked until the
  human selects an eligible succeeded upstream output and the one-time binding is durably written.
  No restart invents a dependency or repeats a provider attempt.

### Money

- **Price source is a config rate card** — per route, with explicit currency and unit, owned by
  whoever owns route bindings. Video routes are per second; image routes are per generation. Not a
  provider API in v1. The UI must say the number comes from our rate card, not from the provider.
- **The estimate is a range, not a point**, once takes are in play. Quote the first pass and state
  that revisions outside its authorized graph are extra. In v1 the lower bound is one generation per
  priced seed/video item and the upper bound is the exact user-requested 1–4 generations per item.
  Confirm authorizes that upper/count set in full; lowering a count or doing work beyond it requires
  a new quote.
- All three numbers in a gate — headline cost, generation count, button label — come from **one
  ordered quote-item set derived from one shot set**. In-flight work is context, never billed again.
- **No reconciliation.** Actual computed from the same table as the estimate can only differ by a
  generation count known before dispatch. Instead, persist a **receipt** per take on the **job**:
  authorization ID, purpose, route, currency, rate unit/value, seconds when applicable, generation
  index/count, and integer total — stored by value, never as a card reference, so a card update
  cannot rewrite history.
- **Budget cap is a pinned brief rule in the user's mental model and a separate mechanism in the
  code.** It persists as `StudioSpendPolicy`, not a `StudioRulePredicate`. Scope in v1 is per batch;
  the quote's upper bound in one explicit currency must fit `maxPerBatchMinorUnits`.
- **Prepare never spends.** It snapshots revision, the exact ordered base/cascade item graph,
  authorization-time request templates and concrete-or-symbolic conditioning dependencies, routes,
  generation counts, rate-card digest/value, currency, bounds, and expiry into a
  `StudioSubmissionQuote`.
- **Confirm is the only spend authority.** Inside the project queue it re-derives the quote; any
  mismatch is stale. Success durably stores a `StudioSpendAuthorization` and idempotent jobs before
  the first provider call. Quote expiry governs confirmation only; once confirmed, recovery finishes
  the authorized jobs regardless of the old quote expiry. Restart may dispatch only authorized jobs;
  accepting a Director proposal cannot manufacture or confirm authorization.

### Validator totality and lookup rules

Carried verbatim from CS2 Amendment 1. Schema-independent; it cost three confirmed defects to learn.

`validateStudioProjectV2` is a total function. Every input, including a corrupt or hostile persisted
record, returns `true` or `false`. It never throws: callers read `false` as "quarantine this record",
and an exception escaping a declared type guard bypasses that path entirely.

- **Resolve every record entry by own key.** `project.shots[id]`, `project.assets[id]`, and
  `project.jobs[id]` inherit `Object.prototype` members, so an ID of `constructor`, `toString`, or
  `__proto__` — each of which satisfies the safe-ID contract — resolves to an inherited value that is
  not `undefined`. Guard with `Object.hasOwn(record, id)`, or re-check identity with
  `resolved?.id === id`. A bare `=== undefined` guard is not sufficient, and reading a field through
  it throws.
- **Walk every unbounded graph iteratively with an explicit stack.** The own-data snapshot graph and
  job retry lineage are unbounded, so recursion can raise `RangeError` instead of returning `false`.
  A valid active shot segment is bounded to eight and a project to 96; iterate those records too, but
  do not fabricate an over-cap 20,000-shot project and claim it proves a reachable valid path.
- **Hoist every key set to module scope.** A per-item `new Set([...])` inside a validator allocates
  once per Bin entry on every project read and write.

### Load and error states

```ts
export type StudioProjectLoadResultV2 =
  | { status: 'supported'; project: StudioRendererProjectV2 }
  | { status: 'unsupported_prototype_schema'; projectId: string }
  | { status: 'not_found'; projectId: string };

export type StudioProjectListResultV2 = {
  projects: StudioProjectSummaryV2[];
  unsupportedProjectIds: string[];
  quarantinedProjectIds: string[]; // malformed schema-2 only
};
```

V1 is not corrupt. Unknown or malformed V2 is corrupt and follows the existing loud
storage/quarantine path.

### Mutation vocabulary

```ts
export type StudioMutationOperationV2 =
  | { kind: 'edit_project'; changes: StudioEditableProjectSettingsChanges }
  | { kind: 'set_brief'; brief: string }
  | { kind: 'set_rules'; rules: StudioBriefRuleDraft[] }
  | {
      kind: 'add_beat';
      beatId: string;
      beat: StudioEditableBeat;
      beforeBeatId: string | null;
    }
  | { kind: 'edit_beat'; beatId: string; changes: StudioEditableBeatChanges }
  | { kind: 'reorder_beats'; beatOrder: string[] }
  | { kind: 'park_beat'; beatId: string }
  | { kind: 'restore_beat'; beatId: string; beforeBeatId: string | null }
  | {
      kind: 'add_binned_beat';
      beatId: string;
      beat: StudioEditableBeat;
    }
  | { kind: 'add_shot'; beatId: string; shotId: string; shot: StudioEditableShot; beforeShotId: string | null }
  | { kind: 'edit_shot'; shotId: string; changes: StudioEditableShotChanges }
  | { kind: 'delete_shot'; shotId: string } // dependency-free only
  | { kind: 'park_shot'; shotId: string }
  | { kind: 'restore_shot'; shotId: string; beforeShotId: string | null }
  | { kind: 'reorder_shots'; beatId: string; shotOrder: string[] } // rewrites the chain
  | {
      kind: 'apply_coverage';
      beatId: string;
      shots: StudioProposedShot[];
      fixedShots: StudioFixedShotReviewV2[];
    }
  | { kind: 'set_hard_cut'; shotId: string; hardCut: boolean }
  | { kind: 'set_seed_still'; shotId: string; assetId: string | null }
  | { kind: 'trim_shot'; shotId: string; trimInSeconds: number | null; trimOutSeconds: number | null }
  | { kind: 'redetach_line'; shotId: string; line: string }
  | { kind: 'rederive_line'; shotId: string; line: string }
  | { kind: 'restore_line'; shotId: string; historyEntryId: string }
  | { kind: 'park_take'; shotId: string; assetId: string }
  | { kind: 'add_alternate_take'; shotId: string; assetId: string }
  | { kind: 'restore_take'; shotId: string; assetId: string }
  | { kind: 'reorder_bin'; bin: StudioBinItem[] }
  | { kind: 'select_take'; shotId: string; assetId: string }
  | { kind: 'set_routes'; imageRouteId: string | null; videoRouteId: string | null }
  | { kind: 'set_spend_policy'; policy: StudioSpendPolicy | null }
  | { kind: 'set_match_to'; shotId: string | null }
  | { kind: 'set_bed'; assetId: string | null }
  | { kind: 'undo_last'; entryId: string };
```

The full MCP edit catalog has one exact schema/parser variant for every `StudioMutationOperationV2`
kind. Task 7 registers that complete catalog as the future-agent gesture vocabulary required by the
approved direction. Current Director direct/proposal capabilities are explicit subsets assembled
from those same variants: a disallowed gesture still parses as a known MCP edit operation but returns
`operation_not_permitted` before publication, reducer access, or side effects. Human-only motion,
take, Cut, undo, and lifted-Beat/Shot decisions are therefore present and tested in the tool schema while
remaining unavailable to the current Director capability. Paid prepare/confirm is a separate
non-edit protocol and never enters this mutation tool.

Renderer free authoring does not expose that full catalog. The single generic native
`apply_authoring_batch` provider accepts only exact `StudioApplyAuthoringBatchRequestV2`, with 1–
`STUDIO_MAX_MUTATION_OPERATIONS` dense operations from the frozen
`StudioRendererAuthoringOperationV2` subset, and returns only
`StudioRendererProjectCommitResultV2`. Main rejects every full-catalog/narrow/proposal-only operation at
the payload boundary before reducer access. Project settings; Beat/Shot/Take/Bin park, restore,
selection, and reorder-Bin; governed rules; coverage/re-derivation proposals; Cut choices; media
actions; cascade actions; and undo use their named narrow authorities instead. Every `set_rules`
operation is draft-shaped. Native accepts only `StudioSetRulesRequestV2`; MCP/proposal uses the same
`StudioBriefRuleDraft[]` field. Under the queue the pure reducer validates and canonicalizes those
drafts from the current project plus its main-issued context, forces project scope, preserves
`createdAt` for an existing ID, and mints it for a new ID from `capturedAt`. No boundary can supply
`scope`, `createdAt`, or an organisation rule. `undo_last` accepts only
`StudioUndoLastRequestV2` and returns the same exact authoring commit result; no renderer request
carries reducer context, undo fragments/digests, or a full `StudioMutationBatchV2`. Both providers
run through the project queue, mint context in main, commit once under expected-revision CAS, and
refresh project/workspace status after success.

Every other reducer-backed or queued free native action—`edit_project`, `set_rules`, Beat/Shot/Take
park/restore, Take selection/alternate, `reorder_bin`, `set_bed`, `set_match_to`, conditioning-frame
retry, and waiting-cascade cancellation—also returns only `StudioRendererProjectCommitResultV2`, with empty
created-ID arrays unless that exact commit created those records. Exact native tests forbid a
project, job, frame, undo fragment, or internal mutation result from crossing. Managed-media
import/detach, read projections, export, proposal/reference, and paid prepare/confirm retain their
separately frozen result contracts.

`delete_shot` remains an active-shot, dependency-free operation for ungenerated coverage.
It also requires empty narration and on-screen text; authored values in either field must be
explicitly preserved/edited, never structurally removed.
Before removing a detached shot, it appends that authored line to the owning beat's history with the
shot's current 1-based ordinal, the reducer context timestamp, and the deterministic operation/entry
ID; if the 20-entry cap is full, oldest-first eviction is part of the same atomic draft. Deleting a
derived shot creates no authored-history entry. A late failure rolls back both history and removal,
and undo restores the shot plus the exact pre-delete history fragment. No delete path discards
detached authored text.
`park_shot` is the non-destructive path for a shot with paid lineage: it removes the shot ID from its
current owner's `shotOrder`, appends exactly
`{ kind: 'shot', beatId: owner.id, shotId, reason: 'lifted' }`, and leaves the shot plus every owned
asset, terminal job, receipt, authorization, selected/seed take, and completed/failed frame record
unchanged. It refuses while the shot has a nonterminal job or a pending/extracting frame operation.
It also derives inbound references from current active project and chain state and fails closed for a
current `matchToShotId` or a nonterminal downstream job/extraction actively consuming the shot or its
take/frame lineage. Historical terminal downstream conditioning snapshots and receipts are retained
lineage, not blockers; parking makes the affected active downstream chain stale. The author must
clear or repoint Match To, or wait for/cancel the active consumer through its existing reviewed
lifecycle, before retrying. Parking never cancels, rewrites, or silently detaches it.

`restore_shot` consumes the one matching shot Bin item and inserts the same shot ID into that item's
recorded `beatId` before `beforeShotId` (or at the end for `null`). The recorded beat may itself be
active or binned, but must still exist; the anchor must belong to it and the eight-shot active
capacity must hold. Restore never reparents the shot and never rewrites paid lineage.

`park_beat` is the same non-destructive active-to-Bin move applied to a whole beat. Before appending
the lifted Beat item, it evaluates the union of the `park_shot` safety proof across every shot in that
beat's `shotOrder`. It refuses the whole operation before mutation when any contained shot owns a
nonterminal job or pending/extracting frame, is the current Match To target, or is named by a
nonterminal downstream job/extraction or waiting authorization dependency that consumes its
shot/take/frame lineage. Terminal jobs, receipts, authorizations, completed/failed frames, and
historical terminal downstream snapshots remain valid; parking the beat removes its shots from the
active film and makes affected active downstream chains stale. It never expands into separate Shot
Bin items or reparents a shot. An empty or terminal-history-only beat may be parked.

`park_beat`, `park_shot`, and `park_take` create `lifted` entries; `add_binned_beat` and
`add_alternate_take` create `alternate` entries. There is no add-alternate-shot operation and no
generic `remove_bin_item` that may orphan a referent. `apply_coverage` reads and replaces only the
named beat's active `shotOrder`; it never edits or deletes a binned shot or its lineage.

Editable change objects are exact-key, nonempty partials of authored fields only. Callers mint safe
IDs; main rejects collisions and returns created IDs in operation order. `reorder_*` inputs are exact
permutations. Batches are 1–32 operations. `undo_last` must be the only operation in its batch and
must name the current top entry in the bounded persisted undo journal. Undo patches are internal
validated before-fragments, never accepted from renderer, IPC, MCP, or a proposal. Each patch's
`afterDigest` must still match the current authored fragment. Shot patches never overwrite
`assetIds`/`jobIds`; removing a beat/shot created by the undone edit is refused if it gained a
persisted dependency. Any mismatch returns `undo_conflict`, consumes no entry, and changes no bytes.

---

## Decisions closed on 2026-08-18

These decisions were inferences this plan drew rather than rulings it received. All are now closed and
folded into the contract above. Recorded so a later reader can tell a ruling from an assumption.

1. **Shot media model — confirmed as drafted.** Shots carry no `mediaKind`; every shot is video.
   `mediaKind` lives only on the asset, so stills are image takes on the image route. A segment head
   may persist with `seedStillId: null`; that is seed-pending and blocks video submission. A hard cut
   establishes a new segment and therefore needs a selected or newly generated seed before video.
2. **The Cut collapses into project fields.** `cuts` and `activeCutId` are deleted; the project
   carries `bedAssetId` and `matchToShotId`. There are no alternate named cuts in CS3.
3. **Conditioning extraction is a durable local lifecycle, not a provider job.** It is keyed by
   selected take plus played endpoint and stored separately from Board posters. See _The
   conditioning frame is not the poster_.
4. **`RESET` is a renderer draft discard.** It uses the existing `useDraftPersistence`, is not a
   reducer operation, and never reaches main. This is what makes "RESET cannot lose writing" true; it
   is why RESET is absent from the mutation vocabulary.
5. **`script.md` is an on-demand export shape**, not a file kept at the project root and never
   ingested.
6. **Storage has a safety cap, not an eviction budget.** Preserve fail-before-mutation write
   admission; only exports participate in count-based retention.
7. **Seedance's last frame is an optimization, not universal provenance.** It can satisfy an
   untrimmed exact-take conditioning request; a trimmed endpoint is decoded locally.
8. **The Bin has exactly three reference kinds.** Beats and takes may be `lifted` or `alternate`;
   shots are `lifted` only and retain their original `beatId` ownership for exact restoration.
9. **Paid work uses prepare/confirm.** Quotes and authorizations are main-owned durable records;
   proposal acceptance and Director paths cannot dispatch.
10. **A confirmed cascade is one authorization graph with human binding barriers.** This is the
    implementation consequence of the approved “this shot, or this shot and the downstream” gate,
    jobs-before-provider durability, and human take-selection rulings. Downstream items may be priced
    and persisted with a symbolic dependency on an earlier authorized item, but main dispatches them
    only after the human selects a canonical primary output of that exact item and main durably binds
    the concrete request once. Frontier-only repeated confirms and automatic output selection are
    both rejected.

## BUG-095 decision closed on 2026-08-23

The product owner approved direction §13.6 after independent contract audit. This block supersedes
every older checklist line that treats `set_hard_cut` as ordinary free authoring, gives a hard-cut
transition an optional cascade, makes it undoable through `undo_last`, or permits the current Director
to propose it.

- The first Shot is already a natural segment head and has no hard-cut control or transition. Only a
  later active Shot may prepare an exact sever (`none` → `hard_cut`) or re-join (`hard_cut` → `none`).
- This is a distinct main-owned paid topology protocol. Its prepare snapshot binds the project
  revision, target and direction, current topology and conditioning authority, exact ordered job graph,
  routes, rates, and total. A renderer `requiresSeedGeneration` field is a route-diagnosis hint only:
  main independently derives canonical seed eligibility and exact-rejects any mismatch before rate
  lookup, quote/cache admission, or route binding. Confirm re-derives the authoritative inputs inside
  the project queue.
- One successful confirmation commits the topology change, authorization, and all required job
  records in one project revision before provider dispatch. Decline/close, prepare refusal, expiry,
  staleness, validation failure, or persistence failure before that commit writes no project bytes.
  Post-commit extraction/provider lifecycle failures remain durable history and never roll back the
  topology or authorization.
- Sever reuses the exact eligible effective seed if one exists and atomically pins that asset as
  `seedStillId`; otherwise it creates exactly one image-route seed job and leaves the pin null until
  the human binds that authorized output. It always creates exactly one replacement target-video job,
  which waits for that binding when the seed was newly generated.
- Re-join clears `seedStillId` without deleting the still asset and creates exactly one replacement
  target-video job conditioned on the predecessor's exact trim-aware endpoint. Missing endpoint bytes
  use the free durable extraction lifecycle before provider dispatch; no predecessor generation is
  authorized.
- Both directions include exactly one replacement-video generation for every downstream Shot before
  the next hard cut. The graph is mandatory, not a base/cascade choice. All required items have count
  one; alternate Takes stay on the ordinary render gate and human selection still binds downstream
  symbolic dependencies.
- Confirmation creates no ordinary undo entry. The inverse is a new paid transition. The current
  Director may neither apply nor propose it; legacy pending hard-cut proposals remain readable only so
  acceptance can fail closed without publishing project or decision bytes.

### Blocker closure ledger

| Former blocker                                      | Closed contract / owning task                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs fork did not contain green Gate 1              | Execute only with `7176e3f6b` as ancestor; CS3 docs were transplanted onto that lineage.                                                                                            |
| No valid pre-seed authoring state                   | Null pin derives latest still or projects `seed_pending`; Task 5 owns reviewed seed jobs and the video readiness gate.                                                              |
| Full-video poster could not represent a tail trim   | Conditioning frame is distinct, keyed by selected take plus played endpoint; Tasks 1C/5 own provenance, extraction, recovery, and the 10s→8s RED.                                   |
| Bin had two versus three incompatible kinds         | Exactly `beat \| shot \| take`; a shot reference is lifted-only, preserves its original beat and paid lineage, and has no generic removal.                                          |
| Ever-rendered shots could never leave coverage      | `park_shot`/`restore_shot` move the exact shot reference across the active/Bin XOR; Tasks 1C/2/5 own lineage and fail-closed dependency proofs.                                     |
| Coverage proposal/result type was undefined         | `StudioProposedShot` and ordered `StudioCoverageApplyResult` are frozen above; Task 2 owns fixed-boundary enforcement.                                                              |
| Re-split invalidated historical line ordinals       | Ordinal is historical 1–8 provenance, independent of current shot count; Task 1C owns shrink/restart REDs.                                                                          |
| Native names landed before atomic cutover           | Tasks 1B/6 keep native/manifest/bridge byte-identical; Task 7 moves every legacy/free/read/reference name together, while Task 8 atomically adds the new paid prepare+confirm pair. |
| Runtime activation and rollback were unspecified    | Task 7 owns the five-state single-flight controller, mixed-root filtering, rollback, retry, and shutdown races.                                                                     |
| Proposal/reference ownership stopped at publication | Task 6 owns V2 list/watch/decision/reap, commit attribution, restart repair, and reviewed reference handoff.                                                                        |
| Pricing types were detached from dispatch authority | Tasks 4/5 own exact-unit rate cards, cached quotes, persisted authorization/jobs-before-provider, receipts, budget, and recovery.                                                   |
| One quote could not preserve human cascade choice   | Authorization plans persist an ordered symbolic item graph; Task 5 binds each dependency once to a human-selected primary before dispatch.                                          |
| Brief detach could destroy a queued provider input  | Request plans freeze `{ assetId, sha256 }`; Task 5 refuses live detach, verifies bytes pre-provider, and permits deletion only after terminal use.                                  |
| Undo was only a label                               | Tasks 1C/2/14 own bounded before-fragment journal, post-edit digests, conflict rules, CAS, and paid-state exclusion.                                                                |
| Gates 2–4 were not executable                       | Each gate now names focused suites, full suite, per-file 80/80 coverage, Playwright/visual evidence, static checks, and independent reviews.                                        |

---

## Delivery Gate 1 — schema, reducer, store, money

> **Task 1 is three passes, deliberately.** The rename and the schema extension have different risk
> profiles and different proofs. Pass 1A cannot change behaviour, so the whole suite must stay green
> with no assertion touched — that proof is available exactly once and only if nothing else rides
> along. Pass 1B changes names that cross a boundary, so expectations move but logic does not. Those
> two passes are independent green commits. Pass 1C is the only pass that adds meaning and starts the
> atomic Tasks 1C–5 schema-2 core tranche described above. Keep its RED and focused-test checkpoints,
> but do not create a knowingly transitional schema-2 commit; the next commit/review point is the
> full-suite-green Task 5 tranche head.

### Task 1A — Rename internal identifiers only

Zero behaviour change. Nothing in this pass may alter a byte that is serialized, sent over IPC, or
named in an MCP schema.

**Rename:** type names (`StudioSection` → `StudioBeat`, `StudioClip` → `StudioShot`,
`StudioShelfItem` → `StudioBinItem`), function names (`validateSection` → `validateBeat`), local
variables and parameters (`clipOwners` → `shotOwners`), constant identifiers
(`STUDIO_MAX_CLIPS_PER_SECTION` → `STUDIO_MAX_SHOTS_PER_BEAT`), and test helper names (`makeClip` →
`makeShot`).

**Do not touch:** any string literal, and any property name on a persisted or wire-facing type.
`sections`, `clips`, `shelf`, `clipId`, and `sectionId` are serialized keys — renaming them is a
contract change and belongs to 1B. The temptation on a find-and-replace is to sweep `'add_section'`
and `clipId` along with everything else; that silently converts a provably safe pass into a
contract-breaking one.

**Steps**

- [ ] Confirm both spec pins still match the committed files (`shasum -a 256`) and the approved
      authority record is present in the direction document. Stop on either mismatch. The inference
      decisions are already closed — see _Decisions closed_.
- [ ] Confirm Gate 1 is green before starting. A rename entered from a red baseline is unverifiable.
- [ ] Perform the identifier rename across `packages/` and `tests/`.
- [ ] **Gate — the free proof:** `bun run test` fully green, and `git diff` contains **no change to
      any assertion, expectation, or fixture value**. If an expectation moved, something in the pass
      crossed a contract boundary; find it and move it to 1B rather than updating the test.
- [ ] Run `bunx tsc --noEmit` and `bun run lint --quiet`.
- [ ] Commit: `refactor(studio): rename internal identifiers to beat and shot`.

### Task 1B — Rename wire and persisted names

Behaviour changes; semantics do not. Expectations and fixtures move in this pass, and that is the
signal that distinguishes it from 1A.

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`
- Modify: the schema-2 store seams and every affected test

**Steps**

- [ ] Rename persisted property names: `sections` → `beats`, `clips` → `shots`, `shelf` → `bin`,
      `sectionOrder` → `beatOrder`, `clipOrder` → `shotOrder`, `clipId` → `shotId`, `sectionId` →
      `beatId`, `storyLine` → `action`, `visualPrompt` → `look`, `shotPrompt` → `line`,
      `selectedAssetId` → `selectedTakeId`. Rename every schema-2 singular, plural, and compound wire
      form with them — including `sectionIds`/`clipIds`, `createdSectionIds`/`createdClipIds`,
      `payableClipIds`, `firstClipId`, `beforeSectionId`/`beforeClipId`, and capacity/projection keys.
      Move the validator's key Sets with them.
- [ ] Rename the MCP operation names carried in `studio_apply_edits`' `mutation_batch` —
      `add_section` → `add_beat`, `edit_section` → `edit_beat`, `reorder_sections` → `reorder_beats`,
      `park_section` → `park_beat`, `restore_section` → `restore_beat`, `add_clip` → `add_shot`,
      `edit_clip` → `edit_shot`, `delete_clip` → `delete_shot`, `reorder_clips` → `reorder_shots`,
      `select_shelved_take` → `restore_take`, `remove_shelf_alias` → `remove_bin_item`, and
      `reorder_shelf` → `reorder_bin`. `remove_bin_item` is a rename-only transitional variant; Task
      1C removes it when it installs the frozen no-generic-removal vocabulary. These are persisted and
      **unregistered MCP** contract changes only.
- [ ] Assert the native constants, payload schemas, provider inventory, manifest, bridge, preload,
      runtime, and renderer are byte-identical to the green Gate 1 baseline and contain no Beat/Shot
      provider vocabulary. Native/public work belongs to Task 7's atomic cutover.
- [ ] **Gate:** the whole suite green. Run everything, not the changed files; also run the native
      parity test as an absence oracle proving no V2 provider was staged early.
- [ ] **Review the diff for logic changes.** This pass should contain renames, moved expectations,
      and nothing else. Any conditional, bound, or branch that changed belongs in 1C.
- [ ] Commit: `refactor(studio): rename persisted and wire names to beat and shot`.

### Task 1C — Beat and Shot contracts and pure validation

The only pass that adds meaning.

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioManagedAssetCollections.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioProjectSummary.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioCanonicalTake.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/factories.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/{index.ts,frameExtraction.ts,generationRequest.ts,submissionIdentity.ts,spendMath.ts}`
- Modify: `tests/unit/process/creative-studio/service/schema2/validation.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/factories.test.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/generation/{frameExtraction.test.ts,generationRequest.test.ts,submissionIdentity.test.ts,spendMath.test.ts}`
- Modify: `tests/unit/process/creative-studio/types/canonicalTake.test.ts`
- Modify: `tests/unit/process/creative-studio/types/projectSummaryV2.test.ts`

**Steps**

- [ ] Add the new persisted fields from the frozen contract: `actionRevision`, `targetSeconds`,
      `lineHistory`, `derivation`, `derivedFromActionRevision`, `chainBreak`, `seedStillId`,
      `trimInSeconds`, `trimOutSeconds`, `spendPolicy`, `spendAuthorizations`, `frameExtractions`, and
      `undoHistory`. Add and exact-validate every supporting proposed-shot, conditioning, extraction,
      quote/authorization, receipt, and undo type shown in the frozen contract; factories start all
      collections empty and policies/routes null.
- [ ] Define the final project without `cuts` or `activeCutId`; add `bedAssetId`, `matchToShotId`,
      direct opaque route IDs, spend/frame/undo collections, and the V2-only media/managed-reference
      types. Widen `targetDurationSeconds` to 5–1440 in the validator **and** summary schema together.
      Add canonical imported audio and managed `conditioningFrames`; `bedAssetId` accepts audio only.
      Remove V2's legacy generated-reference `references` collection and asset
      `sourceReferenceAssetIds`/`sourceAspectRatio`/`sourceResolution`; exact generation provenance
      lives in immutable job request plans, and Task 6 reference acceptance imports media or opens a
      seed gate rather than creating the retired reference-plate shape.
      Remove legacy V2 `ruleListUndo` while preserving the governed `rules`; Task 2 routes rule edits
      into `undoHistory`. Task 2 performs the atomic Cut-module/consumer deletion inside this tranche.
- [ ] Implement the one shared frame-extraction ID helper and freeze its vector before any validator
      or lifecycle code consumes it.
- [ ] Implement the one shared quoted-item ID helper and freeze its vector. Validation rejects a
      stored authorization item whose ID does not recompute from its project/revision/shot/purpose;
      Task 4 prepare and confirm import this helper rather than trusting cached IDs.
- [ ] Implement one pure checked spend-math helper for per-generation amounts and exact authorization
      lower/upper totals. RED ±1 tampering and every unsafe rate×duration×count/sum boundary. Project
      validation and Task 4 pricing import it; neither duplicates arithmetic or reads a live rate card
      to validate historical values.
- [ ] Implement one pure generation-request composer/materializer and freeze exact seed, direct-video,
      deferred-seed, deferred-predecessor, Match To, Brief/rules/Look/line, aspect/resolution,
      reference-ID/digest, duration, and binding vectors. Export current-request comparison for Task 2
      and exact plan materialization for Tasks 4–5; statically fence the module from every operational
      dependency.
- [ ] Implement the shared pure planning-boundary helper in the existing
      `creativeStudioProjectSummary.ts` module; do not add a thirteenth peer under the already-wide
      common project-types directory. Extend `projectSummaryV2.test.ts` with active order, exact
      cumulative integer starts/ends, empty coverage, hostile/missing ownership, and a selected
      10-second Take with a current 8-second Shot plan and trims: planning geometry remains exactly
      0–8 while playback helpers retain their separate media-exact result. Statically fence the
      helper from asset/take, trim, provider, filesystem, and renderer dependencies.
- [ ] RED: unknown keys; duplicate ownership; orphan assets/jobs; beat or shot active-and-binned
      overlap; invalid Bin items of each kind; 25 beats; 9 active shots in one beat; 97 total unique
      shot records across active orders and shot Bin membership; each beat/shot/take Bin maximum at
      exactly N and N+1; shot duration 3 and 16; line history at 20 and 21. A shot Bin item adds no
      second project-shot budget: `STUDIO_MAX_SHOTS_PER_PROJECT` counts its referenced record once,
      while `STUDIO_MAX_BIN_SHOT_ITEMS` independently bounds the number of shot Bin entries. Accept
      every exact boundary.
- [ ] RED totality per the validator rules: an asset `shotId`, job `shotId`, Bin `assetId`,
      `selectedTakeId`, `seedStillId`, or `matchToShotId` of `constructor`, `toString`, or
      `__proto__`; a valid 20,000-link retry chain; a 20,000-deep hostile own-data graph; the exact
      valid 8-shot segment and 96-shot project boundaries; and an asset `durationSeconds` of `1e308`.
      Assert `toBe(false)` rather than `toThrow` for hostile/over-bound records.
- [ ] RED asset ownership/media compatibility: project-owned audio accepted only for bed/import;
      shot-owned audio rejected; project-owned image/video rejected as takes; canonical image seed,
      video take, poster, and conditioning-frame ownership each exact. Positively accept a
      shot-owned image in `imports` only as an unclassified human seed Take with no producing job;
      reject Brief classification, wrong owner/collection/media, or a generated output masquerading
      as that import. Require duration on video/audio and forbid it on image; accept a canonical
      selected 10-second Take after its Shot's planning duration changes to 8, retaining exact
      producing-job provenance. Export artifacts are not
      project assets and Task 13 validates their separate sidecar catalog. Accept only a
      classified active Brief image import as a live generation reference; freeze its exact safe ID
      and lowercase SHA-256 by value. Pure project validation requires a nonterminal referencing job's
      asset record to match that ID/digest, while terminal job/authorization history remains
      structurally valid after detach removes the record. Reject every missing, replaced-digest, or
      cross-owned live record reference. Task 5 alone proves inode, bytes, digest-on-disk, and detach/
      dispatch races; `schema2` remains filesystem-fenced.
- [ ] RED an active Beat with exact empty `shotOrder` and both null/non-null `targetSeconds` as valid
      spine state. Reject any Beat-add operation shape carrying legacy `firstShotId`/`firstShot`
      keys; Task 2 proves later ordered `add_shot`/`apply_coverage` visibility rather than requiring a
      placeholder Shot.
- [ ] RED the chain invariants: a segment head with no seed remains valid and projects
      `seed_pending`; null pin plus completed image takes derives the latest deterministic seed; an
      explicit pin wins; a non-heading shot carrying a pin; a chain edge crossing a beat boundary; and a
      request snapshot whose recorded conditioning shot/take/frame IDs, ownership, or endpoint do not resolve
      to its exact immutable historical provenance. RED request plans with an empty/oversized prompt,
      invalid duration/reference branch, forward-or-cross-segment dependency, cycle, wrong
      upstream purpose/shot, more than `STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST` unique shots, more
      than `STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST` items, or a duplicate
      `(shotId,purpose)`. A `resolved` plan requires `queued_local` plus its equal concrete job
      snapshot at confirm; an `after_take_selection` plan requires `waiting_for_conditioning` plus
      null until its exact one-time human binding. Its only other null-snapshot terminal form is
      `failed/dependency_failed`, justified by an exact upstream item whose jobs are all terminal with
      zero selectable succeeded primaries, or explicitly `cancelled` before binding. Reject
      waiting/dependency-failed/pre-bind-cancelled jobs with any non-null
      `providerJobId`/`remoteStartedAt`, progress/attempt state, receipt, or output and every other
      plan/status/snapshot combination. Every job's configured `provider` must byte-equal the exact
      matching entry in its authorization's `providerBindings`; pure validation never compares the
      opaque route ID to a provider tuple. At item scope, reject mixed waiting/bound siblings, different concrete
      snapshots across generation indices, or a partial bind after one sibling provider attempt;
      only siblings cancelled before binding may remain null. Positively RED both waiting → cancelled
      → restart with no bind/provider/charge and resolved-or-bound queued → cancelled → restart with
      the same concrete snapshot and no provider completion/receipt/output.
      A bound concrete seed or predecessor Take must be the canonical primary produced by the exact
      dependency `upstreamItemId` in the same authorization; an older generated primary, a human
      import, a poster, or an unroled output cannot satisfy that symbolic authority.
      Equality
      with the **current** active predecessor, selected take, trim endpoint, or
      extraction key is not a schema-validity predicate; Task 2 compares those values to project
      staleness. Task 2 proves `chainBreak` authoring authority and Task 5 proves the seed-pending
      video-submission refusal and binding lifecycle.
- [ ] RED extraction state exactness: pending/extracting have no frame/error; ready has one canonical
      managed frame and no error; failed has no frame and one frozen error code; IDs are the stable
      canonical-input digest and duplicate inputs cannot create two records. Accept a still-unbound
      authorized dependent whose exact required record is failed and project
      `conditioning_failed`; reject binding/dispatch until that same ID becomes ready.
- [ ] RED the derivation invariants: `derived` requires a non-null safe
      `derivedFromActionRevision` no greater than its owner's current action revision; `detached`
      requires null. Reject the opposite combinations. History ordinal 0 and 9 are rejected, while
      ordinal 8 remains valid after the beat shrinks to one shot and survives restart.
- [ ] RED trim numeric bounds: finite nonnegative values only, each less than source duration, and
      `trimInSeconds + trimOutSeconds < selectedTake.durationSeconds`. Trims require one selected
      canonical video Take and must be null without it; Shot planning duration is never substituted
      for selected source duration. Reject NaN, infinity, negative zero policy drift, and an empty
      played interval.
- [ ] RED all three reference-only Bin kinds and no fourth: exact beat/shot/take maxima, no generic
      removal, beat/take `lifted | alternate` reasons, shot `lifted` only, and take aliases cannot name
      a current selected/seed take or nonterminal/waiting conditioning media. Positively accept a
      lifted take retained only by an exact terminal historical conditioning snapshot and project the
      affected active chain stale after restart. For shots, prove exact active-or-binned XOR, one unique
      Bin item, a safe existing `shotId`, a safe existing authoritative `beatId`, no other beat's
      `shotOrder` membership, and rejection of missing, duplicated, cross-owned, or magic IDs.
- [ ] RED a binned shot retaining canonical selected/seed takes, terminal jobs, receipts,
      authorizations, and completed/failed frame lineage. Every relation must still resolve to that
      shot; no ownership field is nulled or reparented. Reject a binned shot with a nonterminal job or
      pending/extracting frame operation, and reject any nonterminal downstream job/extraction that
      consumes the binned shot or its take/frame lineage. Positively validate a terminal downstream
      snapshot with exact immutable historical provenance after its predecessor is binned even though
      it no longer equals the current active chain; Task 2 must project that accepted state as stale.
- [ ] RED a binned beat retaining its exact `shotOrder` and every contained shot's terminal paid
      lineage. Apply the same proof over the union of those shots: reject any contained nonterminal
      job, pending/extracting frame, current Match To target, nonterminal downstream consumer, or
      waiting authorization dependency; accept terminal-only history and project affected active
      downstream chains stale. Prove the beat move creates no Shot Bin items and changes no shot
      owner or lineage byte.
- [ ] RED authorization completeness across the whole project: duplicate authorization IDs;
      duplicate authorization-entry keys within one authorization or across two authorizations; a
      job repeating another pair's key instead of its own; missing/extra item-index/job relations;
      and a job linked to two items. Accept the required same-key repetition inside each exact logical
      authorization-entry/job pair and the global bijection at the maximum item and generation
      boundaries. Reject wrong project ID, current/future source revision, confirmation at/after
      expiry, and a noncanonical quoted-item ID; accept the exact precommit-revision and
      confirmed-at-one-tick-before-expiry boundaries.
- [ ] RED the billable-completion matrix: `succeeded`, `failed/no_output`, and
      `failed/download_failed` require the exact receipt; a crash-recovery `running` state may carry it
      only after proven provider completion. Reject either post-completion failure without a receipt,
      a receipt on provider-declared/precompletion failure or cancellation, and any second submit or
      cancellation authority after the receipt exists. Cover missing primary, wrong-media primary,
      local download failure, and restart structurally.
- [ ] RED two different authorization items with nonterminal jobs for the same `(shotId,purpose)`;
      generation-index siblings within one item are valid. Prove every terminal status releases that
      quote exclusion while waiting/needs-attention does not.
- [ ] RED provider-binding completeness: missing/extra/duplicate/reordered item bindings, malformed
      provider tuples, and any sibling job (including waiting/dependency-failed/cancelled) whose
      provider differs by one field. Accept the exact dense one-per-item binding list and keep it
      absent from `StudioRendererProjectV2`.
- [ ] RED sanitized cascade-progress precedence for mixed generation siblings: all-cancelled;
      cancelled plus dependency-failed; cancelled plus remaining selectable success; upstream still
      running; human seed/take choice; and frame extraction. Cancelled siblings remain cancelled when
      the remaining siblings bind or fail, and no bound/runnable item emits a waiting entry.
- [ ] RED `StudioProposedShot` and `StudioFixedShotReviewV2`: exact keys, safe supplied IDs, nonempty
      dense deduplicated reason arrays in frozen reason order, unique fixed Shot IDs in active film
      order, and every reason literal. Task 2 owns authoritative reason derivation, exact proposal
      comparison, fixed-ID preservation, and ordered created/retained/removed/fixed result semantics.
- [ ] Implement the exact validators and `createEmptyStudioProject()` with empty
      beat/shot/Bin/history state. Resolve every record entry by own key, walk both graphs
      iteratively, and consume the constant named for each contract.
- [ ] Convert canonical-take and summary projection helpers to Beat/Shot. The summary is active-only
      and the film-duration projection returns known seconds plus unresolved beat IDs; test target,
      null-target, covered, binned-beat, and binned-shot cases without null-to-zero coercion. Binned
      shots and their retained assets/jobs contribute zero active shot and duration count. RED a
      selected 10-second canonical Take with 1-second tail trim after its Shot planning duration is
      edited to 8: actual/export/conditioning endpoint remains 9 while generation becomes out of
      date; a no-selected Shot uses 8 with null trims. Task 5
      owns readiness once the final job/seed contract has live producers.
- [ ] Mutation proof: restore a bare `=== undefined` guard at one lookup site and prove the matching
      totality test fails; lower each per-kind Bin maximum by one in turn and prove the exact
      beat/shot/take N-boundary test fails; remove the shot active-or-binned XOR and prove its ownership
      test fails; restore all mutations.
- [ ] Checkpoint: run
      `bunx vitest run tests/unit/process/creative-studio/service/schema2/validation.test.ts tests/unit/process/creative-studio/service/schema2/factories.test.ts tests/unit/process/creative-studio/service/schema2/generation/frameExtraction.test.ts tests/unit/process/creative-studio/service/schema2/generation/generationRequest.test.ts tests/unit/process/creative-studio/service/schema2/generation/submissionIdentity.test.ts tests/unit/process/creative-studio/service/schema2/generation/spendMath.test.ts tests/unit/process/creative-studio/types/canonicalTake.test.ts tests/unit/process/creative-studio/types/projectSummaryV2.test.ts`.
      These focused suites stay green; only repository typecheck may remain red until Tasks 2–5
      update every final-type consumer. Do not commit an intermediate schema-2 shape.

### Task 2 — The ordered reducer

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/mutations.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/chain.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/mutationIdentity.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/index.ts`
- Delete: `packages/desktop/src/process/services/creative-studio/service/schema2/cuts.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/renderService.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandService.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandProcessor.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioDirectorCommandWriter.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/mutations.test.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/chain.test.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/mutationIdentity.test.ts`
- Delete: `tests/unit/process/creative-studio/service/schema2/cuts.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandService.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandProcessor.test.ts`
- Modify: `tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandSpendFence.test.ts`
- Modify: `tests/integration/creative-studio/directorCommandLatency.integration.test.ts`
- Modify: `tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`
- Modify: `tests/integration/creative-studio/renderService.integration.test.ts`
- Modify: the direct Director/MCP contract tests needed to keep the unregistered subset exact

**Steps**

- [ ] RED every operation, ordered later-op visibility, input immutability, late-op rollback,
      capacity precedence, collision rejection, exact permutations, and created-ID ordering.
- [ ] Freeze new-record defaults and reducer context before behavior tests: new Beat/Shot values,
      deterministic line-history IDs, one undo ID/source revision/label per successful non-undo batch,
      same-context replay, multiple history entries in one batch, CAS refusal/retry, restart, and
      late-operation rollback. Context is main-issued inside the project queue and never accepted from
      a renderer/MCP/native operation payload. RED that `add_beat` and `add_binned_beat` create an
      exact empty `shotOrder` with no Shot ID allocation, and that a following `add_shot` or
      `apply_coverage` in the same ordered batch sees the Beat and creates coverage atomically. Undo
      of a spine-only Beat creates/restores no phantom Shot and created-ID receipts name only records
      that actually exist.
- [ ] Make the existing unregistered Director caller/producer graph compile against that exact
      contract in this task, not Task 6. Remove `firstShotId`/`firstShot` from writer fixtures,
      serialization, and processor reads. Pass the required reducer context explicitly in
      `directorCommandService.ts` as
      `{ mutationId: command.commandId, capturedAt: command.createdAt }`: both values were already
      main-writer-minted, persisted, exact-validated, unique/canonical, and therefore make retry/
      replay deterministic. RED duplicate/replay, timestamp preservation, empty-Beat receipt, and
      created-ID ordering. Mechanically rewrite every former compound `add_beat` in the Director
      spend-fence, latency, and lifecycle fixtures as an empty-Beat `add_beat` followed immediately
      by an ordered `add_shot` when that scenario still requires coverage; preserve their existing
      scheduler/lifecycle/spend assertions and exact created-Beat/Shot receipt expectations. This
      leaves the Tasks 1C–5 full-suite gate with no deferred `firstShotId`/`firstShot` consumer. Do
      not add an optional/default context overload or move policy/proposal expansion forward; Task 6
      still owns that later behavior.
- [ ] Install the final `StudioMutationOperationV2` union together with the reducer. Remove
      transitional `remove_bin_item`. Freeze the full MCP operation type/catalog as the final mutation
      union, then define `StudioDirectorOperationV2` as the current explicit capability subset
      containing only `set_brief`, Beat add/edit/reorder, Shot add/edit/delete/reorder, and Bin
      reorder. Mechanically move the existing unregistered Director parsers/schemas to those
      final payload shapes now; Task 6 completes the per-operation dormant catalog and splits direct
      versus proposal policy. Project settings, motion/take decisions, undo, and Beat/Shot park/
      restore are catalogued but rejected by the current Director capability; paid confirmation
      remains outside the edit catalog.
- [ ] RED `edit_project` exact nonempty changes, every field bound, unknown keys, no-op equality,
      ordered later-op visibility, stale CAS, rollback, restart, and undo. Name/target changes preserve
      generation freshness and never rescale Beat/Shot/slate state; aspect/resolution changes preserve
      lineage but project generation-out-of-date for affected results. Refuse only an aspect/
      resolution change that would alter a bound nonterminal request; name/target-only edits remain
      safe. Import the same canonical request comparison used by `chain.ts` and poison paid services.
- [ ] Remove legacy V2 `ruleListUndo`; draft-shaped `set_rules` canonicalizes and writes the exact
      governed rule list through this pure reducer and the unified undo journal. Force project scope,
      preserve `createdAt` by existing ID, and mint new timestamps only from reducer-context
      `capturedAt`; reject any unknown provenance key before mutation. Keep it absent from direct
      Director edits. Task 6 translates an accepted `pin_rule` proposal into one ordered draft
      operation, and Task 7 routes the existing human-native rule editor through that same reducer;
      renderer and MCP never author rule scope or timestamps. RED native/MCP/proposal byte-equal
      convergence, same-context replay, undo, restart, and late-batch rollback.
- [ ] Delete the V2 Cut contract as one dependency-closed change: remove `cuts.ts`, its index export,
      reducer guards/reconciliation, media-store selection reconciliation, obsolete V2 render-cut
      projections, and only their V2 tests. Preserve every V1 Cut type, validator, render path, test,
      native payload, renderer component, and fixture byte.
- [ ] RED the removal rules: `delete_shot` is active-only and refused for every persisted dependency;
      `park_take` accepts only an already-unselected, unseeded eligible take and creates an exact
      lifted alias without implicitly clearing any selection; and
      `park_shot` moves the exact active membership to one lifted shot Bin item without changing the
      shot or any paid-lineage record. Refuse an already-binned/missing shot, any
      nonterminal job, any pending/extracting frame operation, a current `matchToShotId`, and every
      nonterminal downstream job/extraction actively consuming that shot or its take/frame lineage.
      Structural validation still enforces exact Beat/Shot/Take Bin N/N+1 boundaries, but do not emit
      unreachable Beat/Shot Bin park blockers: their maxima equal the total valid Beat/Shot record
      caps, so a full Bin cannot coexist with another valid active record to park. At exact Take Bin
      capacity, `park_take` refuses byte-for-byte and workspace status reports
      `take_bin_capacity_reached`; RED 96 Take aliases plus one otherwise eligible active Take.
      Prove each refusal is pre-mutation and leaves the whole batch unchanged; prove historical
      terminal downstream conditioning snapshots do not block and instead become stale.
      For `park_take`, reject only current selected/seed or nonterminal/waiting conditioning use;
      accept a take named solely by terminal historical provenance, retain that provenance through
      restart, and project staleness. RED selected and seed pins as byte-preserving refusals.
- [ ] RED authored-text preservation on dependency-free `delete_shot`. A detached line is appended to
      owner history with its pre-delete ordinal/context timestamp/deterministic ID before removal; a
      derived line adds nothing. Nonempty narration or on-screen text refuses deletion byte-for-byte.
      Cover each field independently and together, the 20-entry oldest eviction boundary, two deletes
      in one batch, late-batch rollback, restart, and undo restoring both shot and exact prior history.
- [ ] RED `park_beat` as one atomic union-of-contained-shots safety decision. Refuse before mutation
      when any contained shot has own in-flight work, pending extraction, current Match To,
      nonterminal downstream consumption, or a waiting authorization dependency; preserve the
      entire project byte-for-byte on refusal. Accept an empty or terminal-history-only beat, create
      only its lifted Beat item, retain every shot/asset/job/receipt/authorization/frame byte, and
      project any affected active downstream chain stale.
- [ ] RED `restore_shot`: consume exactly one lifted shot item, use only its recorded original beat,
      validate the current `beforeShotId` anchor and per-beat capacity, and restore the same shot ID
      with byte-identical asset/job/receipt/authorization/frame lineage. Cover a recorded beat that is
      itself binned, wrong-owner anchors, duplicate/active membership, later-op visibility, and
      late-operation rollback. No operation reparents a shot or creates an alternate shot item.
- [ ] RED `apply_coverage` against the exact `StudioProposedShot` wire shape. It must derive and
      report the fixed set and its complete canonical reasons, reject a caller's mismatched,
      reordered, missing, extra, or stale `fixedShots` row/reason, preserve every fixed shot's
      cumulative planning start/end boundary from the shared helper, reuse requested current IDs,
      create requested new IDs in order,
      apply proposed authored values to retained dependency-free IDs while preserving their
      operational fields, and move every changed/removed detached line to beat history without
      invalidating an ordinal that no longer exists in current coverage. A fixed ID preserves every
      field, and its proposed line/narration/on-screen-text/duration/chain-break values must all equal
      the current shot or the batch is refused before mutation. Treat nonempty narration or
      on-screen text as a fixed-point dependency and RED attempted removal, boundary change, and
      mismatched proposed text for both fields. A retained nonfixed ID may change
      line/duration/boundary. Its input and fixed-set
      derivation are active-order only;
      prove that a previously parked rendered shot is absent from coverage and remains byte-identical
      through re-split, while every remaining active dependent shot stays fixed. With a selected
      10-second Take and current 8-second Shot plan, require the fixed proposal's duration and
      cumulative planning boundary to remain 8 while playback/export/conditioning remains media-
      exact; mutation-kill any substitution of played duration into coverage geometry.
- [ ] RED derivation and authored-text preservation: a different line edit detaches and archives an
      already-detached displaced value; accepted `rederive_line` archives the handwritten line,
      writes its explicit reviewed replacement, and restores derivation at the current action
      revision; `restore_line` copies rather than consumes history and archives a different detached
      target. Editing the action bumps `actionRevision` and marks derived lines stale while leaving
      detached lines untouched. Cover identical replacements, multiple history writes in one batch,
      oldest eviction at 20, rollback, and deterministic replay; poison every LLM/text service to
      prove the reducer is pure.
- [ ] Implement generation state as a pure derivation in `chain.ts`: which shots are stale or out of
      date, from which cause, and what a cascade would cost in generations. Derive continuity stale
      by comparing each selected take's producing job snapshot with current
      seed/predecessor/take/frame/endpoint state. Separately recompose the complete
      non-conditioning request and route and derive generation-out-of-date from
      prompt/Brief/rules/Look/line/Match To/aspect/resolution/route differences and whether the
      producing seed job's own historical reference remains active and digest-equal. Cover
      tail-versus-head trim asymmetry, selected-take replacement, `reorder_shots` invalidating
      downstream, `park_shot`/`restore_shot` invalidating the affected downstream active chain,
      `hard_cut` starting a fresh seed-pending segment, authored-request changes that leave
      conditioning equal, a 10-second selected Take remaining playable/actual after Shot planning
      duration changes to 8 while generation becomes out of date, and beat reorder changing nothing.
      Return unique active shot reports in
      film order capped with `STUDIO_MAX_DIRTY_SHOTS_REPORTED`; reject any implementation that leaves
      that contract constant unused. Import canonical composition/comparison from
      `generationRequest.ts`; `chain.ts` must not build a second request. Add one pure
      inbound-reference derivation used by `park_shot` and, over the union of its contained shots, by
      `park_beat`; current match-to, waiting authorization dependencies, and nonterminal downstream
      jobs/extractions consuming shot/take/frame lineage block, while historical terminal
      conditioning snapshots and receipts do not and instead project staleness.
- [ ] Treat a concretely bound nonterminal request as an inbound reference. `set_seed_still`,
      `select_take`, trim/reorder/hard-cut, route/request edits, park operations, and undo must refuse
      any change that would alter its selected concrete input or immutable request authority. An
      unbound symbolic dependent does not choose an output and blocks only changes that would destroy
      its authorized upstream item/shot relation. `park_take` may lift one of several eligible
      primaries, but refuses the last selectable primary while any transitive dependent waits on that
      item; restore makes the candidate eligible again. Terminal jobs remain immutable history and
      may become stale. RED park/restore, last-candidate, and bind-versus-park queue races.
- [ ] Implement `applyStudioMutationBatch(project, batch, context)` as a pure draft reducer returning
      the next project plus ordered created/retained/removed/fixed IDs. Every successful free authoring batch
      appends one bounded entry containing canonical before-fragments for exactly the project/beat/
      shot/Bin records it touched in the same revision; `undo_last` must be sole-op, CAS-aware, apply
      only those internal patches, revalidate the full result, and remain unable to alter provider
      jobs, receipts, or authorizations. `undo_last` consumes the current entry and never appends an
      inverse—redo is absent. Park/restore patches capture only the owning beat membership and Bin
      before-fragment; the shot and its paid arrays are never snapshotted or overwritten.
- [ ] Static fence the `schema2` directory from filesystem, IPC, job manager, resolver, adapter,
      polling, retry, cancel, and render imports.
- [ ] Mutation proofs: allow `apply_coverage` to move an active shot with takes and prove the
      fixed-point test fails; make `park_shot` reject terminal paid lineage or drop a retained record
      and prove the park/re-split test fails; bypass either current Match To or one nonterminal
      downstream consumer and prove the fail-closed test fails; incorrectly block a historical
      terminal conditioning input snapshot and prove the staleness test fails; make `reorder_shots`
      non-invalidating and prove the staleness test fails; let `park_beat` bypass one contained-shot
      blocker and prove the atomic union/refusal test fails; restore all mutations.
- [ ] Checkpoint: run
      `bunx vitest run tests/unit/process/creative-studio/service/schema2/mutations.test.ts tests/unit/process/creative-studio/service/schema2/chain.test.ts tests/unit/process/creative-studio/service/schema2/mutationIdentity.test.ts tests/unit/process/creative-studio/service/directorCommandContracts.test.ts tests/unit/process/creative-studio/service/directorCommandService.test.ts tests/unit/process/creative-studio/service/directorCommandProcessor.test.ts tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts tests/unit/process/creative-studio/service/directorCommandSpendFence.test.ts`.
      Keep this dependency-closed pure/Director set green. Do not run service/index, media-store, or
      render integration as a Task-2 green oracle: they still compile against job/route/output fields
      that Task 5 replaces inside the same atomic tranche. Task 5 owns those suites and the first
      whole-repository typecheck. The mechanically updated Director latency/lifecycle integrations
      use the real store and therefore join Task 3's checkpoint after its required-context store
      seam lands. Do not commit until the Task-5 gate closes.

### Task 3 — Schema-aware store inspection

Carries CS2 Task 3 almost intact. Only the seam type signatures change.

**Files**

- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/index.ts`
- Modify: `tests/unit/process/creative-studio/store.test.ts`
- Modify: `tests/integration/creative-studio/schema2Cutover.integration.test.ts`
- Modify: `docs/contributing/development.md`

**Steps**

- [ ] Add a bounded schema sniff before V2 parsing returning supported, unsupported V1, not-found,
      and malformed-V2 explicitly. Do not call `migrateSchemaV1Project` on the V2 path.
- [ ] Add V2 create/read/list/summary/update-batch store seams used only by V2 tests until Task 7.
      Keep rename+directory-fsync commit facts, one-revision CAS, summary-repair isolation, and
      commit tags unchanged. Change the internal store signature to require an exact
      `StudioMutationReducerContextV2` argument and pass it as the reducer's third argument; validate
      it before the queue and never derive it from renderer batch bytes. Direct tests supply fixed
      contexts, while Task 7's native handler mints one before invoking the store. Do not retain a
      two-argument call or optional/default context compatibility shim.
- [ ] RED a complete V1 profile tree and assert identical path set, bytes, metadata hashes, zero
      mkdir/write/rename/rm, and no quarantine.
- [ ] RED malformed schema 2 separately and prove it remains a loud quarantine failure — including a
      **CS2-shaped** schema-2 record, which is now malformed by construction and is what internal
      `Forge-Dev-2` profiles contain.
- [ ] RED fresh empty V2 create/restart, mixed V1+V2 listing, summary totals, batch rollback, stale
      CAS, and exactly one revision/observer fact.
- [ ] RED a store round trip with one lifted shot whose original beat is active and one whose original
      beat is binned. Preserve the shot and every asset/job/receipt/authorization/frame byte across
      update, atomic rename, index repair, and restart; summaries count neither lifted shot. RED stale
      CAS and a late invalid anchor/reference as zero-write rollbacks, and quarantine malformed
      active-and-binned, missing-owner, duplicate-shot-item, and in-flight-binned records loudly.
- [ ] Update `docs/contributing/development.md` with the fresh named profile workflow and manual
      profile removal only while the app is stopped. Add no app reset command.
- [ ] Mutation proof: route V1 through the old migrator and prove the no-touch test fails; restore.
- [ ] Run:
      `bunx vitest run tests/unit/process/creative-studio/store.test.ts tests/integration/creative-studio/schema2Cutover.integration.test.ts tests/integration/creative-studio/directorCommandLatency.integration.test.ts tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`
      as the Task 3 checkpoint. Do not commit or claim a repository typecheck until Task 5 updates
      the remaining final-contract consumers.

### Task 4 — The rate card, estimates, and receipts

**Files**

- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/{index.ts,rateCard.ts,estimate.ts,authorization.ts}`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/pricing/{rateCard.test.ts,estimate.test.ts}`
- Modify: `tests/unit/process/creative-studio/service/schema2/validation.test.ts`
- Move: the three existing adapter/resolver tests into
  `tests/unit/process/creative-studio/adapters/` before adding `pricing/`; this reduces the existing
  over-limit test directory to ten direct children. Stage and verify the byte-identical moves before
  pricing assertions change, then include them in the atomic tranche commit; do not create an
  intermediate schema-contract commit.

**Steps**

- [ ] Define the rate card: safe route ID, ISO currency, stable digest over canonical values, and an
      exact rate union — image routes use integer minor units per generation; video routes use
      integer minor units per second. Load it as config; it is never a provider API call in v1. A
      quote may contain exactly one currency and the route kind must match the job purpose.
- [ ] RED the estimate as a **range** over one set of shots, with in-flight work counted as context
      and never billed again, and with the cascade priced as a **separate** line from the base set.
      Lower is one generation per priced item; upper is the requested 1–4 generations per item.
      Reject
      mixed currencies, unsafe integer totals, missing rates, duplicated item IDs or
      `(shotId,purpose)` pairs across base/cascade, and any
      video line whose request plan is neither an exact `resolved` snapshot nor one valid
      `after_take_selection` dependency on an earlier same-authorization item. A quote prices that
      dependency but never speculates which generation the human will select or materializes a
      provider request from a symbolic input.
- [ ] Reuse the same checked per-generation/item total helper from persisted project validation.
      RED lower/upper totals understated or overstated by one, unsafe intermediate
      rate×duration×count arithmetic, and a tampered historical authorization after the current rate
      card changes. Recovery/load validity depends only on frozen item values, never a live card, but
      exact recomputation is mandatory before an authorization can dispatch.
- [ ] Derive every quote from active beat/shot membership. A lifted shot and its retained jobs,
      receipts, takes, and frames are historical context only: they appear in neither base nor cascade
      items and are never billed again. RED active → park and park → restore quote invalidation under
      exact revision comparison.
- [ ] Treat every nonterminal item for `(shotId,purpose)` as in-flight context, not a second quote
      line. RED cross-authorization waiting/queued/remote/needs-attention duplicates and prove each
      terminal outcome permits a fresh reviewed item without reusing its old job/key.
- [ ] RED that the pure quote's headline range, item counts, and generation counts are all derived
      from the same exact base/cascade arrays — a test that fails if any is computed independently.
      Task 8 owns the actual button-label consumption test.
- [ ] Validate `StudioPrepareSubmissionRequestV2` as untrusted main input. Re-derive the eligible
      ordered base/cascade graph; reject missing/extra/reordered/wrong-purpose choices, 0/5 counts,
      a video reference ID, or a seed reference that is absent, inactive, non-image, cross-project,
      or digest-mismatched. Return distinct `baseOnly` and optional `withCascade` quote IDs; the base
      option has no cascade items and the combined option repeats identical base items. Neither
      option is a renderer-authored graph. Derive every item ID with the shared
      `createStudioQuotedGenerationId`; RED the frozen vector, base-item equality across sibling
      options, duplicate prepare at one revision, confirmation of either sibling consuming both
      caches, and a cached/random/tampered item ID that differs from recomputation.
- [ ] Implement pure receipt derivation and correlation, recording route, seconds, generation count,
      and the complete frozen `StudioSpendReceipt` by value. RED image/per-generation and
      video/per-second formulas, safe integer bounds, the exact complete authorization-item/index/
      idempotency-key relation, authorization/item/job correlation, and that a rate-card change does
      not alter an existing receipt. Task 5 owns durable job persistence and crash recovery.
- [ ] Implement the budget predicate as its own pre-dispatch mechanism, scoped per batch, with its
      own breach shape. It is not a `forbidden_terms` variant and does not run per prompt. Compare
      the quote's upper minor-unit bound to the persisted `StudioSpendPolicy`. The currencies must
      match exactly; a configured-policy/quote mismatch is an explicit fail-closed refusal, never an
      absent or skipped cap. RED USD-policy/EUR-quote and EUR-policy/USD-quote before job creation,
      resolver/adapter/provider access.
- [ ] Derive `StudioRendererBudgetVerdictV2` from that same pure predicate for each safe quote option,
      never in renderer. RED `no_policy`, `within_cap`, `over_cap`, and `currency_mismatch`, exact
      policy currency/cap display facts, base-versus-cascade divergence, project revision mismatch,
      and projector by-value isolation. Confirm re-runs the predicate and never trusts the verdict.
- [ ] Implement pure quote derivation and confirmation comparison. The quote freezes project
      revision, exact ordered base/cascade item graph, route IDs, generation counts, immutable request
      plans, concrete-or-symbolic dependency edges, rate-card digest/values, currency, totals,
      and expiry. Main stamps one prepared time; both sibling options expire exactly
      `STUDIO_PREPARED_QUOTE_TTL_SECONDS` later, and no caller supplies or extends that metadata.
      Cache the immutable quote plus canonical prepare choices. Confirmation checks the
      original expiry, recomputes and byte-compares only `StudioSubmissionQuoteCore`, and persists the
      original ID/expiry by value; it never regenerates metadata or extends the window. Add
      clock-advanced-but-unexpired acceptance, exact-expiry refusal, regenerated-ID rejection, expiry-
      extension rejection, deterministic-item-ID mismatch, and restart-cache-loss REDs. No tolerant
      or subset comparison.
      Prepare and re-derive both import `generationRequest.ts`; pricing owns no second prompt,
      reference, or conditioning composer.
- [ ] RED quote tampering, expiry, revision change, route/rate/seed/predecessor/trim/take/order change,
      and budget change. The pure functions return explicit refusal and statically import no store,
      job manager, resolver, adapter, or provider module; Task 5 owns the zero-record/zero-call
      integration proof.
- [ ] RED the authorization graph and bounds: one base shot plus two downstream symbolic items in
      exact order; a seed item followed by its same-shot video item; wrong/future/cyclic/cross-beat
      dependencies; duplicate `(shotId,purpose)`; 24 versus 25 unique shots; 48 versus 49 items; and
      192 versus 193 item-generation jobs. Add a cross-authorization duplicate-idempotency-key RED;
      uniqueness is project-wide, not local to one quote.
- [ ] Mutation proof: make the receipt store a card reference instead of a value and prove the
      card-change test fails; restore.
- [ ] Checkpoint: run `bunx vitest run tests/unit/process/creative-studio/service/schema2/pricing` plus the moved
      adapter tests. Keep the tranche uncommitted until Task 5 wires every authorization/job consumer.

### Task 5 — Shot ownership, chain sequencing, and the conditioning frame

**Files**

> **This task is a lifecycle extension, not a rewrite.** `v2Service.ts`, `jobManager`, `mediaStore`,
> and their tests already carry the Task-1B Beat/Shot names and the CS2 lifecycle. Add seed-still
> purpose, authorization-time request plans, human-bound cascade dependencies, trim-aware
> extraction, and spend authority on top. Do not re-derive the idempotency, submission
> ambiguity, download recovery, cancellation, or retry-lineage logic — it is done and tested.

- Modify: `packages/desktop/src/process/services/creative-studio/service/index.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/preparedSubmissionCache.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/lifecycle.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/workspaceStatus.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioProjectSummary.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioCanonicalTake.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioOutputRole.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts`
- Create: `packages/desktop/src/process/services/creative-studio/adapters/conditioningFrame.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/renderService.ts`
- Modify: `tests/unit/process/creative-studio/service/index.test.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/preparedSubmissionCache.test.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/lifecycle.test.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/workspaceStatus.test.ts`
- Modify: `tests/unit/process/creative-studio/store.test.ts`
- Modify: `tests/unit/process/creative-studio/types/canonicalTake.test.ts`
- Modify: `tests/unit/process/creative-studio/types/projectSummaryV2.test.ts`
- Modify: `tests/unit/process/creative-studio/jobManager.test.ts`
- Modify: `tests/unit/process/creative-studio/mediaStore.test.ts`
- Modify: `tests/unit/process/creative-studio/adapters/providerAdapters.test.ts`
- Create: `tests/unit/process/creative-studio/adapters/conditioningFrame.test.ts`
- Modify: `tests/integration/creative-studio/renderService.integration.test.ts`
- Modify: `tests/integration/creative-studio/generationLifecycle.integration.test.ts`
- Modify: `tests/integration/creative-studio/projectRecovery.integration.test.ts`
- Modify: `vitest.creative-studio-coverage.config.ts`

**Steps**

- [ ] Preserve the existing V2 provider identity, idempotency, submission ambiguity, download
      recovery, cancellation policy, retry lineage, and rule enforcement while adding spend
      authority. Preserve lineage, not the old spend authority: retrying a local download or
      resuming/polling the same durable remote job uses no new provider submission; every retry that
      would make a new provider submission requires a new prepare/confirm and a new authorization
      item. Submission-unknown never silently mints a second charged attempt.
- [ ] Treat active-or-binned membership as authoring state, not media ownership. Media resolution and
      historical terminal job/receipt/frame lineage continue to resolve through a lifted shot, but
      readiness, quote, submit, retry, seed/take selection, and chain scheduling accept active shots
      only. RED every forbidden entrypoint for an individually binned shot or a shot contained by a
      binned beat before resolver/adapter/provider access. Because `park_shot` and `park_beat` refuse
      the same own/inbound in-flight authority over their exact shot set, recovery must never discover
      admitted in-flight work outside the active film; hostile persisted input fails validation rather
      than being repaired or dispatched. Add close/restart races around both park operations and prove
      zero resolver/adapter/provider calls on refusal.
- [ ] Add explicit job purposes. A reviewed `seed_still` job uses the selected image route and creates
      an image take; a `video_take` job uses the selected video route and persists its exact
      complete immutable request snapshot. The newest completed still becomes the default seed only while the user
      has not pinned another; generation completion never replaces a pinned seed or selected video
      take.
- [ ] Finish the existing V2 shot-reference import seam as the frozen human seed-still transaction.
      Main alone receives the picker path; mediaStore decodes/re-proves an image, writes one
      shot-owned `imports` asset with no Brief classification/job/spend record, and commits its asset
      membership under expected revision. RED picker cancel, wrong/ambiguous media, hostile path/
      replacement, wrong/binned shot, byte/asset/project caps, concurrent pin/generation/delete,
      every crash boundary, restart, latest-default tie order, explicit-pin precedence, and zero
      resolver/adapter/provider/spend. No renderer path or asset ID is accepted.
- [ ] Close the atomic schema transition: remove `StudioShot.mediaKind`,
      `StudioShot.referenceAssetId`, V2 `routing`, V2 `outputRole`, and V2
      `referenceInputSnapshot`; switch every service/job/media/projection consumer to final direct
      route IDs, all-video shots, seed-still purpose, and exact generation request plans. Make
      `purpose`, `authorizationId`, `authorizationItemId`, zero-based `generationIndex`,
      `requestPlan`, nullable `requestSnapshot`, `spendReceipt`, and `outputAssetIdsByRole` required
      on every V2 job, and add V2-only `waiting_for_conditioning`. A `resolved` plan has an equal
      snapshot and starts `queued_local`; `after_take_selection` is the only plan with a null snapshot
      and starts waiting, then becomes concrete exactly once before dispatch. Add a
      static/factory/validator ratchet proving all legacy V2 keys are rejected and no producer emits
      them.
- [ ] Replace the final common renderer aliases at the same boundary. Remove V2 from the legacy
      `jobOutputRole` fallback entirely; seed/video output decisions use purpose and the role map.
      Project no authorization or undo-before-fragment state and no job provider/idempotency/remote/
      cancellation/authorization/request/frame-extraction authority. RED the exact renderer keys,
      including raw `frameExtractions` absence, and prove a
      safe by-value receipt remains visible for cost display.
- [ ] Build one by-value `get_workspace_status` projector/result around the pure Task-2 derivations.
      It returns the exact current revision, renderer undo top, capped dirty-shot causes, authorized
      cascade progress, and ordered Beat/Shot/Take park/restore eligibility—nothing else. RED every exact
      key, cause/blocker order, active/Bin ordering, cap, `allowed` equivalence, load/commit/restart
      refresh, paid-only revision advancement, reachable Take-Bin and owner-Beat Shot-restore
      capacity blockers, explicit absence of unreachable Beat/Shot-Bin and project-Beat-capacity
      blocker codes, and forbidden raw authority. Reads perform zero
      mutation, resolver, adapter, or provider work after the shared attribution fence is clean;
      separately RED exact-after proposal sidecar repair before snapshot and no result on failed
      repair.
- [ ] Project `StudioCascadeProgressV2` explicitly from main. Include only active dependent/upstream
      shot IDs, eligible canonical primaries, safe reason, and the two derived action booleans; omit
      every authorization/item/key/provider/request identity. For each active dependent/purpose pair,
      select only the latest persisted authorization item; a newer bound/runnable/failed-after-attempt/
      succeeded item suppresses older terminal rows. RED old-cancelled→new-waiting/bound/succeeded,
      waiting upstream, choose seed/take, frame extraction/failure, dependency-failed, cancelled,
      restart, ordering, deduplication, action-flag truth tables, and the 1–4 asset bound. Freeze
      mixed-sibling precedence: all-cancelled only is `cancelled`; any remaining unbound
      dependency-failed sibling wins next; otherwise running, choose, and extraction follow the
      persisted item state. Cancelled siblings never revive when others bind or fail.
- [ ] Project the independent post-cancellation active-chain seam through exact
      `StudioGetChainStatusRequestV2 -> StudioRendererChainStatusV2`. RED cancel/restart with the same
      failed extraction, current predecessor/take/endpoint replacement, pending/extracting/ready
      suppression, a newer nonterminal authorization item, active-film ordering/deduplication, and
      exact forbidden keys. No raw frame/take/job/item/authorization/provider/managed-file ID may
      cross, and retry still re-derives the sole failed extraction from `dependentShotId` under the
      project queue.
- [ ] Change `canonicalVideoPosterV2` to use `outputAssetIdsByRole.poster`, never array position.
      RED a succeeded job with a third unroled output that still resolves the same cover, plus
      missing/duplicate/cross-owned role IDs.
- [ ] Make media persistence prove duration by decoded media, not request metadata. Canonical video
      primaries and bed audio persist required finite safe source duration; image records omit it. A
      provider-completed video whose duration cannot be proved follows the receipt-bearing
      `no_output` path. Preserve the immutable probed value after later Shot planning-duration edits;
      RED 10-second output → select → Shot duration 8 → restart with 10-second played/export/
      conditioning authority, generation-out-of-date true, and no record rewrite or provider call.
- [ ] Persist the exact receipt as soon as provider completion makes the generation billable and
      before validating or downloading its outputs. RED provider success followed by a missing
      primary, wrong-media primary, `no_output`, `download_failed`, restart, and retry-download: the
      one receipt remains byte-identical and no second charge/receipt is created. Submission-unknown,
      provider-declared/pre-provider failure, and pre-completion cancellation retain a null receipt
      until completion can be proven. Once it is proven, cancellation is closed and only local output
      validation/persistence or recovery may advance the job.
- [ ] Implement trim-aware local extraction in `conditioningFrame.ts`. RED an untrimmed exact
      Seedance take adopting its provider last frame; all other routes locally decoding; and a 10s
      selected take trimmed to 8s producing an 8s conditioning frame rather than reusing the 10s
      poster. Poster and conditioning-frame IDs, collections, and retention remain distinct.
- [ ] RED the recovery invariant: with the frame asset deleted from disk, recovery re-derives it and
      **never** re-renders. RED that the window closing mid-extraction or mid-chain stalls and resumes
      from the durable extraction/authorization record.
- [ ] Implement `retryConditioningFrameV2` as the exact provider-free failed→pending transition under
      the project queue. RED `decode_failed`, `source_missing`, and `storage_error`; close/restart
      before and after reset; repeated failure; selection of an alternate primary producing a
      different extraction ID; zero/multiple/historical failed-record derivation; waiting-item cancel
      → restart → same-ID active-chain retry → ready frame → fresh quote, plus refusal while a newer
      nonterminal item exists; and a poisoned resolver,
      adapter, and provider proving retry reaches none of them. The same ID is reused and no
      authorization/job/receipt/charge changes.
- [ ] Implement `cancelWaitingCascadeV2` as one queued item-level action. RED one to four waiting
      siblings, already-cancelled siblings, a later transitive waiter, stale revision, zero/multiple
      candidate items, any bound/mixed/attempted/receipt-bearing sibling, close/restart, repeated
      click, and a poisoned resolver/adapter/provider. Success cancels every remaining waiting sibling
      atomically, retains authorization/job history, dependency-fails later unbound dependents, and
      creates no receipt/refund/charge/provider cancellation. No renderer-supplied job/item/auth ID is
      accepted.
- [ ] Implement the human binding barrier for authorized cascades. Confirm writes every item/index
      job and its immutable plan before any provider call. Resolved inputs materialize equal
      snapshots immediately; symbolic jobs remain `waiting_for_conditioning` and undispatchable with
      null snapshots. After the
      author explicitly pins/selects the canonical `primary` output of a succeeded generation job for
      the exact earlier authorization item, main re-proves project/authorization/job/role/output
      ownership, derives `take.durationSeconds - (trimOutSeconds ?? 0)` from the selected immutable
      Take under the project queue, waits for or derives that exact endpoint frame, and commits one
      concrete snapshot under the project queue before dispatch. The symbolic dependency carries no
      speculative endpoint.
      RED one shot plus two downstream items through two selection barriers, a seed item feeding its
      same-shot video, close/restart before and after each bind, selection of an older/unrelated take,
      a poster or unroled third output, duplicate binding, binding after any provider attempt, and
      every project/directory/record race. Inject a crash between per-job writes and prove the item is
      either wholly waiting or every non-cancelled sibling has one byte-equal concrete snapshot,
      never mixed.
      A null `seedStillId` may still derive the latest still for ordinary readiness, but completion
      changing that derived default never satisfies `authorized_seed`: RED that only a persisted
      explicit `set_seed_still` to that item's primary binds/dispatches. No path auto-selects a take,
      mutates a template, or asks for a second confirmation. Binding and dispatch both import the one
      `generationRequest.ts` materializer and byte-compare its output; neither rebuilds a request.
- [ ] When an upstream item becomes all-terminal with no selectable primary, atomically fail every
      transitive unbound dependent as `dependency_failed` without a provider attempt, snapshot,
      receipt, or output. RED partial success (remain waiting), all-failed, restart before/after the
      terminalization, a fresh quote from the failed frontier, and no double billing or cross-
      authorization rebinding. RED explicit cancellation of a waiting job and cancellation of every
      upstream generation: cancelled jobs never bind or spend, and the latter terminalizes its
      dependents by the same rule. Also RED cancellation of a resolved/bound queued job before
      provider completion: it retains the exact concrete snapshot across restart, gains no receipt or
      output, and cannot create a mixed-snapshot sibling item.
- [ ] Implement chain sequencing: a shot is submitted only once its predecessor has succeeded and its
      exact selected-take/endpoint frame exists. Segment heads require a current selected seed. RED
      seed-pending authoring accepted but video submission refused; mid-chain failure keeps the
      partial, records receipts only for provider-completed generations, and resumes exact
      already-authorized jobs from the break. A seed/take produced by one authorization is never
      auto-selected; an authorized dependent consumes it only through the human selection and
      one-time concrete binding encoded by that same authorization graph.
- [ ] Add one narrow async V2 store transaction for confirmation. Under the existing per-project
      write queue it loads and freezes the exact current V2 snapshot, checks `expectedRevision`,
      awaits only main resolver/rate/config revalidation, validates one returned next project, and
      rechecks the current clock against the cached exact expiry immediately before persisting that
      project in one revision and releasing the queue. Refusal, throw, close, expiry, or
      validation failure before the write changes no bytes; no callback may call the adapter/provider,
      perform a nested project update, or leak a mutable project reference. Dispatch descriptors are
      returned only after durable success and provider work starts outside the transaction. RED an
      edit queued before/after confirm, delayed resolver, callback throw, close before the write,
      resolver delay crossing exact expiry, persistence ambiguity, and restart; authorization plus
      the complete job set are all-or-none.
- [ ] Implement unregistered `prepareSubmissionV2` and `confirmSubmissionV2` service seams. Confirm
      uses that transaction for quote re-derivation and durably commits the authorization plus all
      idempotent jobs before dispatch. A close after authorization may resume only that exact ordered
      base/cascade dependency graph; a merely stale downstream shot without authorization never
      auto-dispatches. Prepare accepts only the frozen choice request and returns the distinct
      base-only/combined quote options; confirming either one consumes both sibling cache entries so
      the alternative cannot later be confirmed from the same review. Prepare resolves one main-only
      provider binding per item into the cache; confirm re-resolves and byte-compares every binding
      before the atomic commit, persists the exact list, and copies it to all item jobs. Missing or
      changed bindings refuse before job creation. In the Task-5 tranche,
      `originReferenceHandoffId` must be null and every non-null value is refused before resolver or
      mutation; Task 8 enables the field only after Task 6's exact decision/receipt store exists.
- [ ] Implement the prepared-session cache as the only owner of unconfirmed quotes. RED one below,
      at, and above every per-session, per-project, and global byte/count limit; multibyte UTF-8 byte
      accounting; serialized-copy/deep-freeze mutation isolation; deterministic oldest/tie eviction;
      expired reclamation before admission and lookup;
      sibling consumption; same-project quote-ID collision refusal; cross-project same-ID isolation;
      project/quote-core mismatch; evicted/expired/unknown `quote_not_found`; and empty-cache restart.
      Flood it from two projects and prove memory never crosses the frozen global bound. Every refusal or
      eviction leaves project/reference bytes unchanged and reaches no adapter or provider. Exact-byte
      admission occurs after main-only binding resolution because those bindings are part of the
      accounted session; that resolver access grants no mutation or spend authority.
- [ ] RED confirming-session claims under delayed resolver/config and persistence: duplicate/sibling
      `quote_in_use`, idle-only eviction, claimed-only `quote_cache_full`, second expiry while claimed,
      release after each precommit refusal/throw, success consumption, close disposal, and strict
      cache-mutex→project-queue ordering. Start more delayed confirms/prepares than every global count/
      byte limit and prove claimed sessions remain counted/non-evictable, no live cached object escapes
      accounting, and no evicted/expired quote can reach durable commit or provider work.
- [ ] Carry the exact `StudioSubmissionCacheErrorCodeV2` union through service results. RED
      `quote_too_large`, claimed-only `quote_cache_full`, duplicate `quote_in_use`, and scoped
      `quote_not_found` as distinct stable codes; none may be rewritten as a provider, project,
      budget, or generic storage failure, and every case preserves project/reference bytes.
- [ ] RED precommit confirm races: project/route/rate/budget/order/seed/take/trim/frame/reference
      change, expiry, duplicate/sibling-option confirm, and close immediately before durable
      authorization. Each refusal leaves zero new authorization/job records and reaches no adapter or
      provider. Ordinary quote/content refusals stop before resolver; the explicit missing/changed-
      provider-binding cases may resolve config but still perform no adapter/provider work.
- [ ] RED the postcommit boundary separately. Close immediately after durable authorization and
      resolver/adapter/provider failure or throw must retain the exact authorization, binding list,
      and all precreated jobs. Transition only the affected job through the existing definitive-
      failure versus submission-ambiguity rules; receipt stays null unless provider completion is
      proven, and no path silently retries or deletes authority. No provider call may precede the
      durable commit or use a null/mismatched snapshot.
- [ ] RED paid retry authority: retry-download and same-remote-job polling reuse the original job and
      receipt without a provider submit; definitive provider failure and acknowledged
      submission-unknown may prepare a new quote but cannot submit until a new human confirm. Poison
      the provider and prove every legacy retry entrypoint stops before it without that authorization.
- [ ] Make Brief-reference detach preserve immutable request authority. A prepared-but-unconfirmed
      cache entry gives no retention right and becomes stale after detach. Once any persisted
      nonterminal job plan names the import, detach returns `media_in_use` and preserves the project,
      asset record, and managed bytes exactly. Dispatch re-resolves the canonical import and verifies
      its frozen digest and on-disk bytes before provider access. After all referencing jobs are
      terminal, detach may delete the live asset/file; the safe ID and digest retained by value keep
      authorization/job history and generated outputs valid without pretending the input media still
      exists. RED confirm-vs-detach, restart with queued seed input, missing/replaced managed bytes,
      terminal detach with a retained generated primary, and every cleanup/retention route.
      Extend the exact main media-error union and later native mapping with `media_in_use`; V1 detach
      behavior remains byte-for-byte unchanged.
- [ ] RED that retention cannot reach takes, seed stills, or conditioning frames, and that the
      existing project write-admission cap refuses a new large write without evicting anything. Add a
      lifted shot with terminal paid lineage and prove retention, cleanup, and restart leave every
      referenced byte and record untouched. Include every live Brief import needed by a nonterminal
      request plan in the same non-eviction proof.
- [ ] Mutation proof: allow submission without the predecessor's frame asset and prove the
      sequencing test fails; restore.
- [ ] Atomic tranche gate: rerun each exact Task 1C–4 checkpoint plus
      `bunx vitest run tests/unit/process/creative-studio/jobManager.test.ts tests/unit/process/creative-studio/mediaStore.test.ts tests/unit/process/creative-studio/store.test.ts tests/unit/process/creative-studio/service/index.test.ts tests/unit/process/creative-studio/types/canonicalTake.test.ts tests/unit/process/creative-studio/types/projectSummaryV2.test.ts tests/unit/process/creative-studio/adapters/providerAdapters.test.ts tests/integration/creative-studio/renderService.integration.test.ts tests/integration/creative-studio/generationLifecycle.integration.test.ts tests/integration/creative-studio/projectRecovery.integration.test.ts`.
      Then run `bun run test`, `bunx vitest run --coverage --config vitest.creative-studio-coverage.config.ts`,
      `bunx tsc --noEmit`,
      `bun run lint --quiet`, `bun run format:check`, and `git diff --check`. Re-run the native parity
      absence oracle. Keep the coverage config exactly equal to the executable production diff from
      frozen Task-1B head `b37e00e4f`; remove deleted `cuts.ts`, add frame extraction, chain, pricing,
      generation-request, submission-identity, mutation-identity, spend-math, common project-summary
      planning-boundary branches, and conditioning-frame modules, and require every listed file at least 80%
      lines and branches.
- [ ] Prove public-surface absence against `b37e00e4f`, not merely manifest/schema parity:
      `git diff --exit-code b37e00e4f -- packages/desktop/src/common/adapter/native/constants.ts packages/desktop/src/common/adapter/native/payloadSchemas.ts packages/desktop/src/common/adapter/ipcBridge.ts packages/desktop/src/process/bridge packages/desktop/src/preload packages/desktop/src/process/services/creative-studio/runtime.ts packages/desktop/src/renderer`.
      Also require
      `git status --porcelain -- packages/desktop/src/common/adapter/native packages/desktop/src/common/adapter/ipcBridge.ts packages/desktop/src/process/bridge packages/desktop/src/preload packages/desktop/src/process/services/creative-studio/runtime.ts packages/desktop/src/renderer`
      to be empty; the diff alone cannot see an untracked public-surface file.
      Add explicit forbidden-key assertions for Beat/Shot mutation, `park_shot`, `restore_shot`,
      `prepare_submission`, and `confirm_submission` native providers. Mixed V1/V2 main files use
      behavioral V1 byte-tree/no-touch oracles rather than impossible whole-file identity.
- [ ] Commit the dependency-closed, full-suite-green tranche:
      `feat(studio): define beat and shot core`.

### Task 6 — Director, proposals, and the full MCP operation surface

> **Also a rename plus an addition.** CS2 Task 5 already built the Director command mailbox,
> processor, spend fences, the four MCP record writers, and `studio_apply_edits` carrying a
> `mutation_batch` — 6,212 production lines and ~7,500 test lines, of which only a few hundred
> reference the renamed vocabulary. The "every hand gesture as an MCP op" surface exists; this task
> renames its ops and adds the ~12 CS3 introduces. `requiredAction` appears zero times in that code,
> so dropping required actions is free.

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Modify the Director command service, mailbox, processor, writer, and spend-fence modules and their
  tests as the V1 equivalents are versioned.
- Modify: the builtin Studio MCP server and its tool definitions.
- Modify: proposal/reference store, service, MCP, and integration tests; add restart/race cases to
  `tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`.

**Steps**

- [ ] Rename the Director, proposal, and reference record vocabulary to Beat/Shot. Preserve the
      mailbox, processor, latency, and spend-fence behaviour — it is built and tested.
- [ ] Complete the MCP edit catalog with one exact schema/parser variant for every final reducer
      gesture, all routed through the same validation vocabulary as renderer edits. Keep it
      unregistered through Task 6; Task 7 registers the complete catalog atomically with the public
      cutover. Direct and proposal policy sets reference the catalog's variants rather than defining
      duplicate payload schemas. RED that Beat-add variants reject legacy first-Shot fields and that
      an ordered `add_beat` followed by `add_shot` or coverage proposal is the only catalogued atomic
      spine-to-coverage composition. The catalogued `set_rules` variant accepts exact
      `StudioBriefRuleDraft[]` only; reject `scope`, `createdAt`, organisation provenance, and unknown
      keys even though current capability still returns `operation_not_permitted` before reducer
      access.
- [ ] Freeze Director policy in executable capability checks, not prompt prose.
      `studio_apply_edits` validates the full edit catalog, then the current Director capability
      permits only direct-safe text/pre-picture operations; structural/staleness changes require the
      proposal capability, except for §13.6's paid hard-cut topology transition, which the current
      Director may neither apply nor propose. Motion/take decisions (`select_take`, take park/restore), Cut choices,
      undo, and lifted-beat/shot park/restore parse as known future MCP gestures but return exact
      `operation_not_permitted` before writer/publication/reducer access for the current Director. A
      re-split proposal must persist each active fixed Shot and its exact canonical reason rows inside
      the `apply_coverage` operation, but may not bundle `park_shot`; lifting paid coverage remains an
      explicit human-native action. RED writer/parser/list/restart preservation, reason ordering,
      missing/extra/reordered/tampered reasons, base-revision re-derivation, full-catalog parse parity,
      each capability allow/deny edge, zero side effects for denied calls, and continued absence of
      registration until Task 7. Paid prepare/confirm remains outside the edit catalog.
- [ ] RED the spend fence against the new surface, including operations that are free but create
      staleness: the director may create staleness only through a reviewed proposal, never silently.
- [ ] Finish schema-2 store ownership for proposals: list/watch/accept/reject/expire/reap exact V2
      records and decisions. Acceptance applies a mutation proposal through the reducer inside the
      same project queue, commits once, writes one durable decision, and releases only the matching
      slot. Accepted retry is idempotent and never reapplies or re-notifies. V1 sidecars remain
      byte-identical unsupported data.
- [ ] Accept `pin_rule` by deriving the next exact rule-draft list and applying one reducer
      `set_rules` operation inside that same queue/commit protocol. The reducer alone preserves/mints
      persisted provenance from current state/context. It never writes `ruleListUndo`, bypasses the
      unified journal, or gives the Director a direct rule mutation.
- [ ] Make re-derivation a reviewed text proposal, not hidden reducer generation. The Director
      proposes exact `rederive_line { shotId, line }` against the current action revision; acceptance
      re-proves CAS, archives the displaced detached line, and applies that supplied line through the
      pure reducer. Direct invocation under the current Director capability is refused. RED stale
      action/proposal, empty/oversized line, history cap, retry/restart, and a poisoned LLM during
      reducer execution.
- [ ] Implement the frozen `StudioProposalCommitAttributionV2` journal protocol; the process-local
      `StudioProjectCommitFacts` observer is never recovery authority. RED crash/close after
      attribution fsync, after project rename/fsync, after accepted-decision rename/fsync, and before
      attribution/slot quarantine; exact-before returns the proposal to pending, exact-after repairs
      one accepted decision without reducer or duplicate notification, and an existing exact decision
      only completes cleanup. Wrong proposal/project, base/applied revision, before/after digest,
      created IDs, timestamp, inode, directory generation, or replacement preserves every byte and
      fails loud.
- [ ] Install the attribution resolver as the first per-project queued fence for load/status,
      authoring, confirm, paid/local lifecycle writes, and delete. RED an accepted-
      decision write failure without process exit followed by each operation class: none may expose a
      newer project or mutate/delete bytes until the exact decision repairs. Cover repeated repair
      failure, concurrent waiters, a background paid-result write, close, and successful same-process
      repair followed by one normal next revision. The journal is not new spend authority and does
      not replace the Task-5 idempotent provider lifecycle.
- [ ] Finish schema-2 reference-request ownership with the same list/watch/decision discipline.
      Every terminal path writes exactly one `StudioReferenceRequestDecisionV2`: rejection, expiry,
      selection of an already-imported active Brief reference tied to the current project revision, or
      a generation handoff with one safe ID and ordered active shot IDs. Acceptance never imports new
      bytes; the user must use the ordinary media import first, which removes an otherwise ambiguous
      cross-file commit. The generation outcome performs no prepare/provider work and remains pending
      for UI consumption until one exact handoff receipt exists. Publish/list/read/repair the decision
      and receipt with the same identity/directory fences as proposals; V1 sidecars remain no-touch.
- [ ] RED project-scoped handoff identity: duplicate safe IDs across two generation-gate decisions,
      duplicate/mismatched `(handoffId, requestId)` receipts, two authorization origins, receipt-to-
      wrong authorization, directory replacement, restart, and same-ID decisions in different
      projects. Only the cross-project-isolated case is valid; every same-project collision preserves
      bytes and grants no prepare/dismiss/confirm/cleanup authority.
- [ ] RED that proposal cards—including every ordered fixed-Shot reason row—and reference requests
      survive restart, stale CAS, decision-write
      ambiguity, duplicate watchers, selected-import replacement/revision races, expiry/reap,
      generation handoff without a
      receipt, confirmed/dismissed receipt-first repair, and replacement races. Opening/preparing a
      handoff writes no receipt; a confirmed receipt must name the one authorization whose frozen
      origin ID matches. Required actions are absent, their product cases represented by the render
      and chain gates.
- [ ] Account for each operation as a reducer op, unregistered MCP schema/parser variant, explicit
      current policy disposition (`direct | proposal | operation_not_permitted`), exact projection,
      and test. **Do not** add native constants, payload schemas, manifest entries, bridge providers,
      or renderer types in Task 6; those land together in Task 7.
      Human-only Beat/Shot park/restore are accounted for by full-catalog presence, current-capability
      refusal tests, and native ownership, not by proposal acceptance.
- [ ] Mutation proof: let a director path create staleness outside a proposal and prove the fence
      test fails; restore.
- [ ] Run the full suite and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): version director commands for beat and shot`.

### Gate 1 review checkpoint

- [ ] Freeze the exact Task 1–6 head and obtain independent process/schema and security/spend review.
- [ ] Run the focused three-kind Bin proof across validator, reducer/chain, store/restart, pricing,
      job/media lifecycle, and Director/MCP absence suites. The positive oracle is a rendered terminal
      shot parking with byte-identical paid lineage and then surviving re-split; the negative oracles
      are active-and-binned ownership, own in-flight work, current Match To, and each nonterminal
      downstream job/extraction actively consuming its lineage. Prove a historical terminal
      conditioning snapshot permits parking and becomes stale. Independently review original-beat
      restoration and the distinction between active blockers and historical lineage before
      accepting the gate. Repeat the same proof for `park_beat` over the union of its contained shots:
      no partial move, per-shot alias, provider call, or admitted in-flight work outside the active
      film. Re-split one Beat with every fixed-reason family and prove validator, reducer,
      proposal/list/restart projection, and review-card order all carry the same complete canonical
      rows; one missing, extra, or reordered reason must fail before mutation.
- [ ] Verify V2 code is still unregistered from the renderer bridge, current V1 UI behavior is
      unchanged, and no V1 profile tree changed during tests. This check is what certifies the pivot
      premise: the vocabulary must never have reached the bridge, the manifest, or the renderer.
- [ ] **Verify the rename by running the whole suite, not the changed files.** Roughly a thousand
      identifiers moved across thirty-odd files and 18,874 lines of tests. A slice's own tests
      passing says nothing about what it broke elsewhere, and this repo has already carried a red
      cross-file parity test for four slices because nobody ran the repo-wide gate.
- [ ] Run `bun run test`, `bun run test:coverage`, `bun run lint --quiet`, `bun run format:check`,
      `bunx tsc --noEmit`, and `git diff --check`.
- [ ] Update `vitest.creative-studio-coverage.config.ts` to exactly the Task 1–6 executable production
      diff and run it with coverage. Record every file's line/branch result; all must be at least
      80/80. Assert native manifest/provider inventory and renderer/preload/runtime activation remain
      absent, not merely unused. Include every new shot-Bin validator, ownership, inbound-reference,
      reducer, summary, and lifecycle branch in the executable manifest.
- [ ] Resolve every Critical/Important finding in separate commits and re-review before Task 7.

---

## Delivery Gate 2 — atomic cutover and the shell

### Task 7 — Atomically switch runtime, bridge, routes, and renderer

Carries CS2 Task 6 in shape: one atomic switch, legacy deletion in the same task, no dual contract.

**Primary tests:** `tests/unit/process/creative-studio/runtime.test.ts`,
`tests/unit/process/bridge/nativePayloadSchemas.test.ts`,
`tests/integration/creative-studio/schema2Cutover.integration.test.ts`, and
`tests/e2e/features/workspaces/creative-studio.e2e.ts`.

**Steps**

- [ ] RED exact native provider inventory and manifest/schema parity, then add every Beat/Shot
      constant, payload schema, provider, and manifest entry in this task only. No Section/Clip V2
      provider survives the same commit.
- [ ] Register exact renderer-safe `apply_authoring_batch` and `undo_last` providers. The first
      accepts only `StudioApplyAuthoringBatchRequestV2` and returns only
      `StudioRendererProjectCommitResultV2`; the second accepts only `StudioUndoLastRequestV2` and returns
      that same result. Add constants/schema/manifest/IPC/process-bridge/preload/runtime parity,
      1/N/N+1 operation counts, unknown/sparse keys, created-ID/result revision order, stale CAS,
      rollback, restart, and duplicate-click tests. Exhaustively prove the allowed operation-kind set
      and reject every narrow Take/Bin/park/Cut/media/cascade/settings/rules/undo operation plus
      `apply_coverage` and `rederive_line` before reducer access. A renderer cannot submit
      `StudioMutationBatchV2`, reducer context, or any catalog-only operation. Task 14 owns the undo
      UI/conflict hardening, not a later transport invention. For every reducer-backed/queued-free
      narrow provider registered here, assert the same exact commit-result keys, empty created arrays
      where applicable, and explicit absence of `project`, jobs, frames, undo internals, and internal
      mutation result fields.
- [ ] Carry the Task-5 `media_in_use` detach refusal through the V2 service/native error mapping and
      renderer key without changing the V1 detach payload or behavior. The UI names the queued paid
      request that must finish or be cancelled; it never retries deletion behind the user's back.
- [ ] Register the read-only human-native `get_workspace_status` provider with exact
      `StudioGetWorkspaceStatusRequestV2` input and `StudioRendererWorkspaceStatusV2` result. Add
      constants/schema/manifest/bridge/preload parity, exact-key and revision-consistency tests, and
      exact allowlist/forbidden-authority assertions for undo, dirty, cascade, and park-eligibility
      projections. Positively preserve `undoTop.entryId`, each owner-checked Take-subject `assetId`,
      and each bounded canonical `eligiblePrimaryAssetIds` choice while rejecting every
      non-allowlisted identity. After the attribution fence is clean, reading performs zero mutation,
      retry, resolver, adapter, or provider work; exact-after proposal decision/cleanup repair is the
      sole pre-snapshot exception and a failed repair returns no result.
- [ ] Register the read-only human-native `get_chain_status` provider with exact
      `StudioGetChainStatusRequestV2` input and `StudioRendererChainStatusV2` result. Add native
      constants/schema/manifest/bridge/preload parity and exact-key tests; forbid frame/take/job/item/
      authorization/provider/managed-file IDs, suppress historical and authorized-nonterminal rows
      according to the frozen projector. Prove the clean path performs zero mutation, retry, resolver,
      adapter, or provider work, while only exact proposal-attribution repair may precede a snapshot
      and failed repair exposes none.
- [ ] Add the narrow human-native `retry_conditioning_frame` payload/provider with exact
      `{ projectId, expectedRevision, dependentShotId }` keys. Main derives the sole exact currently
      required failed extraction under the queue; historical/alternate ambiguity refuses. It calls only Task 5's queued local
      retry seam, is absent from Director/MCP and paid-confirmation schemas, and has provider-poison,
      stale-CAS, close, and duplicate-click tests.
- [ ] Add the sibling human-native `cancel_waiting_cascade` payload/provider using the same exact
      `{ projectId, expectedRevision, dependentShotId }` schema. It calls only Task 5's queued
      item-level cancellation seam, remains absent from Director/MCP and paid-confirmation schemas,
      and has manifest/bridge/preload parity, stale-CAS, ambiguity, restart, duplicate-click, and
      zero-provider-call tests. No job/item/authorization ID crosses.
- [ ] Replace the legacy scene-shaped `update_project` public path with exact V2 `edit_project`,
      accepting only `StudioEditProjectSettingsRequestV2` and routing its changes through the Task-2
      reducer/store queue. Add constants/schema/manifest/bridge/preload/runtime parity, all four
      fields and partial combinations, hostile/empty keys, stale CAS, restart, undo, bound-request
      refusal, staleness projection, and current-Director `operation_not_permitted`. The old provider/
      payload is removed in this cutover, not retained as an alias.
- [ ] Replace the existing human rule-editor boundary with exact `set_rules`, accepting only
      `StudioSetRulesRequestV2` and returning only `StudioRendererProjectCommitResultV2`. Main
      supplies reducer context under the queue and one draft-shaped reducer operation performs the
      canonicalization. RED unknown keys, renderer/MCP-supplied `scope`/`createdAt`, organisation
      scope, duplicate/hostile IDs, preservation of an existing rule's timestamp, context minting for
      a new ID, byte-equal native/pin-rule/future-MCP convergence, undo/restart/stale CAS, and
      manifest/bridge/preload parity. Keep this provider distinct from the generic authoring subset
      and from Director `pin_rule` proposal acceptance.
- [ ] Add the human-native `park_beat`, `restore_beat`, `park_shot`, and `restore_shot` providers
      atomically with the renderer cutover. Their payloads are exactly
      `StudioParkBeatRequestV2`, `StudioRestoreBeatRequestV2`, `StudioParkShotRequestV2`, and
      `StudioRestoreShotRequestV2`; all route through the Task-2 reducer/store queue and all appear in
      the full MCP edit catalog while the current Director capability rejects them before side
      effects. Native parity, full-catalog presence, capability refusal, manifest, bridge, preload,
      runtime, and renderer tests must fail if any side is missing, renamed, authorized to the current
      Director, or registered twice.
- [ ] Add exact human-native `park_take`, `add_alternate_take`, `restore_take`, and `select_take`
      providers, each accepting only `StudioTakeActionRequestV2`, plus `reorder_bin` accepting only
      `StudioReorderBinRequestV2`. All call their same-named Task-2 reducer operation through the
      project queue; renderer never sends a generic mutation batch. Add constants/schema/manifest/
      bridge/preload/runtime parity, hostile-key/stale-CAS/duplicate-click tests, and exact Task-6 MCP
      catalog/capability parity. Current Director take decisions remain
      `operation_not_permitted`; no native action reaches a paid boundary.
- [ ] Cut the existing main-picker image-import seam over as exact `import_seed_still`, accepting only
      `StudioImportSeedStillRequestV2`. The renderer supplies no path, file, MIME, asset ID, Brief
      classification, or route; main calls only the Task-5 crash-safe local import transaction and
      returns only `StudioImportManagedMediaResultV2`. Add constants/schema/manifest/bridge/preload
      request/result parity, cancel/stale/replacement/restart tests, and
      provider/resolver/adapter spend poison. Keep the project-owned Brief-reference import provider
      distinct; neither asset role can be substituted for the other.
- [ ] Replace public `StudioProject`/renderer aliases with the Beat/Shot types; delete staging seams.
- [ ] Implement one runtime activation controller with explicit
      `inactive | activating | active | degraded | disposed` state and a supported-project ID set.
      Startup classifies the root before constructing or starting any V2 watcher, timer, cleanup,
      recovery, resolver, adapter, media protocol, or mailbox. Mixed roots feed V2 IDs only.
- [ ] RED the full activation lifecycle: V1-only startup stays inactive; the first successful V2
      project commit triggers one single-flight activation; concurrent create/import events do not
      double-install; partial startup disposes everything it installed and enters degraded; the next
      inventory event retries; deleting the last V2 project stops per-project lifecycle; shutdown
      during activation disposes once. A failed project commit never activates.
- [ ] Register only V2 bridge providers; remove legacy scene providers; switch the builtin MCP server
      to the reviewed V2 entrypoints and delete the V1 entrypoints. Register the complete Task-6 MCP
      edit catalog while retaining its exact current-Director capability gate; every forbidden known
      gesture returns `operation_not_permitted` before writer/publication/reducer access.
- [ ] Delete the `StudioPage` Director reference-request auto-submit and auto-dismiss path before any
      V2 paid provider becomes reachable. Wire the reviewed V2 proposal/reference list, watch, and
      decision APIs. An accepted generation decision surfaces only as one persistent unconsumed
      `StudioRendererReferenceGenerationHandoffV2` card; the durable receipt's authorization ID never
      crosses. Task 8 owns opening/preparing the gate and publishing its dismissed/confirmed receipt.
      Task 7 performs zero prepare, resolver, adapter, or provider work and its full-green
      commit remains usable before the workspace gate exists.
- [ ] Delete the schema-1 `validateProject` in `store.ts` and every predicate and value set it alone
      keeps alive, so schema 2's copies become the only definitions. Assert each name has exactly one
      definition under `creative-studio/`.
- [ ] Delete the storyboard model role and the `planning/` directory and its tests.
- [ ] Set `STUDIO_VIEWS` to `['table', 'board', 'cut']`. This is a **shared constant**: a main-process
      regex gates the unsaved-work close dialog, so it is not renderer-only.
- [ ] Delete the scene-based Write, Produce, Review, and Export implementations rather than projecting
      beats as scenes.
- [ ] Register read/free-authoring/proposal/reference V2 providers, but keep both paid
      `prepare_submission` and `confirm_submission` absent from native constants, schemas, manifest,
      bridge, and preload until Task 8 lands the reviewed gate and sanitized quote projector
      atomically. No internal full quote crosses merely because prepare itself is read-only.
- [ ] Run the full suite and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): cut over the workspace to beat and shot`.

### Task 8 — Workspace projection, drafts, selection, and gate state

**Tests:** create `tests/unit/pages/studio/workspace/WorkspaceProjection.test.ts` and
`tests/unit/pages/studio/workspace/SpendGate.dom.test.tsx`; extend service/index and workspace E2E.

**Main/public ownership:** modify the Task-5 service/store confirmation seams and tests plus the
Task-7 native constants, payload schemas, provider manifest/inventory, bridge/preload types, and their
parity tests. This task atomically enables non-null reference handoffs and adds both
`prepare_submission` and `confirm_submission` using the renderer-safe quote projector, plus the exact
free `dismiss_reference_generation_handoff` provider; no later UI task owns a paid boundary.

**Renderer structure:** create `components/Workspace/` under the currently compliant
`components/` parent. Task 8 starts it with `index.ts`, `workspaceProjection.ts`,
`useWorkspaceDrafts.ts`, `spendGate.ts`, and `Views/{index.ts,viewTypes.ts}`. Task 9 adds the shell
and `DirectorRail/`; Task 11 adds `BeatPanel/`; Table, Board, and Cut live under `Views/`. Every leaf
directory has component plus styles/tests as applicable, and `Workspace/` stays at no more than ten
direct children.

**Steps**

- [ ] Build the shared sanitized projection consumed by Table, Board, beat panel, and Cut. Project
      active shots from `shotOrder` only and project all three Bin reference kinds separately; a
      lifted shot exposes its recorded owner, authored fields, deterministic cover, take count, and
      display state without exposing provider credentials or mutable paid records. Consume park/
      restore eligibility for Beat, Shot, and Take plus stable blocker codes only from the revision-matched
      `StudioRendererWorkspaceStatusV2`; never infer them from stripped jobs or frame records.
- [ ] Consume only `workspaceStatus.undoTop` from the authoritative journal projection after load and
      every commit. RED restart, paid-only revision advancement, a new authoring top, consumed top,
      status/project revision mismatch, and stale expected revision; no patch, digest, or
      before-fragment crosses the service/bridge.
- [ ] Implement draft persistence and the selection model once, shared across views.
- [ ] Cut over the existing human project-settings editor to exact `edit_project`: name, project
      target duration, aspect ratio, and resolution share draft/save/CAS behavior but remain distinct
      from Beat target. Show that name/target are non-generative, while aspect/resolution changes mark
      affected generated work out of date and require a new reviewed gate; a bound nonterminal request
      disables only the request-shape fields with the stable refusal. RED partial saves, reset, undo,
      restart, stale status/project revision, i18n, and legacy-provider absence.
- [ ] Put image-route and video-route selection in the Brief, using the sanitized catalog and exact
      readiness projection. Missing image route blocks seed generation only; missing video route
      blocks video generation only. No default route is silently selected by main. Brief/route saves
      call only `apply_authoring_batch` with allowed exact operations and current revision; governed
      rule drafts call only narrow `set_rules`. Renderer never sends persisted rule provenance, the
      full reducer union, or context.
- [ ] Put the human spend-policy control in the Brief beside routes. It sets or clears one exact
      `{ currency, maxPerBatchMinorUnits }` through the allowed `set_spend_policy` member of
      `apply_authoring_batch`, not paid confirm or an ad hoc provider; UI converts display
      units to safe integer minor units without floating-point persistence and never lets the current
      Director capability set it. RED set/clear, stale CAS, undo, restart, locale/i18n formatting,
      unsupported/changed route currency, and the explicit policy-currency-mismatch gate refusal.
- [ ] Implement the render gate's state: the shot set, the base estimate range, the cascade as a
      separate `withCascade` quote option, and the free alternative when a beat has no coverage.
      Renderer choices carry only ordered shot/purpose/count plus an optional seed-reference asset ID;
      main derives the graph and returns distinct quote IDs for the two prices.
- [ ] Implement the chain gate's state: what is stale, from which cause, and what resolving costs.
      Consume only `workspaceStatus.dirtyShots` for current continuity/generation causes; quote
      preparation owns price, so renderer never reconstructs freshness from stripped job snapshots.
      Independently of authorized barrier rows, consume only `StudioRendererChainStatusV2` from
      `get_chain_status` for the exact active predecessor/current selected take/played endpoint and
      address retry only by dependent shot ID. After item cancellation/restart, keep the free retry
      affordance until that same deterministic frame becomes pending/ready or the active input
      changes; no frame/take/job/item/authorization/provider/managed-file ID crosses and no fresh
      quote appears while the current record is failed. RED exact request/result keys, restart,
      stale project input, and authorized-row suppression.
- [ ] Consume only `workspaceStatus.cascadeProgress` for authorized barrier state. Show upstream-running,
      choose-seed/take, conditioning-frame, conditioning-failed, dependency-failed, and cancelled reasons plus canonical
      eligible primary choices, without exposing or inferring authorization/item/key/provider IDs.
      The explicit selection action calls the existing human seed/take operation; main owns binding.
      RED the frozen mixed-sibling precedence so one cancelled generation cannot hide a surviving
      choice or a dependency-failed remainder, plus old-terminal→new-waiting/bound/succeeded history
      so only the latest item can own a row. `conditioning_failed` offers only another eligible
      primary, the explicit free retry when `canRetryConditioningFrame`, or item-level cancellation
      when `canCancelWaiting`. Those actions send only the safe barrier request and call the reviewed
      main seams; neither inspects raw jobs nor enters prepare/confirm/provider code.
- [ ] Add the paid native boundary and UI in one commit: `prepare_submission` sends the bounded
      choices and returns only `StudioRendererPreparedSubmissionOptionsV2`; exact-key native/bridge/
      preload tests forbid internal item IDs, request plans/prompts, reference digests, conditioning
      IDs, rate-card digests, route IDs, origin IDs, and provider/authorization authority. The modal renders the
      selected option's ordered base/cascade lines, currency, lower/upper minor-unit range, generation
      counts, exact `budget` verdict, and expiry. The explicit confirm action sends only that option's
      `projectId`, `quoteId`, and expected revision. Main re-derives and authorizes; the sibling option is consumed.
      Success returns only `StudioConfirmSubmissionResultV2`, then renderer refetches the sanitized
      project and workspace status. RED exact result keys and forbid a full project, job,
      authorization/item ID, quote, receipt, provider, request plan/snapshot, or unknown key.
      Close/cancel spends nothing.
- [ ] RED quote-projector parity for base-only and cascade options at maximum seed/video counts: every
      safe row's order, shot, purpose, sanitized route, duration, count, one-generation/requested
      totals, wait flag, currency, lower/upper total, budget kind/policy facts, revision, and expiry
      must equal the selected
      internal quote's checked values. Headline, rows, generation count, confirm label, and budget
      result consume only that projection. Cover all four verdicts plus stale status/project
      revision. The test fails if the renderer understates or omits an
      internal authorized item even though confirm still accepts only the opaque quote ID.
- [ ] Treat an expired or cache-evicted `quote_not_found` as a normal re-prepare state: close the old
      modal, preserve the user's bounded choices, show that the estimate must be refreshed, and never
      retry confirmation automatically. RED repeated prepare/flood, exact TTL expiry, and restart with
      resolver/adapter/provider spies; cache pressure is never surfaced as spend or project mutation.
- [ ] Map every `StudioSubmissionCacheErrorCodeV2` without collapsing it. `quote_in_use` leaves the
      current confirm visibly pending/disabled and never auto-retries; `quote_cache_full` preserves
      bounded choices and offers a later explicit re-prepare; `quote_too_large` explains that the
      selected review cannot be prepared within the local bound; and `quote_not_found` uses the
      refresh flow above. RED native/bridge/service code parity and prove all four paths perform zero
      new project/reference mutation, adapter call, provider call, or spend.
- [ ] Derive the gate headline cost, generation count, confirm-button label, and every displayed
      base/cascade row from the same quote arrays and exact requested item counts. Show symbolic
      downstream rows as “waits for your take choice,” never as already runnable; after upstream
      completion, selection continues the existing authorization without another cost confirmation.
      RED any independently recomputed label/count and every automatic selection/dispatch path.
- [ ] Project proposal/reference decisions into persistent cards. Accepting text/structure calls the
      reducer path. Reference list/watch/native/bridge outputs are exact
      `StudioRendererReferenceGenerationHandoffV2`; RED unknown keys and prove the durable receipt's
      `authorizationId` and every project/provider authority field remain main-only. Opening an
      unconsumed generation handoff pre-populates this gate and passes its
      ID as `originReferenceHandoffId`; prepare requires the exact ordered handoff shot set as one
      seed-only base choice per shot with no video or cascade choice, and creates no receipt. Subset,
      superset, reordered, duplicate, wrong-purpose, cascade, same-project handoff-ID collision,
      mismatched request relation, and existing-authorization-origin requests fail closed before
      cache/resolver/project work. Explicit dismiss publishes `dismissed`. Successful confirm persists the origin on the
      authorization and publishes `confirmed`; restart repairs an interrupted receipt from that exact
      relation. Enable non-null origin IDs by extending the same project-queue transaction: reserve
      and re-read the exact unreceipted handoff, then commit authorization and publish its confirmed
      receipt before releasing authority. Dismiss uses the same queue/authority order; if project
      commit wins but receipt publication is interrupted, repair must publish confirmed and dismiss
      must refuse. RED confirm-vs-dismiss, close before/after project commit, receipt ambiguity,
      replacement, restart, and sibling quote options. Neither opening nor acceptance bypasses
      confirm, and a receipted handoff never reopens.
- [ ] RED `dismiss_reference_generation_handoff` exact keys, unknown/replaced handoff, stale project
      revision, duplicate idempotent dismiss, already confirmed, confirm-vs-dismiss at every queue/
      receipt boundary, close/restart, and sidecar publication ambiguity. Only the frozen safe request
      crosses; success returns only `StudioDismissReferenceGenerationHandoffResultV2` with the exact
      persisted completion time, and an idempotent retry returns the same value. RED unknown result
      keys and forbid the durable receipt, request decision, authorization ID, project bytes, or paid
      authority. Every refusal preserves project/decision/receipt bytes and performs zero quote,
      resolver, adapter, or provider work.
- [ ] RED that switching views changes presentation only — it never saves, refetches, or discards
      drafts.
- [ ] RED with provider/resolver/adapter spies that opening, recomputing, cancelling, expiring, or
      accepting a proposal/reference card performs zero paid work; only exact confirm can dispatch.
- [ ] Commit: `feat(studio): add the shared workspace projection`.

### Task 9 — Project shell and the collapsible Director rail

**Tests:** create `tests/unit/pages/studio/workspace/DirectorRail.dom.test.tsx`; extend existing
`StudioPage`, Director proposal/card, and conversation-owner tests. Together with Tasks 8 and 10–14,
the new `workspace/` test directory has exactly ten direct children; add no peer without splitting it.

**Source:** add `WorkspaceShell.tsx`, `Workspace.module.css`, and
`DirectorRail/{index.tsx,DirectorRail.module.css}` under `components/Workspace/`.

**Steps**

- [ ] Build the workspace shell and route.
- [ ] Build **one docked collapsible Director rail** with a single persistent conversation owner.
      Do **not** build a layout system that moves the conversation between docked, split, and narrow
      presentations — that machinery existed because the conversation was the centre, and it is not.
- [ ] Preserve proposal cards, rules, the Brief, and the one conversation owner.
- [ ] Land every visible string as an `en-US` key under `creativeStudio.workspace.*`. The other
      eleven locales fall back until the deferred pass.
- [ ] Commit: `feat(studio): add the workspace shell and director rail`.

### Gate 2 review checkpoint

- [ ] Run focused node/jsdom suites for runtime activation, native parity, proposal/reference
      decisions, workspace projection, draft persistence, route readiness, gate quote/confirm, and
      Director persistence; include exact native `park_beat`/`restore_beat` and
      `park_shot`/`restore_shot` schema-to-reducer parity, three-kind projection, active-only quote/
      readiness omission, exact `apply_authoring_batch` allow/deny subset and result, exact
      `undo_last`, `edit_project`, rule-draft canonicalization, Take action, and `reorder_bin` parity, plus Director capability
      refusal; then `bun run test`.
- [ ] Run `bunx playwright test tests/e2e/features/workspaces/creative-studio.e2e.ts` after replacing
      its scene-shaped fixtures/assertions with Beat/Shot lifecycle and V1 no-touch cases. Exercise a
      rendered terminal shot through native lift, verify its retained-work Bin projection and zero
      provider calls, then restore it to the recorded beat at a current anchor.
- [ ] Update and run `vitest.creative-studio-coverage.config.ts`; every executable changed file is
      present and at least 80% lines/branches. Run `bun run lint --quiet`, `bun run format:check`,
      `bunx tsc --noEmit`, i18n type/check commands, and `git diff --check`.
- [ ] Freeze the exact head; independently review activation rollback, V1 isolation, native parity,
      proposal/reference crash recovery, and paid confirmation. Resolve every Critical/Important
      before Task 10.

---

## Delivery Gate 3 — the views

### Task 10 — The Table

**Tests:** create `tests/unit/pages/studio/workspace/TableView.dom.test.tsx` and add the Table cases
to `tests/e2e/features/workspaces/creative-studio.e2e.ts`.

**Source:** create `components/Workspace/Views/Table/{index.tsx,Table.module.css}`.

- [ ] Real data-grid semantics: row and cell roles, keyboard traversal, and a visible focus ring.
- [ ] Columns per the prototype, with **target and actual visually distinct**.
- [ ] Beat states including duration pending, no coverage, seed pending, part done, rendering, and
      stale. A nullable target never renders as zero seconds.
- [ ] RED 24-beat keyboard traversal, selection shared with Board/panel, and no mutation on view
      switch.
- [ ] Commit: `feat(studio): build the table view`.

### Task 11 — The beat panel and the coverage bar

The core interaction of CS3, and the largest single task. Split it if it exceeds one reviewable diff.

**Tests:** create `tests/unit/pages/studio/workspace/BeatPanel.dom.test.tsx` and
`tests/unit/pages/studio/workspace/CoverageBar.dom.test.tsx`; extend the workspace Playwright file.

**Source:** create `components/Workspace/BeatPanel/` with `index.tsx`, `BeatPanel.module.css`,
`CoverageBar.tsx`, and pure `coverageGeometry.ts`.

- [ ] Action, Look, Beat target, and Shot authored-field editors, with the soft 25-word Look counter
      that warns and never blocks. Saves use only allowed `edit_beat`/`edit_shot` operations in
      `apply_authoring_batch`; reset remains renderer-local and no full mutation catalog crosses.
- [ ] The coverage bar: boundary drag changes what a shot generates; edge drag trims what it plays.
      Head trim always free; tail trim warns when it breaks continuity. With a selected Take, width/
      actual/trim endpoints use its probed source duration; changing Shot planning duration marks the
      old Take out of date but does not rewrite its played width. With no selected Take, planning
      duration drives width and trims are absent. Re-split/fixed-boundary offsets are a separate
      planning overlay and import `studioPlanningShotBoundariesV2`; renderer geometry may map those
      seconds to pixels but may not substitute played width or recompute cumulative planning sums.
      RED a selected 10-second Take/current 8-second plan showing 10-second playback width while its
      fixed re-split boundary remains 8.
- [ ] Density tiers computed from the measured bar width, the whole bar committing to one tier taken
      from its narrowest segment. Nothing persisted, nothing chosen, **no tier label rendered**.
- [ ] Chain presentation: segment heads, seed stills, author `hard_cut` distinct in name and treatment
      from system-detected continuity break. Human hard-cut, planning-duration, trim, and Shot-order
      commits use only their allowed exact operations in `apply_authoring_batch` and refresh dirty/
      eligibility status at the returned revision.
- [ ] Seed workflow: seed-pending is editable; imported/generated image takes are visible separately
      from video takes; latest is the default until the user pins one; clear/pin/generate all use the
      reviewed route/gate rules. Human Import calls only `import_seed_still`, receives no path, and
      refreshes readiness from the committed shot-owned asset; seed clear/pin uses allowed
      `set_seed_still` through `apply_authoring_batch`, while generate remains behind prepare/confirm.
      Cancel is a no-op. Video submission is impossible without the required seed.
- [ ] Takes, human-only video-take selection, and per-shot render with its own gate. The full MCP
      catalog names select/park/restore gestures for future agents, but the current Director
      capability rejects them before side effects. Human controls call only the exact `select_take`,
      `park_take`, `add_alternate_take`, and `restore_take` native providers with the current revision;
      park/restore consumes only its revision-matched Take eligibility row. RED wrong ownership/media,
      selected/seed/in-use refusal, stale CAS, and zero paid side effects.
- [ ] Add an explicit human-only **Lift shot** action. Its confirmation states that authored and paid
      work is retained, names any downstream staleness, and never calls delete. Disable it with a
      specific reason for an in-flight job/extraction, current Match To, or nonterminal downstream
      job/extraction consuming its lineage; terminal downstream conditioning history becomes stale
      and does not block. Clearing or repointing Match To is a separate action. Consume only the
      revision-matched workspace-status eligibility row and invoke the exact `park_shot` provider;
      RED that cancel and every refusal preserve project bytes and invoke no paid boundary.
- [ ] Give **Lift beat** the same aggregate safety contract over every contained shot. Its refusal
      identifies the first stable film-order blocker category (own in-flight work, extraction, Match
      To, downstream consumer, or waiting authorization), mutates nothing, and invokes no paid
      boundary; terminal-only history permits the lift and reports the resulting downstream
      staleness. Consume only the aggregate workspace-status eligibility row and invoke the exact
      `park_beat` provider; stale status/revision fails closed.
- [ ] Derivation: derived versus detached, staleness against the action, reviewed re-derive proposal,
      and non-consuming line-history restore. The button never relabels the current line or runs text
      generation inside the reducer; the accepted replacement is visible before commit. Direct
      detach/history restore use only allowed `redetach_line`/`restore_line` authoring-batch members;
      `rederive_line` is absent and can arrive only through the reviewed proposal path.
- [ ] In every re-split review card, list each fixed Shot in active film order and map every persisted
      `StudioFixedShotReasonV2` to a human-readable, accessible reason. Consume the proposal's exact
      self-contained review rows—never infer from renderer project state—and refuse/refresh if
      acceptance re-derives a different row or reason at the base revision. RED combined reasons,
      restart, stale proposal, keyboard reading order, and screen-reader announcement before Apply.
- [ ] `PART DONE` recovery: render the sanitized cascade-progress reason after restart, offer only
      eligible canonical primary choices, and continue the existing authorization after selection.
      `conditioning_failed` names the local error and offers explicit free retry, another eligible
      primary, or whole-waiting-item cancellation according to the two projected action flags; retry
      keeps the same authorization, cancellation sends only the dependent-shot request, and neither
      shows a spend gate or raw generation checkbox. All-failed
      and cancelled states explain that a fresh quote is required; if the current active frame record
      is failed, its provider-free same-ID retry must complete first. No raw job inspection, hidden
      auto-selection, automatic retry loop, or second charge is allowed.
- [ ] Reorder inside a beat must not look like reordering beats, and must show the staleness it
      creates. Shot/Beat reorder controls use only their allowed authoring-batch members; Bin reorder
      remains the separately frozen narrow provider.
- [ ] RED the coverage lifecycle: a rendered shot is fixed during re-split; after explicit lift it
      leaves active coverage, re-split may replace only the remaining dependency-free intervals, and
      the lifted shot plus takes remain available in the Bin. Restoring it at a current anchor
      reintroduces the same identity and shows the resulting downstream staleness/cascade before any
      paid confirmation.
- [ ] RED tail trim end to end: trimming a selected 10s take to an 8s played endpoint displays stale
      downstream state, queues the 8s conditioning extraction after confirmation, and never presents
      the full-video poster as chain authority. Head trim does not invalidate downstream.
- [ ] Commit: `feat(studio): build the beat panel and coverage bar`.

### Task 12 — The Board and the Bin

**Tests:** create `tests/unit/pages/studio/workspace/BoardView.dom.test.tsx` and
`tests/unit/pages/studio/workspace/Bin.dom.test.tsx`; extend the workspace Playwright file.

**Source:** create `components/Workspace/Views/Board/` with `index.tsx`, `Board.module.css`, and
`Bin.tsx`.

- [ ] Deterministic covers and the no-coverage placeholder.
- [ ] One responsive Board layout rather than zoom or user-selected sizes: no S/M/L density control;
      three equal columns at the 1158px collapsed-rail design target, with deterministic two-column
      compact and one-column narrow fallbacks. This supersedes the earlier three-card-size requirement
      under the designer's 2026-08-21 ruling.
- [ ] The Bin: exactly three reference kinds, Beat, Shot, and Take. Beat/Take show lifted versus
      alternate; Shot is visibly lifted only. Each has deterministic restore behavior plus
      drag/keyboard reorder with kind-and-reason announcements. A Shot card shows its recorded owner
      beat, deterministic cover, take count, and retained-work state; it exposes no generate, retry,
      select-take, or generic-remove control while binned. Drag/keyboard order persists only through
      exact `reorder_bin`; Take lift/alternate/restore use the exact Take action providers.
- [ ] Any Board/rail Beat reorder calls only allowed `reorder_beats` through
      `apply_authoring_batch`; Beat/Shot/Take lift/restore and Bin reorder remain their named narrow
      providers. RED that no Board gesture serializes a full mutation union or a narrow operation in
      the generic batch.
- [ ] RED canonical membership and dependency-safe restoration: a current selected/seed take or a
      take consumed by nonterminal/waiting conditioning cannot be binned separately; exact terminal
      historical conditioning may remain after lift and projects downstream staleness across restart.
      A binned beat is absent from the film; an active shot cannot also render in the Bin; and
      replacement races preserve every referent and alias. Restoring a shot
      uses only its recorded beat and a current anchor, works while that beat is itself binned, refuses
      a full beat or stale/wrong-owner anchor without mutation, and preserves the same paid lineage.
      Restore controls consume the revision-matched workspace-status row and call only the exact
      `restore_beat`, `restore_shot`, or `restore_take` native provider; renderer never emits a generic
      mutation batch.
- [ ] RED Lift-beat refusal and acceptance in Board/Bin: aggregate blocker reasons over contained
      shots in stable film order, preserve focus/project bytes on refusal, and show terminal retained
      work plus downstream staleness after a permitted lift. Never create per-shot Bin aliases or
      expose a hidden cancel/provider side effect.
- [ ] Add responsive and human-acceptance coverage for a lifted rendered shot at desktop, compact,
      narrow, and RTL: the confirmation says its takes are kept, the Bin card remains understandable
      without its source panel, focus moves predictably after lift/restore, and screen-reader output
      announces owner, reason, position, and refusal cause.
- [ ] Commit: `feat(studio): build the board and bin`.

### Task 13 — The Cut

**Tests:** create `tests/unit/pages/studio/workspace/CutView.dom.test.tsx`; extend the workspace
Playwright file with imported-audio bed, match-to gate, and export cases.

**Source:** create `components/Workspace/Views/Cut/{index.tsx,Cut.module.css}`.

**Main/public export ownership:** modify `creativeStudioTypes.ts`,
`creativeStudioManagedAssetCollections.ts`, `mediaStore.ts`, `store.ts`, service index/V2 service,
the Task-7 native constants/payload schemas/IPC bridge/process bridge/preload provider set for
`create_export`, `list_exports`, `copy_export`, and `reveal_export`, and
their direct tests. Create one main-only schema-2 export-catalog validator/store module and focused
fault-injection tests, plus pure editor-folder timeline/manifest composition and focused tests. Keep
these in a new compliant `service/schema2/exports/{index.ts,catalog.ts,editorFolder.ts}` directory
with `tests/unit/process/creative-studio/service/schema2/exports/{catalog.test.ts,editorFolder.test.ts}`.
Together with the grouped generation/pricing modules and deletion of `cuts.ts`, each production/test
`schema2` directory finishes at exactly ten direct children; add no peer. Extend the Assets drawer
projection/tests to consume only
`StudioRendererExportCatalogV2`; no renderer code receives a managed name or path.

**Main/public bed-import ownership:** the same task modifies the main picker, media store, service,
native constants/payload schemas/manifest, IPC/process bridge, preload, Cut UI, Assets drawer, and
their direct tests for exact `import_bed_audio`, `detach_bed_audio`, `set_bed`, and `set_match_to`.
They accept only `StudioImportBedAudioRequestV2`, `StudioDetachBedAudioRequestV2`,
`StudioSetBedRequestV2`, and `StudioSetMatchToRequestV2`; no renderer path or generic mutation batch
crosses.

- [ ] Beat order, one bed fading out at the cut's end, match-to, and export. Cut selection controls
      call only exact queued `set_bed`/`set_match_to`; RED set/replace/clear, wrong media/shot,
      active-versus-binned target, stale CAS, restart, undo, current-Director refusal, and zero paid
      work before a later reviewed Match-To render confirmation.
- [ ] Implement the crash-safe main-picker `import_bed_audio` transaction from the frozen contract.
      RED picker cancel; exact request/unknown keys; supported single decoded audio; image/video,
      multi-stream, empty/corrupt, unsafe/replaced, oversized, and missing input; revision/close race;
      simultaneous import/detach/export/delete; staging/asset/project-commit crash boundaries;
      restart repair; and provider/resolver/adapter poison. One successful import writes one
      unclassified project-owned canonical audio asset, applies one `set_bed` reducer operation with
      a main-issued context, and commits the asset, selected `bedAssetId`, and one exact undo entry in
      the same revision. RED prior-bed/null before-fragments, top label/digest, crash rollback,
      restart then undo, and prove undo restores only the prior bed while deliberately retaining the
      imported unselected asset/bytes. Success returns only the exact imported branch of
      `StudioImportManagedMediaResultV2`; cancel returns its exact no-data branch. Replacing it
      retains the previous import; current-bed detach refuses, while explicit
      clear/replace followed by detach removes only the named unreferenced import. The Cut/Assets UI
      calls only the exact provider, cancel is a no-op, and no paid audio-generation route exists.
- [ ] Implement exact `detach_bed_audio` through the frozen crash-safe detach-intent protocol. RED
      current bed, wrong/classified/cross-project asset, export retention claim, stale revision,
      close/replacement, unsafe identity, project-commit and quarantine crash boundaries, restart,
      duplicate click, and positive unselected-audio removal. The project record disappears in one
      revision before only its exact bytes are quarantined/reaped; no other import, take, frame,
      export, or V1 byte is scanned or deleted. Return only
      `StudioDetachManagedMediaResultV2`, expose no path, append no authoring undo entry, and poison
      resolver/adapter/provider/spend.
- [ ] Validate bed playback independently of import: reject a selected image/video ID, unsafe/missing
      managed bytes, and a bed shorter/longer than the film only according to the explicit fade-at-end
      rule.
- [ ] The Cut cannot reach inside a beat: no trims, no retiming, no take selection.
- [ ] `MATCH TO` presented as a costed re-render, never as a free grade.
- [ ] Treat current `matchToShotId` as an inbound active reference: lifting that shot is refused until
      the author clears or repoints Match To in a separate revision. RED the Cut and beat-panel error
      states and prove neither refusal nor clearing invokes generation before reviewed confirmation.
- [ ] **No `AUTO-DUCKED`.** If narration state is shown at all it says there is no voice track yet.
- [ ] Export shapes: editor folder always; a still; **`script.md` on demand**, generated at export
      time and never written to the project root or ingested. One-file stitched export is not in v1
      and its control is absent, never shown disabled or failing.
- [ ] Implement the exact non-stitched `StudioEditorFolderTimelineV2` producer. RED active Beat/Shot
      order, cumulative starts, trim-derived source in/out and played duration, chain break, beat/film
      sums, selected-Take source duration differing from current Shot planning duration, nonempty
      coverage with zero-selected or partially selected video refusal, a selected take
      with missing canonical bytes, true empty-`shotOrder` target slate, `duration_pending`, one
      shared deterministic local slate, no binned entry, optional bed trim and two-second end fade,
      shorter-bed refusal, longer-bed acceptance, and the 99-file maximum-capacity fixture under the
      104-file limit. Every distinct timeline payload path must resolve the exact manifest entry;
      renderer/remote generation is poisoned.
- [ ] Implement the exact `StudioExportCatalogV2` sidecar and managed artifact protocol from the
      frozen contract. RED file-versus-directory shape mismatches; unsafe/deep/duplicate paths;
      symlink/special-file/hard-link identity; byte/count/safe-sum bounds; exact `manifest.json`
      serialization/order/hash/payload bijection; source project/revision mismatch; export-at-N then
      edit/restart/list/copy/reveal at N+1; zero/future source revision; replaced bytes; V1 no-touch;
      and ID/path substitution. Reject duplicate artifact IDs, duplicate managed export names,
      payload `nlink !== 1`, cross-artifact opened-directory aliases, and cross-artifact payload
      hardlinks/identity reuse; prove positive ID-to-managed-ref copy/reveal and retention resolution.
      Create/list/copy/reveal accept only their three frozen request types. Create, copy, and reveal
      require exact `expectedCatalogRevision`; copy/reveal additionally require artifact ID, then
      resolve the main-owned managed ref with
      no-follow identity reproof; destination selection stays in main. Still export derives only the
      named active shot's current canonical cover, while editor-folder/script use the exact active
      project revision.
- [ ] Retention is per shape, count-based, and ordered by `(createdAt, id)`, with size/source revision
      shown for visibility only. RED 5→6 independently for editor-folder/still/script, equal-time ID
      ties, project byte-cap refusal before publication, and that it can never scan, quarantine, or
      evict a take, import, thumbnail, or conditioning frame.
- [ ] RED every crash boundary: staged payload/record fsync, artifact-directory rename, catalog temp/
      rename/fsync, and post-catalog eviction quarantine/reap. Restart quarantines an unreferenced new
      artifact, completes an interrupted exact eviction, refuses a catalog whose referenced payload
      is missing/replaced, never adopts hostile bytes, and returns one sanitized stable listing.
- [ ] RED per-project authority and lock order: simultaneous same-shape exports, concurrent bed
      imports, export versus project delete, export versus Brief/audio import/detach or managed write,
      byte cap changing during staging,
      logical absent-catalog revision 1, first publish to 2, no-op/list/copy/reveal neutrality, one-
      increment repair/publication, safe-revision overflow, stale catalog revision, and close/restart
      at either winner. Recheck exact source revision and
      byte admission immediately before catalog commit; no lost catalog update, sixth retained shape,
      orphan active artifact, deadlock, cross-project lock, or deletion outside `exports` is allowed.
- [ ] Add exact-key native/bridge tests proving export lists expose only
      `StudioRendererExportCatalogV2`; `managedExport`, `fileName`, manifest hash/paths, and raw
      catalog records never cross. Schema-1 on-disk external folders remain byte-identical no-touch
      data and are not treated as V2 retained artifacts; the legacy schema-1 export provider/payload
      removed from the public surface in Task 7 remains absent and is never resurrected, reused, or
      aliased. RED the exact four-provider V2 export inventory plus the separately named
      `import_bed_audio`, `detach_bed_audio`, `set_bed`, and `set_match_to` providers, their exact
      request/result parity, and explicit legacy-name absence. Copy returns exactly cancelled or
      copied and reveal returns exactly revealed; reject destination paths, managed paths, file
      names, catalog records, and unknown result keys on both boundaries.
- [ ] Commit: `feat(studio): build the cut view`.

### Gate 3 review checkpoint

- [ ] Run the five workspace jsdom files plus relevant projection/reducer tests, then `bun run test`.
- [ ] Run the workspace Playwright lifecycle at desktop (1440×900), compact (1100×760), narrow
      (760×900), and RTL. Capture Table, beat panel/coverage, Board/Bin, and Cut screenshots and
      compare structure/content against the frozen reference; intentional corrections (Director
      rail, no density label, target/actual, no AUTO-DUCKED) are asserted explicitly. At every
      viewport, lift a rendered shot, assert the retained-work confirmation/card, active-view
      disappearance, focus and screen-reader announcement, then restore the same identity to its
      recorded beat without a provider call. Include refusal UI for own in-flight work, current Match
      To, and a nonterminal downstream consumer, plus the permitted/stale terminal-history case.
      Also attempt to lift a beat containing each blocker class and assert one atomic refusal with no
      partial Bin aliases or provider work. In the Cut, cancel bed import once, then import supported
      audio through the main picker, restart, and prove the selected bed/duration/fade projection;
      reject wrong media and current-bed detach, replace the bed, then detach only the old unselected
      audio. Clear/reselect the bed and set/clear Match To only through their exact native providers,
      all without exposing a path or reaching paid work.
- [ ] Update/run the Creative Studio coverage manifest at 80/80 per file; run lint, format, typecheck,
      i18n, and diff-check. Freeze the exact head; independently review keyboard/a11y, trim-aware
      conditioning, Bin invariants, audio bed, retention, and visual evidence. Resolve every
      Critical/Important before Task 14.

---

## Delivery Gate 4 — hardening and acceptance

### Task 14 — Undo

- [ ] Complete the `StudioUndoEntry` journal staged in Tasks 1–2. Every successful free authoring
      batch appends exactly one canonical before-fragment entry in the same project revision, capped
      at 20 oldest-first;
      paid lifecycle/recovery writes append none. A new non-undo edit after undo discards abandoned
      forward history; redo is not in v1.
- [ ] `undo_last` must be the sole operation, name the current top entry, and run through the same
      reducer/store queue under expected-revision CAS. It writes one new revision, removes the entry
      it consumed, and never retries a stale/ambiguous result. It cannot cancel/retry provider work,
      delete a receipt/authorization, or claim a refund. Renderer calls only Task 7's exact
      `undo_last` provider with `StudioUndoLastRequestV2` and accepts only
      `StudioRendererProjectCommitResultV2`; it never wraps undo in `apply_authoring_batch` or sends a full
      mutation batch.
- [ ] Render undo only from revision-matched `workspaceStatus.undoTop`: map its frozen label token
      through i18n, send
      only `entryId` plus expected revision, and refresh the safe top after success/conflict/restart.
      RED that no history patches/digests cross and that a paid-only revision does not hide an
      otherwise digest-valid top entry.
- [ ] Re-prove every patch's post-edit digest immediately before apply. Preserve shot asset/job arrays
      across authoring undo; refuse `undo_conflict` if a newly created beat/shot gained dependencies,
      a touched authored fragment changed outside the journal, or any restored reference is no longer
      valid. The entry remains available after conflict.
- [ ] RED restart and exact inverse behavior for re-split, detach/rederive, beat/shot/take
      park/restore, project settings, trim, shot/beat reorder, seed/take selection, routes,
      spend policy, direct bed selection, imported-bed selection, and match-to. Imported-bed undo
      restores the prior bed/null while retaining its new canonical import and bytes. Shot
      park/restore undo changes only the owning beat membership and Bin fragment;
      it reuses the current shot record and cannot replace, delete, or rewind any retained paid
      lineage. Director-applied free edits are undoable; proposal rejection and paid confirmation are
      not. §13.6 hard-cut transitions are paid confirmations and therefore never enter this journal;
      their inverse is another paid transition.
- [ ] Line history is the undo substrate for **text**. `RESET` is not: it discards the renderer draft
      through the existing `useDraftPersistence`, writes nothing to history, and never reaches main.
      It is deliberately absent from the mutation vocabulary — RED that no reducer operation exists
      for it, so it can never revert a committed revision and therefore can never lose writing.
- [ ] Tests: extend reducer/store/service suites and create
      `tests/unit/pages/studio/workspace/Undo.dom.test.tsx`; mutation-kill missing inverse append,
      stale entry acceptance, and paid-state rollback.
- [ ] Commit: `feat(studio): add revision-aware undo`.

### Task 15 — Accessibility, RTL, localization, and capacity

- [ ] Every control is an Arco component — no raw interactive HTML, no styled `div` acting as a
      button. The prototype has an empty accessibility tree; that is a prototype property and must
      not survive into the build.
- [ ] Body text at or above the 14px floor; the prototype's dense all-caps micro-labels are below it.
- [ ] Drag and keyboard reorder with announcements for the beat rail, the coverage bar, and the Bin.
- [ ] Persian logical CSS and bidi isolation. Layout is not translation: RTL must be correct here
      even while the other eleven locales are still falling back to `en-US`. Verify with a locale
      forced to RTL against English strings.
- [ ] Confirm `check-i18n.js` reports only warnings for the deferred locales and no errors, and that
      every new string resolves through a key rather than a literal.
- [ ] Capacity: 24 beats, 96 total unique shots across active and binned membership, and each
      24-beat/96-shot/96-take Bin boundary render and reorder without virtualization. A shot Bin item
      never doubles the project-shot count. In Playwright, after five warmups, 20 keyboard reorders
      must settle projection, focus, and announcement within 250ms p95 on the CI runner; record raw
      samples. Also assert bounded render counts so a faster machine cannot hide an accidental
      quadratic rerender.
- [ ] Commit: `feat(studio): harden accessibility and capacity`.

### Task 16 — Lifecycle, spend, and acceptance

- [ ] Prove the whole lifecycle end to end on a fresh named profile: brief, spine, coverage, render,
      reviewed/imported seed still, video take, trim-aware chain, managed bed-audio import, cut,
      export. Cancel the audio picker once, import and atomically select supported audio, restart,
      replace it while retaining the old unselected import, prove current-bed detach refuses, then
      detach the old import through the exact public action and restart with every unrelated byte
      intact; clear/reselect the retained bed and set/clear Match To through narrow reducer providers,
      undo both, and prove zero paid work before a separately reviewed confirmation. Persist a probed
      10-second Take, change its Shot planning duration to 8, and prove UI actual, summary, export,
      conditioning endpoint, re-split fixed planning boundary, restart, and generation-out-of-date
      all follow the frozen split without rewriting media or spending: played authority remains 10
      minus trims while coverage planning geometry is exactly 8.
- [ ] In the same named-profile matrix, prove render → lift shot → re-split → restart → restore. The
      original shot ID, takes, jobs, receipts, authorization, and frame lineage remain exact; the
      binned interval is absent from active duration/readiness/quotes; restore uses the recorded beat
      and a current anchor; and no provider call occurs until a newly reviewed confirmation. Before
      accepting re-split, assert its persisted review card names every still-active fixed Shot with
      the exact human-readable reasons after restart; tampering with one reason fails closed.
- [ ] In that profile, attempt `park_beat` with contained own in-flight work, Match To, downstream
      consumption, and a waiting authorization dependency. Each is one byte-preserving atomic refusal
      with zero provider work. After those blockers become terminal or are explicitly cleared, lift
      and restart the beat through the exact native park/restore providers with all contained lineage
      exact and active-only projections updated.
- [ ] Prove the spend fences: no unreviewed submission; cascade priced separately; budget cap refuses
      pre-dispatch; quote tamper/staleness/expiry refuses; authorization and jobs precede provider;
      in-flight work never billed twice; receipts written per take. Set, change, undo, and clear the
      cap through the human Brief UI first, including a policy/route currency mismatch that refuses
      with zero jobs/provider work.
- [ ] Prove the approved one-confirm cascade end to end: the gate offers “this shot” and “this shot +
      2 downstream” from the same quote arrays; one combined confirm persists all jobs/keys before
      the first provider call; only the first item runs; the UI pauses for each human primary-take
      choice; each durable bind advances exactly one frontier without another confirmation; and
      restart at waiting, extracting, bound, and partial-failure points preserves the same
      authorization. Cover upstream all-failed terminalization and a fresh re-quote without a second
      charge for any completed generation.
- [ ] Prove recovery: window closed after authorization and during extraction, conditioning frame
      deleted, app restarted, provider ambiguous, proposal/reference decision interrupted, and no
      authorization for a merely stale chain. Each resumes exactly once or fails closed.
- [ ] Inject each terminal conditioning extraction error into the one-confirm cascade, restart on the
      failed state, invoke the explicit free retry, and complete through the same deterministic frame
      ID/authorization without resolver/adapter/provider work or a second charge. Also cover choosing
      an alternate primary and invoking safe dependent-shot item cancellation: every waiting sibling
      cancels atomically, transitive waiters dependency-fail, restart projects one latest terminal
      state, zero provider cancellation occurs, the active chain can retry the same failed frame ID
      without authorization, and only after that frame is ready may a later fresh quote try again.
- [ ] Prove a V1-only and mixed profile run creates no V2 watcher/timer/cleanup/provider side effect,
      while creating the first V2 project after startup single-flight activates the V2 lifecycle.
- [ ] Run the full Beat/Shot Playwright flow using deterministic fake image/video routes and assert
      the conditioning frame is decoded from the selected trim endpoint. A separate manual-provider
      checklist may validate real media quality but is not substituted for automated acceptance.
- [ ] Commit: `feat(studio): prove the beat and shot lifecycle`.

### Gate 4 review checkpoint

- [ ] Run all focused node/jsdom suites, `bun run test`, the complete workspace Playwright matrix,
      and `bun run test:coverage`. Update/run the Creative Studio manifest and require every changed
      executable file at 80% lines/branches. Run lint, full format-check, typecheck, i18n checks,
      diff-check, directory-ratchet audit, and frozen reference/spec hash verification.
- [ ] Make the named-profile render → lift shot → re-split → restart → restore flow a required Gate 4
      E2E oracle, not a manual checklist. Fail the gate if identity, authored fields, takes, jobs,
      receipts, authorization, frames, original-beat ownership, active-only summaries/quotes, current
      anchor restoration, or the zero-provider-before-new-confirmation assertion differs after
      restart.
- [ ] Freeze the exact head; obtain independent process/schema, security/spend, renderer/a11y, and
      recovery/publication reviews. Resolve every Critical/Important finding and re-run affected plus
      full gates; store exact commands, results, coverage summary, screenshot set, and reviewed SHA in
      a Gate 4 status document.
- [ ] Studio remains behind `AIONUI_ENABLE_CREATIVE_STUDIO` and off by default. This plan does not
      authorize enablement, packaged acceptance, or a provider launch.

---

## Deliberately not in this plan

- **Voice.** `narration` and `onScreenText` are retained as authored fields with no downstream
  consumer. TTS and the audio lane are their own sequence. This is the product's largest functional
  gap, not a cosmetic one: a three-minute feature walkthrough is a narrated format by definition, and
  without voice the tool produces a mood piece over a music bed.
- **A real colour pipeline.** `MATCH TO` is prompt-level in v1.
- **One-file stitched export.** V1 ships editor-folder, still, and on-demand script exports. Concatenation,
  audio mix, and fade need a separately owned ffmpeg sequence.
- **Multi-reference provider payloads.** V1 reference attachments inform Director/seed prompt
  authoring, but each paid image request sends at most the one explicitly selected canonical image
  reference supported by its route. The gate names that reference; it never implies all attachments
  are provider conditioning. True multi-image provider payloads need a separate route capability.
- **Project-total budget scope.** Sequenced after receipts exist.
- **Reconciliation against real provider billing.** Withdrawn until a provider returns billing data.
