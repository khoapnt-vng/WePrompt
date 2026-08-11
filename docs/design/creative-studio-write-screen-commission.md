# Commission — draw Write, now that it makes pictures

**Date:** 2026-08-11 · **For:** the Creative Studio designer
**Why now:** Write is about to change from a text form into the place where the script and its images are made together. We would rather you drew that before we build it.
**Related:** [designer brief](creative-studio-designer-brief.md) · [Review commission](creative-studio-review-screen-commission.md) · [script-level v1 design](creative-studio-script-level-v1-design.md) · [brief conversation design](creative-studio-brief-conversation-design.md)

**Amendment, 2026-08-11 (after your first two frames):** we dropped the plate **approval** state. See the callout after §1 of "what changed" and the note under §1 of "what the screen has to hold" — both marked below. Nothing else in this commission changed.

## The ask

Draw **Brief and Write** as one working surface: a conversation with a single Creative Director agent, worked scene by scene, that produces the script **and one supporting image per scene**.

Four components are genuinely new. Everything else on the screen is copy and state changes to a table whose skeleton already works.

## What changed under it

Creative Studio is being re-conceived around one agent and four unchanged phases:

- **Brief + Write** — you talk to a Creative Director. It drafts beats and generates each scene's supporting image.
- **Produce** — every scene is **image-to-video**, with that supporting image as the clip's **first frame**.
- **Review** — unchanged. Your redraw stands.

Two consequences worth holding onto while you draw:

1. **A scene cannot be produced without an image.** There is one path through Produce, not two, and the image is the thing that keeps five separately-generated clips looking like one film. **Amended:** the image needs to *exist*, not to be separately approved by the user — see the note under §1 below. It still blocks Produce; it just isn't a state you design an approve action for.
2. **Scene state is now the legibility surface.** A scene moves through *written → plated → produced → selected*. This replaces an earlier idea (a crew of four named agents, each reporting separately) that we built, ran, and retired.

## What we learned by building it first

We ran a four-agent crew end-to-end twice against real briefs, so this commission is grounded in observed behaviour rather than a proposal:

- It produced a real 20-second script, five generated plates, and a rendered 1920×1080 `.mp4`.
- It took **~15 minutes**, of which image generation was **~12%**. The rest was coordination. That is why there is now one agent instead of four.
- **Three of five video jobs failed** on the first exercise of that route. Partial state is the normal case, not an exception.
- The crew twice **approved work that contradicted its own written spec** — a script inventing a URL that reached a finished asset, and plates that broke the style rules the same agent had written a minute earlier. Nobody opened the images. Whatever verification you draw has to put the artefact in front of a human, not just the document.

## What the screen has to hold

1. **The plate cell, in the VISUAL column.** `Add reference` already lives there, so it has a home. It needs states — *none · queued · generating · ready · failed* — and entry points to generate, import, replace and view large. This is the moment Write stops being text-only.

   **Amended — no separate "approved" state.** Your first pass added `✓ APPROVED` on the plate and a `NOT LOOKED AT` / "Waiting on your eyes" state that blocked Produce until the user had opened the image. Drop both. The reasoning was ours, not yours, and it doesn't hold up: the failure we were guarding against was an *agent* rubber-stamping images it never opened, and a human clicking "approved" on their own review doesn't add anything — they're already the one deciding to move on. What we actually need to protect is spend, since a bad plate becomes the first frame of a video that costs real money to generate. That belongs in Produce's pre-generation review, which has to show the plates themselves at a size worth judging — see the note under "what we are NOT asking for." Ready = the plate exists. Nothing more granular than that in Write.

2. **The conversation panel.** Today's *Writing assistant* rail is a description, a charge disclaimer and one dead button reading *"Storyboard drafting is currently unavailable."* It becomes the Director's conversation: message list, composer, streaming. It is the **same conversation as Brief** — the user should feel they are continuing a discussion, not starting one.

3. **The proposal diff card.** The Director never edits the script directly; it proposes, and the user accepts. A proposal replaces the whole script, so the card's job is to make that read as *"scene 3 changed"*. It needs a **stale state** — a proposal computed against an older version fails closed by design — with an honest recompute path, and it must refuse or flush when rows hold unsaved typing.

4. **The two-state OUTPUT cell.** Today it conflates output *type* with job *status*, and you can currently see it showing `Needs attention` for scenes whose clips failed. Each scene now has two independent states: its plate, and its clip. Getting this cell right is what makes *"5 scenes · 3 plated · 2 clips"* expressible anywhere else.

And three smaller things that fall out:

5. **The subtitle is about to be false.** Write currently says *"This step does not generate images or video."* It will generate images, and they cost money. New copy needs to be exact: images yes, video no.
6. **Duration has a floor.** The video route currently refuses anything under **4 seconds**. A 3-second beat is writable today and only fails much later, at Produce. The limit is readable from the route, so it can be enforced where the number is typed.
7. **Brief as an opening turn.** The landing *"What are we making?"* field already reads as a composer. It should start the conversation rather than fire a one-shot planner, and the shape presets become opening messages.

## Constraints that are real

- **Arco components; no raw interactive HTML.** Semantic tokens only — if a state needs a colour we do not have, name it and we will add a token.
- **Twelve locales**, both themes, keyboard parity.
- **Generating a plate spends money.** Any generate affordance leads to the existing batch approval, never straight to the provider.
- **A blocked scene needs a reason, not a disabled control.** "Needs an image before it can be produced" is the message — that's the only blocking condition; there is no separate "not yet approved" state.
- **The Brief/Write conversation is single-mount today** — prefill has one consumer and the message list uses global DOM ids, so Brief and Write cannot both render it at once. If your design needs it live in both, say so and we will fix the mount rather than have you design around it.
- **No undo exists and none is planned.** Recovery lives in copy and in the accept step.
- **No pricing is displayed anywhere**, and none is planned until an estimate we trust exists.

## What we are NOT asking for

- **Review.** Your redraw stands and this does not disturb it.
- **Produce**, beyond three things: each scene showing its plate as the visible source of its clip; partial state being first-class; and the pre-generation batch review showing every plate about to be spent on, at a size worth judging. That review is where the "did anyone actually look at this" concern from the amendment above gets addressed — once, at the moment money is spent, not per-plate in Write.
- The audio lane — still sprint 4. Generated clips arrive with their own audio and we intend to mute it on ingest.
- Anything about the retired crew, or about Teams.

## What we can show you

The app is running with a real project — *Ballistic Hero, 20s teaser* — carrying five scenes, five generated plates, two finished clips and three failed ones. It is a genuinely messy state rather than a happy path, which makes it the more useful thing to draw against. Say the word and we will get you a build.

If seeing it running changes what you would draw, the running version wins.
