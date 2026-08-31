# Creative Studio 4 — Revision 3 implementation plan

**Date:** 2026-08-30

**Status:** owner-approved, binding; implementation started on `codex/creative-studio-4-pilot`

**Planning baseline:** `f3f9f764b`

**Pilot:** one standalone photograph

**Supersedes:** the Phase 1 plan introduced at `00967fcaf`

`f3f9f764b` is a checkpoint for the design discussion, not evidence that any CS4 runtime contract is
complete. This document replaces the earlier schema-5/defaulting plan. It is the dependency-ordered
plan for Phases 0–6; it deliberately contains no speculative TypeScript literals or hand-built job
fixtures.

No push is authorized by this plan. A phase may be committed locally only after its own exit gate is
green. Pushing or merging still requires separate owner authorization.

---

## 1. Pilot 1 outcome

From a newly created project that requires no Beat, Shot, Reference, film duration, Board style, or
project-wide render dimensions, a person can:

1. choose **Create photo** or **Import photo**;
2. for generation, enter words and invocation-scoped aspect ratio and resolution;
3. see the exact quote in currency before any provider attempt;
4. proceed automatically only under the confirmed spend rule, or explicitly confirm when required;
5. see one Piece appear with queued, running, failed, needs-attention, or current state;
6. receive one verified image as that Piece's current asset without losing prior attempts;
7. rename its `#handle` and undo the rename;
8. reload with the same Piece, Job, asset, authorization, hashes, receipt, and provenance;
9. export the exact current image plus a deterministic provenance sidecar; and
10. delete an unsupported or quarantined project from the library without opening it.

Pilot 1 contains no Assembly, film, video, generated sound, audio-bed workflow, freeform spatial
layout, reference-conditioning workflow, Beat, Shot, or ffmpeg dependency. The word “composition”
in Pilot 1 refers only to the existing frozen generation-request provenance contract. It does not
introduce an ordered-work concept.

---

## 2. Binding decisions

### 2.1 Clean project cutover

- The persisted project schema moves from **5 to 6**.
- A schema-5 project is never decoded as schema 6, never defaulted with Piece fields, and never
  rewritten. It is listed as unsupported cutover data and remains deletable.
- A malformed schema-6 project remains corruption: isolate it, quarantine it, continue loading other
  projects, and keep deletion available.
- There is no migration function, compatibility field, “missing means empty” rule, or prompt rewrite.
- Crash-safe replacement, bounded traversal, startup replay, manifest/brief correlation, and
  per-project failure isolation remain mandatory.

The later block-grammar commission's statement that the canvas arrives beside the four CS3 views is
not an adopted schedule change. The block grammar is accepted as a presentation specification only.
Production remains wholly on schema 5 and the four views through Phase 4; Phase 5 selects schema 6
and the canvas together and removes those views in the same cutover. There is no production interval
with a schema-6 canvas beside schema-5 film views, and no dual-schema project reader.

The schema-6 project root contains only Pilot-relevant project identity and Director binding,
`revision`, `authoringRevision`, name, brief/rules, Piece order and Piece map, assets, Jobs, spend
policy and authorizations, undo history, and timestamps. Optional integrations use explicit `null`
rather than legacy missing-key semantics. Film-only root settings and collections do not appear in
schema 6. Phase 6 must make a new explicit schema decision before adding Assembly or film state.

### 2.2 Piece lifecycle

A Piece is the durable owner of one standalone photograph. Pilot 1 supports exactly one Piece kind:
`photograph`.

- **Prepare new generation:** Main allocates and caches a `create` reservation containing the new
  Piece id, Job id, authorization/item identity, proposed handle and order slot, exact request intent,
  provider binding, cancellation policy, quote, and expiry. Project storage and sidecars are not
  written.
- **Prepare retry:** only a persisted retryable failed/cancelled/needs-attention generated Piece may
  create a `retry` reservation. It targets the existing Piece and source Job, copies the source's
  authored words and request-scoped settings without an edit surface, and allocates only fresh quote,
  authorization/item, and Job identities. It reserves no Piece id, handle, or order slot.
- **Retry reason:** schema 6 uses the exact enum
  `provider_failure | submission_unknown | variation_grid | cancelled`. Main derives it from the
  predecessor condition: ordinary terminal provider failure → `provider_failure`, unknown submit
  outcome → `submission_unknown`, detected variation grid → `variation_grid`, and cancelled
  predecessor → `cancelled`. The schema-5 production reader keeps its former enum until the Phase 5
  cutover.

  | Exact predecessor state                                                          | Fresh paid-retry result        |
  | -------------------------------------------------------------------------------- | ------------------------------ |
  | `failed` or `needs_attention` with `submission_unknown`                          | `submission_unknown`           |
  | `failed` with `variation_grid`                                                   | `variation_grid`               |
  | `cancelled`                                                                      | `cancelled`                    |
  | `failed` with another non-null error except `download_failed` or `poll_deadline` | `provider_failure`             |
  | `download_failed` or `poll_deadline`                                             | no fresh Job; recover same Job |
  | active, succeeded, missing-error, or other `needs_attention` state               | ineligible                     |

  `download_failed` retains the existing same-Job byte-download recovery. `poll_deadline`
  retains the existing same-Job provider-status recovery. Neither may mint a second paid Job.

- **Confirm new generation:** under the project queue, Main claims the `create` reservation,
  re-derives the request and quote, checks authoring and spend authority, and atomically writes the
  Piece, authorization, and queued Job. Dispatch begins only after that commit succeeds.
- **Confirm retry:** under the same queue and service, Main revalidates the exact Piece, source Job,
  lineage, retryable state, copied words/settings, authoring fingerprint, route/rate, and spend rule,
  then atomically appends only the new authorization and queued Job to that Piece. It cannot change
  the Piece's id, handle, order, or current asset and cannot create another Piece.
- **Expired, rejected, stale, lost-on-restart, or failed confirmation:** `create` leaves no Piece,
  Job, authorization, asset, or sidecar record. `retry` leaves the existing Piece and lineage
  unchanged and adds no authorization or Job. The person prepares again.
- **Import:** Main validates and stages the selected image, allocates every id, and atomically commits
  one Piece plus one imported asset. On failure, staging is cleaned or recovered by the existing
  transaction machinery; no ownerless asset or empty Piece remains.
- **Provider success:** one commit registers the verified asset, sets the previously empty Piece
  current-asset pointer, and marks the Job succeeded. Provider bytes can never become current before
  that commit. A duplicate or late output cannot replace those bytes.
- **Provider failure or cancellation:** the Piece and Job remain truthful. No unquoted asset is
  substituted, and completed assets are never removed.

Pilot 1 exposes retry only for an incomplete generated Piece. It does not expose variation,
replacement, edited retry wording/settings, regeneration of a completed Piece, or generation over an
imported Piece; those need a later reviewed product contract. A person who wants different wording
uses Create photo and receives a sibling Piece.

That sibling model makes the 96-Piece bound an explicit Pilot project-lifetime capacity, not an
eviction threshold. Main must refuse a 97th generated or imported Piece before admitting a prepared
session, exposing a quote, or spending, and must recheck the same bound under the project queue at
confirmation/import commit. The renderer explains that the Pilot project is full and directs the
person to start another project. Raising the bound would only postpone the same limit; completed
replacement, presentation removal, and retained superseded provenance remain Phase 6 decisions.

Pilot 1 renders each Piece as a one-member stills block. The later canvas grammar's allowance for a
stills block with up to twelve members means an aggregation of up to twelve distinct Pieces; it does
not change the invariant that one Piece owns exactly one photograph.

Renderer and Director preparation call the same typed Main service. Main exposes admitted sessions
through an ephemeral renderer-safe `preparedPhotoQuotes` activity projection keyed by
`reservationId`; each row contains `mode: create | retry`, the Main-issued quote identity/revision,
target Piece id, proposed handle only for `create`, normalized words, request-scoped settings, exact
price/currency, spend-policy classification, expiry, whether explicit human action is required, and
`duplicateChargeAcknowledgementRequired`. It exposes no provider secret, internal path,
authorization identity, idempotency key, or authoritative fingerprint.

Admission, release, consume, and expiry emit the normal Studio activity notification. A renderer
reload in the same Main process re-queries and restores the quote block; a Main-process restart
truthfully loses the non-durable reservation. A lost `create` reservation leaves no new Piece; a
lost `retry` reservation leaves the existing Piece and lineage unchanged. For a within-cap quote,
the renderer first commits the quote block, waits for the next browser paint opportunity, and only
then calls the ordinary typed confirmation service. Main never auto-dispatches merely because a
session was admitted. The actual renderer E2E holds the fake adapter at dispatch and proves the
quote is visible before releasing it; a jsdom state assertion alone is not sufficient evidence.

There is no public `create_piece` or `delete_piece` mutation in Pilot 1. Creation exists only in the
two atomic service paths above. Piece removal is omitted until product defines presentation removal,
provenance retention, and physical-byte deletion separately.

`rename_piece` is the one new public authoring mutation. It is free, reversible, validated by Main,
and represented by a real undo patch. It changes no immutable id and no frozen historical
composition.

### 2.3 Identity and handles

Main mints project, Piece, asset, Job, quote, authorization, item, mutation, and export identities.
Renderer and Director inputs may echo a Main-issued id to target an existing record, but never mint,
reserve, replace, or choose a new durable identity.

The stored handle excludes the visual `#`. Handle derivation and rename validation share one helper
with explicit `derive` and `rename` modes. Their common pipeline:

1. normalize with Unicode NFKC;
2. apply locale-independent Unicode lowercase;
3. retain Unicode letters, combining marks, and decimal numbers from every script;
4. retain Persian ZWNJ (U+200C) only in the UAX #31 A1 context used by the supported fa-IR
   alphabet: directly after a dual-joining letter and directly before a right- or dual-joining
   letter; ZWJ, bidi controls, adjacent combining marks, and all other invisibles remain unsafe;
5. replace runs of whitespace or ordinary punctuation with one underscore and trim edge underscores;
   and
6. measure both Unicode scalar count and UTF-8 byte count without cutting a scalar, combining
   sequence, or contextual joiner from its following letter.

`derive` discards unsafe controls, bidi/invisible spoofing characters, and `/` or `\` path
separators; safely truncates to the documented bounds; uses locale-independent `piece` when nothing
remains; and resolves collisions with a bounded numeric suffix after truncating the base. `rename`
rejects those unsafe characters/separators, an empty normalized result, either exceeded bound, or a
namespace collision; it never silently deletes, truncates, falls back, or suffixes explicit text.

Current handles and retained aliases share one project-wide namespace. Matching uses the normalized
stored form. `priorHandles` is dense, unique, and bounded. No alias is silently retired: once the
documented limit is reached, another rename is refused unless it returns to an existing alias.
Immutable Piece ids, not aliases, remain the permanent provenance reference. Tests must cover
Vietnamese, Persian, Cyrillic, Japanese, Korean, Traditional Chinese, composed/decomposed accents,
RTL text, valid and ineffective Persian ZWNJ contexts, ZWJ/bidi refusal, emoji-only derived fallback,
derived boundary truncation without an orphan joiner, explicit over-bound refusal,
unsafe-character/path refusal, collisions against both a current handle and an alias, rename-back,
and refusal at the alias cap.

Rename-back swaps the selected prior handle with the current handle, preserving a dense alias array
without increasing its count; it remains legal at the cap. The prepared-session cache reserves each
proposed normalized handle against current handles, aliases, and other active reservations. A
concurrent collision receives the deterministic suffix. Expiry/refusal releases that reservation,
and confirmation recomputes the namespace under the project queue rather than silently choosing a
different handle from the one reviewed.

Generated-photo preparation derives from the Director suggestion or normalized prompt. Import
derives from the selected file's Unicode basename without its final extension while Main holds the
project queue; no raw path crosses into renderer state or persisted provenance. Empty/unsafe
basenames use `piece`. Concurrent same-name imports receive deterministic suffixes, and explicit
rename remains available afterward.

#### Exact Pilot 1 shape and bounds

These values are part of schema 6 and are not implementation suggestions:

| Surface              | Exact bound or key set                                                                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project root         | Exact keys: `schemaVersion`, `revision`, `authoringRevision`, `id`, `name`, `brief`, `rules`, `forgeProjectId`, `briefConversationId`, `pieceOrder`, `pieces`, `spendPolicy`, `spendAuthorizations`, `undoHistory`, `assets`, `jobs`, `createdAt`, `updatedAt` |
| Piece                | Exact keys: `id`, `kind`, `handle`, `priorHandles`, `currentAssetId`, `jobIds`, `createdAt`, `updatedAt`; `kind` is exactly `photograph`                                                                                                                       |
| Safe identity        | ASCII `[A-Za-z0-9_-]{1,256}`; Main mints every durable identity                                                                                                                                                                                                |
| Project text         | Name: 1–256 JavaScript code units, trimmed; brief: 0–16,384 code units                                                                                                                                                                                         |
| Rules                | At most 24; rule text at most 240 code units; at most 8 forbidden terms, each at most 64 code units                                                                                                                                                            |
| Piece catalogue      | At most 96 Pieces and 96 assets                                                                                                                                                                                                                                |
| Handle namespace     | Current handle at most 48 Unicode scalars and 192 UTF-8 bytes; at most 20 retained aliases per Piece                                                                                                                                                           |
| Job lineage          | At most 32 Jobs per Piece, 3,072 Jobs total, and 3,072 spend authorizations                                                                                                                                                                                    |
| Undo                 | At most 20 entries; a schema-6 entry contains exactly one Piece-catalog patch                                                                                                                                                                                  |
| Generation text      | Normalized authored words and frozen composed prompt are each at most 32,768 code units; provider model is 1–256 trimmed code units                                                                                                                            |
| Photo request        | Aspect ratio is one of `16:9`, `9:16`, `1:1`, `4:3`, `3:4`; resolution is `720p` or `1080p`; exactly one output; no conditioning inputs                                                                                                                        |
| Image asset          | MIME is `image/jpeg`, `image/png`, or `image/webp`; verified bytes are 1–52,428,800                                                                                                                                                                            |
| Prepared-photo cache | Five-minute TTL; at most 4 sessions/project and 16 globally; at most 8 MiB/session, 16 MiB/project, and 64 MiB globally                                                                                                                                        |
| Deletion claims      | Five-minute TTL and at most 64 active claims                                                                                                                                                                                                                   |
| Export 3             | Canonical manifest at most 1 MiB; relative path at most 1,024 UTF-8 bytes and depth 4; each segment at most 256 scalars and 512 UTF-8 bytes                                                                                                                    |
| Timestamp            | Exact canonical 24-character UTC ISO-8601 with milliseconds, for example `2026-08-30T00:00:00.000Z`                                                                                                                                                            |

Dense-array rules, exact map-key/id equality, finite safe integers, lowercase SHA-256 digests,
managed relative paths, and no accessors, proxies, sparse arrays, undeclared keys, or inherited data
apply throughout. These bounds may change only with an explicit schema decision and corresponding
boundary tests.

### 2.4 Two revision authorities

Schema 6 separates storage concurrency from authored meaning:

- `revision` increments for every durable project commit and remains the store's internal CAS
  authority.
- `authoringRevision` increments only when project meaning changes: name, brief/rules, Director
  binding, spend policy, Piece creation/import, or Piece rename. Job progress, retry bookkeeping,
  cancellation, receipts, generated outputs, and current-asset publication increment `revision` but
  not `authoringRevision`.

Renderer mutations, Director authoring commands, and prepared generation intents bind to
`authoringRevision`. Main still commits against the current internal `revision` while holding the
project queue. Confirmation also compares an exact Main-derived authoring fingerprint for the fields
the request consumed. Runtime activity therefore cannot stale a direct action or quote, while an
actual prompt, settings, policy, or handle change does.

The wire and persisted fields are exact:

| Contract                       | Authoring authority                                                               | Storage/audit authority                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Schema-6 root                  | `authoringRevision`                                                               | `revision`                                                                                                             |
| Mutation batch 6               | request `expectedAuthoringRevision`; result `authoringRevision`                   | Main captures current `revision` under the queue and returns committed `revision`; renderer never supplies storage CAS |
| Main-only prepared reservation | `authoringRevision`, `authoringFingerprintVersion: 1`, and `authoringFingerprint` | `projectRevisionAtPreparation` is audit-only                                                                           |
| Renderer-safe quote projection | None accepted from renderer; display-only session/quote facts                     | No storage CAS or authoritative fingerprint/revision is exposed                                                        |
| Composition 2                  | the same authoring fields copied from the prepared request                        | `projectRevisionAtPreparation` is frozen history                                                                       |
| Authorization and Job          | the same prepared authoring fields after revalidation                             | `projectRevisionAtPreparation` plus `projectRevisionAtAuthorization` from the atomic commit                            |

Confirmation input carries only the Main-issued `reservationId`, `quoteId`, and `quoteRevision`,
plus the explicit-human decision when one is required and a typed duplicate-charge acknowledgement
only when the safe projection requires it. Main retrieves every authority field from its cache,
recomputes them, and rejects any missing, extra, or mismatched acknowledgement; renderer and Director
cannot echo a replacement fingerprint into authority.

On a successful commit, the persisted authorization retains the exact quote and its `reservationId`
so Main can rederive the quoted item id after cache loss or restart; a coordinated rewrite of quote,
Job, binding, and receipt ids is still invalid. The authorization also freezes the exact cancellation
policy selected by Main, and the persisted Job must match it. Neither authority is reconstructed from
current defaults.

`authoringFingerprintVersion: 1` is SHA-256 over a domain-separated canonical encoding named
`weprompt:studio-authoring:v1`. Map keys sort lexically and arrays retain semantic order. Its common
payload contains project id, `authoringRevision`, project name, brief/rules, Director binding, spend
policy, and the ordered Piece id/kind/handle/prior-handle namespace. Its prepared-request arm is
mode-discriminated: `create` adds the reserved Piece id, proposed handle and order slot plus the
normalized words and request-scoped settings; `retry` adds `existingPieceId`, `sourceJobId`, and the
target Piece's ordered immutable Job-lineage projection—each `jobId`, `retryOfJobId`, and
`retryReason`—plus the copied words and settings, and has no proposed handle or new Piece/order
identity. Main derives that projection from the target Piece's persisted `jobIds` and Job records;
no renderer, Director, prepared-session caller, or fingerprint caller supplies replacement lineage.
Retryable status and current terminal state remain separate confirmation gates. The
fingerprint excludes Job progress/status/error text, receipts, current-asset publication caused by
runtime completion, timestamps, and storage `revision`. Route, rate, composition, and request-plan
equality remain separate frozen quote checks. Phase 6 proposal review must use the same
project-authoring payload without a prepared-request arm if proposals return.

The historical revisions captured in a Job remain audit facts. They are not used as claims that
future runtime-only writes invalidate the request.

### 2.5 Confirmed spend rule

Every quote is shown in real currency before provider dispatch. There is no credit count, wallet,
remaining balance, or draw-down display.

- Pilot 1 accepts only fixed-price single-image routes whose quote has equal lower and upper
  minor-unit amounts. If an active per-batch policy exists, its currency matches, and that exact
  amount is within its cap, the renderer presents the quote and then invokes the normal typed
  confirmation path automatically. The app informs; it does not ask.
- If no policy exists, currency differs, or the quote exceeds the cap, a human must explicitly
  confirm the reviewed quote. The Director cannot perform that action.
- Irreversible structural or destructive actions continue to require explicit human action. A
  within-cap generation is already authorized by the human-set policy and follows the first rule.
- Main re-derives the quote and re-evaluates the current policy immediately before commit. Renderer
  sequencing is not spend authority.
- Automatic and explicit confirmation use exactly the same cache claim, stale checks, atomic commit,
  idempotency keys, receipt, and dispatch path.
- A paid retry prepares and displays a fresh exact quote and follows the same cap/explicit-action
  rule. The prior authorization never silently covers another provider attempt; variable-price
  routes and unquoted or provider-internal automatic retry are deferred.
- `submission_unknown` is an exception to within-cap automation: because the earlier provider
  submission may already have charged, confirmation always requires the human-only reviewed
  duplicate-charge acknowledgement. Main binds it to the reservation and persists
  `duplicateChargeAcknowledged: true` plus the acknowledgement timestamp on the retry Job.

A renderer test must prove the quote is rendered before automatic confirmation is requested. Main
tests must prove a policy change between prepare and confirm fails closed.

The project menu retains a human-only **Spending limit** action even though the film Project settings
dialog is removed. It edits or clears the real per-batch amount and currency, never a balance. The
typed Main mutation increments `authoringRevision`, and changing or clearing the policy invalidates
every prepared quote that relied on its former state.

### 2.6 Request-scoped photo settings

Aspect ratio, resolution, prompt wording, route choice, instruction profile, and any provider-facing
options belong to the prepared photo request and its frozen provenance. They are not required project
creation fields and are not read from film defaults. Renderer sends only typed user choices; Main
resolves the provider route, model, price, limits, and exact prompt. Pilot 1 Create photo is
text-to-image: the request plan and composition carry an exact empty conditioning-input list.

### 2.7 Unsupported and quarantined deletion authority

An unreadable project cannot supply a trustworthy revision, so its library entry carries a
Main-issued opaque `deletionClaim`, not a renderer-invented path or revision. The bounded claim binds
project/catalogue id, internal directory identity, current classification (`unsupported` or
`quarantined`), observed manifest fingerprint, issue time, and expiry. It exposes none of the path or
fingerprint internals to the renderer.

Deletion is human-confirmed and Main-only. Under the catalogue/project lock, Main consumes the
single-use claim, re-traverses and reclassifies the exact directory, and compares its identity and
fingerprint. Expired, replayed, missing, replaced, reclassified, or newly healthy targets fail
closed. A successful deletion uses the existing bounded recovery-aware removal path and cannot
affect another project. Healthy schema-6 deletion keeps its normal decoded revision authority.

---

## 3. Independent contract version matrix

Contract versions move only when that contract's exact persisted or wire shape changes.

| Contract                     |      Baseline | Pilot value | Landing phase                             | Rule                                                                                         |
| ---------------------------- | ------------: | ----------: | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Persisted Studio project     |             5 |       **6** | Phase 3 isolated runtime; Phase 5 cutover | Reject schema 5; no migration/defaulting                                                     |
| Generation composition       |             1 |       **2** | Phase 3 isolated runtime; Phase 5 cutover | Add Piece source and `piece_image`; preserve the frozen prompt as history                    |
| Mutation batch               |             5 |       **6** | Phase 3 isolated runtime; Phase 5 cutover | Add `rename_piece` and authoring-revision authority; no create/delete                        |
| Proposal sidecar             |             6 |           6 | Phase 6 or later                          | Unchanged and unused by Pilot 1                                                              |
| Director command             |            10 |      **11** | Phase 5 cutover                           | Add typed Piece rename/prepare capability and authoring authority                            |
| Export catalog/sidecar       |             2 |       **3** | Phase 3 isolated runtime; Phase 5 cutover | Add standalone Piece image plus provenance export                                            |
| Reference request sidecar    |             5 |           5 | Phase 6 or later                          | Unchanged and unused by Pilot 1                                                              |
| Film export facts            |             1 |           1 | Phase 6 or later                          | Unchanged and unused by Pilot 1                                                              |
| `weprompt-studio:` asset URL |   unversioned |   unchanged | —                                         | Project/asset safe ids still address verified managed bytes                                  |
| Provider adapter protocol    | adapter-owned |   unchanged | —                                         | `piece_image` maps through the existing image capability without changing provider protocols |

Do not couple these constants. Phase 1 freezes and tests the new shapes. Phase 3 installs every new
reader and writer behind an isolated CS4 service/store entry point while the production bridge and
renderer remain on CS3. Phase 5 selects the CS4 Main entry point and canvas renderer together, then
removes the former production path. Do not bump a global constant while an active consumer still
writes the former shape, and do not keep an old version while silently accepting the new shape. Old
sidecars attached only to unsupported schema-5 projects are not migrated.

The temporary development seam is not a compatibility reader: each entry point accepts exactly one
project schema, and only one is selected by the production bridge. It exists so Phases 1–4 can
compile and pass the full suite without pairing a CS4 backend with a CS3 renderer. If that isolation
cannot be made exact, hold Phases 1–5 as an unmerged implementation trench and activate them
together; never land a half-cutover build.

---

## 4. Cross-contract invariants

The Piece arm is not complete until every row below is implemented and tested together. A partial
target-union edit must not be merged.

| Surface             | Required Piece rule                                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target              | Exactly `{kind: piece, pieceId}`; `create` reserves an absent id that resolves after atomic confirmation, while `retry` resolves and revalidates its existing owning Piece before prepare and confirm                                                                                   |
| Purpose             | Exactly `piece_image`; it is never `seed_still`, `reference_image`, `board_still`, or `video_take`                                                                                                                                                                                      |
| Composition 2       | Source is the reserved text-only Piece request: immutable Piece id, exact authored words, request-scoped settings, empty conditioning inputs, resolved route, instruction profile, and authoring audit facts                                                                            |
| Request plan        | Resolved image request, no Shot duration, conditioning input, Board style, or film/reference dependency                                                                                                                                                                                 |
| Quote               | One Piece target/purpose, generation-priced, exact route/rate/request plan, authoring authority, expiry, and deterministic identity                                                                                                                                                     |
| Prepared cache      | Holds the Main reservation and quote; bounded, expiring, claim/release/consume safe, and non-persistent                                                                                                                                                                                 |
| Authorization       | Exact deep copy of the revalidated quote plus provider/idempotency authority                                                                                                                                                                                                            |
| Job                 | Same target, purpose, composition, request plan, authorization item, provider binding, cancellation policy, and idempotency key; `create` has null retry fields, while `retry` persists exact `retryOfJobId` + Pilot retry reason on the same Piece/purpose with one child and no cycle |
| Retry spend safety  | `duplicateChargeAcknowledged` is true with a canonical acknowledgement timestamp iff reason is `submission_unknown`; all other reasons store false + null and cannot accept that acknowledgement                                                                                        |
| Asset               | Exactly one Piece owner; imported asset has no producer/composition digest, generated asset has the exact producer Job and composition digest                                                                                                                                           |
| Piece               | Ordered unique Job lineage; zero or one current asset resolves back to the same owner; Pilot has no replacement/superseded-asset field                                                                                                                                                  |
| Media publication   | Validated bytes and hashes are moved into managed storage before the atomic manifest publication; failure leaves recoverable staging, not a current asset                                                                                                                               |
| Activity projection | Derives status from persisted Jobs and receipts without exposing provider secrets or inventing spend states                                                                                                                                                                             |
| Canvas inventory    | Returns ordered Pieces, handles/aliases, current asset, provenance summary, and lifecycle state without consulting film readiness                                                                                                                                                       |
| Export 3            | Copies the exact current bytes and writes deterministic provenance; never initiates generation or spend                                                                                                                                                                                 |

Composition 2 validation checks exact shape, bounds, digest, and internal stored-to-stored consistency.
It does **not** regenerate an old prompt using current code and compare text. Prompt-template changes
advance the instruction profile for new work; they never mutate or invalidate the recorded prompt of
an existing Job. The current composer emits `weprompt-image-v1.piece-image.v1`; stored provenance
accepts canonical positive versions in the `weprompt-image-v1.piece-image.vN` namespace so a future
current profile can advance while retaining every earlier profile. New composition rejects a caller
that requests anything except the current profile.

---

## 5. Delivery order

The phases below are dependency ordered. Do not start Phase 3 runtime work until the Phase 1 contract
tests and Phase 2 equivalence tests are green. Do not start the canvas before the headless lifecycle
passes.

**Shared Tranche 0 branch rule.** BUG-162 and BUG-163 repair behavior that is still owned by the
shared CS3 production base. Each fix must be implemented and reviewed independently on the current
shared CS3 base (`codex/creative-studio-table-board-ui-design`), pass its CS3 gates there, and only
then reach CS4 by merging the shared base that contains it. Do not author either fix first as a
CS4-local patch, and do not treat the present branch arrangement, a duplicated local diff, or a
claimant label as evidence that this sequence has happened. BUG-190 is not part of that shared code
tranche; it is the external-backed Phase 5 entry prerequisite defined below.

### Phase 0 — amend the contract and stabilize the base

**Purpose:** remove known false assumptions before changing persisted state.

1. Update the CS4 design, this plan, wireframe notes, and all 30 open bug-list triage records as one
   reviewed documentation tranche. Every entry must have a complete, untruncated rationale,
   destination, claimant, and acceptance oracle. The committed count is 3 fix-before, 26 absorb, 1
   superseded, 0 defer.
2. Capture the behavior baseline described in §6 before the first runtime edit.
3. Fix BUG-162 by deriving the turn recap from durable outcomes, not successful tool transport.
   Queued spend, pending review, refusal, cancellation, and actual commit must produce distinct
   truthful recaps.
4. Complete BUG-163 with its remaining live restart/recovery verification. Preserve the existing
   conversation and history, distrust the update echo, prove exact readback, and keep retry bounded.
5. Inventory every exhaustive branch for target kind, purpose, composition source, asset ownership,
   quote/authorization, Job lifecycle, projection, export, IPC parser, and Director tool schema. Save
   the inventory in the implementation change description; missing a branch is a Phase 1 blocker.

**Focused evidence:** the tests named by BUG-162/163, plus a live Director recovery pass for BUG-163.
Do not mark an entry closed from unit evidence alone when its acceptance oracle requires the running
application.

**Exit:** both shared-base blockers satisfy their bug-list evidence on the shared CS3 base, that base
has been merged into CS4, the triage is complete, and the real baseline fixture is committed. BUG-190
is not a Phase 0 or Phase 1 exit condition. No CS4 production path exists yet.

### Phase 1 — freeze schema-6 and cross-contract authority

**Purpose:** make the entire standalone-Piece contract exact before IO or UI depends on it.

Primary files to inspect and change:

- `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/factories.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/mutations/pieceHandles.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/mutations/pieceCatalogV3.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/mutations/deletionClaimsV3.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/generation/composition.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/generation/generationRequest.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/generation/submissionIdentity.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/estimate.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/authorization.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/preparedSubmissionCache.ts`
- `packages/desktop/src/process/services/creative-studio/service/schema2/exports/pieceManifestV3.ts`

The Director-facing command and MCP surface remains provisional in this phase. Phase 1 may define
pure Piece-domain types that a later Director adapter will consume, but it must not freeze or bump the
Director command contract, add or register a Studio MCP tool, or count a provisional Director shape
as Phase 1 exit evidence. Phase 5 owns that surface after BUG-190's entry prerequisite passes.

Work, in order:

1. Freeze the exact schema-6 root and Piece shape, bounds, dense arrays, map-key/id equality,
   bidirectional lineage, timestamp rules, and safe-id rules. The schema-6 validator has no schema-5
   branch and no missing-field defaults.
2. Implement the shared Unicode handle normalizer, collision resolver, alias bound, and rename
   validator. Use it in factory, service, mutation parser, reducer, and projection; Phase 5's
   Director parser must import that same helper. No second normalization algorithm is allowed.
3. Add `authoringRevision` and the exact increment table from §2.4. Move mutation, direct Director,
   and quote stale authority to it while preserving `revision` for the store CAS.
4. Add the Piece target, `piece_image` purpose, composition schema 2 Piece source, resolved image
   request plan, deterministic quote/item identity, rate classification, authorization equality,
   and Job equality. Update all exhaustive switches; never use a catch-all branch to hide an omitted
   owner.
5. Extend the prepared-session contract with the complete Main reservation. Admission, byte bounds,
   project/global capacity, expiry, concurrent claim, release on refusal, consume after commit, and
   close behavior remain explicit.
6. Add `rename_piece` to mutation batch 6 with exact parser keys, a Piece-catalog undo patch, digest
   conflict protection, authoring-revision increment, and renderer-safe refusal. Assert that
   `create_piece` and `delete_piece` are rejected as unknown operations.
7. Define the Piece asset owner and imported/generated provenance rules without widening the old
   nullable-owner XOR. If the implementation retains a union for later modalities, each arm must be
   discriminated and exact; canonical project-owned audio is not forced through Piece ownership.
8. Define renderer-safe canvas inventory, capability activity, and provenance projections. Provider
   ids, adapter ids, hashes used only for internal proof, absolute paths, authorization ids, and
   idempotency keys stay in Main unless a reviewed UI requirement explicitly needs a safe form.
   Phase 1 freezes the projection types; Phase 3 builds the projections and must use the shared
   handle helper rather than implementing a second normalizer.
9. Define export schema 3's exact Piece manifest, but do not bump the export constant or expose the
   exporter until Phase 3.

Focused tests must prove:

- schema 6 accepts a factory project and rejects missing, extra, sparse, duplicate, oversized, or
  cross-owned data;
- schema 5 is not accepted by the schema-6 parser and no defaulting occurs;
- all Unicode and alias cases in §2.3;
- import basenames and concurrent new/import reservations derive distinct Unicode-safe handles while
  explicit rename rejects instead of silently rewriting invalid input;
- schema-6 validation and fingerprint tests admit a canonical runtime Job-progress change with only
  `revision` advanced, while the Phase-1 rename reducer advances both revisions; Phase 3 must prove
  the same runtime rule through the public Job-transition path once that path exists;
- runtime activity does not stale a quote or direct action, while an authored input or policy change
  does;
- canonical authoring fingerprints are stable across map insertion order, differ across the
  `create`/`retry` arms, change for authored/request mutations, ignore declared runtime fields, bind
  the exact domain/version, bind retry's ordered immutable predecessor topology while excluding Job
  progress/status/error text, and never appear in the renderer-safe quote projection;
- composition 2 admits only Piece + `piece_image`, stores exact prompt/settings/route, and validates
  historical records without recomposition;
- target, purpose, request plan, quote, authorization, Job, receipt, asset, and Piece lineage agree;
- Job retry lineage requires null predecessor/reason together for `create`, an exact retryable
  same-Piece/same-purpose predecessor plus reason for `retry`, one child per predecessor, and no
  cycles; status-to-reason mapping includes cancelled → `cancelled` and never overloads
  `provider_failure`; `download_failed` and `poll_deadline` remain same-Job recovery and cannot mint
  a fresh paid retry;
- duplicate-charge acknowledgement/timestamp are present together exactly for a confirmed
  `submission_unknown` retry and are false/null for every other Job;
- fixed-price photo quotes require equal lower/upper amounts and variable-price routes fail closed;
- no public create/delete operation parses;
- rename undo restores handle and alias state and refuses a digest conflict;
- `create` and `retry` reservations are exact, immutable, bounded, expiring, single-claim, and write
  nothing; retry carries no new Piece/handle/order identity;
- the prepared-quote projection contains only the reviewed safe fields and changes on admit,
  release, consume, and expiry;
- stale, duplicate, invalid, expired, and policy-invalid confirmation inputs fail closed; and
- unsupported/quarantined deletion claims bind the exact classification and storage identity, are
  single-use and expiring, and refuse changed or healthy targets.

**Exit:** the new contract and pure derivations compile and pass focused tests. No production decoder
may write a partial schema-6 record, and no provider call occurs in this phase.

### Phase 2 — capture-backed, behavior-neutral extraction

**Purpose:** create reviewable seams before installing the new runtime. This phase changes no
observable CS3 behavior and no CS4 contract.

1. Convert `packages/desktop/src/process/services/creative-studio/store.ts` into a directory module
   with `index.ts` preserving the import path. Extract only coherent existing responsibilities:
   project classification/manifest IO, transactional replacement/replay, proposal/reference
   sidecars, and deletion authority. Keep each directory at ten or fewer direct children.
2. Convert `packages/desktop/src/renderer/pages/studio/StudioPage.tsx` into a `StudioPage/` directory
   with `index.tsx` preserving the import path. Extract existing project-command orchestration,
   proposal/spend orchestration, and view adapter construction without changing DOM, copy, state
   timing, or IPC calls.
3. Move the existing `chain.ts`, `projectStatus.ts`, and `workspaceStatus.ts` projection family under
   one projection directory before adding Piece projections. Preserve barrel exports and reduce,
   rather than worsen, the existing direct-child count.
4. Update `vitest.creative-studio-coverage.config.ts` for every moved runtime path in the same change.
5. Replay the captured baseline before and after extraction. Persisted bytes that are promised
   canonical remain byte-identical; public Main and renderer projections remain deep-equal; failure
   classifications and side effects remain equal.

Do not mix Piece behavior, schema changes, locale changes, or visual changes into an extraction
commit. If equivalence cannot be demonstrated, narrow or revert the extraction before proceeding.

**Exit:** capture replay, the existing Creative Studio focused suites, coverage, and the full test
suite pass with behavior unchanged.

### Phase 3 — implement the isolated headless schema-6 runtime

**Purpose:** make Create, Import, persistence, recovery, projections, and Export work through Main,
with no canvas yet.

Primary files and seams:

- a new versioned CS4 service/store entry point built from the Phase 2 extracted primitives; do not
  select or rename `service/v2Service.ts` in production yet
- isolated CS4 media, Job, runtime, provider-resolution, generation, pricing, lifecycle, projection,
  and export modules
- typed CS4 bridge and payload contracts that Phase 4 can exercise without registering them as the
  production `creativeStudioBridge`
- a standalone Piece exporter and export-3 catalog inside the isolated entry point

Phase 5, not Phase 3, registers the CS4 providers in
`packages/desktop/src/process/bridge/creativeStudioBridge.ts`, the common/native IPC bridge and
payload schemas/constants, and preload. Additive shared types may land earlier; no production IPC
method may route a CS3 renderer into schema-6 storage.

Work, in order:

1. Implement CS4 project creation, load, list, summary, update notifications, and deletion inside the
   isolated CS4 entry point. Creation accepts a human-facing project name and brief only; Main mints
   `projectId`. That entry point returns schema 5 only as unsupported inventory; malformed schema 6
   is quarantined; both remain deletable.
2. Implement the typed prepare-photo service. Main validates invocation settings, allocates the
   reservation ids, resolves image capability/route and price, composes schema 2 provenance, builds
   the request plan and quote, and admits the session without touching disk.
3. Implement one confirmation service for automatic and explicit cases. Claim the cache entry,
   re-read under the project queue, rederive composition/request/quote, compare authoring authority,
   re-evaluate spend policy, then branch only on the frozen reservation mode: `create` atomically
   commits Piece + authorization + queued Job; `retry` atomically appends authorization + queued Job
   to the revalidated existing Piece. Consume the session after commit, release it on a retryable
   refusal, and dispatch only the committed Job.
4. Extend Job ownership, resume, retry, cancel, duplicate-charge handling, progress, and terminal
   transitions for Piece Jobs. Every durable status has an explicit recovery arm.
5. Extend media ingestion/publication for Piece-owned images. Verify MIME, dimensions, size, hash,
   collection, producer, composition digest, and exact Job ownership before the success commit.
   Variation grids and invalid outputs fail without publishing a current asset or silently spending
   on a replacement.
6. Implement atomic photo import through the existing native picker boundary and managed-media
   transaction machinery. The renderer never supplies a path or id directly to the service contract.
7. Implement rename and undo through the shared mutation service and authoring revision.
8. Implement Main-owned canvas inventory, capability activity, provenance, and project-summary
   projections. A standalone photo never calls film readiness.
9. Implement export schema 3. Export only the current Piece image and a deterministic sidecar that
   records project/Piece/asset identity, hash, dimensions, MIME and byte size, imported versus
   generated origin, and—when generated—the exact frozen composition/request, route display facts,
   authorization/receipt provenance, and producer Job linkage. Never include absolute source paths
   or provider secrets. Verify source bytes before publication, use crash-safe/quarantine behavior,
   retain the bounded export catalog, and never generate or spend.
10. Keep schema-5 decode/default code confined to the still-selected CS3 entry point. The isolated
    CS4 entry point contains no schema-5 decoder or defaults. Phase 5 deletes the former path after
    switching production. Keep corruption containment and startup replay in both until that switch.

Focused tests must include:

- prepare writes no manifest or sidecar and restart loses only the ephemeral reservation;
- renderer reload in the same Main process restores the safe prepared quote, while Main restart
  clears it without a new Piece for `create` and without changing the existing Piece for `retry`;
- explicit and within-cap confirmation use the same commit builder;
- `create` commit failure creates no Piece/auth/Job and cannot dispatch; `retry` failure leaves the
  existing Piece/lineage unchanged, appends no auth/Job, and cannot dispatch;
- successful commit is durable before dispatch, and a dispatch throw leaves a recoverable queued Job;
- concurrent duplicate confirmation admits one authorization and one Job;
- at 95 Pieces, two concurrent create/import attempts admit exactly the 96th Piece; the losing 97th
  attempt receives the typed `catalog_capacity` refusal before quote or spend, and confirmation
  rechecks capacity under the project queue;
- authoring changes, cap removal, cap reduction, currency change, expiry, malformed cache data, and
  route/rate changes refuse before spend;
- a retry cannot reuse the prior quote or authorization and exposes a fresh exact price;
- a `submission_unknown` retry remains explicit under a matching cap, refuses a missing/extra/stale
  duplicate-charge acknowledgement, and persists the acknowledgement plus timestamp with the Job;
- unrelated progress/receipt commits do not stale the prepared photo;
- import success is Piece + asset atomic, cancel writes nothing, invalid input writes nothing, and a
  crash at each file/manifest boundary recovers deterministically;
- Unicode/RTL filenames derive the initial import handle in Main, concurrent same-name imports suffix
  deterministically, and no source path persists or enters renderer state;
- retry revalidates its existing Piece and source Job, appends one fresh authorization/Job without a
  second Piece or handle/order/current-asset change, and refuses completed, imported, stale-lineage,
  edited-request, or non-retryable targets; the persisted predecessor/reason link survives restart,
  permits only one child, and cannot cycle;
- output success publishes one exact current image, and late, second, invalid, or duplicate outputs
  fail closed without changing it;
- resume covers every nonterminal Piece status, with no second unquoted Job;
- canvas and activity projections are stable over reload and strip Main-only authority;
- schema-5 projects are unopenable and deletable, malformed schema-6 projects are isolated and
  deletable through revalidated Main claims, changed/healthy targets are refused, and one bad
  project does not disable the runtime; and
- export copies verified bytes, produces deterministic schema-3 provenance, retains catalog bounds,
  quarantines a malformed catalog without disabling Studio, and performs zero generation/quote calls.

**Exit:** the complete Pilot lifecycle is available through the isolated typed CS4 Main/service APIs
and durable storage, while the production bridge still selects CS3. No renderer claims are made yet.

### Phase 4 — headless fake-adapter lifecycle gate

**Purpose:** prove the backend journey before adding UI. This is a service/integration gate, not the
user E2E.

Use `packages/desktop/src/process/services/creative-studio/adapters/e2eFakeAdapter.ts` through the
isolated CS4 entry point's real provider resolver, Job manager, media store, store queue, bridge
contracts, and filesystem. Do not call internal reducers to skip the public path.

Scenarios, each starting with zero Beat and Shot records:

1. create project → prepare generated photo → expose quote → automatic within-cap confirmation →
   queued/running/succeeded → rename → undo → rename → reload → export;
2. the same generated path with no policy, over-cap, and currency mismatch, proving no provider
   attempt before explicit confirmation;
3. import photo → rename → reload → export, with no quote, authorization, Job, provider call, or
   spend receipt;
4. provider rejection, timeout, malformed payload, variation grid, download failure, cancellation,
   same-Piece retry through a fresh exact quote/authorization, duplicate output, and app restart in
   every nonterminal durable state;
5. stale/expired/duplicate confirmation and runtime-only revision movement;
6. corrupt one schema-6 manifest or export catalog while a second project remains fully usable; and
7. concurrent create/import at the 95→96 boundary, proving the 97th attempt produces no quote,
   authorization, Job, provider call, or spend; and
8. unsupported schema-5 deletion and quarantined schema-6 deletion.

Assertions use the persisted manifest, managed bytes, export payload, and public projections. No
test may declare success merely because the adapter was called.

**Exit:** the headless matrix passes repeatedly with deterministic ids/clock from injected Main
dependencies. There is still no claim that the renderer journey works.

### Phase 5 — canvas, Director integration, and actual renderer E2E

**Entry prerequisite — BUG-190.** Phases 1–4 may proceed without it because they register no
production Director MCP tool. Before Phase 5 freezes the Director command surface, registers a new
Studio tool, or cuts the Director over to the canvas, the trusted-read boundary must exist and pass
its oracle. The 2026-08-30 runtime audit established that the Director uses Aionrs, not ACP; the
pinned path reduces every MCP proxy to the single `mcp` approval category, and **Allow always**
therefore covers mutating Studio tools and external MCP tools as well. AionCore/Aionrs must propagate
both backend-authenticated built-in Studio server identity and MCP `readOnlyHint`; WePrompt must pin
that reviewed release with checksum and provenance evidence. An existing and a newly added read-only
Studio tool must then run without consent while an equivalent external or mutating tool still
prompts. A renderer auto-click, bare server-name allowlist, caller-forgeable trust flag, or global MCP
approval is not an acceptable substitute.

**Purpose:** expose exactly the accepted Pilot and remove the superseded four-room workspace.

1. Switch the production bridge/service selection and renderer to CS4 in the same cutover. Remove
   the temporary isolation seam and the former schema-5 production reader only after the new Main
   and renderer paths are wired together.
2. Replace the four-view workspace with one automatically laid-out, dependency-ordered board. Do not
   persist coordinates or offer hand reordering.
3. The empty state exposes exactly **Create photo** and **Import photo**. Do not render shooting
   script, sound, video, or Assembly offers and do not show a second composer.
4. Create-photo UI collects words and request-scoped image settings. Use Arco controls and semantic
   styling; no raw interactive HTML and no Node imports in renderer code.
5. Present quote amount, currency, scope, and expiry before confirmation. For `within_cap`, transition
   from the rendered quote to automatic confirmation without a confirmation button. For no policy,
   over-cap, or currency mismatch, render one explicit bounded confirmation action. Never show a
   credit/balance/envelope counter. Retain a human-only **Spending limit** project-menu action that
   sets, changes, or clears the per-batch amount and currency through the typed Main mutation.
6. Render the Piece from the persisted canvas/activity projections: proposed handle, Job progress,
   truthful failure and retry/cancel affordances, current image, retained Job/authorization attempt
   history, imported/generated origin, recorded spend, and provenance. Do not label a pending Piece
   current.
   Show retry only for the exact incomplete generated states allowed by §2.2; completed and imported
   Pieces expose no replacement/regeneration action.
   A `catalog_capacity` refusal is announced before any quote or spend and explains that this Pilot
   project has reached 96 Pieces and another project is required.
7. Rename uses an Arco `Input` with a fixed visual `#`, preserves text direction correctly, reports
   collision/bound refusals, and offers the existing undo mechanism.
8. Export is available from the project menu only when a current Piece asset exists. It invokes the
   schema-3 exporter and never invokes generation or quote preparation.
9. Keep the Director rail, but update its preset surface map and tools for the canvas. Renderer and
   Director photo preparation use the same typed Main operation. The Director may draft words and a
   name; it cannot choose durable ids, route internals, price, explicit spend confirmation, or human
   approval. Piece rename is a free typed direct operation; there is no proposal card for it.
10. Do not expose proposal cards or create proposal sidecars. Pilot Director operations are the typed
    direct prepare and rename paths; the quote block is the paid-work review surface. A collapsed
    rail still distinguishes working from blocked on the person.
11. Remove the four view routes, selectors, film-only Render control, film project settings, and old
    session-storage drafts in the same cutover. Update the Main route-close contract with
    `STUDIO_VIEWS`; do not leave a route that bypasses unsaved-work preflight.
12. Add every user-visible key to the `conversation` locale module for all configured locales:
    `zh-CN`, `en-US`, `ja-JP`, `zh-TW`, `ko-KR`, `tr-TR`, `ru-RU`, `uk-UA`, `pt-BR`, `de-DE`,
    `es-ES`, and `fa-IR`. Regenerate types; do not rely on English fallback for Pilot controls or
    errors.
13. Meet keyboard, screen-reader, responsive, and RTL requirements: logical CSS properties, visible
    focus, semantic regions and headings, announced progress/failure, non-color-only status, no
    clipped German/Turkish labels, stable reading/tab order, `dir="ltr"` only on immutable technical
    ids where needed, and correct Persian canvas flow.

Focused renderer evidence:

- `tests/unit/pages/studio/StudioPage.dom.test.tsx` for the empty-to-Piece state machine and IPC
  sequencing;
- `tests/unit/pages/studio/StudioLibrary.dom.test.tsx` for supported/unsupported/quarantined listing
  and claim-backed, human-confirmed deletion;
- `tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx` for roles, names, status announcements,
  focus, action availability, and the duplicate-charge warning/acknowledgement;
- `tests/unit/pages/studio/studioI18n.test.ts` for exact key and placeholder parity across all twelve
  locales;
- Director rail tests for shared prepare, truthful recap, blocked state, absence of proposal cards,
  and runtime activity not staling a prepared quote; and
- project-menu tests for the human-only spend-policy editor, quote invalidation on change/clear,
  schema-3 Piece export, and the no-generation/no-spend boundary.

The actual renderer E2E in `tests/e2e/features/workspaces/creative-studio.e2e.ts` runs the real
Electron renderer, preload, IPC bridge, Main service, filesystem, and fake provider adapter. It must
cover both Create and Import, automatic and explicit spend paths, progress/failure, rename/undo,
same-Piece retry, reload, provenance, export, deletion of unsupported/quarantined projects,
a `submission_unknown` retry that stays human-gated under a matching cap, keyboard-only use, one
narrow viewport, one wide viewport, LTR, and `fa-IR` RTL. The automatic path must hold the
fake adapter before dispatch, observe the quote block as visible in the browser, then release the
path and observe exactly one attempt. The unknown-submission path must show its warning, require the
typed acknowledgement, and persist it before the next dispatch. CI never calls a paid provider. A
live paid smoke test requires separate explicit authorization and is not a completion gate.

**Exit:** the user-visible Pilot 1 journey passes through the actual renderer. Only now may the plan
claim Pilot 1 implemented.

### Phase 6 — Assembly, film, video, sound, and later modalities

Phase 6 is a separate product and schema tranche, not hidden Pilot debt.

- Introduce `StudioAssemblyV2` only after its ordering, ownership, stale/current, and export rules are
  approved. An Assembly is not `StudioGenerationCompositionV2`.
- Decide and version the post-Pilot project schema explicitly; do not append Assembly/film fields to
  schema 6 without a discriminator bump.
- Add Beat/Shot-derived film planning, references, video conditioning, generated/imported sound,
  audio beds, automatic free recuts, and film projections only here.
- Define the first proposal-producing operations, one-pending policy, authoring authority, review
  surface, and proposal-sidecar version here; Pilot 1 deliberately creates no proposal.
- Define completed-Piece variation/replacement, imported-to-generated replacement, and bounded
  superseded-asset lineage here; schema 6 deliberately contains none of them.
- Resolve ffmpeg/ffprobe packaging, LGPL notices, H.264 distribution review, hardware/software
  encoder support, video ingestion, conditioning extraction, and film export before video is
  declared available.
- Carry every Phase-6 bug-list acceptance oracle into focused and actual renderer E2E tests. Do not
  reopen a deleted CS3 surface solely to fix its pixels; preserve the surviving rule in the new
  surface.

---

## 6. Real fixture capture requirement

Hand-authored project, Job, asset, quote, or authorization literals are forbidden as the integration
oracle. Their exact key sets already drifted once in the discarded plan.

Before the first runtime edit, add a test-only capture harness that starts the real current Main
store/service with an isolated temporary root and injected deterministic clock/id source, then uses
public service calls and the existing fake adapter to produce a representative healthy schema-5
project, sidecars, managed assets, project list, renderer project, detailed status, quote projection,
and export catalog. Capture bytes after normal transactional publication. Do not edit the JSON by
hand; remove machine-specific information by controlling inputs at creation time.

Public APIs correctly cannot create unsupported or corrupt state. Build that classifier corpus in a
separate, clearly named corruption-fixture harness: start from the captured runtime bytes, then make
one deterministic storage-level schema-discriminator change for the unsupported case and one exact
malformation for the corrupt case. Record the transform and hashes, and never describe either output
as public-runtime data or feed it through a migration.

The committed fixture must include:

- one ordinary supported project with real manifest/brief correlation;
- at least one authorization, Job, verified generated asset, and export catalog produced by the
  public runtime;
- runtime and renderer-safe projections from the same revision;
- one derived unsupported-schema classifier fixture and one independently derived malformed-project
  classifier fixture; and
- a capture metadata file naming baseline `f3f9f764b`, the harness command, and SHA-256 of each raw
  payload.

Phase 2 uses the healthy capture as a before/after equivalence oracle and the derived corpus only for
classification containment. Phase 3 uses freshly generated schema-6 fixtures from the new public
runtime; it never mutates a schema-5 project into schema 6. Unit tests may use existing repository
factories/builders, but must not invent stale exact-record literals.

---

## 7. Acceptance map

| Pilot acceptance criterion                 | Owning evidence                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| New project has no film scaffold           | Phase 1 factory/validation tests; Phase 3 create/load integration          |
| Prepare writes nothing                     | Prepared-cache unit test plus Phase 3 filesystem assertion                 |
| Create/retry commits are mode-atomic       | Create fault injection; same-Piece retry append tests; Phase 4 inspection  |
| Import Piece, asset, and handle are atomic | Media fault injection; Unicode/concurrent import tests; Phase 4 journey    |
| Cost shown before spend                    | Phase 5 DOM sequencing test and renderer E2E                               |
| Within-cap auto; safe exceptions explicit  | Policy matrix; unknown-submission ack; Phase 4/5 paths                     |
| Runtime activity does not stale authoring  | Revision/direct-action/quote unit tests and restart integration            |
| Stable identity and exact provenance       | Validation, reload, media publication, and export tests                    |
| Unicode handles and safe aliases           | Phase 1 script/boundary/collision matrix and RTL renderer test             |
| Rename and undo                            | Mutation/digest tests plus renderer E2E                                    |
| Failure, retry, cancel, and recovery       | Job-manager unit tests plus Phase 4 restart matrix                         |
| Exact current image export                 | Export schema-3 unit/integration tests plus renderer E2E                   |
| Schema 5 rejected; corruption isolated     | Store corpus/inventory tests plus Phase 4 two-project scenario             |
| Twelve locales and accessibility           | `studioI18n.test.ts`, `StudioAccessibleCopy.dom.test.tsx`, and LTR/RTL E2E |

---

## 8. Gates and completion language

Run these from the repository root for every implementation phase. Auto-fix commands run before the
read-only gates; any resulting change belongs to that phase and must be reviewed.

1. `bun run lint:fix`
2. `bun run format`
3. `bunx tsc --noEmit`
4. `bun run i18n:types`
5. `node scripts/check-i18n.js`
6. focused unit, DOM, integration, or E2E tests named by the phase
7. `bun run test:coverage:creative-studio`
8. `bun run test`
9. `git diff --check`
10. the source audit below
11. Phase 4 headless fake-adapter matrix when Main lifecycle changes
12. Phase 5 actual renderer E2E when renderer, preload, IPC, or user-visible behavior changes

Every new, moved, or changed executable Creative Studio file must appear in
`creativeStudioRuntimeManifest` in `vitest.creative-studio-coverage.config.ts`. A move removes the old
path and adds every new runtime path. Per-file line and branch coverage remains at least 80%; the
manifest is not allowed to shrink merely to make the gate green.

The source audit is a reviewed diff plus explicit searches for:

- every `StudioGenerationTarget` and target-kind branch;
- every `StudioJobPurpose`, composition-source, request-plan, and primary-media-kind branch;
- every nullable or discriminated asset owner and owner-resolution branch;
- every quote, authorization, idempotency, confirmation, Job-resume, and provider-output path;
- every project/protocol/sidecar version equality check;
- any schema-5 defaulting, migration, or prompt recomputation;
- any `create_piece` or `delete_piece` parser/operation;
- project-wide aspect ratio, resolution, duration, Board style, or route defaults entering the photo
  request;
- renderer imports from Main/Node, raw interactive HTML, hardcoded user-visible strings, absolute
  paths, provider secrets, or untranslated copy; and
- new runtime files absent from the coverage manifest.

No phase is “done” because focused tests pass. Do not claim Pilot completion until typecheck, i18n
generation and validation, focused tests, Creative Studio per-file coverage, the full test suite,
source audit, headless fake-adapter lifecycle, and actual renderer E2E all pass. Record exactly which
commands ran and their exit codes. A skipped gate is reported as skipped, never as passed.

This document is a plan only. At the `f3f9f764b` checkpoint, none of the Phase 1–6 implementation
claims above is complete.
