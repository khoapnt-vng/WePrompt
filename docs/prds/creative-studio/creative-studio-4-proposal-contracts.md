# Two proposal contracts — recommendations

Read-only research against `ghk/codex/creative-studio-4-pilot`. Nothing implemented.

---

## Read this first: three premises in the brief are not in the code

Each is a verified absence, not a reading of intent. All three change the shape of what
follows, so I have specified against the live model and marked where the answer moves it.

**1. The Pilot does not consume the proposal ledger.** `git grep -li proposal` across
`service/pilot/**` and `store/pilotStore.ts` returns **zero files**. The V2 ledger is
schema-5 only, and on this revision the production Director path uses the *receipt mailbox*
instead. So "terminal-proposal retention" currently describes a subsystem Phase 6 does not
touch.

**2. The pending cap is 50, not one.** `STUDIO_PROPOSAL_V2_MAX_PENDING_PER_PROJECT = 50`
(`creativeStudioTypes.ts:156`), and the slot index space, the writer cap and the renderer's
list handling are all built for many. Nothing in the code expresses the value 1.

**3. There is no block concept in the ledger.** `grep -c block proposalSidecars.ts` returns
**0**, so "a proposal spanning several existing blocks is refused" has nothing to attach to.

**Consequence:** both contracts below are written for the V2 ledger as it exists. If the real
target is a new Pilot-native proposal family, the retention contract survives almost intact
(it is storage-shaped) but the replay contract must be re-specified against the receipt
mailbox, whose identity and residue model differ.

---

# Contract 1 — bounded terminal-proposal retention

## What grows, and why it costs more than disk

`decisions/<proposalId>.json` and its paired `pending/<proposalId>.json` are never pruned.
`proposalSidecars.ts:573` states the intent: *"Terminal proposal sources and decisions are
immutable audit history."* Nothing in the repo enforces a bound on them.

The cost is not primarily storage. **There is no exact-path single-proposal reader.** Every
read of proposal state goes through `readProposalLedgerV2`, which enumerates all four
families and JSON-parses every record found — and even the Director's single-proposal lookup
does `listProposalsV2()` then a linear `.find` (`director/processor.ts:374-375`). So each
retained rejection makes **every** subsequent proposal read slower, permanently. A project
that rejects steadily degrades its own read path with no ceiling.

## Recommended model: bounded payloads, permanent tombstones

Split what must survive from what must not accumulate.

- **Drop the payload.** `pending/<id>.json` carries the proposal source and is the large
  record (`STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES` each). It is what bounds.
- **Keep the fact, permanently, at ~120 bytes.** A decision is
  `{schemaVersion, proposalId, status, decidedAt}`. Retaining *only that* forever costs
  almost nothing and preserves everything downstream actually reads.

This resolves four consequences at once that a plain count-cap would each break:

| Consequence of pruning | Resolved by the tombstone |
|---|---|
| Terminal records are today's durable **id-reuse guard** — the writer refuses any id already present in a terminal directory | the tombstone is the guard, and it never expires |
| A Director turn recap degrades to `unknown` for a forgotten id (`turnRecap.ts:324`) | status + decidedAt retained, so labels never degrade |
| `studio_get_proposal` would answer `not_found` for something the user genuinely accepted | it can still answer `no_longer_pending` |
| Accepted-proposal provenance must survive | status, decidedAt and appliedRevision survive |

**Prune pending and decision as a pair.** The pending↔decision pairing is enforced in three
places; one-sided pruning is already impossible and relaxing that invariant is the more
expensive change.

### Why the tombstone is not a fifth directory

Three storage facts block the obvious placements: the family root admits **exactly four**
children (`PROPOSAL_V2_DIRECTORY_NAMES`), each leaf rejects foreign filenames, and four
derived name shapes already coexist inside the leaves (`.publish`, `.tmp`, `.ready`,
`.cleanup`).

So: **one append-only file at a computable path in the project directory**, beside
`project.json` — `proposal-history.json`. One exact path, no enumeration, no new leaf
grammar, and it does not widen any accepted-name regex.

### No migration

Absent file is a valid empty history. Existing retained records stay readable and are simply
never pruned until a sweep first runs, at which point their tombstones are written from the
decisions they already contain. Nothing is rewritten, no version gate is added, and a reader
on an older build sees a file it does not know and ignores it.

## Type shapes

```ts
/** Permanent, id-only terminal record. Written when a decision is made, never removed. */
export type StudioProposalTombstoneV4 = {
  proposalId: string;
  status: 'accepted' | 'rejected' | 'expired';
  decidedAt: string;
  /** Present only for accepted proposals that applied a revision. */
  appliedRevision: number | null;
};

/** The whole file. Absent file === { schemaVersion, entries: [] }. */
export type StudioProposalHistoryV4 = {
  schemaVersion: 1;
  /** Ordered oldest-first by decidedAt. Append-only. */
  entries: StudioProposalTombstoneV4[];
};
```

## Limits

| Limit | Recommended | Rationale |
|---|---|---|
| Retained payload-bearing terminal records per project | **32** | Matches `STUDIO_MAX_JOBS_PER_PIECE_V3`; enough to review recent history, small enough to keep reads flat |
| Payload retention window | **7 days by `decidedAt`** | Reuses the existing `STUDIO_DIRECTOR_COMMAND_RECEIPT_RETENTION_MS` precedent rather than inventing a duration |
| Tombstone entries | **unbounded** | ~120 bytes each; bounding these is what reintroduces every problem above |
| Tombstone file bytes | **hard ceiling, refuse above it** | A ceiling that can be hit needs a named error, not silent loss — see D4 |

Whichever of count or window is hit first evicts. Both are eviction triggers, not expiry.

## Recovery invariants

- **R1.** A decision is never observable without its tombstone. Write the tombstone in the
  same commit that writes the decision, or the tombstone first — never the decision first.
- **R2.** Pruning is idempotent and crash-safe: a partially pruned pair is completed on next
  sweep, and a pair whose tombstone is missing is never pruned.
- **R3.** An id present in the tombstone file is never re-admitted, regardless of whether its
  payload survives. This is the invariant that makes pruning safe.
- **R4.** Pruning never changes an answer to a decided/undecided question — only the
  availability of the payload.
- **R5.** A sweep is bounded per call and resumable; it never enumerates unboundedly.

## Focused acceptance tests

1. **A rejected proposal's payload is dropped and its fact survives.** Decide 33 rejections;
   assert 32 payloads remain, the 33rd's `pending`/`decisions` files are gone, and its
   tombstone is present with the right status and `decidedAt`.
2. **The id-reuse guard survives pruning.** Prune a proposal, then re-admit its id; assert
   refusal, and assert the refusal cites the tombstone rather than a missing record.
3. **Recap fidelity does not degrade.** Prune an accepted proposal, then resolve a turn recap
   referencing it; assert the label is still `committed`, not `unknown`.
4. **Absent history file is empty history, not an error.** Delete `proposal-history.json`,
   read the ledger; assert success with zero entries and no migration path taken.
5. **Pruning is pair-atomic under interruption.** Fail between the two unlinks; assert the
   next sweep completes it and the invariant checks still pass.
6. **Read cost is flat in retained history.** Assert `listProposalsV2` parses at most
   `32 + pending + slots + commits` records regardless of tombstone count. This is the test
   that would have caught the original defect.

---

# Contract 2 — idempotent mailbox replay

## The failure window, precisely

A proposal is persisted, then receipt publication fails — crash, IPC loss, process exit. On
replay the Director re-issues the same command. Today the code contains **contradictory
answers for the same identity, with neither marked as intended**:

- `service/director/processor.ts:391-407` reports an already-decided proposal as freshly
  `recorded`, with a **synthesised `status: 'pending', decidedAt: null`**. It reports a lie
  about a decided proposal.
- The store compares the whole payload with `sameJson` and raises
  `Studio proposal identity collision` (`proposalSidecars.ts:1864-1869`), while the service
  and processor compare only **partial fields**. Three predicates, three behaviours.

## The exact replay result matrix

`replayProposal(commandId, proposalId, payload)` → exactly one of:

| Prior durable state | Result | Side effects |
|---|---|---|
| No record for this id | `admitted` | Persist, then publish receipt |
| `pending`, same id, **same bytes** | `already_pending` | **Publish the missing receipt.** No write to the proposal |
| `pending`, same id, **different bytes** | `identity_collision` | **Nothing written.** Not a no-op — a hard refusal |
| `accepted` | `already_decided` + `accepted` + `appliedRevision` | Publish a terminal receipt. Never re-apply |
| `rejected` | `already_decided` + `rejected` | Publish a terminal receipt |
| `expired` | `already_decided` + `expired` | Publish a terminal receipt |
| A **different** pending proposal exists | `busy` if the cap is 1; `admitted` if 50 | Depends on D2 |

Three properties this fixes:

- **`already_pending` is the whole point of the contract.** The proposal is already durable;
  what failed was the receipt. Replay publishes the receipt and returns the original — it
  does not re-persist, and it does not report `recorded` as if it were new.
- **A decided proposal never reports `pending`.** The synthesised
  `status: 'pending', decidedAt: null` is removed. A replay against a decision returns the
  real decision.
- **`identity_collision` is a refusal, not a first-result return.** Returning the first
  result for different bytes would silently discard the Director's actual request.

### Distinguishing a different pending proposal from same-id corruption

These are different failures and must not share a code:

- **Different pending proposal** — a *different* `proposalId` occupying admission. Detected by
  id comparison alone. Result `busy` (or `admitted` under a 50 cap). Recoverable by deciding
  the other proposal.
- **Same-id/different-bytes corruption** — the *same* `proposalId`, different payload.
  Detected by digest comparison. Result `identity_collision`. **Not recoverable by retry**,
  because retrying reproduces it; it means either a Director bug or a mutated record.

The digest is what makes the second decidable, so it must be **stored with the record**:

```ts
export type StudioProposalIdentityV4 = {
  proposalId: string;
  /** sha256 over the canonical JSON of the admitted payload, lowercase hex. */
  payloadSha256: string;
  admittedAt: string;
};
```

Storing the digest — rather than comparing whole payloads at replay time — is what lets the
payload be pruned by Contract 1 while identity remains decidable. **The two contracts depend
on each other here:** without the digest, pruning a payload would make
`identity_collision` undetectable, and every replay against a pruned id would have to be
admitted blind.

## Recovery invariants

- **I1.** Every persisted proposal eventually has a published receipt. Replay is the
  mechanism, so replay must be safe to call unboundedly.
- **I2.** Replay never mutates a persisted proposal, and never re-applies a decision.
- **I3.** Identity is decidable from retained data alone, for the whole life of the id —
  including after the payload is pruned. This is R3 restated from the replay side.
- **I4.** Every result is total and named. No path returns success for a state it did not
  verify, and no path synthesises a status it did not read.
- **I5.** Two replays of the same command produce the same result and the same side effects,
  except that the receipt is published at most once.

## Focused acceptance tests

1. **Persisted-but-unpublished replays to `already_pending` and publishes once.** Fail
   receipt publication, replay twice; assert one proposal, one receipt, `already_pending`
   both times.
2. **Decided replays report the decision, never `pending`.** For each of accepted, rejected,
   expired: replay and assert `already_decided` with the true status and `decidedAt`, and
   assert no re-application. This is the test that fails against today's synthesised
   `'pending'`.
3. **Same id, one byte different, is refused with nothing written.** Assert
   `identity_collision`, assert the stored record is byte-identical to before, assert no
   receipt is published.
4. **A different pending proposal is `busy`, not a collision.** Assert the two codes are
   never interchanged — the test that stops the recoverable and unrecoverable cases merging.
5. **Identity outlives the payload.** Prune under Contract 1, then replay with different
   bytes; assert `identity_collision` still. This is the joint test of both contracts.
6. **Replay is total over prior states.** Table-driven across every state including absent
   and corrupt-unparseable; assert exactly one named result each and no thrown exception.

---

# Owner decisions — flagged, not invented

Blocking, in the order they gate the work.

| # | Decision | Why it cannot be derived |
|---|---|---|
| **D1** | **Which subsystem is the target** — the V2 ledger, or a new Pilot-native family? | The Pilot references proposals zero times; the ledger is off the shipped path. This decides whether Contract 2 applies as written |
| **D2** | **Pending cap: 1 or 50?** | Code says 50 everywhere; nothing expresses 1. Sets the `busy`/`admitted` row of the matrix, and a cap of 1 would let the slot family collapse to one exact path |
| **D3** | **Retention rule** — 7-day window, count of 32, both, or never? | Two sibling families chose 7 days + a cap; this one says "immutable audit history" and prunes nothing |
| **D4** | **At the byte ceiling: refuse, or evict?** | Both are first-class idioms here — drop-oldest-silently for `undoHistory`, refuse-with-a-code for `priorHandles`. Silence loses audit data; refusal blocks a user |
| **D5** | **Is a proposal id single-use forever?** | My model assumes yes, via permanent tombstones. If reuse is acceptable the tombstone can itself be bounded, and the design simplifies |
| **D6** | **Money-touching provenance: same window?** | After the commit attribution is deleted, the only join from a spend authorization back to its paid-recovery proposal is `confirmedAt === decidedAt`. Retaining `appliedRevision` in the tombstone preserves it — but whether spend needs a *longer* rule is an owner call |
| **D7** | **Who schedules the sweep?** | `reapAbandonedProposalsV2` exists on the store contract with **no production caller** — tests only. There is no established trigger to extend |
| **D8** | **Adopt exact-path reading?** | Three load-bearing invariants — the set-equality fence, the commit-attribution singleton, and pending-has-exactly-one-slot — are all defined over complete listings, and slots are index-named so no path is computable from a proposalId. Adopting it dismantles all three |

---

# What I did not invent

- Any duration, count or byte ceiling not already precedented in this subsystem. Every number
  above cites the sibling constant it mirrors.
- The one-pending rule, the block-spanning refusal, or a Pilot proposal family. All three are
  absent from the code and are D1/D2.
- A resolution to the three disagreeing identity predicates. I specified the contract the
  matrix requires and flagged that two of the three must be deleted, rather than choosing
  which on the code's behalf.
- Placement of a durable index in any location the storage rules currently forbid.
