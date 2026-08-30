# Creative Studio 4 — the canvas

**Date:** 2026-08-30 · **Revision 3** · **Status:** owner-approved, binding
**Supersedes:** revisions 1 and 2, and the four-view workspace IA

> Revision 3 is a clean contract, not a compatibility amendment. It corrects Revision 2's schema-5
> defaulting, completes the standalone-photo generation contract, separates quoted intent from a
> durable Piece, and narrows Pilot 1 to what the product can actually finish.

---

## Product statement

Creative Studio becomes a multi-modal workspace whose first-class objects are named **Pieces**. A
film is eventually an **Assembly** of Pieces; it is not the container every Piece must live inside.

The load-bearing Pilot 1 requirement is deliberately smaller:

> From a new project with zero Beats and zero Shots, a person can create or import one standalone
> photo, see its cost before any paid work begins, observe progress or failure, receive a named
> Piece, rename it, reload it with stable identity and exact provenance, and export it.

No video, film, Assembly, sound, reference workflow, or ffmpeg dependency belongs to Pilot 1. The
workspace is an automatically laid-out, keyboard-accessible board, not an infinite spatial canvas.

An empty project presents exactly two creation actions:

1. **Create photo**
2. **Import photo**

Shooting-script and sound offers are not shown, disabled, or teased in Pilot 1.

---

## Vocabulary

- **Piece** (`StudioPieceV2`) — a durable, named output owner. A generated Piece may exist while its
  authorized Job is running; an imported Piece is born with its imported asset.
- **Job** (`StudioJobV2`) — the durable record of authorized work, dispatch, recovery, result, and
  spend. It is not a Piece.
- **Quote block** — a provisional renderer presentation of quoted intent. It is not a Piece and is
  not part of canvas inventory.
- **Assembly** (`StudioAssemblyV2`) — a future ordered arrangement of Pieces. It is deferred to
  Phase 6 and does not appear in any Pilot 1 schema or UI.
- **Generation composition** — immutable generation-request provenance. It is not an Assembly.

The screen may call a Piece a card or block. Those are presentation terms, not persisted type names.

---

## Clean project-schema cutover

`STUDIO_PROJECT_SCHEMA_VERSION` moves from **5 to 6**.

Schema 6 is exact. A schema-6 decoder must require all schema-6 keys and invariants. It must not
default missing `pieces`, `pieceOrder`, or any other CS4 field. A schema-5 project is unsupported
test data and follows the existing per-project unsupported/quarantine path. It must never be
silently decoded as schema 6.

There is no migration, compatibility object, dual read, fallback owner, or write-back conversion.
Legacy project data may be deleted through an explicit bounded project-deletion path. Corruption
containment remains: project scanning continues past one unreadable project, crash-safe writes and
startup replay remain, and corruption in one project cannot disable the Studio.

Because an unreadable project cannot provide a trustworthy revision, Main returns an opaque,
expiring deletion claim with its unsupported/quarantined library entry. Human-confirmed deletion
reclassifies the exact directory under lock and consumes the single-use claim. Any changed,
replaced, healthy, expired, or replayed target fails closed; the renderer never receives or supplies
an absolute path or invented revision.

Project schema, Director protocol, proposal protocol, mutation batch, generation composition,
reference request, film-export facts, and export sidecar are independent contracts. A project-schema
bump does not imply that every other version moves. Each contract changes only when its own shape or
semantics changes.

### Contracts that move for Pilot 1

| Contract               | Revision | Reason                                                            |
| ---------------------- | -------: | ----------------------------------------------------------------- |
| Studio project         |    5 → 6 | First-class Piece storage and exact CS4 invariants                |
| Generation composition |    1 → 2 | A real Piece source and `piece_image` purpose                     |
| Mutation batch         |    5 → 6 | Typed, undoable Piece rename                                      |
| Director command       |  10 → 11 | Add typed Piece preparation/rename capability in Phase 5          |
| Export catalog/sidecar |    2 → 3 | Add exact standalone-Piece image and provenance export in Phase 3 |

These versions activate only with the phase that lands every reader and writer for that contract;
they are not coupled to the project-schema bump. Assembly adds no contract in Pilot 1 because it
does not yet exist. Proposal sidecar 6 remains unchanged and unused in Pilot 1; Phase 6 must version
it if a later approved proposal operation changes its shape or authority.

---

## Piece-capable generation provenance

`StudioGenerationCompositionV2` remains immutable request provenance, but its schema independently
moves to version 2. The new version adds a genuine Piece arm rather than pretending a standalone
photo is a Shot or project Reference.

A Piece image request has all of these matching facts:

- purpose: `piece_image`
- target: `{ kind: 'piece', pieceId }`
- source: a text-only Piece-image source carrying the normalized user prompt and request-scoped
  photo settings
- resolved provider route and model revision
- exact prompt composition sent to the provider
- an exact empty conditioning-input list; image-conditioned creation is deferred to Phase 6
- quote revision, authorization provenance, and producer linkage

Validators enforce the source/purpose/target relationship as a biconditional. Quote, authorization,
Job, composition, producer asset, and Piece must agree on the same immutable `pieceId`. A mismatch,
missing owner, stale revision, duplicate confirmation, or unsupported composition version fails
closed before dispatch.

Generation-composition version 1 remains meaningful only inside schema-5 records, which the clean
cutover rejects. No stored prompt is recomposed or rewritten to make it look current.

---

## The create, quote, and import lifecycle

### Create photo

1. The person or Director drafts wording. Main resolves the route, rate, request-scoped photo
   settings, and a new immutable `pieceId`.
2. Main prepares a quote that freezes the reserved id, prompt composition, route, revision,
   provenance facts, settings, currency, and exact price. **No Piece or Job exists yet.**
3. The renderer shows a provisional quote block in the future Piece's board position. It is visibly
   quoted intent, not a Director proposal card, a durable Piece, or canvas inventory.
4. Immediately before authorization, Main rederives the quote from current state. Stale or changed
   state rejects the quote and requires fresh review.
5. Once the spend rule permits the work, one compare-and-swap commit atomically creates the Piece,
   spend authorization, and queued Job. Dispatch happens only after that commit.
6. Provider success is committed atomically with the validated asset, exact hash/provenance,
   producer linkage, Piece current-asset pointer, and Job success.

A declined, expired, invalid, or never-confirmed quote leaves no Piece, Job, authorization, or empty
canvas record. A duplicate confirmation cannot create a second Piece or charge.

### Import photo

Import does not quote or spend. After byte and media validation, one atomic commit creates the
Main-issued Piece id, imported asset, exact hash and import provenance, Piece current-asset pointer,
and canvas order entry. Failure leaves none of them behind.

Imported provenance is never presented as generated provenance. A later approved capability may
allow generation to supersede an imported current asset, but Pilot 1 does not; any future path must
preserve the imported bytes and history.

### Retry an incomplete generated Piece

Retry is not creation. A fresh exact quote targets the existing retryable failed, cancelled, or
needs-attention generated Piece and copies the prior authored words/settings without an edit surface.
Confirmation atomically appends a new authorization and queued Job; it does not create another Piece
or change the Piece's id, handle, order, or current asset. Pilot 1 offers no variation, replacement,
regeneration of completed work, edited retry, or generation over an imported Piece. Different words
create a sibling Piece.

Schema 6 persists an exact retry predecessor and reason. Its retry-reason enum is
`provider_failure | submission_unknown | variation_grid | cancelled`; Main derives the reason from
the predecessor state and never maps cancellation to provider failure. The schema-5 reader retains
its former enum. `submission_unknown` is exceptional because a provider may already have charged:
it always requires a reviewed duplicate-charge warning and explicit human acknowledgement, even
under a matching cap, and persists the acknowledgement and timestamp on the retry Job.

---

## Identity, names, and ownership

Main mints every persisted safe id. The renderer and Director may echo a Main-issued id when
targeting an existing record, but cannot mint, reserve, replace, or choose a new Piece, Job, asset,
quote, authorization, or export identity.

A Piece has one immutable id and one mutable human-facing handle. Handles are Unicode text, not ASCII
slugs. One Main-owned normalizer has two explicit modes:

- **derive** for a new generated/imported Piece: preserve letters, marks, and numbers from every
  script; fold whitespace and ordinary punctuation to `_`; discard unsafe controls/invisible
  spoofing characters and path separators; truncate safely to both scalar and UTF-8 bounds; use the
  locale-independent fallback `piece`; and add a bounded collision suffix;
- **rename** for text a person explicitly submits: apply the same Unicode normalization and ordinary
  punctuation folding, but reject unsafe controls/invisibles/path separators, an empty result,
  over-bound text, or a collision instead of silently deleting, truncating, falling back, or adding a
  suffix.

Both modes resolve against current handles, retained aliases, and active reservations. Render the
handle inside a bidi-isolated element with `dir="auto"`; do not force `dir="ltr"` on Persian, Arabic,
Hebrew, or mixed-script names.

Renaming is a typed direct, human-visible, undoable `rename_piece` operation shared by the renderer
and Director paths; it is not a proposal. The former handle is retained as a bounded alias so links
remain useful. Aliases may never become ambiguous or be silently evicted: when the cap is reached,
another rename is refused unless it reuses an existing alias. Immutable ids, never handles, cross
process boundaries and appear in quote or dispatch records.

Returning to a retained alias swaps it with the current handle, so the alias count does not grow even
when the bound is full. Active Main reservations participate in the same namespace as persisted
handles and aliases; concurrent preparations cannot reserve the same normalized handle. Expiry or
refusal releases only that reservation, and confirmation rechecks the namespace before commit.

Import derives the initial handle from the selected file's Unicode basename without its final
extension, inside the project queue. The raw path never crosses to the renderer or persists as the
handle. Empty/unsafe basenames use `piece`, and concurrent same-name imports receive deterministic
suffixes. The person may use explicit rename afterward.

Pilot 1 has no public `create_piece` or `delete_piece` mutation. Creation belongs to the atomic
confirm/import transactions above. Deletion semantics require a later product ruling because Jobs,
authorizations, assets, and provenance must not be orphaned. Presentation removal is not byte
deletion and must not be disguised as it.

Each asset has exactly one legal owner kind, with project-owned audio treated separately when that
later modality returns. For a Piece image:

- the asset's `pieceId` resolves to a Piece;
- the Piece's optional current asset id resolves back to that Piece;
- a producer Job targets the same Piece;
- no Shot or Reference owns the same asset;
- every retained Job and asset is represented exactly once in its owner's lineage.

---

## Piece lifecycle and canvas presentation

The old phrase “every block holds finished work” is too strong. The actual rule is:

> The canvas contains purposeful work, never empty film-craft rooms.

A durable Piece may therefore be:

- **running** — created atomically with an authorized Job, with no current asset yet;
- **needs attention / failed / cancelled** — its durable Job and authorization history remain;
- **current** — it owns one current imported or generated asset.

Pilot 1 never replaces completed media, so schema 6 contains no superseded-asset field or state. It
retains every failed/cancelled Job and authorization attempt. Phase 6 must define and version asset
replacement/history before any current-asset pointer may advance to different bytes.

For Create photo, the provisional quote block before authorization is not a Piece; after
authorization, it is replaced in place by the newly durable Piece block without implying that paid
output already exists. A retry quote instead belongs to capability activity for an existing Piece;
confirmation appends its Job history and updates that Piece's state without replacing its identity.

The three Main-owned projections are:

1. **Canvas inventory** — durable Pieces, order, labels, current assets, and lineage state.
2. **Capability activity** — quotes, Jobs, progress, attention, failure, cancellation, and spend
   facts. A quote block comes from this projection, not inventory.
3. **Film composition status** — the existing film readiness projection, consulted only after
   Assembly arrives in Phase 6.

Authoring revisions and capability activity must not share an accidental invalidation clock. A Job
progress update cannot stale an unrelated prepared quote or direct Director action. Future proposal
review must use the same dedicated authoring authority when it returns in Phase 6.

---

## Request-scoped photo settings

A standalone photo does not inherit a film scaffold. Aspect ratio, output resolution, prompt,
provider route, and model revision are resolved for that invocation and frozen in its quote and
generation composition. Pilot 1 Create photo is text-to-image only; imported photos do not become
conditioning inputs until a later reviewed capability.

Creating a CS4 project must not require film duration, film resolution, or a film aspect ratio. Film
defaults may return with Assembly in Phase 6; they are not hidden prerequisites for Pilot 1.

---

## Authority and spend

| Actor    | Owns                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Director | Draft wording and suggest a name                                                                                                  |
| Main     | Identity, hashes, eligibility, route, rate, quote, revision, provenance, deterministic gates, authorization records, and dispatch |
| Human    | The active per-batch spend cap and any explicit approval required outside it; irreversible decisions                              |
| Renderer | Present intent and cost, collect explicit human action when required, and show progress or failure                                |

Every quote displays the exact cost and currency before paid work begins.

Pilot 1 admits only fixed-price single-image routes whose quoted lower and upper minor-unit amounts
are equal. A paid retry is a new reviewed quote and follows the same cap/explicit-action rule; no
authorization silently covers another provider attempt. Variable-price routes and unquoted or
provider-internal automatic retry are deferred.

- If an active human-authorized per-batch cap exists, its currency matches, the rederived quote is
  within that cap, and no irreversible action is involved, Main may authorize and proceed without an
  additional confirmation click.
- If no cap exists, currency differs, the quote exceeds the cap, or an irreversible action is
  requested, the renderer requires one explicit bounded human action.
- A `submission_unknown` retry always requires the human-only duplicate-charge acknowledgement,
  regardless of cap, because the prior provider submission may already have spent money.
- Confirmation always rederives and rejects stale state before its mode-specific atomic commit:
  create writes Piece + authorization + Job; retry appends authorization + Job to the existing Piece.

`maxPerBatchMinorUnits` is a ceiling, not a wallet. The UI must not show credits, “remaining”, “left”,
or a drawn-down balance derived from receipts. Recorded spend may be shown as recorded spend by
currency, never relabelled as available funds.

Free reversible work is informed, not gated. It still receives deterministic validation and cannot
silently alter paid provenance.

---

## Pilot 1 workspace

The first screen is the board plus the existing Director relationship, with exactly **Create photo**
and **Import photo** as creation actions. A single composer may collect the Create-photo description;
it must not compete with a second composer or imply that typing arbitrary words is authorization.

The quote block shows the normalized request, request-scoped settings, exact price/currency, and the
action required by the spend rule. When a cap permits automatic work, the cost remains visible and
the status explains that work was authorized by the active cap.

The resulting Piece block owns progress, retry/cancellation where legal, failure copy, rename,
current image, provenance disclosure, and export. Reload reconstructs the same Piece and activity
from persisted Main state.

Pilot 1 exposes no Director proposal card. The Director's two Piece capabilities—prepare a photo and
rename a Piece—use the same typed direct operations as the renderer. The quote block is the only
review surface for prepared paid work.

The current app bar is **not** preserved unchanged. Four-view navigation and the film-only Render
control do not belong in the Pilot 1 workspace. Project naming and applicable project-menu actions
may remain. The menu retains a human-only **Spending limit** action for setting, changing, or clearing
the per-batch amount and currency; it is not the retired film Project settings dialog. Controls for
absent capabilities are removed rather than shown disabled. Director copy and its workspace map must
be updated in the same tranche as the visible IA.

### Accessibility and localization

- Full keyboard traversal with stable focus when quote → Piece replaces in place.
- Live-region announcements for paid-work start, progress transitions, failure, cancellation, and
  completion without repeating every progress tick.
- Programmatic labels for create, import, quote action, rename, provenance, retry/cancel, and export.
- All copy in all twelve locales in the same change; Persian layout uses logical properties.
- Handles use bidi isolation and `dir="auto"`; status and action copy wraps rather than truncates.
- Light/dark use Arco tokens and semantic styling; color is never the only status signal.

---

## Export

Pilot export writes the exact current Piece photo plus a provenance sidecar. It does not initiate
generation or spend. It fails closed if the current asset, hash, owner, producer/import provenance,
or frozen request facts are inconsistent.

The sidecar freezes Piece id and handle-at-export, asset id and sha256, media facts, origin
(imported/generated), provider/route/model and quote/authorization/receipt provenance when generated,
and the export contract version. Export sidecar version 3 lands with this exporter, not during the
earlier project-schema task.

---

## Delivery sequence

### Phase 0 — amendment and stabilization

Freeze this contract; rewrite all open-backlog dispositions with complete rationales, destinations,
claimants, and acceptance evidence; fix the declared pre-CS4 blockers. No feature implementation
starts from an ambiguous contract.

### Phase 1 — exact contracts

Land project schema 6, Piece invariants, generation composition 2, `piece_image` purpose and matching
source/target, request-scoped photo settings, Main-issued identity, Unicode handles, quote
reservation, asset ownership, exact mutation parsing, and rename undo.

The contract harness must use the real types and compile before production implementation begins.

### Phase 2 — behavior-neutral extraction

Split the oversized store and workspace renderer behind fixtures captured from the real backend.
This tranche contains no CS4 behavior and proves behavior neutrality independently.

### Phase 3 — headless runtime

Implement import, quote/rederive, cap or explicit authorization, atomic new-Piece confirmation,
atomic same-Piece retry append, dispatch, media publication, retry/cancellation, reload,
projections, provenance, and standalone-photo export behind an isolated CS4 Main entry point.

### Phase 4 — fake-adapter lifecycle gate

Exercise the complete Main lifecycle with zero Beats and zero Shots: import, quote, stale/duplicate
confirmation, within-cap authorization, outside-cap explicit action, dispatch, failure, retry,
restart recovery, invalid output, quarantine containment, reload, and export. This is a headless
integration gate, not the user E2E.

### Phase 5 — Pilot canvas and user E2E

Switch the production Main and renderer paths together, then ship exactly Create photo and Import
photo; provisional quote presentation; cost/authorization state; durable Piece progress, failure,
rename, provenance, reload, and export; Director integration; all twelve locales; RTL, responsive,
accessibility, and theme behavior. Retire the four CS3 views and film-only app-bar controls here. Run
the actual renderer-to-Main Pilot journey.

### Phase 6 — Assembly and later modalities

Only after Pilot 1 passes: Assembly, film, Beats/Shots, references, video, sound, ffmpeg distribution,
preview/export parity, and automatic free recuts. Composition in the CS4 arrangement sense first
appears here; generation composition remains request provenance. Define the first proposal-producing
operations, one-pending rule, authoring authority, review surface, and proposal-sidecar version here;
Pilot 1 deliberately creates no proposal.

Phase 6 also defines completed-Piece variation/replacement, imported-to-generated replacement, and
the bounded superseded-asset lineage they require; none is preallocated in schema 6.

Parallel implementation begins only after Phase 1 freezes the seam. Headless runtime and its tests
may split across separate files against those contracts, but the canvas does not start until the
Phase 4 lifecycle gate passes.

The Phase 3 entry point is development isolation, not a dual-schema product reader. Production stays
on CS3 through Phase 4; Phase 5 selects CS4 Main and renderer together and removes the former path.

---

## Backlog contract

Backlog triage is a committed deliverable, not a note. Each open entry must have:

- one disposition: `fix-before-CS4`, `absorb`, `superseded-by-cutover`, or `defer`;
- an untruncated rationale;
- an explicit destination phase when absorbed or deferred;
- one claimant field; `Unclaimed` is honest until an implementation owner reserves the entry;
- an exact test, source audit, or observed behavior that can close it.

The Revision 3 allocation is **3 fix-before · 26 absorb · 1 superseded**. BUG-176 belongs to Phase 6
and must not block Pilot 1. No entry is closed merely because the UI containing its present symptom
is deleted; the underlying behavior must either have evidence in the replacement or be explicitly
superseded.

---

## Completion gates

For each tranche, run the repository-prescribed order and record evidence:

1. lint autofix and repository formatter
2. TypeScript typecheck
3. i18n type generation and twelve-locale validation
4. focused tests for every changed contract and behavior
5. Creative Studio coverage with every new runtime file in the explicit manifest
6. accessibility assertions for new renderer surfaces
7. full tests and source audit
8. fake-adapter integration at Phase 4 and actual Pilot E2E at Phase 5

Contract-focused coverage includes exact-key rejection, schema-5 rejection, no decode-time defaults,
Unicode and bidi handles, project-wide handle/alias collisions, Main-only identity, atomic failure,
duplicate and stale quote confirmation, cap/currency behavior, owner cross-links, undo, restart recovery,
quarantine containment, exact provenance, and export hash consistency.

No phase is complete merely because documentation or a partial type union compiles.

---

## Wireframe authority

The bundled Revision 2 wireframe remains useful visual evidence for block density, disclosure,
progress, responsive layout, Arco mapping, and light/dark treatment. It is not the Pilot 1 contract.

For Pilot 1, disregard its reference-conditioned photo flow, shooting-script and import-sound offers,
second composer, credit/envelope readouts, forced left-to-right handles, film blocks, and implication
that ordinary prompt text is a spend confirmation. Under the 2026-08-30 owner approval, the quote
block/Piece distinction and the spend rules in this document supersede those drawings.

---

## Explicitly out of scope for Pilot 1

Assembly; film; Beats and Shots; character/background References; video; generated or imported
sound; voice; ffmpeg packaging; freeform canvas positioning; hand reordering; Piece deletion;
migration or compatibility fields; credits or a remaining-balance display.
