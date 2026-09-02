# Wave 2 — scope and split

Read-only assessment of every file Wave 2 would touch, verdicted `rewire` / `adapt` /
`rewrite` / `delete` against the CS4 contracts. Nothing implemented.

---

## The headline: Wave 2 is not a port

I sized it earlier as "~9,100 lines of existing video and References code to port". That was
wrong twice over, and both corrections point the same way.

**The video adapters need no work at all.** All of them implement the *same*
`GenerationProviderAdapter` — one definition at `adapters/types.ts:103`, no older variant
anywhere in the repo — and name **zero** schema-5 identifiers. More than that, the registry
at `adapters/index.ts:29-38` **already constructs all four unconditionally**, because the
video deps are optional and the factories default to real singletons. The Pilot's runtime is
handed a four-entry map today. The video adapters are unreachable for **route and
media-kind** reasons, not registration reasons.

**The References code is not portable, it is deletable.** `referenceSidecars.ts` (2,222),
`referenceViewAdapter.ts` (870), `studioReferenceRequestWriter.ts` (694),
`referenceRemovalBlockers.ts` (271) and the References view files all verdict **delete** —
several are not merely dead but *un-runnable*, because no main process registers a provider
for the schema-5 channels they call. And the semantic reference workflow is **already ~70%
present in the Pilot under a different name**: the bounded Piece conditioning that shipped in
`f962f705e`.

**So the real work was never the 9,100 lines.** It is generalising the Pilot's *own*
image-shaped assumptions — code that works, is on the critical path, and touches money.

| Verdict | Lines | What it means |
|---|---|---|
| `rewire` | 10,037 | works as written; needs constructing or selecting |
| `delete` | 22,031 | dead or superseded; carry nothing |
| `adapt` | 24,880 | **the actual Wave 2 cost** |
| `rewrite` | 10,325 | cheaper fresh than ported |

---

## The correction that matters most for planning

I said the media-kind hardcoding was five sites. **It is not five.** Measured:

- `service/pilot/runtime/media.ts` — **~30 gates**, not 3. The three assignments are the cheap
  ones. Verdict: **rewrite**, 2,111 lines.
- `service/pilot/runtime/jobs.ts` — **4**, not 1.
- plus `projections.ts`, `prepare.ts`, and the schema-2 spine: `validation.ts` (3,901),
  `estimate.ts` (2,051), `authorization.ts` (788), `composition.ts` (753),
  `submissionIdentity.ts` (709).

**Pricing and authorization are in the blast radius.** That is the single most important fact
in this document: generalising media kind is a money-touching change, so it must happen once,
deliberately, with the spend tests green — not twice, incidentally, during two feature ports.

---

## And the answer to "are we doing double work?"

You were right to push. My first split — video first, References second — **would have been**
double work, because both would have reopened the same request-building and pricing spine.

The correct axis is the shared primitive. But the sharing is more specific than I said last
time, and the detail changes the slice:

`ResolvedStudioGenerationRequest` carries **two mutually exclusive conditioning channels** —
`firstFrame` for video and `conditioningImages` for stills. The video adapters use
`hasImageConditioningFields(request)` (`types.ts:47-48`) as a **first-line disqualifier**, so
a video request must **omit those keys entirely** — `undefined` is not sufficient.

So the shared thing is not one conditioning field. It is **the request builder and its
media-kind branch**, which must choose the right channel and omit the other. That is a small,
precise, testable piece of work — and it is exactly the piece both features would otherwise
have written differently.

---

## The split

### Slice 1 — generalise the media spine *(belongs in Wave 1)*

The Pilot stops assuming its output is a photograph. Media kind, duration, the request
builder's channel choice, and the pricing and validation paths that follow from them.

- `runtime/media.ts` ~30 gates — **rewrite**; this is the bulk
- `runtime/jobs.ts` 4 gates plus `durationSeconds: 1` — adapt
- `prepare.ts`, `projections.ts`, `contracts.ts` — adapt
- `validation.ts`, `estimate.ts`, `authorization.ts`, `composition.ts`,
  `submissionIdentity.ts` — adapt, and **money is here**
- `StudioPieceKindV2 = 'photograph'` gains a second member

**Why Wave 1, not Wave 2:** the schema is already being bumped, and a contract
generalisation done during a feature port is how it becomes a rewrite. The pricing exposure
makes this argument stronger, not weaker.

**Demonstrable at the end:** nothing new to a user. This is the slice with no demo, which is
precisely why it must not be smuggled into a feature slice where it will be rushed.

### Slice 2 — one video Piece

Thin, because Slice 1 did the general work and the adapters are already live.

- Select a video route; omit the image conditioning keys per the disqualifier
- `durationSeconds` inside the model's spec window — `seedance-1-5-pro` is 4–12,
  `dreamina-seedance-2-0` is 4–15
- Target **`bytePlusSeedanceAdapter`** for the demo: it is the only one with a real endpoint,
  a `queued_only` cancellation policy, and a provider-supplied poster (`last_frame_url`)

**One risk worth naming:** `imageAdapter` returns only `{kind:'complete'}` and defines no
`poll` or `cancel`, so **the Pilot's entire remote-job machine is built and tested but has
never run in production**. Video is the first thing to exercise submit → poll → cancel for
real. Budget for that discovery rather than assuming tested means exercised.

**Demonstrable at the end:** one video Piece produced, viewed, priced, with provenance. No
Assembly, no film, no export.

### Slice 3 — semantic References

Not a port. Mostly deletion, then extension of what already exists.

- Delete ~4,200 lines of dead schema-5 References code
- Extend the bounded Piece conditioning already shipped — the assessment puts the semantic
  workflow at **~70% present under a different name** — with naming, typing and reuse
- The `stills` block with a caption per member is the canvas home, per grammar v2, so the old
  References view is replaced wholesale rather than migrated
- `referenceRemovalBlockers.ts` is deleted, but **read it before deleting**: it encodes real
  rules about when a reference may be removed, and those rules may outlive their UI

### Not Wave 2 — film export

`filmExporter.ts` (1,833, adapt) and `editorFolder.ts` (413, rewrite) belong in Wave 3, where
the wave list already puts export parity. The assessment's framing is the right test:
**does a video Piece need a video *pipeline*, or just a video *byte stream*?** Slice 2 needs
only the stream. `ffmpegBinaries.ts` is a `rewire`, but it resolves to bare `ffmpeg` on PATH
and appears in no packaging config, so shipping it is Wave 3 work regardless.

---

## What this changes about Wave 2's size

Wave 2 as scoped — "References and video Pieces" — is **smaller than Wave 1** once Slice 1
moves into Wave 1, and larger than it looks if Slice 1 stays.

- Slice 2 is genuinely small: the adapters are done, and the general work is upstream.
- Slice 3 is mostly deletion plus a bounded extension of shipped code.
- The 24,880 `adapt` lines are almost entirely Slice 1, which is a Wave 1 contract change.

That is the scope-down: **not by cutting features, but by recognising that most of the counted
volume is either already working, already dead, or actually a Wave 1 contract job.**

---

## Decisions this needs

1. **Does Slice 1 move into Wave 1?** My recommendation is yes, and the pricing exposure is
   the reason. This is the only genuinely contentious call here.
2. **Second Piece kind: `video`, or `motion` to match the grammar?** The grammar's kind is
   `motion` and absorbs video and clip sets; `StudioPieceKindV2` is a persisted union. Picking
   the wrong name here is a schema migration later.
3. **Is `durationSeconds` on the Piece or on the Assembly binding?** Raised earlier for the
   Assembly clock; Slice 1 forces the answer, because the request builder needs a duration
   before any Assembly exists.
4. **Confirm References is delete-and-extend, not port.** ~4,200 lines are proposed for
   deletion on the strength of this assessment. Worth a second opinion before anyone runs
   `git rm`.
