# Two proposal contracts (rev 2) — the schema-7 Pilot-native family

Re-issued after D1 and D2. Read-only research; nothing implemented.

**The two answers together make the hard part easy.** D1 moves the target to a family that
does not exist yet, so the replay contract becomes a *specification* rather than a repair of
three disagreeing V2 predicates. D2 caps unanswered proposals at one, which makes
exact-path/no-leaf-enumeration achievable **by construction** — retiring what had been the
most expensive open question.

Rev 1 was written against the schema-5 V2 ledger. Everything storage-shaped survives;
everything that was a correction of existing defects is now simply absent from the design.

---

# Contract 1 — bounded terminal-proposal retention

## Layout: three exact paths, no directory ever listed

```
<studioRoot>/<projectId>/proposal/
  current.json                  the one unanswered proposal — absent means none
  history.json                  permanent append-only tombstones
  decided/<proposalId>.json     retained payloads, bounded
```

The V2 ledger needed four families and an index-named slot space because it admitted fifty.
At a cap of one, **presence of `current.json` *is* the slot** — no slot family, no index
grammar, no dense-index probe.

**Nothing enumerates, including the sweep.** That is the part worth stating plainly, because
it is what rev 1 could not achieve: `history.json` is the index. Pruning reads the oldest
tombstones, computes `decided/<id>.json` for each, and unlinks by exact path. There is never
a reason to call `readdir` on `decided/`.

## What is retained, and what is dropped

| Record | Lifetime | Size |
|---|---|---|
| `current.json` | until decided | one proposal payload |
| `decided/<id>.json` | bounded window, then pruned | one proposal payload each |
| tombstone in `history.json` | **permanent** | ~120 bytes |

The tombstone is what makes pruning safe. Retaining only `{proposalId, status, decidedAt,
appliedRevision}` forever preserves four things that a plain count-cap would each break:

- **the id-reuse guard** — an id in `history.json` is never re-admitted, whether or not its
  payload survives;
- **recap fidelity** — a Director turn recap resolves a label instead of degrading to
  `unknown`;
- **the `no_longer_pending` answer** — `studio_get_proposal` never has to claim a proposal
  the user genuinely accepted never existed;
- **accepted-proposal provenance** — status, `decidedAt` and `appliedRevision` survive
  indefinitely.

## Type shapes

```ts
/** The single unanswered proposal. Absent file means none pending. */
export type StudioProposalCurrentV7 = {
  schemaVersion: 7;
  proposalId: string;
  /** sha256 over the canonical JSON of the payload, lowercase hex. */
  payloadSha256: string;
  admittedAt: string;
  payload: StudioProposalPayloadV7;
};

/** Permanent, id-only terminal record. Written on decide, never removed. */
export type StudioProposalTombstoneV7 = {
  proposalId: string;
  status: 'accepted' | 'rejected' | 'expired';
  decidedAt: string;
  /** Retained so identity stays decidable after the payload is pruned. */
  payloadSha256: string;
  /** Present only where an accepted proposal applied a revision. */
  appliedRevision: number | null;
  /** False once decided/<id>.json has been pruned. */
  payloadRetained: boolean;
};

/** Absent file === { schemaVersion: 7, entries: [] }. */
export type StudioProposalHistoryV7 = {
  schemaVersion: 7;
  /** Oldest-first by decidedAt. Append-only; entries are never rewritten except
      payloadRetained flipping true -> false on prune. */
  entries: StudioProposalTombstoneV7[];
};
```

Carrying `payloadSha256` in the tombstone is the single most load-bearing field here: it is
what lets Contract 2 answer `identity_collision` for an id whose payload has been pruned.
**Without it the two contracts cannot both hold.**

## Limits

| Limit | Recommended | Rationale |
|---|---|---|
| Retained payloads per project | **32** | Mirrors `STUDIO_MAX_JOBS_PER_PIECE_V3`; enough to review recent history |
| Payload retention window | **7 days by `decidedAt`** | Reuses the `STUDIO_DIRECTOR_COMMAND_RECEIPT_RETENTION_MS` precedent rather than inventing a duration |
| Tombstone entries | **unbounded** | ~120 bytes each; bounding them reintroduces all four consequences above |
| `history.json` bytes | **hard ceiling, refuse above it** — see D4 | A ceiling that can be hit needs a named error, not silent loss |

Count and window are both eviction triggers; whichever is reached first prunes. Neither
expires anything, because a tombstone never expires.

## No migration

An absent `proposal/` directory and an absent `history.json` are both valid empty state.
Since the family is new at schema 7, there is no prior data to read and therefore nothing to
migrate — this is the cheapest moment in the product's life to fix the shape.

## Recovery invariants

- **R1.** A decision is never observable without its tombstone. Append the tombstone before
  or in the same commit as removing `current.json`; never the reverse.
- **R2.** Pruning is idempotent and crash-safe. A tombstone with `payloadRetained: true`
  whose payload file is already gone is repaired by flipping the flag, not by an error.
- **R3.** An id present in `history.json` is never re-admitted, regardless of payload
  retention. This is the invariant that makes pruning safe at all.
- **R4.** Pruning never changes the answer to a decided/undecided question — only payload
  availability.
- **R5.** The sweep is bounded per call, resumable, and never enumerates.
- **R6.** At most one `current.json` exists. Its presence is the admission gate; no counting.

## Focused acceptance tests

1. **A 33rd decision prunes the oldest payload and keeps its fact.** Assert 32 payload files,
   33 tombstones, and the oldest tombstone at `payloadRetained: false`.
2. **The id-reuse guard survives pruning.** Prune, then re-admit the id; assert refusal citing
   the tombstone.
3. **Recap fidelity does not degrade.** Prune an accepted proposal, resolve a recap
   referencing it; assert the label is still `committed`, not `unknown`.
4. **Nothing enumerates.** Spy on `readdir`/`opendir` for the whole family and assert **zero
   calls** across admit, decide, read, prune and repair. This is the test that keeps the
   exact-path property true as the code grows, and rev 1 could not offer it.
5. **Absent files are empty state, not errors.** Delete both; assert a successful read of
   zero entries and no pending proposal.
6. **Prune is crash-safe mid-pair.** Fail between unlink and flag write; assert the next
   sweep repairs rather than throws.
7. **Read cost is flat in history length.** Assert the number of files opened by a proposal
   read is independent of tombstone count.

---

# Contract 2 — idempotent mailbox replay

## The window

A proposal is persisted, then receipt publication fails — crash, IPC loss, process exit. On
replay the Director re-issues the same command. In a new family there are exactly three
durable states to resolve against: **no record**, **`current.json`**, and **a tombstone in
`history.json`**.

## The exact result matrix

`replayProposal(proposalId, payload)` → exactly one of:

| Prior durable state | Result | Side effects |
|---|---|---|
| No `current`, id not in history | `admitted` | Persist `current.json`, then publish receipt |
| `current`, same id, **same digest** | `already_pending` | **Publish the missing receipt.** No write to the proposal |
| `current`, same id, **different digest** | `identity_collision` | **Nothing written** |
| `current`, **different** id | `busy` | Nothing written. Recoverable by deciding the other |
| Tombstone: `accepted` | `already_decided` + `accepted` + `appliedRevision` | Publish terminal receipt. Never re-apply |
| Tombstone: `rejected` | `already_decided` + `rejected` | Publish terminal receipt |
| Tombstone: `expired` | `already_decided` + `expired` | Publish terminal receipt |
| Tombstone for this id **and** a different `current` exists | `already_decided` | **History wins.** This id's fate is settled; the other proposal's pendency is irrelevant to it |
| Tombstone digest ≠ replayed digest | `identity_collision` | Holds even when the payload has been pruned |

Four properties this pins down:

- **`already_pending` is the whole point.** The proposal is already durable; the *receipt* is
  what failed. Replay publishes it and returns the original — it does not re-persist, and it
  never reports the proposal as new.
- **A decided proposal always reports its real decision.** With a cap of one, `busy` and
  `already_decided` cannot be confused: `busy` is about *another* id occupying admission,
  `already_decided` is about *this* id being finished.
- **`identity_collision` is a refusal, not a first-result return.** Returning the first
  result for different bytes silently discards what the Director actually asked for.
- **Identity outlives the payload**, via the tombstone digest. This is the join between the
  two contracts.

## Distinguishing the two failures that must never share a code

- **`busy`** — a *different* proposalId holds `current.json`. Detected by id comparison.
  **Recoverable:** decide the other proposal and retry.
- **`identity_collision`** — the *same* proposalId, different digest. **Not recoverable by
  retry**, because retrying reproduces it. It means a Director bug or a mutated record, and
  it must be surfaced as such rather than swallowed.

Under D2 these are now cleanly separable, because there is exactly one admission slot and one
id can occupy it.

## Type shapes

```ts
export type StudioProposalReplayResultV7 =
  | { outcome: 'admitted'; proposalId: string }
  | { outcome: 'already_pending'; proposalId: string; admittedAt: string }
  | { outcome: 'busy'; holdingProposalId: string }
  | {
      outcome: 'already_decided';
      proposalId: string;
      status: 'accepted' | 'rejected' | 'expired';
      decidedAt: string;
      appliedRevision: number | null;
    }
  | { outcome: 'identity_collision'; proposalId: string; expectedSha256: string };
```

Five outcomes, total over the state space, each carrying exactly what its caller needs to
act. `identity_collision` carries the expected digest so the mismatch is diagnosable without
reading the payload — which may no longer exist.

## Recovery invariants

- **I1.** Every persisted proposal eventually has a published receipt. Replay is the
  mechanism, so it must be safe to call unboundedly.
- **I2.** Replay never mutates a persisted proposal and never re-applies a decision.
- **I3.** Identity is decidable from retained data alone for the whole life of the id,
  including after the payload is pruned. R3 seen from the replay side.
- **I4.** Every result is total and named. No path returns success for a state it did not
  read, and **no path synthesises a status** — the defect that made rev 1 a correction.
- **I5.** Two replays produce the same result and the same side effects, except the receipt
  is published at most once.
- **I6.** `busy` and `identity_collision` are never substituted for one another.

## Focused acceptance tests

1. **Persisted-but-unpublished replays to `already_pending` and publishes once.** Fail
   publication, replay twice; assert one proposal, one receipt, same result both times.
2. **Each decided state reports itself.** Table-driven over accepted, rejected, expired;
   assert the real status and `decidedAt`, and assert no re-application.
3. **Same id, one byte different, refused with nothing written.** Assert
   `identity_collision`, byte-identical stored record, no receipt.
4. **A different pending proposal is `busy`, never a collision.** The test that stops the
   recoverable and unrecoverable cases merging.
5. **Identity outlives the payload.** Prune under Contract 1, replay with different bytes;
   assert `identity_collision` still, sourced from the tombstone digest. The joint test.
6. **History wins over pendency.** Decide id A, admit id B, replay A; assert
   `already_decided` for A and that B is untouched.
7. **Total over prior states**, including absent, pruned and corrupt-unparseable: exactly one
   named outcome each, no thrown exception.

---

# Owner decisions still open

D1, D2 and D8 are closed. D8 — whether to adopt exact-path reading — is retired by D2 rather
than answered: at a cap of one there is nothing to dismantle.

| # | Decision | Why it cannot be derived |
|---|---|---|
| **D3** | Retention rule: 7-day window, count of 32, or both? | Sibling families chose 7 days and a count of 128; neither is a statement about proposals |
| **D4** | At the `history.json` byte ceiling: refuse, or evict? | Both are first-class idioms here — drop-oldest for `undoHistory`, refuse-with-a-code for `priorHandles`. Silence loses audit data; refusal blocks a user |
| **D5** | Is a proposal id single-use forever? | The design assumes yes via permanent tombstones. If reuse is acceptable, tombstones can themselves be bounded and this simplifies |
| **D6** | Money-touching provenance: same window? | `appliedRevision` in the tombstone preserves the join to a spend authorization, but whether spend needs a *longer* rule is an owner call |
| **D7** | Who runs the sweep? | **Recommendation: prune opportunistically inside the decide path**, bounded per call. A new family has no reaper to wire, and decide is the only moment history grows — so no scheduler is needed at all |

## One adjacent question, raised because it is a schema question

**An Assembly of photographs has no clock.** `StudioPieceV2` carries `kind` and
`currentAssetId` and **no duration**, but the filmstrip shows per-segment durations and slates
"hold their time". Wave 1's only Piece kind is `photograph`, and video does not arrive until
Wave 2.

The fix consistent with what is already agreed — the Assembly owns per-binding state, as it
owns audio time anchors and the mix level — is that **segment duration is a property of the
binding, not of the Piece**. A photograph held four seconds in one Assembly and two in
another is then coherent, and the field costs one number in the binding record.

It is raised here because it must be decided before the schema-7 freeze, not after.

---

# What I did not invent

- Any duration, count or byte ceiling without citing the sibling constant it mirrors.
- A resolution to D3–D7.
- The segment-duration answer above — it is a recommendation with its reasoning, offered for
  the freeze rather than assumed into it.
