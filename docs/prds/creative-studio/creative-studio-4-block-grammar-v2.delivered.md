# CS4 — the block grammar · revision 2

> Designer delivery, extracted from the standalone HTML bundle for readability.
> Source: `CS4 Block Grammar v2 - standalone.html`. The bundle is the authoritative
> artefact; this is a text rendering for search, review and quoting.
>
> **This supersedes `creative-studio-4-block-grammar.html.txt` (revision 1).**

---

CS4 — the block grammar · revision 2

1 Six kinds
2 Every block
3 The table
4 Status matrix
5 What to strip
6 One block, forty blocks
7 Extremes & locales

The block grammar, revised

What every block has in common, and what each kind may differ in. Written against the canvas wireframe's plates and scenarios; every element resolves to an Arco component per Plate 09.

Revision 2 — what changed, and why you are reading this instead of the first table

Eleven cells were wrong or missing, three of them because I derived a cost from a placement rule instead of from the chaining invariant. Folded in here: the corrected ordering rows under Ruling 1b; sound split into two rows; PROPOSED and NEEDS BUDGET extended to board and cut; chain position added as a member attribute; the quote given a home in region 4; the fixed vocabulary of Ruling 2 applied throughout — GENERATING/RENDERING, QUEUED, SLATE for the retired STILLED; delete corrected to lift to bin; and the uppercasing bug fixed for four locales. This supersedes the delivered table. Build from this one.

Because the canvas now has to win, the grammar has one job beyond consistency

A block must show something the four views structurally cannot. Three things qualify, and every rule below is chosen to protect them: an artifact with no project around it (References cannot render a lone photograph), unlike kinds adjacent (a script beside the plate that conditions it beside the clip that went stale — no view holds two kinds), and one home per decision (a proposal cannot be in two places if it is a state on the thing itself). If a rule below makes a block look more like its old view, it is the wrong rule.

§1
Ten kinds are six

Merging is welcome, so: a photograph is a stills set of one, cast and places are stills sets with a caption per member, and a proposal is not a kind at all — it is a status any kind can hold, which is also the only way "one home for the decision" survives contact with code. Six kinds, four of which are sets. sound now occupies two rows of one kind — imported and generated — because they differ in six of seven columns and a single qualified row would have to be decoded before it could be read.

stills

Absorbs photograph, character set, place set. One member or twelve; members may carry a caption and a group (turnaround, plate set). Aspect is per-member, not per-kind.

motion

Absorbs video and clip set. One member plays inline with a scrubber; two or more render as a tile row with per-member status. An imported 20s take and a five-shot Beat are the same kind at different counts.

document

The script. One member always. The only kind with a reading measure and the only kind whose body is prose. Not a set, never tiled.

board

The storyboard: a set of sets, grouped in named rows (Beats), where a member may be an image, a running skeleton, or its own shooting-script line. The only kind that renders unproduced members — and the reason no tile is ever empty.

sound

One imported audio member. Kept separate from motion because it has no frame, no aspect and no thumbnail — a waveform is not a tile, and the subject of a sound block is the words, not a picture of the sound. Imported as a music bed, or generated as voice, narration and SFX.

cut

The film composition over other blocks. Distinct from motion because it owns a timeline of references it does not contain, and is the one kind whose gaps are honest rather than errors.

proposal — cut as a kind

Becomes status PROPOSED plus a judgement footer, available to every kind. A proposed set of places is a stills block wearing one status; there is no separate component to keep in sync, and therefore no way for it to render twice.

§2
True of every block

A person learns this once. The container owns all six regions; a kind may only fill region 5.

1
#beat_2_clips
2
Beat 2 · 5 shots · 0:30

3
PARTIAL

4
conditions strip — present only while RUNNING or PROPOSED

5

6
free action
free action
one line of consequence, never a paragraph

Arco: Card (bordered, radius 4, no shadow at rest) · header title+extra · Tag size small · Button size small, type text/outline · Grid for members.

1 · Handle — always, always first

Mono 13px. Derived and untouched: #photograph_2 in grey-5, no # emphasis. Named: grey-8 with a grey-4 #. Click = inline Input with prefix="#"; old handle persists as an alias, shown once as was #… for the session. Never mirrors: dir="ltr" on the span inside RTL.

2 · Meta — kind, then count, then duration

11px grey-6, middot-separated, in that fixed order. Kind word is omitted when the handle already says it (#beat_2_clips needs no "Clips"). Duration only for motion, sound, cut, document. First thing to go at 640.

3 · Status — inline-end, uppercased in CSS

One chip, or a plain count summary when members disagree ("4 rendered · 1 stale"). Absent entirely when the block is current and whole — RENDERED shows on a lone artifact, not on every block in a 40-block canvas (see §6). Header flex-wrap: wrap: the chip drops to line two rather than truncating the handle, and German is why.

4 · Conditions strip — the only visible provenance

Thumbnails of what conditioned the work plus handles. Present only while RUNNING, PROPOSED or NEEDS BUDGET. It disappears on completion — provenance then lives only behind the stale popover. In NEEDS BUDGET this region is the quote: what would condition the work, what it would produce, what it would cost. A quote is not a block and never a row; it is this region arriving before the body does, and it is exempt from every density and shedding step. Absent during local RENDERING, which has no conditions to show.

5 · Body — the only per-kind region

Padding 14px, member gap 8–10px. Member state is drawn on the member (skeleton, hatch, error fill), never on the container. Members of motion, board and cut also carry chain position — CHAIN HEAD / AFTER n — which never sheds: it is what makes a re-render's blast radius visible before it happens. Ordering is stated, never handled; there is no drag surface anywhere in this grammar. There is no empty body: a block exists because a member exists, and a board's unproduced member carries its shooting-script line instead of a picture.

6 · Footer — free actions and one consequence line

Present when the block has a free reversible action or an unavoidable decision; absent otherwise. Max three actions, primary only when a decision is genuinely pending. A control that would fail is omitted, never disabled.

States of the container itself

Rest: border grey-3. Hover: border grey-4, footer actions become visible if they were hover-only, handle gains an edit affordance. Focus (keyboard): 2px blue-6 ring, offset 1 — blocks are tabbable in canvas order and the handle is the first stop inside. Selected: yes, one exists — border blue-6 + an Arco Checkbox at the header's inline-start, appearing on hover, persisting while any selection exists; multi-select drives one bulk act only (lift to bin — nothing in this product is deletable). Attention: a block awaiting judgement or budget uses a coloured border (blue-6 / grey-4 respectively), never motion, never a badge on the canvas.

§3
One row per kind

"On the block" means free, reversible, and scoped to this artifact. "In the rail" means it costs money, is irreversible, or needs wording — the Director says it and approval is a reply. When in doubt the test is: could a person undo it by ignoring it? If yes, it is a link on the block.

KIND
HEADER
STATUSES
ON THE BLOCK
IN THE RAIL
MEASURE
AT 640 — SHEDS / NEVER SHEDS

stills
handle · count ("4 plates", "2 characters · 8 views") · status. No duration ever.
RENDERED · QUEUED · GENERATING · FAILED · STALE · PARTIAL · PROPOSED · NEEDS BUDGET · IMPORTED
Download · Generate · Retry (per failed member, free) · rename · Keep / Discard when PROPOSED
Any new wording; "more like this one"; using a member as a reference; re-making a stale member (priced).
5 of 12. Portrait members are tall; five columns keeps four members per row without a member exceeding ~150px.
Sheds: member captions, then group labels, then tiles per row (4 → 3 → 2). Never sheds: the group label of a turnaround (a face without "back view" is unusable) or per-member status.

motion
handle · count + total duration ("5 shots · 0:30") or bare duration when count is 1 · status or count summary.
RENDERED · QUEUED · GENERATING · FAILED · STALE · PARTIAL · PROPOSED · NEEDS BUDGET · IMPORTED
Play · Download · Generate · Retry a failed member · Re-do a marked range (free) · rename
Producing missing members (priced); re-making a stale member; anything that changes the shooting script.
8 of 12 for a set (a Beat is 5–6 clips at 16:9 and must stay one row); 12 for a single member with a scrubber.
Sheds: shot numbers, then chip text for rendered members. Never sheds: below 3 tiles per row — it wraps to a second row instead — nor the scrubber's marked failure ranges.

document
handle · beats + shots + running time · status · Edit (the one kind with an action in the header, because editing is the whole point).
DRAFTED · CURRENT · PROPOSED. Never stale — a script conditions others, nothing conditions it; editing it makes downstream blocks stale.
Edit · expand/collapse a Beat · read the whole script · per-Beat production price (a priced act, but shown here because it is the script that names the work)
Rewrites, cuts, tone; "make it thirty seconds shorter". Every structural change is speech.
7 of 12, body capped at a 760px reading measure. Full 12 only when it is the sole block on the canvas.
Sheds: the open scene's prose preview (collapses to headers), then per-Beat prices. Never sheds: the reading measure — it stops growing, it never shrinks below 46 characters.

board
handle · beats + shots + "n slates" · status. Per-row header: Beat name · shots + duration · row status.
Block: PARTIAL · PROPOSED · NEEDS BUDGET · GENERATING. Row: same. Member: RENDERED · QUEUED · GENERATING · FAILED · STALE · SLATE, or unproduced and carrying its script line.
Still a Beat (priced but shown — it is pennies and reversible) · reorder Beats (free; keyboard, no chrome) · collapse to thumbnail map when fully stilled · rename. Reordering Shots within a Beat is not here — it rewrites the chain (Ruling 1b).
Producing clips for a Beat; splitting or dropping a Shot; anything that edits the script behind it.
12 of 12 always. It is the film's index; a Beat is a row and rows need the full width. Collapses to 5 when every shot holds a still and it becomes a map.
Sheds: 6 tiles per row → 4, with the row scrolling horizontally inside the block; then Beat durations. Never sheds: the Beat name, the unproduced member's script line, or the row's own status.

sound · importedthe music bed

handle · "imported" + duration · IMPORTED (always shown — it is the only status it has, and it tells the truth that the Director did not make this). Second line, plain: −6 dB under #the_cut, or not in the film — never blank.
IMPORTED only. Never generates, never queues, never fails, never stales, never proposed, never SLATE.
Play · Download · Replace file · rename. All free, all reversible. No level control — the cut owns it: the owner carries the control, the subject carries the fact.
Where it sits under the cut — which beats it plays under, and whether it ducks. No generation exists to ask for.
4 of 12, at every density. This kind never grows and never outranks a picture — the one kind exempt from the generous step, because a sentence in a very large box looks like it is waiting for something.
Sheds, first and entirely: the waveform — present only at default density and while playing, because its one use is as a scrub target. Then the filename. Never sheds: play, duration, or the level line.

sound · generatedvoice, narration, SFX

handle · what it is + duration ("narration · 0:12") · status. Second line is the line it was made from, one line, ellipsised — the subject, not a caption.
NEEDS BUDGET · PROPOSED · QUEUED · GENERATING · RENDERED · STALE · FAILED. No RENDERING — mixing is the cut’s operation, so the refund distinction stays legible. No SLATE: picture is the film’s clock and audio holds no time.
Play · Download · Retry when FAILED and nothing was spent · Move to front when QUEUED · Keep / Discard when PROPOSED · rename. No chain position — audio carries a time anchor instead, so reordering it is always free and it never stales from a reorder.
Any change to the words; a different voice or read; where it sits under the cut. Every re-generation is money, so every re-generation is speech.
4 of 12, as imported — except 6 while NEEDS BUDGET or PROPOSED, so the quote and the line it prices each fit on one line.
Sheds: the waveform entirely, then the voice name, then the line truncates — never below its first six words. Never sheds: play, duration, the line, the price.

cut
handle · "m:ss of m:ss" — the only header that states a shortfall as fact · status.
PARTIAL · PROPOSED · NEEDS BUDGET · RENDERING · RENDERED · STALE · FAILED. PARTIAL counts picture only — a film with unrendered audio plays silent at full length, and that is not incompleteness. PARTIAL is its resting state for most of a project's life and is not an error.
Play · re-cut (free, and per ruling 4 it happens without asking) · trim head/tail · match continuity to the previous shot (one action, undoable) · the music bed’s level · rename. Ceiling, stated: no crop, no grading, no keyframes. No Download until whole — an export that would fail is absent.
Producing the missing beats; hard cuts and joins. Reordering is not here and not anywhere — the film has no order of its own; it reads the board’s.
5 of 12 beside a clip set, 8 when alone in its row. A 16:9 player wants width but must not read as the canvas's subject.
Sheds: the per-beat legend under the filmstrip. Never sheds: the filmstrip itself — the gaps are the point — or the "of m:ss" total.

§4
Which kinds can hold which status

Ruling 2's fixed list, applied. The delivered preamble said two additions; there were five, and the words were reused where the keys were not. Two levels now, because they were being conflated: block level says what the whole thing is, member level says what one piece of it is doing. STILLED is retired in favour of SLATE; RUNNING is retired in favour of GENERATING for provider work and RENDERING for local composition — a behavioural split, not a naming one.

IMPORTED
NEEDS BUDGET
PROPOSED
QUEUED
GENERATING
RENDERING
RENDERED
PARTIAL
FAILED
STALE
KIND-LOCAL

stills
●
●
●
●
●
—
●
●
●
●
—

motion
●
●
●
●
●
—
●
●
●
●
—

document
—
—
●
—
●
—
—
—
●
—
DRAFTED, CURRENT

board
—
●
●
●
●
—
—
●
—
●
—

sound · imported
●
—
—
—
—
—
—
—
—
—
—

sound · generated
—
●
●
●
●
—
●
—
●
●
—

cut
—
●
●
—
—
●
●
●
●
●
—

Member level

SLATE
Holds its time, no render yet
board, cut — picture only. Replaces the retired STILLED.

QUEUED
Committed, waiting
Carries position ("2nd"), dependency ("waits on 1.2’s last frame") and one action: Move to front.

READY TO RENDER
Could start, nobody has said go
Narrower than it looks: only where a member is startable and unasked. No money committed — that is what separates it from queued.

GENERATING
Provider work in flight
Region 4 present. Cancellable for a refund.

RENDERING
Local composition in flight
cut only, and at block level only. Region 4 absent. Nothing to refund.

RENDERED
Done

STALE
Plays, but off the chain
Two causes, two action sets. Chain-stale offers Re-render chain / Keep; words-stale — a script edit, and the only kind audio has — offers Keep alone, because there is no chain to re-render.

FAILED
Failed
Never a bare chip. Carries a reason and a cost-truth: "rule breach · visible branding · not spent". The silence case needs no new word — "returned silence · spent".

Three absences worth reading. A board is never RENDERED at block level — completion has its own word, and failure is always a member's. sound · imported holds one status for its whole life, which is the honest shape of a thing nobody made. And RENDERING belongs to the cut alone: mixing a narration under a film is the film's operation, not the narration's, which is what keeps "cancellable for a refund" true wherever GENERATING appears. The delivered table's claim that a cut never fails assumed provider re-cut; local composition fails visibly, with nothing spent.

§5
Re-hosting: what to strip, what the container supplies

The hazard is view-shaped chrome arriving with each component. The rule: a re-hosted component keeps only its member rendering and loses every surface that framed it — no page header, no progress bar, no transport, no empty state, no view-level toolbar. If it draws something outside its own tile, it goes.

COMPONENT TODAY
BECOMES
STRIP
CONTAINER SUPPLIES
KEEP EXACTLY

Board Shot tile grid (2,457 lines)
motion
Board scroll container and its own grid sizing; the "nothing to produce until the Table is set" empty state; view toolbar and filter row; tile-level context menus that navigate to other views.
Column count (5 at rail 431, 3 minimum), gap, header with handle and count summary, footer actions, selection and focus rings.
The tile itself: thumbnail, duration, status chip, per-tile retry — including the exact status words.

References character & place cards (1,709 lines)
stills
Page header and readiness progress bar; the card's own bordered shell (it becomes a member, not a card); "Nothing to review until…" state; the review/approve affordances that duplicated the rail.
One border for the whole set, the group label per turnaround or plate set, member captions, the PROPOSED judgement footer.
Image rendering, aspect handling, per-view labels ("back view", "three-quarter") and the failed-member treatment.

CutPlayer (3,199 lines)
cut
Full-height transport bar and keyboard shortcut layer; export panel; "Nothing to cut until Shots are produced"; the Cut view's own timeline zoom controls.
Player width (5 or 8 of 12), the header's "m:ss of m:ss", the filmstrip's fixed 22px height, and absence of Download until whole.
Playback, per-beat filmstrip segments including the dashed gaps and stale hatching.

Beat panel: clip rows, first frames (7,161 lines)
board
Panel chrome, resizer and docking; per-Beat navigation that assumed one Beat on screen at a time; the Table's drag-to-arrange surface.
Six rows visible at once, row headers with Beat name and row status, horizontal scroll inside a row at narrow widths, the collapse-to-map behaviour.
The row's shot ordering and the first-frame renderer — including the unproduced member that shows its shooting-script line.

One acceptance test for this section: no block may render a scrollbar of its own except a board row, and no block may render a progress bar that is not a member's. Both are reliable tells that a view came along for the ride. A third has been added: no block may render a drag handle. The Table’s drag-to-arrange surface and the Cut’s shot dragging are both struck — ordering is typed, or stated and moved with Alt+↑/↓ on a focused member, announced with its cost.

§6
One block must look right; forty must look right

Measure is a property of the kind and never changes with count — that is what keeps forty blocks legible. What changes with count is chrome density, in two steps, applied canvas-wide rather than per block.

1–3 blocks · generous

Grid centres with a max content width of 900px and 15% vertical padding, so a lone photograph is composed rather than stranded top-left. Status chips show even when nothing is wrong (RENDERED is reassurance at this count). Footers are always visible, never hover-only. Meta shows kind word in full.

4–8 blocks · the default

Everything as drawn in the wireframe's Plate 03: full canvas width, 20px gap, all six regions available, chips on every non-current state. This is the tuning target — Scenario C sits here.

9+ blocks · quiet

Chips appear only for states that need a person (PROPOSED, NEEDS BUDGET, FAILED, STALE, RUNNING); RENDERED and IMPORTED go silent. Footers become hover-only except where a decision is pending. Stills sets cap at two rows with a "+12 more" member. Gap tightens to 16px.

The invariant across all three

A block that needs a person looks identical at every density: coloured border, chip present, footer visible, primary action shown. Density may quieten satisfied work; it may never quieten a decision. Two consequences now written down rather than inferred: a quote is exempt from every step — chip, footer and price at full size at nine blocks and at forty — and a sound block has neither a ceiling nor a floor, holding 4 of 12 and its one line of words at every density, because the words were always its subject.

§7
Extremes, locales, and the order of shedding

The shedding order, universally

Same sequence for every kind, so it is learnable: 1 duration and secondary meta, 2 member captions, 3 chip text on satisfied members, 4 tiles per row, 5 footer secondary actions. Nothing sheds the handle, a status that needs a person, a member's own failure marker, or a chain position — at any width. Sound inverts step 4: its waveform goes first and entirely, and its words never go.

Twelve to six columns

Under canvas 720px the field halves and spans halve, rounding up: 7→4, 8→4, 5→3, 4→2, 12→6. Two blocks may still share a row (4+2), which is the point — never a single stack. A span never exceeds the field.

RTL and expansion

Logical properties throughout (margin-inline-start, inset-inline-end); status sits at the header's inline-end and the budget readout at the app bar's inline-end, so both land left in Persian. Handles carry dir="ltr" and never mirror. Status strings are translated in sentence case and uppercased in CSS — text-transform: uppercase plus letter-spacing: .04em — so German ABGELAUFEN needs no new string and simply wraps the header. Except in four locales: text-transform: none for :lang(tr), :lang(az), :lang(de) and :lang(el), where machine uppercasing mangles the dotted i, ß and accented capitals. This was a bug in revision 1, not a preference.

Dark

Canvas #17171A, block #232324, border #2E2E30, primary #3C7EFF. Chips become 16%-alpha fills of their hue. Member placeholders go lighter than the block, never darker, so imagery stays the brightest thing on the canvas.

Three things this spec decides that you may want to overrule

1. A proposal is a status, not a component — cheapest way to guarantee one home, but it means every kind's card must implement a judgement footer.
2. RENDERED goes silent above eight blocks. It trades reassurance for calm, and it is reversible in one constant if you disagree.
3. Selection exists, but drives exactly one bulk act (lift to bin). Anything more and the canvas starts becoming a file manager.
