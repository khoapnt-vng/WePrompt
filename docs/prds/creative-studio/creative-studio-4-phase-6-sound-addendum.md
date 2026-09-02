# Addendum to the Phase 6 grammar-extension commission: sound is in scope

You asked for this and you were right. This addendum brings sound into the commission and
says why the exclusion was wrong.

## We got this wrong, and here is how

The commission's "what we are not asking" said sound was settled, citing
`creative-studio-3-sound-and-progressive-workspace.md` as carrying "decisions and slices".
It does carry those — for a different thing.

Read properly, that document is about **sound direction as prose**:

- **D1** puts sound direction in `shootingScript` — free text the model writes — explicitly
  _instead of_ a new field, to avoid an unmigrated schema change.
- Its own scope note reads: **"No audio generation, no TTS, no per-Shot audio re-render, no
  waveform editing. If a model produces silence, the product says so and moves on."**
- All of it is **Shot-scoped**, and Shots do not exist in CS4.

So CS3 settled how a person _asks_ for sound, not what a produced sound _is_. Phase 6 needs
the second, and the exclusion was based on a misreading of the first. Your sentence —
"Phase 6 invalidates the delivered `sound` row whether or not the commission mentions it" —
is correct.

## What survives from CS3, as a constraint rather than a design

**D2 stands and should bind the new rows: never offer sound a model cannot produce.**
`silentOutput` is already known per route, so a binding that cannot produce audio must say
so rather than present a dead control. The document's framing is worth keeping verbatim:
a control that implies something untrue is worse than no control.

## What we are asking you to specify

Your own proposal, which we accept as the shape: **two sound rows, or one row with a
generated column.**

### Row A — the imported music bed

As delivered (`IMPORTED` only, never runs, never fails, never proposed), plus the correction
you flagged: **a level owned by the `cut`** — "ducked under the whole film, −6 dB".

The question that raises, and which we need answered: the level is a property of the film,
not of the sound. Does it appear on the `cut` row, on the `sound` row, or in the rail? It is
the first attribute we have that one kind owns _about_ another.

### Row B — generated voice, narration and SFX

These "run, fail, stale and can be proposed like any other work", so this row needs the full
column set: header, statuses, actions on the block versus in the rail, measure, and both rail
extremes.

Specific things we will otherwise get wrong:

- **Which statuses.** Generated audio is provider work, so `GENERATING` and region 4 apply —
  but is a re-mix local `RENDERING`? The Generating/Rendering split now carries a refund
  distinction, so this is not a naming question.
- **What `SLATE` means for audio.** A member that holds its time without a render is a film
  idea. Does silence hold time the same way, and does a `PARTIAL` film with unrendered audio
  read differently from one with unrendered picture?
- **Whether audio members carry chain position.** You added it to `motion`, `board` and `cut`
  members. Audio is timed but may not be chained. If it does not carry position, say so — the
  absence is as load-bearing as the presence.
- **Duration and cost.** A video quote states price, duration and price-per-second. Does a
  narration quote state the same three, or does character count replace duration?

### And the one thing sound adds that no other kind has

Sound is the only kind that is **heard rather than seen**, so density and shedding have no
obvious meaning for it. A quietened photograph is still a photograph; a quietened sound block
is a row of text about a thing you cannot perceive. Tell us what a `sound` block sheds at
rail 720 and canvas 640, and what — if anything — replaces the thumbnail as its subject.

## Constraints

- **The status vocabulary is now fixed.** `SLATE` at member level, `PARTIAL` at block level,
  `STILLED` retired, `QUEUED` and `READY TO RENDER` added, `GENERATING`/`RENDERING` split with
  the refund distinction, and `FAILED` carrying a reason and a cost-truth. Design against that
  list, not the delivered one.
- **No new kinds.** `sound` is already one of the six.
- **D2 binds:** a binding that cannot produce audio says so; it does not render a dead
  control.
- Twelve locales, Arco components, and `text-transform: none` for `:lang(tr)`, `:lang(az)`,
  `:lang(de)`, `:lang(el)` as you specified.

## What we are not asking

- **Not the sound feature.** How a person asks for sound is settled — it is prose in the
  script.
- **Not waveform editing, TTS voice selection, or per-member audio re-render.** CS3 excluded
  those deliberately and Phase 6 does not reopen them.
- **Not drawn screens.** Rows and rules, as before.

## For reference

- [The CS3 sound document](./creative-studio-3-sound-and-progressive-workspace.md) — D1 and
  D2, and the scope note that shows why it does not cover this.
- [Ruling 2, revised](./creative-studio-4-ruling-2-status-vocabulary.md) — the fixed
  vocabulary this must be designed against.
- [The grammar-extension commission](./creative-studio-4-phase-6-grammar-extension-commission.md)
  — which this extends.
