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

- **Exactly one image engine and one video engine bound** in Settings → Model → Creative Studio media
  models. With two of either kind the project gets no route and there is no in-app cure until the
  Engine Strip ships.
- **The video engine must report first-frame support.** If it does not, the whole mechanism is
  unavailable on that engine and the experiment is answering a different question. Check before
  spending.
- **Shot duration ≥ 4 seconds.** The engine floor is 4s and authoring still accepts 1–3s, which fails
  at render — after the money.

## Blocked on S1.5 — found by attempting it, 2026-08-14

The experiment cannot run today, and the reason is the thing S1.5 exists to fix.

Reference generation is gated on `canGenerateReference = models.catalog?.image.status === 'ready'`
(`WritePhase.tsx`). The workspace has exactly one image binding and one video binding — preconditions
met — but a **project** adopts a route only when the catalog loads with no selection and finds exactly
one option. A project created now shows `Rendering with —` on Board and offers only _Add reference_,
never _Generate reference_.

So: bindings exist workspace-wide, the project has no engine, and there is no in-app cure. That is
precisely the live blocker the Engine Strip was specified to remove, and it now also gates the
experiment that gates Phase 3a. Worth noting in the sequencing argument: 1.5 is not merely _before_
3a, it is **required to test 3a's premise at all**.

**A project is already prepared and waiting**, so this is two clicks once the strip ships:

- project `dbf35861_0614_4cb3_9465_0baee3304e79`, one shot, output **Video**, length **5s** (above the
  4s engine floor)
- visual prompt carrying the two checkable attributes: _a red-and-white horizontally striped scarf_
  and _a polished brass telescope_, on a rain-wet cobblestone street at night
- nothing generated; **zero spend so far**

Pick up at step 3 below.

## Protocol

1. **New project**, one shot. Landscape 16:9 is fine.
2. **Write a visual prompt with at least two specific, checkable attributes** — not "a woman in a
   city" but "a woman in a **red-and-white striped scarf** holding a **brass telescope**, on a rain-wet
   street at night". Vague prompts make drift unfalsifiable: you cannot tell a coherence failure from
   a prompt that never specified anything.
3. **Generate the still** — the reference-image control on the shot's visual cell.
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
