# Creative Studio 3 — the shortest path to a watchable film

Written 2026-08-22. Scope agreed with the owner the same day.

**The MVP is this sentence:** a pilot user types one line about what they want, answers two or three
questions, and watches a film — without ever opening a settings form.

Out of that sentence: no one-file export, no narration, no hand-tuning of models. References and cast
land after the spine runs, not before.

**Narrowed further 2026-08-22, on the owner's instruction: make it work first.** Cost legibility and
duration fitting are out of the MVP — no rate-card display, no estimate ranges, no solving shot
lengths against a Beat target. Whatever the models return is the length. The one thing kept is the
existing `prepareSubmission` → `confirmSubmission` gate, because it already exists and it is what
stops a stray click billing the user; leaving it in costs nothing.

---

## 1. What already works, so nobody rebuilds it

This is the part that changes the plan. The chain is far less unbuilt than it looks from the outside.

| Step                                                       | State                 | Evidence                                                                                                                                                                |
| ---------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The brief reaches the Director                             | works                 | opening turn seeded and verified live; the Director answered with three questions                                                                                       |
| The Director writes the whole script                       | **already permitted** | `set_brief`, `add_beat`, `edit_beat`, `add_shot`, `edit_shot`, `delete_shot`, `reorder_beats`, `reorder_shots` are all `direct` — `directorCommandContracts.ts:281-312` |
| Generation produces real media                             | works                 | verified in-app: an 8.0MB MP4 at 15s plus a 1408×768 seed still, $0.78                                                                                                  |
| Takes can be selected                                      | works                 | dedicated `selectTake` provider                                                                                                                                         |
| The Cut assembles the film                                 | works                 | verified: 9 Beats, proportional filmstrip, correct counts                                                                                                               |
| Reference requests have a tool **and** an approval surface | exists, unverified    | `studio_request_reference_images`; `DirectorProposals.tsx` renders `referenceRequests`                                                                                  |
| Video models are discoverable                              | works                 | `openRouterVideoAdapter.ts:353` fetches `/videos/models` directly; routes carry `supportsFirstFrame`                                                                    |

**Cast is not an entity and nothing needs to be built for it.** It is
`briefReferenceRole: 'cast' | 'look'` on a reference asset — `creativeStudioTypes.ts:81`.

So the work is not three features. It is a handful of seams between things that already work.

## 2. The seams

**The hard stop.** `factories.ts:58` creates every project with `imageRouteId: null`. §3 of the
direction says a project needs two live routes by construction. Today the Director can write a
flawless script and Render does nothing until the user finds Brief & rules and binds two models by
hand. That is a cliff at the exact moment a new user has momentum.

It is worse than an inconvenience because of the chain: shots condition on the previous shot's last
frame, so a video route without `supportsFirstFrame` breaks continuity **quietly** rather than
failing. A default has to be chosen on that constraint, not on price or name.

**The first-run consent wall (BUG-090).** The Director's first act is `read_storyboard`, and the rail
stops on _"I'd like to run a command… Yes, allow once?"_. Observed blocked for over three minutes. A
pilot user's first experience of the product is a security dialog about a read-only tool on a built-in
server they did not install.

**Two unverified seams.** Whether the reference request actually round-trips to a tagged asset, and
whether the spend gate is reachable from a script the Director just wrote. Both are plausible and
neither has been driven.

## 3. The slices

Ordered so each one unblocks the next, and each states how it is proved rather than assumed.

### Slice 0 — drive the chain once and write down what really breaks

Everything above is read from code. Nothing in sections 1–2 has been driven end to end in one sitting.
One project, roughly $1–2, an hour.

_Done when:_ a written list of what actually broke, with the failures reproduced. If it contradicts
this plan, the plan changes — that is the point of doing it first.

### Slice 1a — bind Studio media models, which is the cliff above the cliff

**Found 2026-08-22 by verifying Slice 1 in the running app, and it changes the plan.**

A Studio route needs a `StudioConnectionBinding`, not just a configured provider. Measured in a live
instance: one provider (OpenRouter) with an image-capable model available, and the project's Image
and Video pickers both offering **zero options** and reading `Selection required`.

So the first-run path is longer than section 2 claimed:

1. configure a provider — Settings
2. **bind Studio media models — Settings → Models → Studio media** ← the real cliff
3. create a project
4. routes bind themselves — Slice 1
5. render

Step 2 is a settings visit, which the MVP sentence says a user should never need. Slice 1 is
necessary and not sufficient: it removes the friction at step 4 and is inert until step 2 has
happened. Options, in preference order: bind a connection automatically from provider models that
already qualify; or fold the binding into first-run rather than leaving it in Settings.

_Done when:_ a user who has configured one provider reaches a render gate without opening Settings.

### Slice 1 — a project is generable from birth

Bind both routes at creation from `listGenerationRoutes()`, choosing the video route on
`constraints.supportsFirstFrame` and health, not on name. Leave the Brief form as the override.

_Done when:_ a project created from the composer can reach the render gate with no visit to any
settings surface, and its video route is first-frame-capable. Verified in the running app, not by a
test that renders into jsdom.

### Slice 2 — the first-run consent wall — **closed 2026-08-22 by decision, no code**

The question this slice existed to answer has one: it is the design question, not the one-line list
entry. There is no per-server lever in the desktop repo — no approval field on the session
descriptor, no permission field on conversation creation, no aioncore config written from here. The
0.1.55 binary exposes `tools.auto_approve` and `allow_list`, so the decision is configurable, but
only on AionCore's side.

**Owner's call: accept one click per project.** It is a security prompt doing its job, once, on a
read-only tool. Pre-answering it from the rail would grant consent on the user's behalf through a
mechanism that keys on the bare server name — which a user can claim by importing a server under it.

Reopen if pilot users trip on it; the fix belongs in the AionCore fork's tools config. BUG-090 holds
the full investigation.

### Slice 3 — render straight from the Director's script

The existing gate reachable from what the Director just wrote. **Not** in this slice: making the cost
readable, ranges, or the rate card — §7's range rule is deferred with the rest of pricing.

_Done when:_ brief → questions → script → Render → real media, with no manual step between.

### Slice 4 — the Cut plays the film

Take selection and playback of the assembled film in-app.

_Done when:_ a pilot user watches their film end to end without leaving the app.

### Slice 5 — cast and look references

The round trip: the Director requests, the user approves, images generate on the image route and land
tagged `cast` or `look`. Built against a chain that already works, which is why it is last.

_Done when:_ two shots in one Beat visibly share a subject.

## 4. Explicitly out, and why

| Item                              | Reason                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One-file stitched export          | §6 rules it ffmpeg-class, spiked out and unbuilt. The Cut offers the editor folder instead — and §6 is explicit that the one-file option is hidden rather than shown and failing. |
| Narration and TTS                 | §5: the fields exist and have **no downstream consumer**. Real gap, own sequence.                                                                                                 |
| Hard-cut gating (BUG-095)         | Correctness, not viability. The bookkeeping is already right; only the money is missing.                                                                                          |
| The Beat panel redraw (§13.4)     | Four pieces of carried design work. None of it blocks a film.                                                                                                                     |
| `presentation-runs` (BUG-092/093) | Platform, not Studio. Broken 100% of the time and worth fixing — but it does not stand between a user and a film.                                                                 |

## 5. Risks worth naming now

**A single first-frame-capable route.** If seedance-2.0 is the only binding that supports first frames,
the whole chain rests on one model's availability. Slice 1 should record what it picked and why, so a
future outage is diagnosable rather than mysterious.

**"Ask first" costs turns.** The Director asking two or three questions before building is the agreed
behaviour and it produces better scripts, but it puts conversation between a pilot user and their
first visible result. Worth watching in Slice 0: if the questions feel like an interrogation rather
than a conversation, the fix is the wording of the rules, not the policy.

**Money is real from Slice 3 onward, and the MVP will not tell anyone what it costs.** That is the
accepted trade for speed. It is safe only because the confirm gate remains; it stops being safe the
moment anything renders without one, so that is the line to hold while everything else relaxes.
§7's ranges and §11.3's budget cap are the answer when pilot users start asking, and they will.
