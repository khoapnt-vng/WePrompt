# Roadmap to an autonomous Director

The intent: **the Director is the product, and the app is where you watch and correct it** — not a
video tool with a chat panel attached.

This is not a new direction. The design handoff already states it: _"The director is not a chat panel
bolted onto an app; it is a second operator of the same controls. That is the structural decision the
whole design rests on."_ What diverged is the build — the UI got the write commands and the Director
got reads and proposals. This document is the route back.

---

## Where the Director actually is

Five tools: two reads (`read_storyboard`, `studio_list_routes`) and three proposals
(`propose_storyboard`, `propose_brief_rule`, `studio_request_reference_images`). Every mutation is a
record a human acts on. It cannot change one field of the project, and it cannot spend.

That is **Level 0 — Advisor**.

---

## Current Phase 2 status

Phase 2A happy path complete; Level 1 not hardened; 2B next; 2C remains recovery gate.

Phase 2A is the Level 1 happy path over the existing flat storyboard. Phase 2B broadens that
happy path with Section -> Clip -> Take and Table/Board review. Phase 2C hardens Level 1 with
versioned recovery/checkpointing and exactly-once attribution. 2A/2B are not full or hardened
Level 1. Their direct edits are temporarily not generally undoable; StudioRuleListUndo remains
rule-list-specific and unchanged. Paid authority remains Phase 3b.

The audited records are [Phase 1](creative-studio-2-gates/phase-1.md) and
[Phase 2A](creative-studio-2-gates/phase-2a.md).

`set_brief` is the sharpest temporary recovery gap. CAS and receipts prevent stale/ambiguous writes
but are not undo.

---

## The levels, and what each one costs

### Level 1 — Operator over free edits

The Director writes the document: brief prose, script, visual prompts, ordering, take selection.
It still cannot spend.

**Cost: small.** Seven CAS-guarded write commands already exist in IPC — `updateProject`,
`updateScene`, `reorderScenes`, `setBriefRules`, `selectAsset`, `updateCut`, `placeCutScenes`. The
MCP tools are thin wrappers over commands main already validates.

**One trap that is not optional.** `propose_storyboard` _"is a whole-script replace that mints fresh
scene ids every call."_ Exposed as a direct write it would re-key every scene on every edit and
orphan the jobs and assets pointing at those ids. Level 1's script tools must be **granular** —
`update_scene` by id, `reorder_scenes` by id list — never the whole-replace shape.

### Level 2 — Producer within a ceiling

The Director generates, watches, and continues: make a reference, render a clip, poll for
completion, take the last frame, render the next.

**Three things are missing, and only one is UI work.**

- **Job visibility.** `read_storyboard` now reports concrete scene-reference ids, ordered Brief
  references and whether a selected take exists. It still cannot see the selected take id, job
  status, progress, or failure reason. That remaining projection change is small.
- **A spend ceiling.** See below; this is the design decision, not the code.
- **The last frame.** Captured today only by the BytePlus adapter, not by the OpenRouter route we
  currently bind. Level 2's chaining is gated on that binding, not on MCP work.

### Level 3 — Autonomous production

A brief goes in, a cut comes out, and the human reviews the result rather than the steps.

**This is blocked on something no tool fixes.** See "Sight", below.

---

## The design decision that unlocks Levels 2 and 3: a ceiling, not a gate

Per-call confirmation does not survive autonomy. Nobody meaningfully reads the ninth identical
dialog, and a Director that stops for approval every 90 seconds is not autonomous.

Replace it with a **granted budget**: _"up to N generations on this project"_, visible and
decrementing, with a hard stop that needs a fresh grant. The handoff's principle — _"free is direct;
money asks once"_ — is preserved exactly. It asks **once per run** instead of once per call, which is
closer to what "asks once" was always trying to mean.

Everything else in the spend fence stays: rules enforced before spend, main deriving routes and
inputs from canonical state, the renderer never supplying authority.

---

## Three problems that are not tools

### 1. Sight — the hard ceiling on Level 3

The MCP tool result type is **text only**: `content: Array<{ type: 'text'; text: string }>`. The
Director can commission an image and a video and **cannot see either one**.

A director that cannot look at its own output is not directing. It can write, spend, and chain, but
it cannot answer _"is this take any good?"_ — which is the entire job. Level 3 is not reachable
without one of:

- **an image-returning tool result**, so takes and stills come back as pixels to a multimodal model;
- **or a human in the loop for judgement only** — the Director does everything except decide whether
  the output is right.

The second is a legitimate product, and it is much cheaper. It should be a deliberate choice rather
than a limitation nobody named.

### 2. Checkpointing, not per-edit undo

Undo's importance **scales with autonomy**, and its right shape changes with it.

At Level 1, with a human watching, a missing undo is a UX gap. At Level 3, where the Director works
alone for twenty minutes, the user does not want to reverse edit #7 of forty — they want to **reject
the run**.

That argues for **run-scoped checkpointing** rather than per-edit inverses: snapshot before the
Director starts, let it work, then accept or discard the whole run. That is cheaper than
`apply_script_changes` with inverses, and better suited to the thing being built.

One constraint from grounding it earlier: a coarse project revert **fails open** — it silently drops
the `providerJobId` of work already paid for. A run checkpoint must therefore revert **script and
brief only** and never the generated assets or job ledger. Takes you paid for survive the discard.

### 3. Latency shapes the product

A Director turn measured **82 seconds**. A four-clip chain — draft, generate, poll, chain, generate —
is many minutes of wall time.

That is fine for _"go make this and tell me when it's done"_ and wrong for anything watched live. The
autonomous Director is a **background job with progress**, not a conversation. Design the surface for
that: a run you can start, watch, interrupt, and reject.

---

## Build order

1. **Level 1's tool set.** Granular script/brief/prompt writes over existing commands. Days, and it
   makes the Director genuinely useful without touching money.
2. **Job visibility in `read_storyboard`.** Small, and Level 2 cannot be reasoned about without it.
3. **The ceiling decision.** A product decision that gates all autonomous spend; nothing downstream
   should be built assuming either answer.
4. **Run checkpointing**, scoped to script and brief.
5. **The sight decision** — image-returning results, or a human judgement step. This one decides
   whether Level 3 exists at all.

Items 1 and 2 are unblocked today and do not depend on the model or binding questions. Item 5 is the
one worth thinking about longest, because it determines whether the product is an autonomous director
or a very fast assistant with a person as its eyes.

---

## How this relates to the phase roadmap

The two are **axes, not a sequence**. The phases define what the product can do; the levels define
who operates it. The Director can only ever do what the app can do, so phases feed levels rather than
competing with them. The programme target is: Phases 1, 1.5 and 3a remain Level 0; Phase 2 delivers
Level 1; Phase 3b delivers Level 2; Phase 4 broadens Level 2; Level 3 remains the later north star.

**Level 1 is mechanically independent, but scheduled with Phase 2.** Its wrappers do not require the
section model, a provider decision or a binding. Keeping the work in Phase 2 nevertheless gives the
programme one explicit point at which the Director becomes the operator of free edits, instead of
letting autonomy drift into capability slices such as 3a.

**3b becomes a fork, and it is the real question.** "Poll for done, take the last frame, make the
next clip" is Phase 3b described as a Director capability. Two ways to build it:

- **App-orchestrated** — main renders, extracts, feeds the next clip and tracks staleness; the
  Director gets one tool, `render_section`. Manual users get chaining too.
- **Director-orchestrated** — the Director gets primitives (read the last frame, set a scene's
  reference, generate, poll) and sequences them itself. Less code, more AI-native, and the chain
  becomes something the Director _decides_ rather than something the app _does_ — but a user working
  by hand gets no chaining, and staleness still has to live somewhere.

Under the direction in this document the second is the more honest answer. Decide it deliberately
rather than defaulting to the first because the phase plan says so.

**Phase 2's justification weakens.** Sections were justified as an _authoring_ structure — the level
between a three-minute film and a six-second clip that a human needs in order to work. An autonomous
Director does not need them: a flat list of thirty scenes is tractable for an agent, and grouping is
a human comprehension aid. If the Director does the authoring, sections become a **review**
convenience rather than infrastructure — a much weaker case for 60–80 days. Worth asking of the
Section redesign: what do sections do for someone reviewing an agent's work, rather than for someone
building it by hand?

**Unchanged:** 3a is still needed — coherent output matters whoever drives. 1.5 shipped. Phase 4 may
matter _more_, since "brief in, finished file out" is exactly its job.

---

## OpenRouter and BytePlus are not interchangeable

Both reach Seedance. They are different adapters with different capabilities, and the difference
decides what Level 2 costs.

|                      | `openrouter-video-v1`                                    | `byteplus-seedance-v1`                                                  |
| -------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| bound today          | **yes**                                                  | no                                                                      |
| last frame returned  | **no** — the adapter has no `last_frame` handling at all | **yes** — reads `content.last_frame_url`, emits it as a `poster` output |
| last frame persisted | n/a                                                      | durably, via `persistProviderPosterFromUrlForJob` into `thumbnails`     |
| model identifier     | `bytedance/seedance-2.0`                                 | `dreamina-seedance-2-0-260128` (also two 1.x models)                    |
| base URL             | OpenRouter's                                             | must equal `https://ark.ap-southeast.bytepluses.com/api/v3` exactly     |
| duration bounds      | from route constraints                                   | per-model spec: 2–12s, 4–12s, and 4–15s                                 |
| what it sends        | one image, `frame_type: 'first_frame'`                   | one image, `role: 'first_frame'`                                        |

**The consequence that matters: Level 2's chaining input is free on BytePlus and absent on
OpenRouter.** The hardest part of 3b — getting the last frame — is already implemented, already
persisted, and already tested on one adapter and simply not present on the other. Binding through
BytePlus is a configuration change, not engineering: the adapter is 404 lines with
`validateConnection`, `submit` and `poll`, it is registered in the registry, it is a first-class
integration in the service catalogue, and it is covered by existing tests.

**And a symmetry worth noting: neither adapter sends multi-reference today.** Both push exactly one
image in a first-frame role. Seedance 2.0's nine-reference mode is not reachable through either
without adapter work, so the "maybe the still stage is unnecessary" question is open on _both_ paths,
not just one.

Two things to check before treating the BytePlus route as ready: the model must be one of the three
names in `BYTEPLUS_SEEDANCE_MODELS` — note `dreamina-seedance-2-0-260128` bears no resemblance to
OpenRouter's `bytedance/seedance-2.0` — and BytePlus is a separate vendor account, which is
procurement rather than engineering.
