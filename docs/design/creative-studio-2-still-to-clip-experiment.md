# The still→clip experiment

One hour, three paid generations, no code. It decides whether Phase 3a is worth 12–17 days.

**The claim under test:** a still produced by a real image engine, fed to a real video engine as a
clip's first frame, yields a clip that visibly continues from that still — and two clips built from
the same still look like they belong in the same film.

Every piece of evidence for this today comes from `e2eFakeAdapter`. A fake adapter proves the
plumbing carries a field. It cannot prove two real models agree about a face.

---

## Two questions, deliberately separated

Conflating them is the trap: a plumbing failure looks exactly like a coherence failure, and would
kill a phase that was never actually tested.

**Q1 — mechanical, objective.** Does the still actually arrive as the video's first frame?
Answered by extracting frame 0 of the output and comparing it to the still. No judgement involved.

**Q2 — perceptual, human.** Does the rest of the clip belong with that still — same subject, same
light, same world? Answered by eye, by someone who did not write the prompt if possible.

**If Q1 fails, Q2 is unanswerable.** Report it as plumbing and re-run; do not record a verdict on
coherence.

---

## Preconditions

- **Explicitly select the image and video engines in the project's Engine Strip.** Multiple routes
  may be bound; record the intended integration as well as provider and model, then verify both
  current project choices immediately before spending.
- **The video engine must report first-frame support.** If it does not, the whole mechanism is
  unavailable on that engine and the experiment is answering a different question. Check before
  spending.
- **Shot duration ≥ 4 seconds.** The engine floor is 4s and authoring still accepts 1–3s, which fails
  at render — after the money.

## S1.5 is no longer the technical blocker; the experiment has not run

The current branch has explicit project-level image and video selection, so S1.5 no longer prevents
this experiment. That is implementation evidence, not provider evidence: the human sign-off still
requires all three paid generations below, and this document makes no claim that they ran.

**A project was prepared during the earlier attempt**, with zero spend recorded at that point:

- project `dbf35861_0614_4cb3_9465_0baee3304e79`, one shot, output **Video**, length **5s** (above the
  4s engine floor)
- visual prompt carrying the two checkable attributes: _a red-and-white horizontally striped scarf_
  and _a polished brass telescope_, on a rain-wet cobblestone street at night
- nothing generated; **zero spend was recorded during preparation**

Before spending, verify that the prepared project still exists, that its prompt, output mode and
duration remain as described, and that its current image and video choices name the intended routes
and integrations. If any of that has drifted, repair or replace the project before step 3; do not
infer current state from this note.

## Protocol

1. **New project**, one shot. Landscape 16:9 is fine.
2. **Write a visual prompt with at least two specific, checkable attributes** — not "a woman in a
   city" but "a woman in a **red-and-white striped scarf** holding a **brass telescope**, on a rain-wet
   street at night". Vague prompts make drift unfalsifiable: you cannot tell a coherence failure from
   a prompt that never specified anything.
3. **Verify the current project routes, then generate the still** — confirm the Engine Strip's image
   and video choices, including integrations, before using the reference-image control on the shot's
   visual cell.
4. **Render the shot as video**, with that still as its first frame.
5. **Second clip from the same still**, different action, same attributes. This is the product claim
   and it is a different question from step 4.

Three paid generations: one still, two clips.

## What to record

Save all of it — this is the evidence, and a screenshot of a verdict is not evidence.

- image engine + video engine, model names and integrations
- the still
- both clips
- **frame 0 of each clip**, extracted, beside the still
- the last frame of each clip
- shot duration used, and any warning shown before spending

## Reading the result

| outcome                                                                 | meaning                                                   | what to do                                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Q1 fails** — frame 0 is not the still                                 | plumbing, not coherence. The premise is still untested.   | Fix and re-run. Cheap, and it is a bug worth having found.                                                         |
| **Q1 passes, Q2 passes** on both clips                                  | the mechanism works and buys real coherence               | Plan 3a. This is the result the programme assumes.                                                                 |
| **Q1 passes, Q2 fails within one clip**                                 | the engine accepts the frame and then drifts away from it | 3a as designed does not deliver coherence. **This is the phase-killing result and the most valuable one.**         |
| **Q1 passes, within-clip holds, the two clips do not match each other** | continuation works, shared conditioning does not          | 3a is narrower than promised: it buys continuity inside a clip, not a consistent film. Re-scope before committing. |

## Why this is worth an hour before any planning

Phase 3a is 12–17 hand-days, and the programme plan puts it **before** the expensive model
restructure precisely so coherence is proven early. That ordering only pays if the premise is
actually tested. Planning 3a first would mean writing a detailed plan for a mechanism nobody has
watched work.

The handoff is explicit that this is the strongest lever available — _"two clips with identical refs
and sloppy prompts match better than two with careful prompts and different refs"_ — and that
prompt wording is the weakest. If that ranking is wrong on the real engines, the whole coherence
strategy changes, and it is better to learn it from three generations than from three weeks.

## Not in scope

The last-frame chain — clip 2 starting from clip 1's final frame — is Phase 3b and needs sections.
This experiment tests **still → clip**, once and twice, not clip → clip.
