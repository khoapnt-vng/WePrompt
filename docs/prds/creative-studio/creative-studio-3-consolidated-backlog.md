# Creative Studio 3 — consolidated backlog

Everything open as of 2026-08-28, in one place: the bug list, the planned work, and what is waiting on
someone. Counts are read from `creative-studio-3-bug-list.md` rather than tallied by hand.

**135 bugs filed · 104 closed · 31 open** — 3 P1, 21 P2, 7 P3.

_Ten entries added 2026-08-30 (**BUG-179**…**BUG-188**) after the 08-29/30 work was reverted at the owner's request. They are findings, not regressions: each was verified against the current code or reproduced live, and none had ever been filed. **BUG-179** is the one to read first — a single unreadable project stops Creative Studio working for every project in the profile, which is why a brand-new project reported itself unusable._

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

Filing them individually was right; fixing them individually would not be. Five clusters:

**Images are cropped wherever they matter** — **BUG-172** (P2), **BUG-178** (P2).
Three instances of one pattern: a fixed `block-size` plus `object-fit: cover` plus `overflow: hidden`.
The canonical reference image loses 67% of itself; the take strip is 54×38; the Shot's `Start` tile is
74px. Every one of those surfaces exists so the owner can judge an image. One shared image frame with
`aspect-ratio: 16/9` fixes all three; three local patches would not stop the fourth.

**Loading states that assert unavailability** — **BUG-167** (P3, _fix landed_).
Distinct from a genuine unavailable state and repeatedly mistaken for one. Note this cluster is also
where **S6** lands, so the new blank work area must not become a fourth variant.

**The view chrome is inverted** — **BUG-171** (P3), **BUG-175** (P3), **BUG-177** (P3).
Every view wraps itself in a card repeating its own name, across References, Table and Board. The
measurement that matters: the two redundant headings render at 20px and 21.75px while the project
title is 14.5px and the Beat's own name is 13px. The page's least informative labels are its largest.
BUG-171 and BUG-175 are one fix — deleting the duplicate frees exactly the weight the name needs.

**The Director's outputs cannot be resolved** — **BUG-160** (P2), **BUG-161** (P2), **BUG-162** (P3),
**BUG-163** (P2), **BUG-164** (P3, _fix landed_).
The owner's live symptom: four proposals pending at revisions 18 and 22 against a project at 1216,
`Accept` disabled on all four, `Reject` the only exit. This is the cluster actually in the owner's way.

**Money spent on nothing** — **BUG-141** (P2), **BUG-142** (P2), **BUG-165** (P1), **BUG-166** (P2).
BUG-142 and BUG-166 are the quiet ones: a status that permanently nudges toward re-rendering, and a
Board that can never show a preview because nothing captures a poster.

**Standalone** — **BUG-173** (P2, Shot rows share their Beat's exact indent, colliding with per-Beat
numbering) and **BUG-174** (P3, remove the 28 move controls; check they are not the only keyboard
route first).

## 3. Planned work

### Piece 1 — Sound _(S1–S3 implemented 2026-08-30; S4 deferred)_

Sound is not missing, only inaudible: every Shot video already carries an AAC stereo stream, real on
some models and silence on others, and three hardcoded `muted` attributes stand between the owner and
it. The export already mixes Shot audio and a music bed.

- **S1** adds default-muted, per-project mute and volume control across review players · **S2** keeps
  route capability separate from revision-correlated current-take loudness analysis · **S3** teaches
  the Director to author narration, dialogue, ambience and sound hits in the existing shooting script
  · **S4** music bed _(deferred — needs an audio import path)_

### Piece 2 — Progressive work area _(S5–S9 implemented 2026-08-30)_

Extends the view-less entry route and the seven Main-owned project-status stages, which say which
views have content.

- **S5** readiness from status stages · **S6** blank work area · **S7** disable empty views ·
  **S8** auto-advance on first content · **S9** retire the References one-time transition

Readiness now comes from exact revision-matched status. Empty projects stay view-less with Director
guidance; unready views remain visible with an accessible reason; direct unready URLs are preserved;
and automatic reveal stops after any explicit view choice. The retired References-opened key is inert
rather than migrated.

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
