# Creative Studio 3 — plan review

Reviewing `8b353ae6e` ("docs(studio): close creative studio 3 plan blockers") and the Gate 1 fix
series beneath it, against `a78021ca3`. Read-only review; no code or plan changes made.

**Verdict:** one blocking finding, one governance item, and one correction to a ruling of _mine_
that this amendment overturned correctly. Everything else I checked is sound and should not be
re-litigated.

---

## 1. BLOCKING — removing `park_shot` leaves every rendered shot permanently unremovable

**Where:** plan lines 647–649, restated as a RED at 868–870.

The amendment deletes `park_shot` and substitutes:

> There is no `park_shot`: the Bin has no shot kind. `delete_shot` is dependency-free only. The
> author must park eligible takes individually and clear jobs, seed/conditioning, selection,
> match-to, and other references before deletion.

**That path cannot terminate.** Traced through the amended plan itself:

- `park_take` "clears an eligible take from selection and creates an exact lifted alias" (line 869).
  Alias semantics — the take remains in `shot.assetIds`.
- `StudioShot` still carries `assetIds: string[]` (line 255) and takes are still immutable (line 520).
- The full mutation vocabulary contains **no operation that removes a take from a shot**. There is no
  `delete_take`, `discard_take`, `detach_take`, or equivalent. `park_take`, `restore_take`,
  `select_take`, and `add_alternate_take` all preserve shot ownership.
- `delete_shot` is dependency-free only, and re-split treats "any asset … or other persisted
  reference" as a fixed point (line 467).

So a shot that has ever produced a take holds an asset dependency that no operation can clear, and
can never be deleted, parked, or re-split away. Its boundary is frozen for the life of the project.
The only remedy left is parking the whole beat, which drops every one of that beat's takes out of
the film.

This is the exact gap `park_shot` was introduced to close — the CS2 design's rule that "a clip with
assets, jobs, or cut dependencies cannot be deleted" — and it was closed by explicit decision, not
by oversight.

**Fix, either is sufficient:**

- Restore `park_shot` with a third Bin **reference** kind. A shot item is structurally identical to a
  beat item, so XOR membership, per-kind maxima, and the canonicality rule all apply unchanged. This
  is not the value-shaped third kind that was correctly rejected for authored text.
- Or add an explicit take-removal operation and define what it does to cut, seed, conditioning, and
  match-to references.

The first needs no new schema shape and matches the product's own "park, do not delete" rule.

---

## 2. GOVERNANCE — the designer's spec was amended without the designer

`8b353ae6e` changes `creative-studio-3-direction-and-answers.md` across eleven content hunks under a
new "Amended on 2026-08-18 after executable-plan review" header. These are not reflows. They add
`duration pending` and `seed pending` states, change the `ONE FILE` and bed rulings, rewrite the
spend section into a `prepare` → `confirm` protocol, and reverse the Bin ruling to "A shot is never a
Bin item."

The pin was updated correctly — `f4dfd4b7…` verifies against the amended file — so the mechanics were
handled well. The issue is authority, not hygiene: that document carries the designer's rulings in
the designer's voice, and it now asserts positions the designer has not seen, including a reversal of
a decision the product owner approved directly.

The plan's own rule is that the frozen contract may not be reinterpreted "without a spec amendment
and a new independent contract review." The amendment half was done. This document is the review
half, and finding 1 says one of the amendments does not hold.

**Recommended:** route the amended direction document back to its author before Task 1C freezes
against it, and keep engineering-originated changes in the plan rather than in the spec.

---

## 3. CORRECTION TO MY OWN RULING — the conditioning frame is not the poster

This amendment overturns a conclusion I reached and a decision that was taken on the strength of it.
**Codex is right and I was wrong.**

I argued that because `bytePlusSeedanceAdapter.ts` returns `content.last_frame_url` and the adapter
contract calls it "a generated video's optional last-frame poster," the conditioning frame and the
Board poster were one artifact — therefore no fifth collection, and no extraction. On that basis the
frame-storage decision was taken as "one asset, read by role."

That reasoning holds only for an **untrimmed** shot, and the whole point of the trim model is that
shots get trimmed. The amendment states it exactly (lines 500–510): the chain input is the frame at
`take.durationSeconds - (trimOutSeconds ?? 0)`, which for any tail-trimmed shot is **not** the
provider's last frame. It follows directly from the rule that tail trims break continuity — a rule I
accepted and then failed to carry into the storage decision.

So `conditioningFrames` as a distinct managed collection is correct, local extraction is genuinely
required rather than a route-conditional fallback, and the extraction-identity digest over
`{ shotId, takeAssetId, endpointSeconds }` is a better answer than anything I proposed.

**What this invalidates:** the "One asset, read by role" option chosen during the decision review, and
the two entries in _Decisions closed_ that rested on it. The amendment has already rewritten both,
with the reason recorded ("Full-video poster could not represent a tail trim"). No action needed
beyond knowing the earlier decision was superseded on good grounds.

Note that "read outputs by role, never by position" — the fix to `canonicalVideoPosterV2` indexing
`outputAssetIds[1]` — survives and is still correct. Only the aliasing conclusion was wrong.

---

## 4. Verified sound — do not re-litigate

- **Gate 1's six fixes are substantive.** `bf6b6043d` implements the Amendment 1 totality rules and
  goes further than reported: `ownValue` now also checks `Object.hasOwn(descriptor, 'value')`,
  defending against accessor properties, which the original review never raised.
- **Removing `remove_bin_item` is an improvement over my vocabulary.** "No generic `remove_bin_item`
  may orphan the referent" is correct; `restore_beat` and `restore_take` are the right exits, and
  nothing destructive is needed.
- **`duration pending` and `seed pending` fill a real hole** I left open — I never said what a null
  target or a freshly re-split head should do, and treating them as valid authoring states that gate
  render rather than as malformed data is the better answer.
- **Route selection, spend authorization, and undo** were all on the undrawn list and now have
  mechanisms (`set_routes`, `set_spend_policy` with `prepare`/`confirm`, `undo_last` over a bounded
  persisted journal with internal-only before-fragments).
- **No internal contradictions.** The superseded rulings were removed rather than left alongside the
  new ones, and _Decisions closed_ was updated with the reasoning.

---

# Addendum — review of `d384112fb` for handover

Reviewing `d384112fb` ("feat(studio): version director commands for beat and shot") and the four
commits beneath it, against the plan at the same head. Findings 1 and 3 above are **resolved**; see
§A4. Line citations in §1–§4 were against `8b353ae6e` and have drifted — the plan is now 3,968 lines.

## A1. BLOCKING FOR HANDOVER — head is red

`bun run test` at `d384112fb`: **1 failed, 10,108 passed, 19 skipped** across 672 files.

The failure is `tests/integration/creative-studio/directorCommandLatency.integration.test.ts:372` —
`expect(max).toBeLessThanOrEqual(thresholdMs)`, where `thresholdMs` is
`(ACK_GRACE_MS - SWEEP_INTERVAL_MS) / 2`. (Line 373, visible in the failure output, compares two
constants and cannot fail.)

Characterisation, measured:

- **Passes in isolation** — the file alone runs 2 tests green in 43s.
- **Fails under the full suite**, where total duration was 326s against a ~200s norm.
- This commit _itself_ added a `creative-studio-timing` vitest project with `fileParallelism: false`,
  `maxWorkers: 1`, and `groupOrder: 1` specifically to stop this test competing with other workers.
  **The mitigation did not hold.**

Two things make it structurally fragile beyond ambient load: it asserts on **`max` of 30 samples**
rather than the `p95` it already computes, so a single outlier fails the run; and the threshold is a
derived safety budget, not an arbitrary number.

**Do not resolve this by widening the threshold or switching to p95 without a decision.** Plan
constraint 14 forbids weakening a timeout or assertion to obtain green, and the vitest comment
records these as "frozen production thresholds". Either the budget is real — and then max is the
right assertion and the scheduling fix needs to actually work — or the budget is advisory, which is a
product decision, not a test-hygiene one.

## A2. Tasks 2–5 have no terminal `Commit:` step

Every other task in the plan ends with one. Tasks 2, 3, 4, and 5 have **zero**:

| Task                     | Lines     | `Commit:` steps |
| ------------------------ | --------- | --------------- |
| 2 — reducer              | 2458–2656 | 0               |
| 3 — store inspection     | 2656–2699 | 0               |
| 4 — rate card            | 2699–2796 | 0               |
| 5 — shot ownership/chain | 2796–3082 | 0               |

For a plan executed task-by-task, a task with no commit step has no defined stopping point. This is
the most likely reason execution ran 1C straight into 6: **four tasks' work was absorbed into two
commits**. The deliverables do exist — `schema2/pricing/{rateCard,estimate,authorization}.ts`,
`adapters/conditioningFrame.ts`, plus unplanned `chain.ts`, `lifecycle.ts`, `workspaceStatus.ts`,
`mutationIdentity.ts`, `preparedSubmissionCache.ts` — so nothing is missing, but nothing is
separately reviewable either.

Compounding it: **0 of the plan's checkboxes are ticked** across 3,968 lines, so progress cannot be
read from the plan at all — only inferred from the tree. Restore the four commit steps and adopt
checkbox discipline before Gate 1, or the gate cannot establish what it is gating.

## A3. Directory ratchet violated

`service/schema2/` now has **11 direct children** (`chain.ts`, `factories.ts`, `generation/`,
`index.ts`, `lifecycle.ts`, `mutationIdentity.ts`, `mutations.ts`, `preparedSubmissionCache.ts`,
`pricing/`, `validation.ts`, `workspaceStatus.ts`).

AGENTS.md caps directories at ten direct children for new or substantially reorganised directories,
and the plan's own constraint 12 repeats it. `validation.ts` (79 KB) and `mutations.ts` (72 KB) are
also large enough to be worth splitting on their own terms.

## A4. Resolved since §1–§3

- **`park_shot` is restored** (`8e844315c`), as `{ kind: 'shot'; beatId; shotId; reason: 'lifted' }`.
  Carrying `beatId` makes restore well-defined, which is better than the sketch in §1. The blocking
  finding is closed.
- **The three-pass split was honoured** — `801b04179` (1A internal identifiers), `b37e00e4f` (1B
  persisted and wire names), `39302a957` (1C core). `nativePayloadSchemas.test.ts` moved in the same
  commit as the wire rename, as 1B required.
- The conditioning-frame correction in §3 stands: `adapters/conditioningFrame.ts` exists and the
  poster aliasing is gone.

## A5. Scope note

`d384112fb` is **16,299 insertions across 33 files**, including `store.ts` +6,167 — Task 3 territory
— under a Task 6 label. Combined with A2, single commits are now spanning multiple planned tasks at a
size that is difficult to review as one unit. Worth splitting future task commits even where the plan
text has drifted.
