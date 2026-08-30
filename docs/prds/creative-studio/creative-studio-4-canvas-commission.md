# Creative Studio 4 — a commission: the workspace becomes a canvas

**For:** the designer of the Creative Studio prototype
**From:** engineering, 2026-08-30
**About:** the CS4 pivot — [the canvas design](./creative-studio-4-canvas-design.md), and the owner's
direction of 2026-08-30
**Needs:** drawings. The model is settled; what is not settled is what any of it looks like

## The short version

Creative Studio's workspace is four views — References, Table, Board, Cut — over a Beat and Shot
model. The owner's verdict on it: _"we show users a lot of screens with no content, no clear CTA
(will Director do it or user needs to click a button kinda of problem)"_.

He is right, and it is worse than it sounds. **On a brand-new project all four views are locked.**
Every readiness stage derives `not_started`, so the entire first-run workspace is one paragraph:

> **The Director starts here**
> The Director will draft the first plan from your brief. Review it here when it arrives.

And if you address a locked view directly, it tells you:

| View       | What it says                                                   |
| ---------- | -------------------------------------------------------------- |
| References | "Nothing to review until the Director plans references."       |
| Table      | "Nothing to arrange until the Director drafts the storyboard." |
| Board      | "Nothing to produce until the Table is set."                   |
| Cut        | "Nothing to cut until Shots are produced."                     |

Four sentences, each saying the Director will do it, none offering the person anything to do.
Meanwhile the only enabled control in the app bar — **Render…** — answers an empty project with
_"Nothing is ready to render yet"_.

The pivot: **the workspace becomes a canvas of named blocks, and every block holds finished work.**
Nothing on the canvas is an empty container, because a block exists only because something was made.
The Director presents work that is ready for review; it does not present rooms.

Alongside it, Creative Studio is repositioned as a **multi-modal studio** — photo, sound, video. A
person can make one photograph. A film becomes one composition over artifacts rather than the
container everything must live inside.

## What is there now

A fixed app bar (rail toggle, project title, a stat strip, the four-view navigation, **Render…**, and
a menu labelled **Project**), then two panes: a resizable **Director rail** on the left — a chat — and
a work panel on the right holding one `<main>` where a view renders.

That `<main>` is the only thing this commission replaces. The app bar and the Director rail stay.

## Why the four views are not arbitrary — read this before redrawing

The order encodes a real dependency, not a taste: references condition the storyboard, the storyboard
sets the shot list, shots are produced, production is cut. Each view was locked until its predecessor
had content **on purpose**, and that gating shipped on 2026-08-30 as an answer to this very
complaint.

It did not work, and the reason matters for your drawing: **gating tells you what you cannot do, and
a person arriving at an empty studio needs to know what they can.** The canvas is not a rejection of
the dependency. The dependency is real and the Director still honours it. What changes is that the
person never meets it as a locked door.

Underneath, the app already derives seven stages — `brief · engines · references · storyboard ·
bindings · production · cut` — each `not_started | in_progress | complete | blocked`, and every
blocker already carries a cause, a location and a **remedy typed as free, proposal, or paid**. That
is the signal your canvas renders. You are not inventing a state model; you are giving one a face.

## The reference the owner showed us

A canvas of blocks, each labelled with a `#` handle — `#narrative_script`, `#shooting_list`,
`#video_clips`, `#final_video`, `#Frame 5`. The handles read like variables: things produced, and
therefore things referable.

Three properties we are explicitly adopting:

- **The script is one document, not thirty objects.** Scenes, shots, shot scale, camera movement,
  camera angle, visual content, atmosphere, sound, dialogue — all of it rendered as a readable
  document inside a single card. Today we turn that same information into Beats and Shots as app
  objects and then build four views to look at them.
- **Cast and places are blocks, not a tab.** Character turnarounds in a row, environment plates as a
  set — appearing because the Director made them.
- **Nothing is an empty container.**

One property we are **not** adopting: the reference shows a credit balance (`✦ 412`). We decided on
2026-08-12 not to price in credits, and the owner confirmed on 2026-08-30 that there is **no credit
counter and no corner readout of any kind**. Please do not draw one. Cost appears where it is owed —
at the moment of spend, in currency — and nowhere else.

## A note on words, for the handoff

Draw in whatever language is natural — "block", "card", "artifact" are all fine on a drawing. But so
you know what we will call them when we build: **a thing a capability produces is a Piece**, and **an
ordered arrangement of Pieces is an Assembly**. We cannot use _artifact_, _composition_ or _block_ as
type names, because all three already mean something else in this codebase — `block` alone appears
eleven times meaning **blocker**, a reason something cannot proceed.

Worth knowing for one reason only: if a drawing labels something on screen, tell us whether that word
is the user's word or a placeholder. User-facing words go to twelve locales; ours do not.

## The decisions that are settled — not open for redesign

1. **Standalone artifacts are first-class.** A photograph needs no film around it. If a drawing
   requires a project to have a story before a picture can exist, it fails this.
2. **A film is one composition over artifacts**, not the container. Beats and Shots become the
   structure of the film composition.
3. **Provenance is recorded and not shown while work is current.** Every generation already records
   what conditioned it, what it cost, and what it supersedes. The canvas stays calm by keeping that
   silent — and must be able to surface it at the moment something breaks. See the third hard problem.
4. **Spend has two gates and no more:** money beyond the authorized envelope, and changes that cannot
   be undone. Everything else is shown, never asked. A product that asks permission to do something
   free and reversible is tiring, not careful.
5. **Sound is one imported audio file.** There is no sound generation of any kind today — no
   voice, no music, no effects. Draw sound as something a person brings, not something a Director
   makes.
6. **Voice is parked.** Do not design it.
7. **No migration.** Existing projects are test data.
8. **A control that would fail is absent, not disabled-with-an-error.** Film export already works this
   way and it stays that way.

## The hard problems — these are why we are asking rather than improvising

### 1. The first run, when there is nothing

**This is the commission.** "Nothing is an empty container" is easy to say and hardest to draw at
exactly the moment it matters most: a person opens a new project and there are no artifacts, because
they have not made any.

A canvas with nothing on it is, definitionally, empty. So what is that screen? If the answer is "a
prompt box and the Director", then CS4's first run is a conversation and the canvas arrives later —
which is a legitimate answer, and we would rather you tell us that than have us guess.

Draw the first thing a person sees, and the first thing that happens after they speak.

### 2. Where unfinished work lives on a canvas of finished work

The rule is "blocks hold finished work". Real sessions are full of work that is not finished:

- a **pending Director proposal** — by definition the one artifact awaiting judgement
- a generation **awaiting spend confirmation**, or **running**, or **partially failed**
- a **blocked** stage with a typed remedy

Today a proposal renders in two places at once — the work panel and the Director rail — which is its
own confusion. On a canvas it needs one home, and unfinished work needs a treatment that does not
make the canvas a queue.

### 3. The disclosure moment

A clip goes stale because the frame that conditioned it was replaced. The app knows precisely what
happened, what re-making it costs, and what else it invalidates. A calm canvas must be able to say
all of that **at that moment** without becoming a metadata panel the rest of the time.

Draw a block current, and the same block stale.

## What we are asking you to draw

- **First run, zero artifacts** — the hard problem above.
- **A canvas mid-work**, with a realistic mix: script, cast, places, clips, a cut. Enough blocks that
  arrangement, scanning and scroll become real questions.
- **One block of each kind**, at the size it will actually be:
  - a **script document** — the whole shooting script as a readable card
  - a **set of stills** — characters as turnarounds, places as plates
  - a **set of clips**
  - **sound** — an imported bed
  - **the final video**
- **A block's name.** Shots have no name field today: a Shot carries a shooting script and a
  position, nothing else. Handles will be authored with a derived default. Show how a person renames
  one, and what an unnamed block looks like before they bother.
- **The pending proposal**, in its single home.
- **In-flight and failed generation.**
- **A stale block**, per the third hard problem.

## Constraints the drawing has to live within

- **The Director rail is permanent and takes horizontal space.** Default 431px, resizable 280–720,
  collapsible. The canvas is never full window width, and its width changes while a person works.
  Blocks must survive both extremes.
- **Twelve locales, including Persian, which is right-to-left.** Anything positioned in a corner has
  to be corner-aware rather than side-aware. Assume text expands by a third in German.
- **Light and dark.**
- **Everything is built from Arco Design components.** No bespoke controls; a drawing that needs one
  is a drawing we will build wrong.
- **Shot length is 4–15 seconds and a Beat holds up to 8 Shots**, so a 30-second Beat is 5–6 clips.
  Clip sets are wider than they are tall in count.
- **Status vocabulary is fixed** — `RENDERED`, `FAILED`, `STALE` and the rest already exist on Shot
  tiles. Reuse the words for the same states.
- **A block may be partially filled.** A Beat with two of five Shots produced is normal and is not an
  error.

## What we are not asking

- **Do not redesign the Director rail or the chat.** It stays as it is.
- **Do not design voice, sound generation, or a credit ledger.** None of the three exists and two are
  ruled out.
- **Do not design migration or an upgrade path.** There is none.
- **Do not solve the dependency order.** References before storyboard before production before cut is
  real; the Director enforces it. Your job is that a person never meets it as a locked door.
- **Do not draw the app bar,** and do not draw a balance, budget or credit readout anywhere.

## For reference

- [The CS4 canvas design](./creative-studio-4-canvas-design.md) — the model, what is kept, and the
  four decisions still with the owner.
- [The Beat timeline commission](./creative-studio-3-beat-timeline-commission.md) — the format this
  follows, and the settled rulings on chained joins and hard cuts.
- [The spend governance ruling](./creative-studio-3-spend-governance-ruling.md), 2026-08-25 — the two
  gates, and why showing a picture beats asking a question.
- [The bug list](./creative-studio-3-bug-list.md) — in particular BUG-171, BUG-183 and BUG-184, which
  are all the same complaint in three places: the product tells people about controls instead of
  showing them work.
