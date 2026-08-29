# Creative Studio 3 — consolidated backlog

Everything open as of 2026-08-28, in one place: the bug list, the planned work, and what is waiting on
someone. Counts are read from `creative-studio-3-bug-list.md` rather than tallied by hand.

**123 bugs filed · 120 closed · 3 open** — **BUG-144** and **BUG-165** (both P1) are blocked on an owner decision rather than on engineering: ffmpeg distribution, and whether a chained take's quoted upper bound may double to fund a retry. **BUG-183** (P2) has its message fixed; what remains on it is rendering the control in the banner and telling apart a catalogue that was never fetched from settings that match no model.

_Closed 2026-08-29: **BUG-163**, verified end to end by driving the repair on `Panel Check` and watching the PATCH, the proving readback and the composer arrive — and the measurement corrected the entry's stated mechanism, since the backend echoes the conversation record rather than returning an empty 204; **BUG-162**, verified by driving the real turn-close builder against the real locale bundle in the running renderer; **BUG-177**, verified live — one opaque scrim, and hit-testing finds no point that resolves into the Beat panel behind it; that verification turned up **BUG-181**, the frame counter painted over by Arco's close button, filed and fixed in the same pass; **BUG-166** — live verification found its own first fix persisting pure-black posters, now fixed and re-verified against the real capture function; **BUG-172** on live evidence from `Plateau` itself, and **BUG-180** on the owner's scope ruling that every Studio project is throwaway test data and migration is not done during development. The containment half of BUG-180 is filed and fixed as **BUG-179** and is unaffected by that ruling: one unopenable project must not degrade the runtime for every other project._

_Closed 2026-08-29 after live verification in the running app: BUG-138, 171, 173, 174, 175, 176 and 178. Of the eight still open, **five carry a landed fix that could not be witnessed** — four of those five need a working Director, which never attaches in this profile — and only three need engineering: BUG-144 (owner-deferred distribution decision), BUG-165 (one Director-adjacent cause plus a pricing call) and BUG-180 (no repair route for a project bricked mid-publication)._

_Added 2026-08-29 from live verification: **BUG-179** (P1, one unreadable project degraded the whole runtime — **fixed and verified live**, and it also fixed film export by consequence) and **BUG-180** (P2, a crash mid-publication leaves a project permanently unopenable with no in-app recovery)._

_Status 2026-08-29: **12 of the 14 open entries carry a landed fix awaiting live verification**, recorded as `Fix landed … not yet verified live` rather than closed, because jsdom does not compute layout and this file's own standard is that a commit message describing the right fix is not evidence. Only two entries have unfinished work, and neither is engineering that can proceed today: **BUG-144** is the owner-deferred distribution decision, and **BUG-165** needs a prompt-authoring change that overlaps the in-flight Director work plus a pricing call on retry cost._

_Count note 2026-08-29: the previous line read 116 filed · 98 closed. Counting `- [ ]`/`- [x]` **[BUG-nnn]** headers in `creative-studio-3-bug-list.md` returns 118 unique ids with no duplicates, so the filed and closed figures were two low; the open figure of 18 was correct. BUG-138 was reopened on 2026-08-29, taking open to 19._

---

## 1. The P1s — one active, one deferred

| Bug         | What is broken                                                                            | Note                                      |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| **BUG-144** | Film export needs an ffmpeg the product never ships                                       | Needs a bundling decision, not only a fix |
| **BUG-165** | Chained generation — the product's central mechanism — succeeds about a third of the time | Root cause only partly proven             |

**BUG-144 is deferred** by the owner: what remains is a distribution and counsel decision, not
engineering. The mechanism is already in place — the resolver looks in
`resourcesPath/bundled-ffmpeg/<platform>-<arch>` and `electron-builder.yml:107` already declares
`extraResources`, the same route `bundled-aioncore` ships by. Only binaries and the decision are
missing.

**BUG-136 and BUG-140 closed 2026-08-28.** Both were already fixed in the working branch and were
verified live: `Plateau` opens at revision 1218 with 97 stored job compositions written before the
prompt rewrite, and three films that plan no references have all their Shots bound with two of them
holding jobs. Neither needed merging.

This entry previously claimed two P1 fixes sat unmerged on the remote. That was wrong, and the
mistake is worth keeping: it came from `git merge-base --is-ancestor`, which tests whether a branch
**tip** is an ancestor. Both fixes had landed via different commits, so ancestry reported "not
merged" while the code carried them. Compare content, not ancestry.

## 2. The P2s and P3s, grouped by what fixes them

_Recounted from the bug list 2026-08-29. The previous revision of this section listed eighteen ids —
the superseded open figure — of which **six were already closed** (BUG-141, 142, 160, 161, 164, 167)
and it omitted **BUG-176**, an open P2 no cluster covered. Since this is the view people plan from,
that meant six closed items were re-pickable and one real one was invisible. Regenerate this list
from the bug list rather than editing it by hand._

Twelve of the fourteen open entries now carry a landed fix awaiting live verification. Three clusters
plus two standalones remain:

**Images are cropped wherever they matter** — **BUG-138** (P2, _reopened and fix landed_),
**BUG-172** (P2, _fix landed_), **BUG-178** (P2, _fix landed_).
One pattern in two shapes: a fixed `block-size`, or a hardcoded `aspect-ratio`, each combined with
`object-fit: cover` (or an unconstrained image) plus `overflow: hidden`. Ten instances, not three.
**The frame must not be `aspect-ratio: 16/9`.** `StudioAspectRatio` is
`'16:9' | '9:16' | '1:1' | '4:3' | '3:4'`, so a hardcoded landscape frame newly breaks every portrait
and square project — precisely the defect BUG-138 was filed for. The frame takes its ratio from the
project. Note the trap that this fix hit and had to correct: the ratio is published on
`WorkspaceControls`, and an Arco `Modal` without `getPopupContainer` portals its subtree to
`document.body`, escaping that DOM node. Any portalled surface must republish it.

**The view chrome is inverted** — **BUG-171** (P3, _fix landed_), **BUG-175** (P3, _fix landed_),
**BUG-177** (P3, _fix landed_).
Every view wrapped itself in a card repeating its own name. Measured: two redundant headings at 20px
and 21.75px while the project title is 14.5px and the Beat's own name 13px — the page's least
informative labels were its largest. BUG-171 and BUG-175 were one fix.

**The Director's outputs cannot be resolved** — **BUG-162** (P3, _fix landed_),
**BUG-163** (P2, _fix landed_).
The rest of this cluster closed on inspection. What remained was two wrong root causes: BUG-162 is app
copy chosen from transport counts, not Director prose; BUG-163 is a provider typed `Promise<boolean>`
that resolves `undefined` on a 204, so a successful write read as a failure.

**Money spent on nothing** — **BUG-165** (P1), **BUG-166** (P2, _fix landed_).
BUG-165 is the chained-generation success rate; its remaining retry mitigation is a pricing decision.
BUG-166 was a Board that could never show a preview because a poster was only ever captured inside
the Beat panel.

**Standalone** — **BUG-173** (P2, _fix landed_: Shot rows shared their Beat's indent, colliding with
per-Beat numbering), **BUG-174** (P3, _fix landed_: the 28 move controls removed, keyboard route kept),
and **BUG-176** (P2, _fix landed_: only a 19px strip of the Beat card opened the Beat).

**Not in a cluster** — **BUG-144** (P1) is the owner-deferred ffmpeg distribution decision, covered in
section 1.

## 3. Planned work

### Piece 1 — Sound _(planned, unstarted)_

Sound is not missing, only inaudible: every Shot video already carries an AAC stereo stream, real on
some models and silence on others, and three hardcoded `muted` attributes stand between the owner and
it. The export already mixes Shot audio and a music bed.

- **S1** make it audible in review · **S2** say when a route cannot produce sound · **S3** the Director
  writes sound into the shooting script · **S4** music bed _(deferred — needs an audio import path)_

### Piece 2 — Progressive work area _(planned, unstarted)_

Extends three mechanisms that already exist: the view-less entry route, `defaultStudioView`, and the
seven project-status stages, which already say which views have content.

- **S5** readiness from status stages · **S6** blank work area · **S7** disable empty views ·
  **S8** auto-advance on first content · **S9** retire the References one-time transition

Order matters: S5 first, then S6/S7, then S8, then S9.

### Piece 3 — The Beat track _(fully specified, not yet sliced)_

The designer's drawing arrived and answers the commission; eight decisions are settled and three gaps
were decided by engineering. It replaces three bands with one track, seek and select only. **This has
no slices yet** — it is the one planned piece that cannot be started without a breakdown.

Its one shared dependency: decision 7 renames `Ready to render` → `Ready` in the owned status
vocabulary, which is twelve locale values and touches the Board as well as the track.

## 4. What is waiting on a person

- **Piece 3 needs slicing** — the only planned work that cannot start.
- **9 commits held unpushed** at the owner's instruction: the sound and workspace plan, four rounds of
  bug filings, the Beat timeline commission and its decisions, and one real fix (`843806ec3`).

## 5. Landed today, not yet verified

`2831fe4b6` (**BUG-167**) and `d737fd5b7` (**BUG-164**) arrived while this was being written and are
recorded as fixes landed, not as closed. Three others were verified live today and closed properly —
**BUG-168** (0 conversation requests in 20s, against ~25/s), **BUG-169** (`RENDERED · LATEST ATTEMPT
FAILED`, with 30 RENDERED against 30 Shots holding video) and **BUG-170** (no flash across three
focus events).

The standing rule that produced those three: a commit message describing the right fix is not
evidence. BUG-166 and BUG-167 were both found _inside_ the work that claimed to add Board monitoring.
