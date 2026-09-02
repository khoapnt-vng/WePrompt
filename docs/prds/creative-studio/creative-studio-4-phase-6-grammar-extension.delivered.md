# CS4 — the grammar, extended

> Designer delivery, extracted from the standalone HTML bundle for readability.
> Source: `CS4 Phase 6 Grammar Extension - standalone.html`. The bundle is the authoritative artefact;
> this is a text rendering for search, review and quoting.

---

CS4 — the grammar, extended

The three answers
1 The quote
2 Ordering
3 Proposals at film scale
Corrections to the table
The vocabulary
Argue with this

Three gaps, closed — and eleven rows corrected

You asked for one more pass over the grammar. Two of your three gaps close out of work that already exists — the CS3 board and cut answer the ordering question better than the boundary rule you proposed, and my own board row already contains the precedent that answers proposals at film scale. The third, the quote, is not a row. What genuinely needs new work is smaller than the commission assumes and larger than it asks: the delivered table has eleven cells that are wrong or missing, and three of them are wrong because I derived them from a placement rule instead of from the chaining cost.

One thing to fix in the rulings before they are signed

Ruling 1 describes a two-way disagreement between the grammar and CS3's prose. It is four-way: the CS3 Table & Board prototype ships permanent reorder chrome in two places — "drag a row to reorder" on the Board and "drag a shot to reorder" in the Cut — and the second one spans the chain and is offered free and unwarned. The row drag agrees with CS3's prose; the shot drag contradicts it and contradicts BUG-174. Name the prototype as a thing being overruled, or it will be cited as precedent by whoever builds Assembly.

1 · The quote is not a row

It is the conditions strip with a price on it — region 4 of a block that has not started. It has no measure of its own because it is never wider than the block it belongs to, and it is exempt from density, because a cost is a decision.

2 · There is only one order

CS3 already settled it: reading order is play order. The film does not own an order, it reads the board's. So the canvas is not hosting a competing order — it is hosting the one block that owns ordering, on an axis the canvas does not use.

3 · A multi-block proposal is one block's proposal

"Storyboard these eight Beats" is PROPOSED on one block — the board that owns the eight Beats as members. Never eight chips, never eight footers. It consumes the one pending slot for the whole canvas.

§1
The quote block — the rule, not the row

You gave me the choice and I am taking the second: it is not a row. Your own canvas design says it is not a Piece and not inventory, and every column you asked me to fill would be a lie if I filled it — a thing with no members has no measure, and a thing that is not inventory cannot shed. Rows describe artifacts. A quote is not an artifact; it is a block's fifth region arriving before its body does.

The rule, in five clauses

a. A quote is the conditions strip of a block in state NEEDS BUDGET, carrying what would condition the work, what it would produce, and what it would cost.
b. It renders inside the block it is about, in region 4, above a body that shows the work's shape and not its result — for a film, one segment per Beat with a duration and no picture.
c. It is never a free-standing card, is never in inventory, and never has a handle of its own. Answering it turns the same block QUEUED; declining removes the block.
d. It is exempt from every density step and every shedding step — chip present, footer visible, price at full size at nine blocks and at forty, at 1440 and at 640. Your reading of the invariant is correct and I am making it explicit rather than inferred.
e. The price is the last thing on the canvas to be abbreviated. It is never rounded, never a range, never "~", and it states the currency in every locale.

Why this beats giving it a row

A row would make the quote a seventh thing on the canvas that a person must learn, and it would need its own answer to every question the table asks — measure, shedding, statuses — where the honest answer to all three is "the same as the block it belongs to". Making it a region instead means the decision and the thing decided are the same object, which is the identical argument that made a proposal a status rather than a component. One home, one mechanism, one implementation.

Several quotes at once, which Phase 6 makes normal

Quotes do not compete for the one pending slot — that slot is for judgement, and a quote is not a judgement until it is answered. But a canvas may hold at most one unanswered quote per block and the app bar states their sum: "3 quotes outstanding · $14.60 if all three run". Without the sum, three quotes of $6 each read as $6 three times, which is how a budget disappears.

A video quote is not a photograph's quote in a bigger font

It carries a duration, and duration is the thing a person can change to change the price. So a film quote states price, duration, and price per second — three numbers, because the third is the only one that lets someone judge whether the second is worth it. A photograph's quote states one number and no rate.

Twelve locales

The quote is a sentence with numbers in it, and word order moves. It is built as one interpolated string per clause — never a concatenation, never a label beside a value — so Japanese can put the counter-word where it belongs. The price is dir="ltr" like a handle.

§2
Assembly ordering — the contradiction dissolves

You proposed that ordering inside a block is a different act from ordering blocks, with the block as the boundary. That is right but weaker than what CS3 already ships, which says something sharper: the film has no order of its own. The storyboard's reading order is play order; the cut plays "shots in story order" and stores nothing. So there was never a second order on the canvas to reconcile — there is one order, it lives in one block, and the canvas orders blocks on a different axis entirely (dependency), which no person and no Director ever hand-edits.

What marks the boundary visually

Nothing new, and deliberately nothing draggable. Ordering is stated, not handled: every member of an ordered body carries its position as text — CHAIN HEAD, AFTER 1.2 — which CS3 already draws. A body whose members say where they sit is legibly ordered; a canvas whose blocks say nothing of the kind is legibly not. A person learns the difference by reading, not by discovering that a drag failed.

Chain position is a missing column in my table

The delivered grammar gives members a status and no position. That is the actual defect behind your question: with no position on the member, ordering has nowhere to live but a drag handle. Add chain position to motion, board and cut members, and it never sheds — it is the one thing that makes a re-render's blast radius predictable.

Taking the cost model as given

Under Ruling 1b, intra-Beat reorder is priced and warned, Beat-scale reorder is free. Its presentation also already exists in CS3 and needs no invention: the affected member goes "stale · it plays, but off the chain" with Re-render chain beside Keep. Keep is a real option, and it is why this can be presented as a consequence rather than a gate.

Under Ruling 1a, and a warning about runs

Director-primary is the reading I want, for a reason neither document gives: a run is derived from adjacency in canvas order. Phase 1's ban on hand reordering is the only thing that keeps a run honest. If either a person or the Director may reorder blocks on the canvas, runs become hand-formable and hand-breakable, and the whole derivation collapses into a group field by another name. Ruling 1 needs a sentence saying canvas block order is nobody's to edit — not the Director's either.

The keyboard path BUG-174 requires, without chrome

A focused member accepts Alt+↑/↓ to move within its body, announced by an aria-live line that states the new position and the cost if there is one — the same words the Director would have said. It is keyboard-reachable, it is never visible chrome, and it exists only inside ordered bodies. This satisfies the acceptance evidence as written: no always-visible move controls, and the typed Director operation remains the primary path with the deterministic result.

§3
Proposal review at film scale

Your four questions all have one answer, and it comes from the row you already accepted. A board is the kind that renders unproduced members, each carrying its shooting-script line instead of a picture. So "storyboard these eight Beats" is not eight proposed blocks. It is one proposed board with eight unproduced members — which is what a storyboard is. The multi-block case was an artifact of thinking the proposal creates blocks; it creates one block whose body is the eight.

YOUR QUESTION
THE RULE

Every affected block, one representative, or elsewhere?
One block: the one that owns the work as members. A proposal that spans several existing blocks is not one proposal — it is several, and it must be said as several or refused. A proposal that creates work always creates a container for it, and the container wears the status. There is no representative-of-many, because that is a decision with a home that is not the thing decided.

What does PROPOSED look like on a block that does not exist yet?
Exactly like a board whose members are unproduced: every member shows the words it would be made from, at full member size, with no picture and no skeleton. A skeleton means "coming"; this is not coming, it is offered. The block has a derived handle, a blue-6 border, region 4 carrying the quote, and one judgement footer. My rule that a block exists because a member exists holds — the members are the script lines, which exist.

Does one proposal spanning eight blocks consume the slot for eight, or the canvas?
The canvas. Your belief is right, and the reason is the one-home argument, not scale: the slot exists so a person is never asked two questions at once. One pending judgement, canvas-wide, whatever its size. A second proposal cannot be made while one is unanswered — the Director says so in words rather than the canvas refusing silently.

Where does the judgement footer live when the judgement covers many blocks?
It never covers many blocks, so it stays where the grammar puts it: region 6 of the one proposed block. Eight footers was the correct instinct that something was wrong with the premise, not with the rule. Per-member Keep/Discard does not exist — a storyboard is accepted or declined whole; adjusting seven of eight is a sentence to the Director, not eight checkboxes.

This costs you a cell in my own status matrix, and you should know which

§1 of the delivered grammar says PROPOSED is available to every kind; §4's matrix denies it to board and cut. The matrix is wrong — I wrote those two rows thinking about blocks that already exist. Both gain PROPOSED, and both gain NEEDS BUDGET, which is the same correction seen from the quote's side: a film that has been quoted and not commissioned is a cut in NEEDS BUDGET and there is nowhere else for it to be.

§4
Corrections to the delivered table

Eleven cells. Three are the cost-model inversion you found; the rest surfaced from reading the CS3 prototype against my own rows. Everything here is a replacement string for a cell that exists, except the two marked new.

ROW / CELL
DELIVERED
CORRECTED
WHY

board · on the block
"reorder members"
Two entries. On the block: reorder Beats (free, keyboard, no chrome). In the rail: reorder Shots within a Beat — priced, because it rewrites the chain — surfaced on the block only as the resulting stale members with Re-render chain / Keep.
One cell held two operations with opposite costs. This is the real defect behind your contradiction — not the placement, the conflation.

cut · in the rail
"reordering the film; hard cuts and joins"
Reordering leaves the row entirely. The film has no order of its own — it reads the board's. Rail keeps: producing the missing Beats; hard cuts and joins.
"Reading order is play order." A rail action that reorders the film would create the second order the canvas is trying not to have.

cut · on the block
"Play · re-cut · rename. No Download until whole."
Add trim head/tail and match continuity to the previous shot ("one action, undoable"), and the stated ceiling no crop, no grading, no keyframes. Still no Download until whole.
Both are free and reversible, so my own placement rule puts them on the block. CS3 ships them; my row silently deleted them.

cut · statuses
Never FAILED — "a failed re-cut reverts silently"
FAILED is possible, plus PROPOSED and NEEDS BUDGET. A failed local composition says so and states that nothing was spent.
My reasoning assumed provider re-cut. Phase 6 makes local composition a real operation that can fail with a previous cut still playable — that is reportable, not silent.

board · statuses
No PROPOSED, no RENDERED
Gains PROPOSED and NEEDS BUDGET. Still never RENDERED at block level.
§4 contradicted §1's "available to every kind", and §3's answer needs it. A proposed storyboard has nowhere else to live.

sound · whole row
IMPORTED only. Never runs, never fails, never proposed. Rail: "where it sits under the cut, and nothing else."
Two sound rows, or one row with a generated column: an imported music bed (as delivered, plus a level owned by the cut — "ducked under the whole film, −6 dB") and generated voice, narration and SFX, which run, fail, stale and can be proposed like any other work.
Your commission excludes sound while Phase 6 invalidates this row. I need it in scope, or it ships wrong.

§2 · selection
"multi-select drives one bulk act only (delete)"
One bulk act only: lift to bin. And the bin needs a home the grammar never gave it — one canvas-level surface, not a block.
Delete does not exist in this product. CS3: "nothing here is in the film; nothing here is lost." Runs: "nothing is deletable." Mine was the only document with a delete in it.

Member attributes · new
Members carry status, caption, group.
Members of motion, board and cut also carry chain position — CHAIN HEAD / AFTER n — which never sheds.
Without it, ordering has nowhere to live but a drag handle, and a re-render's blast radius is invisible until it happens.

Region 4 · new
Present only while RUNNING, PROPOSED or NEEDS BUDGET.
Same, and in NEEDS BUDGET it is the quote (§1). Absent during local composition, which has no conditions to show.
Closes the quote gap without a seventh row, and handles the Generating/Rendering split.

§4 · preamble
"Existing vocabulary reused verbatim. Two additions."
Five new words, not two, and the words are reused where the keys are not. See §5.
Straight undercount in my own text; your engineering notes caught it first.

§7 · locales
"Status strings translated in sentence case and uppercased in CSS."
Same, with text-transform: none for :lang(tr), :lang(az), :lang(de) and :lang(el).
Machine uppercasing mangles Turkish dotted i, German ß and Greek accents. This is a bug in the delivered spec, not a preference.

§5
The vocabulary — what Ruling 2 is missing

Ruling 2 asks about the running word. That is the second-biggest problem in the vocabulary. The biggest is that three words already mean "timed but not rendered", two of them mine, and a fourth state ships in the prototype that no document lists.

Three words, one condition

CS3 says SLATE ("shots without a render hold their time as slates · 4 slates · 0:27"). I coined STILLED on board and drew honest dashed gaps on cut, and PARTIAL names the same fact at block level. Recommendation: SLATE wins at member level — it ships, it is a film word, and it says "holds its time", which is the whole content of the state. STILLED retires; PARTIAL stays at block level and answers 2c: it survives video unchanged, because a partly-rendered film is exactly a film with slates in it.

The missing state is QUEUED

The prototype ships QUEUED · 2ND with "waits on 1.2's last frame" and a Move to front action, plus READY TO RENDER and a percent-with-ETA. Ruling 2b lists none of them. A queue is not a run — money is committed, nothing is happening, and there is an action. Video queues are long; this needs to be in the fixed list or it will be invented per-surface.

The running word — I agree, with one addition

Generating for provider work, Rendering for local composition, as recommended. The addition: they differ in more than the word. Generating has conditions to show and money at stake; Rendering has neither. So region 4 is present for one and absent for the other, and only Generating can be cancelled for a refund. If the two words ever collapse back into one, that distinction goes with them.

One canvas-scoped set — and one thing to keep from the views

Collapse to one canvas-scoped vocabulary during the cutover, as recommended. Keep exactly one thing the view-scoped keys had: failure carries a reason and a cost-truth — "rule breach · visible branding · not spent". A failure that does not say whether money went is a failure a person cannot act on, and my delivered FAILED chip has room for neither.

§6
What to argue with, and what I need

Three decisions here you may want to overrule

1. The quote is a region, not a row. Cheapest and most consistent, but it means a quote can never be seen without the block it belongs to — no "all outstanding quotes" surface except the app bar's sum.2. A proposal spanning existing blocks is refused rather than rendered. It keeps one home absolutely, and it does mean the Director cannot offer "re-render these three stale clips" as one judgement.3. STILLED retires in favour of CS3's SLATE. It is my word being dropped, and I think it should be.

Two things I need before implementation

Sound in scope. Phase 6 invalidates the delivered sound row whether or not the commission mentions it.One sentence in Ruling 1 saying canvas block order is nobody's to edit — not a person's, not the Director's. Runs depend on it, and nothing currently says it.

Two errors in the documents themselves

The rulings doc gates "question 4 of the commission"; the commission has three questions. And Ruling 2 is said not to gate the commission — but question 1 asks which statuses the quote can hold, which is Ruling 2's list. It gates a third of the commission.

No kind was added

Six kinds stand. Assembly is cut as delivered — "the film composition over other blocks, owning a timeline of references it does not contain" — and the quote is a region. What changed is one member attribute, eleven cells, and three words.
