# Creative Studio 3 — the References panel

> Designer handoff received 2026-08-26 night. Two files are committed beside the plan and are the
> authority for anything this document paraphrases:
>
> - **Handoff notes** — `docs/prds/creative-studio/creative-studio-3-references-panel-handoff.md`
>   (the designer's own README, verbatim)
> - **References Panel** — `docs/prds/creative-studio/creative-studio-3-references-panel.html.txt`,
>   sha256 `fd2c57db3656ddf1…89ba8ce8`
>
> Fidelity is **high** — colours, type, spacing, radii and copy are final unless design says
> otherwise — and the HTML is a reference to rebuild with WePrompt's components, not code to copy.
> The designer states it shares a design language with the beat panel composer handoff: *"same card
> shape, same status vocabulary, same accent. Build them as one family."*
>
> This document records what the handoff gets **right against the shipped model**, what **conflicts
> with engine limits**, and what has **no supported mutation** today.

## 1 · What this design gets right, and should not be second-guessed

Unusually for a handoff, several decisions here are already validated by run data from six real
projects. Recording them so nobody "corrects" them during implementation.

- **`contain`, not `cover`, on the picture band.** The README calls this out explicitly and gives the
  reason — references arrive in every aspect ratio, so the picture is matted whole onto the parchment
  ground. **This is the fix for BUG-138**, filed the same day after a 768×1376 portrait reference was
  cover-cropped into a landscape box so hard that the four figures in it were invisible. The
  designer's added instruction — *"never use a dark ground here, which reads as a void"* — is a real
  distinction: the mat must read as matting.
- **Generate appends a take and makes it current, rather than overwriting.** This is exactly the
  shipped model: `approvedAssetId` plus `supersededAssetIds`, with the newest generation becoming
  current. It also matches the owner's References ruling — newest is current, current is approved,
  no separate approval act — and the takes model settled for Shots in the First Frames rulings.
- **Characters before backgrounds.** The panel's intro sentence — *"Characters are generated first,
  then the backgrounds that recur"* — is not a stylistic preference; it is enforced.
  `estimate.ts:1095` refuses a background reference while any character reference lacks an
  `approvedAssetId`, returning `invalid_reference`. The design and the engine agree, which is worth
  saying because the error message does not explain the rule.
- **Three status words, one place.** `NO PHOTO` / `CURRENT SET` / `GENERATING` map cleanly to
  `approvedAssetId === null` / non-null / a running `reference_image` job.

## 2 · `Bind to all shots` cannot do what it says — this is the blocker

The panel's headline action *"pushes the current set to every shot"*, and is inert until every
reference has a photo. On the current engine that action is **impossible for most projects**.

The image route reports **`maxConditioningImages: 2`**, and that budget is counted across characters
**and** background together — the constraint behind BUG-134. Binding "the current set" therefore
overflows the moment a project holds three references.

**The evidence that matters is the design's own example**, not usage data: the prototype's progress
counter reads **`2 / 3 SET`** — three references — so the completion state the panel is built around
is already one where its primary action cannot legally run. That conflict is structural and holds
regardless of how many references a real project turns out to need.

For colour rather than proof, the projects on the owner's machine at the time of writing held 2, 2,
3, 3, 4 and 5 references. **These were same-day throwaway test projects, most of them created while
exercising the pipeline, and they are not evidence of production reference counts** — the owner has
said as much. They are recorded only to show that three-or-more is an easy shape to reach, not to
claim a rate.

**This needs a product decision, not an implementation.** Options, in the order they seem defensible:

1. **Bind per Shot, not per project** — a Shot takes the background plus the characters that appear
   in it, which is what the owner did by hand today (the two dinner Beats got cook + guests; the rest
   got cook + kitchen). This is the only option that scales past two references and it is what the
   binding editor already models.
2. **Bind the background plus one character** and let Shot-level editing add the rest — honest, but
   makes the headline button a partial action, which the copy would have to admit.
3. **Keep bind-all and gate it** on the project holding ≤ `maxConditioningImages` references —
   correct, but disables the button for most real projects and does not tell the user why.

Whatever is chosen, the button must **not** silently produce over-budget bindings: today that
surfaces later as a per-Shot error at the generation gate, far from the action that caused it.

## 3 · `+ Add character` has no supported mutation

The panel offers `+ Add character` and `+ Add place` symmetrically. Only one of them is supported.

`amend_reference_plan` — the operation that appends to an existing reference plan — rejects
non-background additions outright (`payloadSchemas.ts:429`):

    if (reference.kind !== 'background') {
      context.addIssue({ code: 'custom', message: 'only background references may be appended' });
    }

The only way to add a character to a planned project is `set_reference_plan`, which **replaces the
whole plan**. That is not an append, and doing it behind an innocuous `+ Add character` button would
put every existing character reference — and its takes — at risk.

This asymmetry is not accidental: BUG-122 was *"a project cannot add a newly discovered background
after approving its character references"*, and the fix added the background-only append. Characters
were left out. Adding one now is a schema-and-validation task, not a button.

**Recommended:** ship `+ Add place` (supported today) and either omit `+ Add character` or show it
disabled with the reason, until an append path for characters exists. Do not implement it via
`set_reference_plan`.

## 4 · Auto-named handles need a stable ordinal the store does not keep

The naming rule is `slug(name) + '-' + zeroPadded(index + 1)` → `@wren-01`, `@wren-02`, with handles
**derived, never stored**, so a rename re-slugs every photo immediately. That is a good rule and the
right storage decision.

The problem is *which* index. The design means creation order — *"the order it was made"*. The store
does not preserve it. `select_reference_image` (`mutations/index.ts:1366-1372`) does:

    const supersededAssetIds = reference.supersededAssetIds.filter((id) => id !== operation.assetId);
    if (reference.approvedAssetId !== null) supersededAssetIds.push(reference.approvedAssetId);

so the outgoing current is **pushed to the end**. The array records *recency of demotion*, not
creation. Takes made A, B, C give `superseded=[A,B], approved=C`; switching current to A gives
`superseded=[B,C], approved=A`. Any index derived from that ordering renumbers the photos **every
time the user switches current take** — which would silently repoint `@wren-02` in a prompt written
five minutes earlier.

**Fix: derive the ordinal from `asset.createdAt`**, which every asset carries and which no mutation
rewrites. Sort the take set by creation time and number from there; the handle for a given photo then
never changes except on rename, exactly as the design intends.

## 5 · The designer's open questions, answered where run data allows

The README raises three. Two can be answered now.

1. **Autocomplete on `@` in the shot prompt.** Not built, and worth scoping separately — the shot
   prompt is `shootingScript`, free text that is composed into the generation prompt. Note the
   constraint that matters: **naming a photo in a prompt does not make the engine use it.**
   Conditioning comes from the binding and the first frame, not from prose. If `@wren-02` is to
   genuinely select that image, it must resolve to a binding change, not a string in the prompt.
   Until then, the README's rule — *"a prompt that names a photo outright should win over the bound
   one"* — is aspirational and must not be stated in UI copy as though it works.
2. **Collision rule for duplicate names.** Refuse the duplicate at entry rather than suffixing.
   Reference labels are already required to be unique per kind by
   `studioV2ReferencePlanAdditionsSchema` (*"duplicate reference label"*), so refusing at entry
   matches an invariant that exists; `@wren-2-01` would invent a second naming scheme to work around
   a rule the schema already enforces.
3. **Persisted handles and renames.** Moot while handles are display-only. It becomes real the moment
   (1) ships — and the answer follows from §4: if handles derive from `createdAt` and prompts store a
   resolved reference rather than the literal string, a rename cannot break anything.

## 6 · Smaller notes

- **The take strip is real and exercised.** Four references across today's projects already hold two
  takes each, so the strip is not a hypothetical affordance.
- **`✕` on the picture "drops the current take"** — decide what becomes current afterwards. The store
  has no operation for deleting a take; `select_reference_image` only re-points. If removal is
  wanted, it needs a mutation, and the rule for a reference whose last take is removed
  (`approvedAssetId → null`, back to `NO PHOTO`) must be explicit.
- **`Generating` state** — a running `reference_image` job. The route reports no progress for images,
  so this is a determinate-free state; do not draw a percentage.
- **Panel width 1000px max**, narrower than the composer's 1320. Both sit inside the same Studio
  shell, so confirm the two panels agree about their container.

## 7 · What this does not change

Spend governance is untouched. `Generate`, `Generate another` and `Generate again` enter the existing
prepare/confirm quote path at 3 minor units per image. Naming, switching the current take, importing,
binding and editing a prompt are free. `Cancel run` must never spend.
