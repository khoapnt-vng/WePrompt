# Creative Studio 3 — a layout question about the app bar

**For:** the designer of the Beat and Shot prototype
**From:** engineering, 2026-08-21
**About:** [BUG-068](./creative-studio-3-bug-list.md), the app bar
**Needs:** four answers before we build it

## The short version

Your app bar is measured, understood, and we intend to build it as drawn. One decision taken after
the prototype was drawn has changed the width available to it, and the bar no longer fits in that
width. We do not want to improvise a fix for something this central, so we are asking.

## What changed

The prototype lays every screen out against the full window. The product now keeps a permanent
**Creative Director rail** down the left of the workspace — a conversation panel that was specified in
the implementation plan and confirmed by the owner on 2026-08-21 as needed. It is not going away.

The rail is collapsible, and that turns out to matter more than anything else here.

Measured in the running application at a **1492px** window:

|                          | Rail expanded | Rail collapsed |
| ------------------------ | ------------- | -------------- |
| Director rail            | 431px         | 53px           |
| Workspace content column | **780px**     | **1158px**     |

## Why the bar does not fit

Taking the bar's own measurements from the prototype and collapsing its flexible spacer to zero — the
narrowest the bar can possibly be while keeping every element:

| Part                                          | Width     |
| --------------------------------------------- | --------- |
| Project dot                                   | 22px      |
| Project title                                 | 206px     |
| Stat strip `9 BEATS · 2:58 OF 3:00 · 5 READY` | 219px     |
| View chips `TABLE BOARD CUT`                  | 156px     |
| `Render…`                                     | 76px      |
| Overflow `⋯`                                  | 27px      |
| Six 11px gaps                                 | 66px      |
| Container padding                             | 36px      |
| **Minimum**                                   | **808px** |

So:

- **Rail expanded — 780px available. The bar is 28px short.** Not tight; it does not fit, with the
  spacer already at zero and nothing left to give.
- **Rail collapsed — 1158px available. It fits comfortably**, with 350px of spacer left over.

The 28px is the optimistic case. `Season 4 feature walkthrough` is 28 characters and measures 206px.
A real project in the running build is currently called `make an epic, medieval age, monster and
dragon` — 45 characters, roughly 331px at the same type, which pushes the minimum to about **933px**.
Project titles are user-typed and unbounded, and the prototype does not show a truncation rule.

## What we are asking

**1. Does the bar span the window, or live inside the workspace column?**
If it spans the full width and sits above both the rail and the workspace, it keeps its proportions
and the problem disappears — but it then reads as application chrome rather than as the project's own
header, and the rail gets a second header beneath it. If it lives inside the column, it has to change.

**2. If it lives inside the column, what yields first?**
We would rather be told the order than guess it. Candidates, in no particular order: the stat strip
moves under the title; `Render…` loses its label and becomes an icon; the overflow absorbs `Render…`;
the view chips move out of the bar entirely. Please give us a priority order as width decreases.

**3. What is the truncation rule for the project title?**
A maximum width, then ellipsis? A minimum reserved width it never drops below? Something else?

**4. Is the expanded rail a working state, or a consulting state?**
This is the one we most want your view on. If people are expected to collapse the rail while working
in Table, Board and Cut, then 1158px is the real design target, the bar fits as drawn, and question 2
goes away. If the expanded rail is where people live, then every view needs re-proportioning at 780px
and the two views below need your hand.

## Two views that need redrawing either way, if the answer to 4 is "expanded"

These are not app-bar issues, but they have the same cause and the same answer would settle them.

**The Board.** Three 16:9 cards sit near 430px each at full width. The same three columns inside 780px
fall to roughly 250px. That is small enough that three-up may stop being the right answer rather than
simply shrinking, and we would rather not pick a new column count for you.

**The Cut.** The preview panel, the right-hand `THE FILM` panel, the filmstrip and the audio-bed
waveform are composed against the full width. Inside 780px the preview and the side panel are
competing for the same space, and the filmstrip's nine beat segments become very narrow.

## What we are not asking

We are not asking you to justify the design or to simplify it. The prototype is the reference we are
building to, the typefaces are already correct in the build, and the remaining fidelity work is ours.
This is one question about a constraint that appeared after you drew it.

## For reference

The measured spec of the bar as drawn — container, order, and per-element type, colour and box — is
recorded in the [bug list appendix](./creative-studio-3-bug-list.md). The prototype it was taken from
is `creative-studio-3-beat-and-shot-reference.html.txt`, sha256 `642c8b16…0846ee`.
