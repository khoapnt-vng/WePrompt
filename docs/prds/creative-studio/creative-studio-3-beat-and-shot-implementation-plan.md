# Creative Studio 3 — Beat and Shot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the schema-1 scene/phase prototype with a Beat → Shot → Take workspace whose
Table, Board, and beat panel share one revisioned state; whose beats own their own cut; whose
first-frame chain is explicit, quoted, and recoverable; and whose paid generation stays behind a
reviewed human confirmation that shows what it will cost.

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
[creative-studio-3-direction-and-answers.md](./creative-studio-3-direction-and-answers.md) (§1–§11),
SHA-256 `4211c28b9c0b131e6867c3a2a1c137b8b3e211ddefa61fef76ba7779687b8d4a`; frozen visual reference
[creative-studio-3-beat-and-shot-reference.html.txt](./creative-studio-3-beat-and-shot-reference.html.txt),
SHA-256 `642c8b16a56c2799d119c6077c7282969c1d612bd9aca606e39da51c710846ee`. The reference is the
offline bundle of the prototype the review was conducted against; the direction document refers to
it by its authoring name, `Creative Studio 3 - Beat and Shot.dc.html`.

> **Verify the direction document before relying on the pin.** It was transcribed into the
> repository from the authoring copy rather than exported from it, and repository formatting was
> applied. Diff it against the authoring copy once; if they differ, re-commit and re-pin. A hash is
> only an anchor if it names the file everyone means.

**Planning baseline:** `00cac2a08` on `codex/creative-studio-table-board-ui-design` — CS2 Tasks 1–5
complete, Gate 1 pending. Verify that ancestry and a clean worktree before Task 1. Enter Task 1 only
from a **green Gate 1**: the rename below touches roughly a thousand lines across thirty-odd files
and 18,874 lines of tests, and a red baseline makes rename breakage indistinguishable from
pre-existing breakage.

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
   user-selectable contracts. Task 7 switches all public paths atomically and deletes the legacy
   scene providers/types/tests before Gate 2 review.
4. **One free mutation authority.** Renderer free-authoring IPC and Director processing call the same
   pure ordered reducer inside the store queue. The reducer imports no filesystem, IPC, renderer, job
   manager, provider resolver, adapter registry, polling, retry, cancel, or render code.
5. **Reviewed spend only.** The only paid boundary is the reviewed submission path. Director
   reference/generation requests are queued for human review. No Director path may submit, retry,
   cancel, download, render, resolve routes/providers, or invoke adapters.
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

---

## Frozen schema-2 contract

Task 1 implements these names exactly. Later tasks may not rename or reinterpret them without a spec
amendment and a new independent contract review.

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
export const STUDIO_MIN_SHOT_SECONDS = 4;
export const STUDIO_MAX_SHOT_SECONDS = 15;
export const STUDIO_LOOK_SOFT_WORD_LIMIT = 25;
export const STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST = 24;
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
- **Bin capacity is enforced per kind, and only per kind.** There is no independently meaningful
  total. This replaces CS2's arrangement, where a 120-item total was enforced and the per-kind
  maximum that mattered was not.
- **The 25-word Look limit is soft.** The counter warns; word 26 is allowed. Rules are hard;
  guidance is soft, and the Look is guidance.
- Asset `durationSeconds` is a finite number greater than `0` and at most `Number.MAX_SAFE_INTEGER`.
  `Number.MAX_VALUE` is not a bound: it admits `1e308` and makes trim comparisons vacuously true.

Generation, reference-request, dirty-report, and MCP projection limits remain independently named
even when values coincide, and **each validator consumes the constant named for its own contract**.
`STUDIO_PROJECT_SCHEMA_VERSION` is the only source of the persisted version literal in validators and
factories. Every constant added must have at least one consumer by the end of its owning task; an
unreferenced limit is not centralized.

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
  shotOrdinal: number; // the ordinal the line was written against
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
  seedStillId: string | null; // required iff this shot heads a chain segment
  selectedTakeId: string | null;
  assetIds: string[];
  jobIds: string[];
};

export type StudioBinItem =
  | { kind: 'beat'; beatId: string; reason: 'lifted' | 'alternate' }
  | { kind: 'shot'; shotId: string; reason: 'lifted' | 'alternate' }
  | { kind: 'take'; assetId: string; reason: 'lifted' | 'alternate' };
```

**`StudioBinItem` is reference-only.** Every kind names an existing record. Authored text never
enters the Bin — it goes to the owning beat's `lineHistory`, which is why the hardened membership,
canonicality, and per-kind maxima all survive unchanged.

Beat and shot IDs are immutable and unique within a project. Every beat is either in `beatOrder` or
in the Bin, exactly once. Every shot belongs to exactly one beat's `shotOrder`, or is in the Bin.
Every shot-owned asset, job, and take relation resolves to that shot. Validation rejects orphaned,
duplicated, or cross-owned identities.

### Duration: authored target, derived actual

- **`actual`** = the sum of a beat's shots' _played_ duration (`durationSeconds` minus trims).
  Derived, never persisted as a competing author-editable value.
- **`targetSeconds`** = nullable authored intent. Never constrains shot durations; the engine never
  has to satisfy it. It is what the director works toward when proposing coverage.
- **A beat with no coverage contributes `targetSeconds` to the film**, because it exports as a slate
  of that length. This is the only case where an authored number reaches the renderer.
- Therefore **the film total is `Σ (actual if the beat has coverage else targetSeconds)`** — a mixed
  figure by construction. State it wherever it is computed; it is not reproducible otherwise, and the
  under/over readout compares this mixed figure against the project target.
- Target and actual **must render distinctly** (`~24s target` versus `24s`). Rendering them
  identically is the defect this split exists to prevent.

### The chain

- **Chains are strictly beat-scoped.** Beats are therefore the unit of parallelism: a project at the
  cap is 24 parallelisable groups, never one long series. Freeze this as an invariant.
- The **head of a chain segment** conditions on a still (`seedStillId`); every other shot conditions
  on the previous shot's last frame. A shot heads a segment if it is first in `shotOrder` **or** its
  `chainBreak` is `hard_cut`.
- **`hard_cut` is author-chosen; continuity break is system-detected.** They are different things and
  must never share a name or a visual treatment. A continuity break means the frame a shot was
  generated from no longer exists — upstream was re-rendered or tail-trimmed.
- **Re-rendering shot N marks N+1…end stale, not invalid.** Stale shots still play. Cascade is opt-in
  and must be separately priced at the gate.
- **Trim asymmetry:** head trims are always free and never break continuity. Tail trims break
  continuity unless the shot is last in its chain segment.
- **Reordering shots inside a beat rewrites the chain and is not free.** Reordering beats is free.
  The UI must not make the two look alike.
- **No chain advance without the frame asset on disk.** Frame extraction is a distinct job, not a
  side effect of render completion.

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
- **Re-splitting coverage may only change the boundaries of shots that have no takes.** Shots with
  takes are fixed points the split works around, and the director's proposal must state which shots
  it treated as fixed. A shot with takes is removed only by lifting it to the Bin — never by
  re-split, and never by deletion.

### The Cut

The Cut is film-level only: beat order, one bed, match-to, export. It cannot reach inside a beat.
Trims, retiming, and take selection live in the beat panel.

**The Cut is not a record.** `cuts` and `activeCutId` do not exist. Because the Cut only reorders
beats and the project already has a beat order, that order _is_ the film. The project carries
`bedAssetId: string | null` and `matchToShotId: string | null` and nothing else. This deletes the
cut-clip record, its validator, and the dormancy rule that kept binned beats' cut entries alive.

- `MATCH TO` in v1 is **prompt-level**, therefore a re-render, therefore costed, and the UI must say
  so. A real colour pipeline is a separate later decision.
- The bed **fades out at the cut's end**. Never extend, never hard-truncate.
- **`AUTO-DUCKED` must not ship.** There is no voice track to duck for until TTS lands. `narration`
  and `onScreenText` are retained as authored fields with no downstream consumer.
- Export retention keeps the last **5 per shape**, oldest evicted, listed in the assets drawer with
  its size. Size is shown for visibility only: there is **no project size budget**, because takes and
  frames are exempt from eviction by ruling, so a budget could only ever reach exports — which the
  per-shape count already bounds.
- **Retention reaches exports only — never takes, never conditioning frames.** "A missing frame is
  always re-derivable" holds only while the take video survives; eviction that reaches takes turns
  recovery into a re-render that charges.

### The conditioning frame is the poster

**There is no fifth collection, and there is no extraction job.** The provider's last frame and the
Board cover are the same artifact, so they cannot have divergent lifetimes.

`bytePlusSeedanceAdapter.ts` already reads `content.last_frame_url` and emits it as a
`ProviderOutput` with `role: 'poster'`; the adapter contract's own comment on that field reads
_"Distinguishes a generated video's optional last-frame poster from primary output."_ The frame
arrives with the take, at no extra cost, and lands in `thumbnails`.

- **Read outputs by role, never by position.** `jobManager` already filters
  `outputs.filter((o) => o.role === 'poster')`. The fragile code is `canonicalVideoPosterV2` reading
  `outputAssetIds[1]`; fix that instead of constraining output count. This replaces any
  "exactly two outputs" rule — with role-addressed reads, a third output is harmless.
- **Local extraction is a route-conditional fallback inside output persistence, not a job.** Only
  Seedance emits a poster role; `openRouterVideoAdapter`, `mediaGatewayAdapter`, and
  `e2eFakeAdapter` emit `primary` only, so those routes need a locally produced frame. It enters
  through the existing path: synthesize a `ProviderOutput` with `role: 'poster'`,
  `mediaKind: 'image'`, and `source: { kind: 'file', path }` — the shape `imageAdapter` already
  uses and `jobManager`'s poster persistence already accepts. No provider-less job, no new adapter
  id, no new `StudioJobStatus` value.
- **No chain advance without the frame asset on disk.** Because takes are immutable and on disk, a
  missing frame is always re-derivable, so closing the window mid-chain stalls the chain rather than
  losing it, and recovery asks "is the frame there?" rather than re-rendering.
- Because canonical-take identity requires `collection === 'assets'`, a `thumbnails` frame is
  automatically ineligible for selection and for the Bin. That falls out of the existing invariants
  and must not be re-implemented.
- **Storage:** flat `fileName`, location encoded by the collection. `isSafeFileName` rejects path
  separators, and the store quarantines any record carrying a path-shaped key at any depth, so a
  take-relative path may never appear in the record.
- Mid-chain failure keeps the partial, bills only completed generations, and resumes from the break.

### Money

- **Price source is a config rate card** — per route, per second, with an explicit currency field,
  owned by whoever owns route bindings. Not a provider API in v1. The UI must say the number comes
  from our rate card, not from the provider.
- **The estimate is a range, not a point**, once takes are in play. Quote the first pass and state
  that revisions are extra.
- All three numbers in a gate — headline cost, generation count, button label — come from **one set
  of shots**. In-flight work is context, never billed again.
- **No reconciliation.** Actual computed from the same table as the estimate can only differ by a
  generation count known before dispatch. Instead, persist a **receipt** per take on the **job**:
  route, seconds, generation count, and the **rate value in force** — stored by value, never as a
  card reference, so a card update cannot rewrite history.
- **Budget cap is a pinned brief rule in the user's mental model and a separate mechanism in the
  code.** `validateRulePredicate` accepts exactly `forbidden_terms`; a budget check has a different
  input (a batch estimate), a different site (pre-dispatch, not per prompt), and a different breach
  shape. **Scope in v1 is per batch** — "under $10" means this run. The project-total reading needs
  receipts to exist first and is sequenced after.

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
- **Walk every graph iteratively with an explicit stack.** Job count is unbounded by this contract,
  so a recursive retry-lineage walk raises `RangeError` on a long chain instead of returning `false`.
  The shot chain has the same shape and the same exposure.
- **Hoist every key set to module scope.** A per-item `new Set([...])` inside a validator allocates
  once per Bin entry on every project read and write.

### Load and error states

```ts
export type StudioProjectLoadResult =
  | { status: 'supported'; project: StudioRendererProject }
  | { status: 'unsupported_prototype_schema'; projectId: string }
  | { status: 'not_found'; projectId: string };

export type StudioProjectListResult = {
  projects: StudioProjectSummary[];
  unsupportedProjectIds: string[];
  quarantinedProjectIds: string[]; // malformed schema-2 only
};
```

V1 is not corrupt. Unknown or malformed V2 is corrupt and follows the existing loud
storage/quarantine path.

### Mutation vocabulary

```ts
export type StudioMutationOperation =
  | { kind: 'set_brief'; brief: string }
  | {
      kind: 'add_beat';
      beatId: string;
      beat: StudioEditableBeat;
      firstShotId: string;
      firstShot: StudioEditableShot;
      beforeBeatId: string | null;
    }
  | { kind: 'edit_beat'; beatId: string; changes: StudioEditableBeatChanges }
  | { kind: 'reorder_beats'; beatOrder: string[] }
  | { kind: 'park_beat'; beatId: string }
  | { kind: 'restore_beat'; beatId: string; beforeBeatId: string | null }
  | { kind: 'add_shot'; beatId: string; shotId: string; shot: StudioEditableShot; beforeShotId: string | null }
  | { kind: 'edit_shot'; shotId: string; changes: StudioEditableShotChanges }
  | { kind: 'delete_shot'; shotId: string } // dependency-free only
  | { kind: 'park_shot'; shotId: string } // the removal path for a shot with takes
  | { kind: 'restore_shot'; shotId: string; beatId: string; beforeShotId: string | null }
  | { kind: 'reorder_shots'; beatId: string; shotOrder: string[] } // rewrites the chain
  | { kind: 'apply_coverage'; beatId: string; shots: StudioProposedShot[] } // re-split
  | { kind: 'set_hard_cut'; shotId: string; hardCut: boolean }
  | { kind: 'set_seed_still'; shotId: string; assetId: string }
  | { kind: 'trim_shot'; shotId: string; trimInSeconds: number | null; trimOutSeconds: number | null }
  | { kind: 'redetach_line'; shotId: string; line: string }
  | { kind: 'rederive_line'; shotId: string }
  | { kind: 'restore_line'; shotId: string; historyIndex: number }
  | { kind: 'park_take'; shotId: string; assetId: string }
  | { kind: 'restore_take'; shotId: string; assetId: string }
  | { kind: 'remove_bin_item'; item: StudioBinItem }
  | { kind: 'reorder_bin'; bin: StudioBinItem[] }
  | { kind: 'select_take'; shotId: string; assetId: string }
  | { kind: 'set_match_to'; shotId: string | null }
  | { kind: 'set_bed'; assetId: string | null };
```

`park_shot` is the removal path for a shot that has takes. `delete_shot` remains dependency-free
only, exactly as CS2 specified — a shot with assets, jobs, or cut dependencies cannot be deleted, and
that is why `park_shot` exists.

Editable change objects are exact-key, nonempty partials of authored fields only. Callers mint safe
IDs; main rejects collisions and returns created IDs in operation order. `reorder_*` inputs are exact
permutations. Batches are 1–32 operations.

---

## Decisions closed on 2026-08-18

These seven were inferences this plan drew rather than rulings it received. All are now closed and
folded into the contract above. Recorded so a later reader can tell a ruling from an assumption.

1. **Shot media model — confirmed as drafted.** Shots carry no `mediaKind`; every shot is video.
   `mediaKind` lives only on the asset, so stills are image takes on the image route. `seedStillId`
   is required on any shot heading a chain segment, **including one after a `hard_cut`** — a hard cut
   establishes a new look, so it re-seeds rather than continuing.
2. **The Cut collapses into project fields.** `cuts` and `activeCutId` are deleted; the project
   carries `bedAssetId` and `matchToShotId`. There are no alternate named cuts in CS3.
3. **There is no extraction job** — resolved by evidence, not by ruling. See _The conditioning frame
   is the poster_. Local extraction is a route-conditional fallback inside output persistence, so the
   provider-less-job problem does not arise.
4. **`RESET` is a renderer draft discard.** It uses the existing `useDraftPersistence`, is not a
   reducer operation, and never reaches main. This is what makes "RESET cannot lose writing" true; it
   is why RESET is absent from the mutation vocabulary.
5. **`script.md` is an on-demand export shape**, not a file kept at the project root and never
   ingested.
6. **No project size budget.** The phrase is withdrawn; per-shape export retention is the only bound.
7. **Seedance returns the last frame** (`bytePlusSeedanceAdapter.ts:206`), and CS2 already persists
   it as the poster. The other three adapters do not, which is why the fallback exists.

**Two rulings in the direction document are superseded by decisions 3 and 7**, because they were
written without knowing the adapter already supplies the frame: the fifth managed-asset collection
(§11.2) and the "render job keeps exactly two outputs" rule (§11.2). Read outputs by role instead.

---

## Delivery Gate 1 — schema, reducer, store, money

### Task 1 — Beat and Shot contracts and pure validation

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioProjectSummary.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioCanonicalTake.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/factories.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/validation.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/factories.test.ts`
- Modify: `tests/unit/process/creative-studio/types/canonicalTake.test.ts`
- Modify: `tests/unit/process/creative-studio/types/projectSummaryV2.test.ts`

**Steps**

- [ ] Confirm both spec pins still match the committed files (`shasum -a 256`), and that the
      direction document has been diffed against its authoring copy at least once. Stop if not. The
      seven inference decisions are already closed — see _Decisions closed_.
- [ ] Replace the Section/Clip/Shelf types with Beat/Shot/Bin and the independently named constants
      from the frozen contract. Delete `cuts` and `activeCutId`; add `bedAssetId` and
      `matchToShotId`. Widen `targetDurationSeconds` to 5–1440 in the validator **and** the summary
      schema together. The managed-asset collection set is unchanged — there is no fifth collection.
- [ ] Change `canonicalVideoPosterV2` to resolve the poster **by output role**, not by
      `outputAssetIds[1]`. RED that a job with a third output still resolves its cover.
- [ ] RED: unknown keys; duplicate ownership; orphan assets/jobs; beat active-and-binned overlap;
      invalid Bin items of each kind; 25 beats; 9 shots in one beat; 97 shots; each per-kind Bin
      maximum at exactly N and N+1; shot duration 3 and 16; line history at 20 and 21. Accept every
      exact boundary.
- [ ] RED totality per the validator rules: an asset `clipId`, job `clipId`, Bin `assetId`,
      `selectedTakeId`, `seedStillId`, or `matchToShotId` of `constructor`, `toString`, or
      `__proto__`; a 20,000-link retry chain; a 20,000-link shot chain; an asset `durationSeconds` of
      `1e308`. Assert `toBe(false)` on each, never `toThrow`.
- [ ] RED the chain invariants: a shot heading a segment without a `seedStillId`; a non-heading shot
      carrying one; a chain edge crossing a beat boundary; `chainBreak` set by anything but an author
      operation.
- [ ] RED the derivation invariants: `derived` with a null `derivedFromActionRevision`; `detached`
      with a non-null one; a history entry whose `shotOrdinal` exceeds the beat's shot count.
- [ ] Implement the exact validators and `createEmptyStudioProject()` with empty
      beat/shot/Bin/history state. Resolve every record entry by own key, walk both graphs
      iteratively, and consume the constant named for each contract.
- [ ] Convert canonical-take and summary projection helpers to Beat/Shot. The summary is active-only
      and the film total uses the mixed rule from the frozen contract; test that a no-coverage beat
      contributes its target and a binned beat contributes nothing.
- [ ] Mutation proof: restore a bare `=== undefined` guard at one lookup site and prove the matching
      totality test fails; remove the per-kind Bin maximum and prove the boundary test fails; restore
      both.
- [ ] Run: `bunx vitest run tests/unit/process/creative-studio` and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): define beat and shot contracts`.

### Task 2 — The ordered reducer

**Files**

- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/mutations.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/chain.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/index.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/mutations.test.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/chain.test.ts`

**Steps**

- [ ] RED every operation, ordered later-op visibility, input immutability, late-op rollback,
      capacity precedence, collision rejection, exact permutations, and created-ID ordering.
- [ ] RED the removal rules: `delete_shot` refused when the shot has assets, jobs, or cut
      dependencies; `park_shot` accepted in exactly that case; `restore_shot` returning it to a named
      beat; takes surviving both with a live referent throughout.
- [ ] RED `apply_coverage` refusing to move the boundary of any shot that has takes, and reporting
      which shots it treated as fixed.
- [ ] RED derivation: edit detaches; `rederive_line` writes the previous line to history and restores
      derivation; editing the action bumps `actionRevision` and marks derived lines stale while
      leaving detached lines untouched; history evicts oldest at 20.
- [ ] Implement staleness as a pure derivation in `chain.ts`: which shots are stale, from which
      cause, and what a cascade would cost in generations. Cover tail-versus-head trim asymmetry,
      `reorder_shots` invalidating downstream, `hard_cut` starting a fresh segment, and beat reorder
      changing nothing.
- [ ] Implement `applyStudioMutationBatch(project, batch)` as a pure draft reducer returning the next
      project plus created IDs. Preserve jobs, assets, routing, rules, and undo state unless an exact
      operation owns a field.
- [ ] Static fence the `schema2` directory from filesystem, IPC, job manager, resolver, adapter,
      polling, retry, cancel, and render imports.
- [ ] Mutation proofs: allow `apply_coverage` to move a shot with takes and prove the fixed-point
      test fails; make `reorder_shots` non-invalidating and prove the staleness test fails; restore
      both.
- [ ] Run: `bunx vitest run tests/unit/process/creative-studio/service/schema2` and
      `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): add beat and shot mutations`.

### Task 3 — Schema-aware store inspection

Carries CS2 Task 3 almost intact. Only the seam type signatures change.

**Files**

- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/index.ts`
- Modify: `tests/unit/process/creative-studio/store.test.ts`
- Create: `tests/integration/creative-studio/schema2Cutover.integration.test.ts`
- Modify: `docs/contributing/development.md`

**Steps**

- [ ] Add a bounded schema sniff before V2 parsing returning supported, unsupported V1, not-found,
      and malformed-V2 explicitly. Do not call `migrateSchemaV1Project` on the V2 path.
- [ ] Add V2 create/read/list/summary/update-batch store seams used only by V2 tests until Task 7.
      Keep rename+directory-fsync commit facts, one-revision CAS, summary-repair isolation, and
      commit tags unchanged.
- [ ] RED a complete V1 profile tree and assert identical path set, bytes, metadata hashes, zero
      mkdir/write/rename/rm, and no quarantine.
- [ ] RED malformed schema 2 separately and prove it remains a loud quarantine failure — including a
      **CS2-shaped** schema-2 record, which is now malformed by construction and is what internal
      `Forge-Dev-2` profiles contain.
- [ ] RED fresh empty V2 create/restart, mixed V1+V2 listing, summary totals, batch rollback, stale
      CAS, and exactly one revision/observer fact.
- [ ] Update `docs/contributing/development.md` with the fresh named profile workflow and manual
      profile removal only while the app is stopped. Add no app reset command.
- [ ] Mutation proof: route V1 through the old migrator and prove the no-touch test fails; restore.
- [ ] Run:
      `bunx vitest run tests/unit/process/creative-studio/store.test.ts tests/integration/creative-studio/schema2Cutover.integration.test.ts`
      and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): isolate beat and shot storage`.

### Task 4 — The rate card, estimates, and receipts

**Files**

- Create: `packages/desktop/src/process/services/creative-studio/pricing/rateCard.ts`
- Create: `packages/desktop/src/process/services/creative-studio/pricing/estimate.ts`
- Create: `packages/desktop/src/process/services/creative-studio/pricing/index.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Create: `tests/unit/process/creative-studio/pricing/rateCard.test.ts`
- Create: `tests/unit/process/creative-studio/pricing/estimate.test.ts`

**Steps**

- [ ] Define the rate card: per route, per second, explicit currency, versioned by value. Load it as
      config; it is never a provider API call in v1.
- [ ] RED the estimate as a **range** over one set of shots, with in-flight work counted as context
      and never billed again, and with the cascade priced as a **separate** line from the base set.
- [ ] RED that the headline cost, the generation count, and the button label are all derived from the
      same shot set — a test that fails if any is computed independently.
- [ ] Implement the receipt: persisted on the job, recording route, seconds, generation count, and
      the rate **value** in force. RED that a rate-card change does not alter an existing receipt.
- [ ] Implement the budget predicate as its own pre-dispatch mechanism, scoped per batch, with its
      own breach shape. It is not a `forbidden_terms` variant and does not run per prompt.
- [ ] Mutation proof: make the receipt store a card reference instead of a value and prove the
      card-change test fails; restore.
- [ ] Run: `bunx vitest run tests/unit/process/creative-studio/pricing` and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): add rate card estimates and receipts`.

### Task 5 — Shot ownership, chain sequencing, and the conditioning frame

**Files**

> **This task is a rename plus an addition, not a build.** `v2Service.ts` (815 lines), the clip-owned
> `jobManager` and `mediaStore` conversions, and their ~5,600 lines of tests already exist from CS2
> Task 4 and are CS3-valid. Rename `clipId` → `shotId` (≈218 production lines, ≈334 test lines), then
> add the chain and the frame fallback on top. Do not re-derive the idempotency, submission
> ambiguity, download recovery, cancellation, or retry-lineage logic — it is done and tested.

- Modify: `packages/desktop/src/process/services/creative-studio/service/index.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts`
- Create: `packages/desktop/src/process/services/creative-studio/lastFrame.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/renderService.ts`
- Modify: `tests/unit/process/creative-studio/service/index.test.ts`
- Modify: `tests/unit/process/creative-studio/jobManager.test.ts`
- Create: `tests/unit/process/creative-studio/lastFrame.test.ts`
- Modify: `tests/integration/creative-studio/generationLifecycle.integration.test.ts`
- Modify: `tests/integration/creative-studio/projectRecovery.integration.test.ts`

**Steps**

- [ ] Convert V2 asset/job/take/poster/output/retry/cancel/recovery checks to `shotId`. Preserve
      provider identity, idempotency, submission ambiguity, download recovery, cancellation policy,
      and rule enforcement.
- [ ] RED that the poster resolves **by role** and that a job carrying a third output still yields a
      cover — the inverse of the old positional assumption.
- [ ] Implement the local last-frame fallback in `lastFrame.ts`, entering output persistence as a
      synthesized `ProviderOutput` with `role: 'poster'`, `mediaKind: 'image'`, and
      `source: { kind: 'file', path }`. RED per route: Seedance supplies the frame and the fallback
      never runs; `openrouter-video-v1` and `weprompt-media-gateway-v1` do not, and it does.
- [ ] RED the recovery invariant: with the frame asset deleted from disk, recovery re-derives it and
      **never** re-renders. RED that the window closing mid-chain stalls the chain and resumes.
- [ ] Implement chain sequencing: a shot is submitted only once its predecessor has succeeded and its
      frame asset exists. RED mid-chain failure keeping the partial, billing only completed
      generations, and resuming from the break.
- [ ] RED that eviction cannot reach takes or conditioning frames.
- [ ] Mutation proof: allow submission without the predecessor's frame asset and prove the
      sequencing test fails; restore.
- [ ] Run the studio unit and integration suites and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): own generation by shot with a first-frame chain`.

### Task 6 — Director, proposals, and the full MCP operation surface

> **Also a rename plus an addition.** CS2 Task 5 already built the Director command mailbox,
> processor, spend fences, the four MCP record writers, and `studio_apply_edits` carrying a
> `mutation_batch` — 6,212 production lines and ~7,500 test lines, of which only a few hundred
> reference the renamed vocabulary. The "every hand gesture as an MCP op" surface exists; this task
> renames its ops and adds the ~12 CS3 introduces. `requiredAction` appears zero times in that code,
> so dropping required actions is free.

**Files**

- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts`
- Modify the Director command service, mailbox, processor, writer, and spend-fence modules and their
  tests as the V1 equivalents are versioned.
- Modify: the builtin Studio MCP server and its tool definitions.

**Steps**

- [ ] Rename the Director, proposal, and reference record vocabulary to Beat/Shot. Preserve the
      mailbox, processor, latency, and spend-fence behaviour — it is built and tested.
- [ ] Extend the MCP operation surface with the CS3 additions — `park_shot`, `restore_shot`,
      `apply_coverage`, `trim_shot`, `set_hard_cut`, `set_seed_still`, `rederive_line`,
      `restore_line`, `restore_take`, `set_match_to`, `set_bed` — routed through the same reducer as
      the existing ops.
- [ ] Gate the operations the director must not call yet. **Freeze granularity is per server, not per
      tool**, so this needs either a second server or an explicit per-tool gate; decide and record
      which, because "the tool exists but is not callable" is not a state the current mechanism has.
- [ ] RED the spend fence against the new surface, including operations that are free but create
      staleness: the director may create staleness only through a reviewed proposal, never silently.
- [ ] RED that proposal cards survive and that required actions are gone, their two cases now being
      the render gate and the chain gate.
- [ ] Account for the per-operation cost honestly: each is a reducer op, an MCP tool, a native
      constant, a payload schema, a manifest entry, and a parity test. The manifest parity test sat
      red for four slices once; run the **whole** suite, not the slice's own files.
- [ ] Mutation proof: let a director path create staleness outside a proposal and prove the fence
      test fails; restore.
- [ ] Run the full suite and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): version director commands for beat and shot`.

### Gate 1 review checkpoint

- [ ] Freeze the exact Task 1–6 head and obtain independent process/schema and security/spend review.
- [ ] Verify V2 code is still unregistered from the renderer bridge, current V1 UI behavior is
      unchanged, and no V1 profile tree changed during tests. This check is what certifies the pivot
      premise: the vocabulary must never have reached the bridge, the manifest, or the renderer.
- [ ] **Verify the rename by running the whole suite, not the changed files.** Roughly a thousand
      identifiers moved across thirty-odd files and 18,874 lines of tests. A slice's own tests
      passing says nothing about what it broke elsewhere, and this repo has already carried a red
      cross-file parity test for four slices because nobody ran the repo-wide gate.
- [ ] Run `bun run test`, `bun run test:coverage`, `bun run lint --quiet`, `bun run format:check`,
      `bunx tsc --noEmit`, and `git diff --check`.
- [ ] Resolve every Critical/Important finding in separate commits and re-review before Task 7.

---

## Delivery Gate 2 — atomic cutover and the shell

### Task 7 — Atomically switch runtime, bridge, routes, and renderer

Carries CS2 Task 6 in shape: one atomic switch, legacy deletion in the same task, no dual contract.

**Steps**

- [ ] RED exact native provider inventory and manifest/schema parity.
- [ ] Replace public `StudioProject`/renderer aliases with the Beat/Shot types; delete staging seams.
- [ ] Switch runtime startup to classify supported V2 before any mutating lifecycle action.
- [ ] Register only V2 bridge providers; remove legacy scene providers; switch the builtin MCP server
      to the reviewed V2 entrypoints and delete the V1 entrypoints.
- [ ] Delete the `StudioPage` Director reference-request auto-submit and auto-dismiss path before any
      V2 submit provider becomes reachable.
- [ ] Delete the schema-1 `validateProject` in `store.ts` and every predicate and value set it alone
      keeps alive, so schema 2's copies become the only definitions. Assert each name has exactly one
      definition under `creative-studio/`.
- [ ] Delete the storyboard model role and the `planning/` directory and its tests.
- [ ] Set `STUDIO_VIEWS` to `['table', 'board', 'cut']`. This is a **shared constant**: a main-process
      regex gates the unsaved-work close dialog, so it is not renderer-only.
- [ ] Delete the scene-based Write, Produce, Review, and Export implementations rather than projecting
      beats as scenes.
- [ ] Run the full suite and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): cut over the workspace to beat and shot`.

### Task 8 — Workspace projection, drafts, selection, and gate state

**Steps**

- [ ] Build the shared sanitized projection consumed by Table, Board, beat panel, and Cut.
- [ ] Implement draft persistence and the selection model once, shared across views.
- [ ] Implement the render gate's state: the shot set, the base estimate range, the cascade as a
      separate priced option, and the free alternative when a beat has no coverage.
- [ ] Implement the chain gate's state: what is stale, from which cause, and what resolving costs.
- [ ] RED that switching views changes presentation only — it never saves, refetches, or discards
      drafts.
- [ ] Commit: `feat(studio): add the shared workspace projection`.

### Task 9 — Project shell and the collapsible Director rail

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

- [ ] Freeze the head; independent review; full gate commands; resolve Critical/Important before
      Task 10.

---

## Delivery Gate 3 — the views

### Task 10 — The Table

- [ ] Real data-grid semantics: row and cell roles, keyboard traversal, and a visible focus ring.
- [ ] Columns per the prototype, with **target and actual visually distinct**.
- [ ] Beat states including no coverage, part done, rendering, and stale.
- [ ] Commit: `feat(studio): build the table view`.

### Task 11 — The beat panel and the coverage bar

The core interaction of CS3, and the largest single task. Split it if it exceeds one reviewable diff.

- [ ] Action and Look editors, with the soft 25-word Look counter that warns and never blocks.
- [ ] The coverage bar: boundary drag changes what a shot generates; edge drag trims what it plays.
      Head trim always free; tail trim warns when it breaks continuity.
- [ ] Density tiers computed from the measured bar width, the whole bar committing to one tier taken
      from its narrowest segment. Nothing persisted, nothing chosen, **no tier label rendered**.
- [ ] Chain presentation: segment heads, seed stills, author `hard_cut` distinct in name and treatment
      from system-detected continuity break.
- [ ] Takes, take selection, and per-shot render with its own gate.
- [ ] Derivation: derived versus detached, staleness against the action, re-derive, and line history
      restore.
- [ ] `PART DONE` recovery: the resume affordance, undrawn in the prototype.
- [ ] Reorder inside a beat must not look like reordering beats, and must show the staleness it
      creates.
- [ ] Commit: `feat(studio): build the beat panel and coverage bar`.

### Task 12 — The Board and the Bin

- [ ] Deterministic covers and the no-coverage placeholder.
- [ ] Three card sizes rather than zoom.
- [ ] The Bin: three reference kinds, **both reasons labelled** — lifted versus alternate — with
      restore for each, and drag/keyboard reorder with announcements.
- [ ] Commit: `feat(studio): build the board and bin`.

### Task 13 — The Cut

- [ ] Beat order, one bed fading out at the cut's end, match-to, and export.
- [ ] The Cut cannot reach inside a beat: no trims, no retiming, no take selection.
- [ ] `MATCH TO` presented as a costed re-render, never as a free grade.
- [ ] **No `AUTO-DUCKED`.** If narration state is shown at all it says there is no voice track yet.
- [ ] Export shapes: editor folder always; a still; **`script.md` on demand**, generated at export
      time and never written to the project root or ingested; and **one-file stitched only if the
      ffmpeg scope has an owner and has landed** — otherwise that option is hidden, never shown and
      failing.
- [ ] Retention is per shape, count-based, with size shown for visibility only. RED that it can
      never evict a take or a conditioning frame.
- [ ] Commit: `feat(studio): build the cut view`.

### Gate 3 review checkpoint

- [ ] Freeze the head; independent review; full gate commands; resolve Critical/Important before
      Task 14.

---

## Delivery Gate 4 — hardening and acceptance

### Task 14 — Undo

- [ ] Revision-aware undo covering the destructive moves: re-split, detach, park, restore, and
      match-to change. Director edits are undoable.
- [ ] Line history is the undo substrate for **text**. `RESET` is not: it discards the renderer draft
      through the existing `useDraftPersistence`, writes nothing to history, and never reaches main.
      It is deliberately absent from the mutation vocabulary — RED that no reducer operation exists
      for it, so it can never revert a committed revision and therefore can never lose writing.
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
- [ ] Capacity: 24 beats and 96 shots render and reorder without virtualization.
- [ ] Commit: `feat(studio): harden accessibility and capacity`.

### Task 16 — Lifecycle, spend, and acceptance

- [ ] Prove the whole lifecycle end to end on a fresh named profile: brief, spine, coverage, render,
      chain, cut, export.
- [ ] Prove the spend fences: no unreviewed submission; cascade priced separately; budget cap refuses
      pre-dispatch; in-flight work never billed twice; receipts written per take.
- [ ] Prove recovery: window closed mid-chain, frame deleted, app restarted, provider ambiguous.
- [ ] Commit: `feat(studio): prove the beat and shot lifecycle`.

### Gate 4 review checkpoint

- [ ] Freeze the head; independent process/schema and security/spend review; full gate commands.
- [ ] Studio remains behind `AIONUI_ENABLE_CREATIVE_STUDIO` and off by default. This plan does not
      authorize enablement, packaged acceptance, or a provider launch.

---

## Deliberately not in this plan

- **Voice.** `narration` and `onScreenText` are retained as authored fields with no downstream
  consumer. TTS and the audio lane are their own sequence. This is the product's largest functional
  gap, not a cosmetic one: a three-minute feature walkthrough is a narrated format by definition, and
  without voice the tool produces a mood piece over a music bed.
- **A real colour pipeline.** `MATCH TO` is prompt-level in v1.
- **Multi-reference provider input.** Still a separate provider capability.
- **Project-total budget scope.** Sequenced after receipts exist.
- **Route selection UI.** Carried forward as an open design item.
- **Reconciliation against real provider billing.** Withdrawn until a provider returns billing data.
