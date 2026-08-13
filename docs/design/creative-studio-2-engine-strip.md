# The Engine Strip — Creative Studio media-engine selection

**Design specification, v1.** Branch of record: `feat/studio-three-pane` @ `87a998761` (HEAD read as `b507b4c81`, "docs(creative-studio): record engineering's response to the CS2 design handoff"). Every code claim below was re-verified against source in this worktree; where a proposal or a judge asserted something the source contradicts, I say so and correct it.

---

## 1. The verdict, and what I am overriding

**The winning shape is Proposal 1, "The Engine Bar, made live."** All three lenses independently named it strongest (9 / 9 / 9), so there is no winner to override. It wins because it is the only proposal where the diagnosis and the cure occupy the same pixel: the surface that tells you the video engine is unset is the surface that sets it, it is present rather than reached, and it is net deletion of routing code rather than net addition of a screen.

I am overriding four sub-judgments.

**Override 1 — P1's own mount list is wrong, and lens 1 found the hole.** P1 mounts in Produce and Write only. `defaultStudioPhase(sceneCount)` returns `'brief'` at `sceneCount === 0` (`studioPhaseRoute.ts`), so every brand-new project — the zero-binding onboarding case — opens on a screen P1's strip does not reach. I add a **third mount in Brief**, using the same compact variant as Write. This costs one `Pick` widening (`BriefPhaseController` currently omits `models` and `openModelSettings`, `PhaseShell/types.ts`) and no new component.

**Override 2 — lens 3 scored P3 (money gate) at 6, above P2 and P4, on buildability.** I discard P3's shape anyway. Lens 2 is right that it inverts the rule it is built on: the only way to change a free setting becomes opening a charge dialog and cancelling it, and its own ambient signpost reads "choose it when you render," which restates the incident as the fix. Cheapness does not rescue a surface whose entry condition is a spend intent. P3's _findings_ are grafted in full; its placement is rejected.

**Override 3 — P2 and P4 both spend design on aspect-ratio-change orphaning, and lens 2 correctly called it over-investment. I go further and cut the gesture-time confirm dialog entirely.** `aspectLocked` fires as soon as any asset or active job exists (`BriefPhase.tsx`), and resolution has no editor anywhere in the renderer — it is set once at project creation. So the "you changed the frame and left your engine behind" path is only reachable on a project that has generated nothing, which is precisely the project where nothing is lost. I keep one reactive sentence for the state and spend no modal on it.

**Override 4 — P4's `catalogVersion` claim is false and P3's is true; I build on P3's.** Verified at `creativeStudioService.ts:1040-1052`: the hash covers `storyboardOptions` (providerId/providerName/model/health) plus `[...imageOptions, ...videoOptions]`. The _selection_ is not in it. So a selection write does not move `catalogVersion` and does not invalidate the submission token checked at `:1915`. The review lock in this design is justified by `project.revision` alone, not by the catalog hash.

The design's name changes from "Engine Bar" to **Engine Strip**, because `EngineBar` is the read-only thing being replaced and the two must not be confused in review.

---

## 2. What was grafted, and from where

**From Proposal 2 (Brief block):**

- The **coherence readout** as a named, project-level fact — "Coherence: on — each clip continues from the one before it." This is the single best piece of copy in the whole set, and it is the only place `supports_first_frame` gets a product noun instead of a capability tag. I keep it in the full (Produce/Board) variant only; the compact mounts stay silent when healthy.
- The **role hints that state the coupling rather than the media kind**: "Makes the stills, and the first frame of every clip" / "Makes the clips, starting from those stills." A user who reads only the labels learns that both are required.
- The **third coherence-off reason** nobody else would have found: an Images-API image model gets `supportsFirstFrame = !isImagesApiModel(model)` and a gateway binding that omits the field defaults false, so the chain can break at the _still_, not only at the clip.
- **Refresh on mount, on window focus, and on return from Settings** — verified load-bearing, see §9.

**From Proposal 3 (money gate):**

- The **`catalogVersion` finding** (options-only hash), which is what makes the review lock cheap and correctly reasoned.
- The **enable/disable rule for the Render control**: distinguish "a live remedy exists" from "nothing available could help." I apply it to which _action_ the reason offers, not to whether the button is enabled.
- The **`errors.staleProject` trap**: the stale branch sets that copy before rebuilding, so any engine write must not borrow it. See `models.engine.saveStale`.

**From Proposal 4 (Engines Room):**

- The **S1–S8 per-shot reason table**, including the two states that offer **no action at all**, and the discipline of writing **no copy** for the `kind` and `sceneId` branches of `routeSupportsScene` because they are provably inert on the per-shot path (`ShotGrid` supplies only `durationSeconds` and `hasReference`).
- The **duration-bounds intersection**, which is strictly better than P1's "disclose the fallback": when no route resolves but options exist, derive `[min,max]` from the intersection of that role's available options and label it as such, instead of silently widening to the 1–60s storage bounds.
- **`resolveShotEngine(project, shot)`** as the one door kept open for a future per-section scope, plus the **falsifiable exit criterion** for reopening that question.
- The **stale-Director notice** after a committed engine change.
- The **`saveStale` wording**, which is the best of the four.

**From all four:** `integrationLabel` on the renderer route projection; a reason-returning sibling to `routeSupportsScene`; keep the dangling reference and name the dead engine; render the Render control disabled rather than omitting it; the Library badge; retire the word "route" from user-facing copy.

---

## 3. What is discarded, and why

**Proposal 2's placement — Brief as the canonical and only writer.** Disqualified by lens 2 on shell survival: CS2's shell is Table / Board / Cut and Brief is not one of the three, and the three-pane record already calls Brief's work panel "explicitly provisional." Lens 3 found a second reason nobody else saw: Brief is a _draft_ surface, and every engine write passes `beforeMutation`, which flushes the project draft and all scene drafts and returns false unless everything lands clean — so a picker inches from the brief textarea would force-save prose mid-sentence and silently refuse the write when a flush fails. Brief keeps a mount in this design, but it is one of three, not the home.

**Proposal 3's placement — selection inside `GenerationReviewModal`.** Disqualified twice by lens 2: it makes the spend dialog the only route to a free decision, and it moves the disclosure _into_ the run. Lens 3 added a third, unspotted cost: because the write goes through `beforeMutation`, "Cancel keeps your engine choice" also means cancelling a spend dialog can leave the project saved and its revision bumped, from a gesture the user experienced as backing out. A mutation performed inside a consent surface with a side effect the consent surface disowns is not shippable.

**Proposal 4's placement — a new `/studio/:id/engines` route.** Disqualified by lens 1 and lens 3. Verified: `Router.tsx` declares one studio route `'/studio/:id/:phase?'`, `parseStudioPhase` returns null for `'engines'`, and `StudioPage`'s effect then `navigate(..., {replace:true})` away — so all five of P4's deep links bounce today. The two fixes are both bad: adding `'engines'` to `STUDIO_PHASES` lands a bogus fifth step in `StudioPhaseNav` and poisons `rememberStudioPhase`; or a separate page owning its own fetch, flush, models hook and header. P4 also asserted a route mount is "the only thing that reliably re-runs `listRoutes`" — false; `models.refresh()` is already exported from `useStudioModels` and callable from anywhere, which is exactly what this design does.

**P4's always-visible chip, including in the healthy state.** A permanent toolbar element for a decision made once per project, in the same activity cluster as the save chip and `StudioDocumentActivity`, in a frame that had just been trimmed. Lens 2 named the rule and P4 broke it deliberately. Not adopted in any form — the strip is present in the work area, and the header stays as it is.

**Per-section and per-clip engine scope.** Refused. See answer (e). `ROUTING_KEYS` is an exact three-key set (`store.ts:76`, enforced at `:991`) and `grep -ci section` is zero in both `creativeStudioTypes.ts` and `store.ts`, so per-section is a schema migration before it is a UI decision — and it is a chain-break control wearing an engine-picker costume.

**Reviving `GenerationControls`' component body.** Verified: it contains no `Select`, no option list, no choice affordance. It is a reviewer with a Refresh button. Its helpers are live and stay; the body and its test are deleted. All four proposals got this right and it deserves recording, because "wire up the dead picker" is the first thing any reader will propose.

**The frame-change confirm dialog** (P2 and P4). See override 3.

---

## 4. Placement

### The component

`EngineBar.tsx` is promoted out of `components/PhaseShell/phases/produce/` — it stops being Produce-private — into a studio-level directory:

```
components/EngineStrip/
  EngineStrip.tsx        the section, the pair verdict line, the two slots
  EngineSlot.tsx         one role: trigger, summary, menu, states
  engineSlots.ts         getProjectEngineSlots(catalog, project)
  engineStrip.module.css
  index.ts
```

`getReadySelectedRoutes(catalog)` is **replaced** by `getProjectEngineSlots(catalog, project)`, which returns **both roles unconditionally** as `{ role, status, selectedRoute, options, chainCapable, blockReason }`. The whole class of bug this design exists to fix lives in the filter it deletes: `getReadySelectedRoutes` keeps only roles whose `status === 'ready'`, and `ProducePhase` early-returns `ConnectEngineCard` only when that list is empty — so **(image ready, video ambiguous), the actual production incident, renders today as a completely healthy Produce phase with a strip that reads "Engines: image."**

`components/Models/StudioModelBar.tsx` is **deleted**. Its entire body is `const routes = getReadySelectedRoutes(catalog); if (routes.length === 0) return null;` — it exists only to implement the hide-when-nothing-is-ready rule this design abolishes.

### Three mounts, one component

**Mount 1 — Produce (today) / Board (CS2). `variant="full"`, `ownsPhaseHeading={true}`.** Rendered by `ProducePhase` at the top of the phase, **always**, replacing both the `<StudioModelBar>` line and the `readyRoutes.length === 0` early return. Structural win: `data-studio-phase-heading` currently lives in two mutually exclusive components (`EngineBar.tsx:74` and `ConnectEngineCard.tsx:34`), and `StudioPhaseShell` focuses that attribute on every phase transition. An unconditional strip means one heading, always mounted, and the focus target can never land on nothing.

**Mount 2 — Write (today) / Table (CS2). `variant="compact"`, `ownsPhaseHeading={false}`.** Above the script table. This is where the block first bites and it is not optional: `resolveSceneDurationBounds` returns `source: 'fallback'` with 1–60s whenever no route resolves, and `WritePhase` consumes the bounds and never the source — so a user can author a 3s clip that a 4s-floor engine will never accept, and nothing anywhere says so.

**Mount 3 — Brief. `variant="compact"`, `ownsPhaseHeading={false}`.** Below the existing `constraintsRow` (Target duration, Aspect ratio), above the "Start writing" footer. Rationale: brand-new projects open here, and engine and frame are the _same predicate_ — `routeSupportsProject` filters on exactly `project.aspectRatio` and `project.resolution`. Brief is a mount, not the home, so if CS2 drops Brief the strip loses one of three surfaces and nothing else.

**Not mounted in:** Review / Cut (consumes no engine — Cut is local ffmpeg); the top bar (CS2's one-money-control-plus-view-switch budget stands, and the header's activity cluster stays as it is); the money gate; Settings.

**Reached how:** by nothing. It is not reached; it is present. Zero clicks to see state, one to open, two to change.

### Downstream placement changes

`ConnectEngineCard` is **demoted** from full-phase takeover to an inline empty state _inside the grid region_, rendered only when **both** roles have zero options. Its heading loses `data-studio-phase-heading`. Its `askTeammateCopy` is rewritten, because today it asks a colleague to add a binding — which in the ambiguous case makes the problem strictly worse.

`GenerationReviewModal` keeps its shape exactly. Its refusal gets specific and gains one secondary button that **closes** and moves focus. No picker inside it, ever.

The Library card gains a badge reusing `library.readinessSetupRequired`.

---

## 5. States

Legend: `[ text ▾ ]` = Arco Dropdown over a text-styled Button (`styles.engineTrigger`, unchanged). `(!)` warning tone, `(x)` error tone, `(i)` neutral tone. `«…»` visually hidden.

### State A — chosen, both live, chain intact (full variant)

```
«h2 data-studio-phase-heading tabIndex=-1: Rendering with —»
┌──────────────────────────────────────────────────────────────────────────┐
│ Engines                                Used by every shot in this project│
│   ┌ Image ─────────────────────┐   ┌ Video ────────────────────────────┐ │
│   │ [ gemini-3-pro-image    ▾ ]│   │ [ seedance-1-0-pro            ▾ ]│ │
│   │ 1080p · Starts from a frame│   │ 720p · 4–12s · Silent ·          │ │
│   │                            │   │ Starts from a frame              │ │
│   └────────────────────────────┘   └──────────────────────────────────┘ │
│ Coherence: on — each clip continues from the one before it.              │
└──────────────────────────────────────────────────────────────────────────┘
Shot cards below: Render present on every eligible shot.
```

No status word, no icon, no warning. In the compact variant this state renders as one line — the two triggers and nothing else.

### State B — ambiguous: two video engines bound, none chosen. **The reported bug.**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Engines                                Used by every shot in this project│
│ (!) Set a video engine too — no clip can be made without one.            │
│   ┌ Image ─────────────────────┐   ┌ Video ────────────────────────────┐ │
│   │ [ gemini-3-pro-image    ▾ ]│   │ (!)[ No video engine is set.  ▾ ]│ │
│   │ 1080p · Starts from a frame│   │ Not set · 3 available            │ │
│   └────────────────────────────┘   └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘

Video shot cards:  [ Render ] (disabled, aria-describedby →)
                   (!) No engine is set for this kind of shot.
                       [ Set engines ]

Batch button:      Generate 4 ready shots
                   2 shots are not here — no video engine is set.
```

Menu open (one click on the Video slot):

```
   ┌ Video ───────────────────────────────────────────────────────────┐
   │ (!) [ No video engine is set.                                 ▴ ]│
   ├──────────────────────────────────────────────────────────────────┤
   │ ○ seedance-1-0-pro · BytePlus · Seedance                         │ ← focus
   │   720p · 4–12s · Silent · Starts from a frame                    │
   │ ○ seedance-1-0-pro · BytePlus · Self-hosted video gateway        │
   │   1080p · 5–10s · Silent · Cannot start from a frame             │
   │ ○ veo-3 · Google · OpenRouter video          (i) Not verified yet│
   │   1080p · 4–8s · With sound · Starts from a frame                │
   ├──────────────────────────────────────────────────────────────────┤
   │ Refresh engine list                                              │
   │ Manage engines in Model settings                              ↗  │
   └──────────────────────────────────────────────────────────────────┘
```

Rows 1 and 2 are the same `providerId` + `model` bound under two of the three video adapters. `createStudioMediaChoiceId` hashes `adapterId`, so they carry distinct `choiceId`s and genuinely different capabilities — but `toRendererRoute` strips `adapterId`, so **without the integration-label change they render as two identical rows and this menu is unusable.** That is the reported bug one layer down, and it is why the contract change in §9 is blocking rather than cosmetic.

While refreshing, the option area is replaced by one row: "Checking engines…"

### State C — exactly one option, not yet chosen. Pre-armed, never pre-written.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Engines                                Used by every shot in this project│
│ (!) No engines are set. Nothing can be rendered yet.                     │
│   ┌ Image ─────────────────────┐   ┌ Video ────────────────────────────┐ │
│   │ (!)[ gemini-3-pro-image ▾ ]│   │ (!)[ seedance-1-0-pro         ▾ ]│ │
│   │ Not set · 1 available      │   │ Not set · 1 available            │ │
│   └────────────────────────────┘   └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

The engine's name is shown greyed with "Not set" adjacent — the slot says what it _would_ be, not what it is. The trigger is styled as the phase's suggested next action. Opening the menu focuses the single row, so Enter commits. Two clicks for a fresh project, once, ever. Nothing is written until then.

### State D — no route at all (`options.length === 0` for the role)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Engines                                Used by every shot in this project│
│ (!) Set a video engine too — no clip can be made without one.            │
│   ┌ Image ─────────────────────┐   ┌ Video ────────────────────────────┐ │
│   │ [ gemini-3-pro-image    ▾ ]│   │ (!) No video engine fits this     │ │
│   │ 1080p · Starts from a frame│   │     project.                     │ │
│   │                            │   │ Connect one, or check it supports│ │
│   │                            │   │ 16:9 at 1080p.                   │ │
│   │                            │   │ [ Manage engines ↗ ]             │ │
│   └────────────────────────────┘   └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

No dropdown — there is nothing to drop down. The second sentence is deliberately written to be true whether zero bindings exist **or** `routeSupportsProject` filtered them all out on health, silent output, aspect ratio or resolution. Main discards the rejection reason, so the UI must not claim to know which. Today's "Connect an engine — about a minute, once for the whole workspace" is a flat lie at a user who has three engines connected and working.

Both roles empty — the **grid region only** is replaced, never the phase:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Engines   [ …strip as above, both slots in state D… ]                    │
├──────────────────────────────────────────────────────────────────────────┤
│      Connect an engine — about a minute, once for the whole workspace     │
│      [ Open Model settings ]   [ Ask a teammate ]                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### State E — invalid / dangling (`routing[role]` set, `selectedRoute === null`)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Engines                                Used by every shot in this project│
│ (x) Set a video engine too — no clip can be made without one.            │
│   ┌ Image ─────────────────────┐   ┌ Video ────────────────────────────┐ │
│   │ [ gemini-3-pro-image    ▾ ]│   │ (x)[ seedance-1-0-lite        ▾ ]│ │
│   │ 1080p · Starts from a frame│   │ seedance-1-0-lite is no longer   │ │
│   │                            │   │ available. Choose another engine.│ │
│   └────────────────────────────┘   └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

The dead engine keeps its **name**. The dangling ref in `project.json` is not cleared and not auto-replaced, even when exactly one option survives. Opening the menu lists the survivors under a header row: "Replacing seedance-1-0-lite".

Five causes, five sentences, and two of them offer **no action at all**:

| cause                                              | slot copy                                                                                                          | action                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| binding removed / model retired                    | "seedance-1-0-lite is no longer available." + "Choose another engine."                                             | menu                   |
| provider unconfigured                              | "BytePlus has no usable credential in this workspace." + "Add one in Model settings, or ask whoever manages them." | `[ Manage engines ↗ ]` |
| health `unavailable`                               | "seedance-1-0-pro is not answering. Wait, or choose another engine."                                               | **none**               |
| capability narrowed on revalidation                | "This engine no longer starts from a frame."                                                                       | menu                   |
| project frame no longer supported                  | "seedance-1-0-pro cannot make 9:16 at 1080p."                                                                      | menu                   |
| catalog fault (`catalog === null` / empty version) | "(i) The engine list has not loaded yet."                                                                          | **none**, neutral tone |

The two no-action states are the load-bearing part. Offering "Open Model settings" for a health flip or a catalog fault sends the user to a screen that cannot help them, and dresses a system fault as their problem.

### State F — capability-unsupported: role is `ready`, no `supports_first_frame`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Engines                                Used by every shot in this project│
│   ┌ Image ─────────────────────┐   ┌ Video ────────────────────────────┐ │
│   │ [ gemini-3-pro-image    ▾ ]│   │ [ seedance-lite               ▾ ]│ │
│   │ 1080p · Starts from a frame│   │ 720p · 5–10s · Silent ·          │ │
│   │                            │   │ Cannot start from a frame        │ │
│   └────────────────────────────┘   └──────────────────────────────────┘ │
│ (!) Coherence: off — this video engine cannot start from a frame.        │
│     Each clip will start fresh instead of continuing from the one before.│
└──────────────────────────────────────────────────────────────────────────┘

Only shots that carry a reference lose their action:
  [ Render ] (disabled)
  (!) This engine cannot start from a reference image.
      [ Remove the reference ]   [ Set engines ]
```

Nothing is blocked at project level — the engine is healthy and a user may legitimately want independent clips. The line is persistent and non-dismissable, because the alternative is a silently uncoherent film. Today that same shot reads "This route is no longer valid. Review it before generating," which is a false statement about a working engine. Deleting that lie is the highest-value copy change in this spec.

Symmetric image variant, same weight, same slot position:

```
│ (!) Coherence: off — this image engine cannot take reference images, so  │
│     the cast and look cannot carry into the still.                       │
```

### State G — writing (single-flight)

```
│   ┌ Image ─────────────────────┐   ┌ Video ────────────────────────────┐ │
│   │ [ gemini-3-pro-image    ▾ ]│   │ [ Saving…                      ⟳]│ │
│   │ Saving the other engine…   │   │                                  │ │
│   │ (trigger disabled)         │   │ (trigger disabled, aria-busy)    │ │
│   └────────────────────────────┘   └──────────────────────────────────┘ │
```

`updateSelection` refuses while `pendingRoleRef !== null`, so the other slot's trigger is disabled for the duration. There is **no Apply button**, so there is never a partial-success state to model: two independent atomic writes, each with its own CAS. Failure renders a `role="alert"` line under the strip, with three distinct causes:

- generic refusal → "That engine could not be set. Try again."
- `beforeMutation` returned false (a draft could not flush) → "Your unsaved changes could not be saved, so the engine was not set."
- `stale_project` → "The project changed while you were choosing. Your engines have been reloaded — check them and try again." — this must **not** reuse the existing `errors.staleProject` copy, which describes someone else changing the project.

The renderer never applies an optimistic value. The slot only ever shows what main confirmed.

Draft interaction, specified rather than left to chance: opening the dropdown moves focus off any editor, which triggers the existing blur-flush, so by the time the write fires the draft is normally clean. There is **no pre-emptive disable while dirty** — the failure is real but rare, and it gets its own honest sentence above rather than a permanently greyed control.

### State H — locked (money gate open)

```
│   Both slots disabled. Tooltip / aria-describedby:                       │
│   "Finish or cancel the render review first."                            │
```

Justified by `project.revision` only: a route write bumps it, and `confirmGeneration` compares `generationReview.projectRevision`. `catalogVersion` is _not_ affected by a selection write, so this lock is about not invalidating the review the user is reading, nothing more.

### State I — compact variant (Write / Table and Brief)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Engines  [ gemini-3-pro-image ▾ ]  (!)[ No video engine is set. ▾ ]      │
│          4–12s — the range the available engines share.                  │
└──────────────────────────────────────────────────────────────────────────┘
   Shot 03  │ …visual prompt…                     │ Duration [ 3s ▾ ]     │
```

The second line appears only when `resolveSceneDurationBounds` returns `source: 'fallback'`. Two forms, and this is the graft from P4 that improves on P1: when options exist for the role, show the **intersection** of their bounds — "4–12s — the range the available engines share." When no options exist at all, say so — "Shot lengths are not limited by any engine yet." Never silently widen to 1–60s and never present storage bounds as if an engine set them.

No `data-studio-phase-heading` in this variant. Exactly one mount per phase render may own it, and a guard test must assert that.

### State J — the money gate

```
┌ Review generation ──────────────────────────────────────────────────────┐
│ 6 selected shots · 42 requested video seconds                            │
│ Aspect ratio 16:9      Resolution 1080p                                  │
│ Shot 01  Video · 8s · Provider BytePlus · Model seedance-1-0-pro         │
│ …                                                                        │
│ Watermark disabled                                                       │
│ Silent output; audio generation disabled                                 │
│ 2 shots are not in this render — this engine cannot start from a frame.  │
│ Generation uses your selected provider account and may incur provider    │
│ charges.                                                                 │
│ (x) 2 shots have no engine. Close this to set one.                       │
│                   [ Cancel ]  [ Close and set engines ]  [ Confirm and   │
│                                                            generate ]    │
└──────────────────────────────────────────────────────────────────────────┘
```

"Close and set engines" closes the modal and moves focus to the offending role's slot. Selection is never performed inside the gate.

### Library card

```
┌ Coffee launch ───────────────┐
│  [thumbnail]                 │
│  8 shots · 42s               │
│  (!) Engine setup required   │
└──────────────────────────────┘
```

Shown when either media role is not `ready`.

---

## 6. Copy

All new copy nests under **existing** i18n groups, so the top-level group set does not grow. `studioI18n.test.ts:383` asserts the exact group set against `plannedGroups`; this design **shrinks** it by one (`routing` is deleted). Strings marked **[FS]** are full sentences and must be added to `streamFullSentenceKeys`, which forbids leaving them as English in any locale.

### `conversation.creativeStudio.models.engine.*`

```
label                = "Engines"
scope                = "Used by every shot in this project."                                  [FS]
roleImage            = "Image"
roleVideo            = "Video"
roleImageHint        = "Makes the stills, and the first frame of every clip."                  [FS]
roleVideoHint        = "Makes the clips, starting from those stills."                          [FS]

optionLabel          = "{{model}} · {{provider}} · {{integration}}"
summary              = "{{resolution}} · {{duration}} · {{audio}} · {{frame}}"
durationRange        = "{{min}}–{{max}}s"
frameYes             = "Starts from a frame"
frameNo              = "Cannot start from a frame"
audioSilent          = "Silent"
audioOn              = "With sound"
unverified           = "Not verified yet"

notSetImage          = "No image engine is set."
notSetVideo          = "No video engine is set."
notSetCount          = "Not set · {{count}} available"
notSetCount_one      = "Not set · 1 available"
notSetCount_other    = "Not set · {{count}} available"

noFitImage           = "No image engine fits this project."
noFitVideo           = "No video engine fits this project."
noFitHint            = "Connect one, or check it supports {{ratio}} at {{resolution}}."        [FS]

pairNeedImage        = "Set an image engine too — first frames and stills need one."           [FS]
pairNeedVideo        = "Set a video engine too — no clip can be made without one."             [FS]
pairNeither          = "No engines are set. Nothing can be rendered yet."                      [FS]

coherenceOn          = "Coherence: on — each clip continues from the one before it."           [FS]
coherenceOffVideo    = "Coherence: off — this video engine cannot start from a frame. Each clip
                        will start fresh instead of continuing from the one before."            [FS]
coherenceOffImage    = "Coherence: off — this image engine cannot take reference images, so the
                        cast and look cannot carry into the still."                              [FS]

retired              = "{{model}} is no longer available."
retiredAction        = "Choose another engine."
replacing            = "Replacing {{model}}"
needsSetup           = "{{provider}} has no usable credential in this workspace."
needsSetupHint       = "Add one in Model settings, or ask whoever manages them."               [FS]
notAnswering         = "{{model}} is not answering. Wait, or choose another engine."           [FS]
capabilityLost       = "This engine no longer starts from a frame."                            [FS]
frameMismatch        = "{{model}} cannot make {{ratio}} at {{resolution}}."
catalogUnloaded      = "The engine list has not loaded yet."                                   [FS]

refresh              = "Refresh engine list"
refreshing           = "Checking engines…"
manage               = "Manage engines in Model settings"
manageShort          = "Manage engines"

saving               = "Saving…"
savingOther          = "Saving the other engine…"
saveFailed           = "That engine could not be set. Try again."                              [FS]
saveBlocked          = "Your unsaved changes could not be saved, so the engine was not set."   [FS]
saveStale            = "The project changed while you were choosing. Your engines have been
                        reloaded — check them and try again."                                   [FS]
lockedDuringReview   = "Finish or cancel the render review first."                             [FS]

boundsFromEngine     = "{{min}}–{{max}}s — set by {{model}}."
boundsFromOptions    = "{{min}}–{{max}}s — the range the available engines share."             [FS]
boundsUnbounded      = "Shot lengths are not limited by any engine yet."                       [FS]

directorStale        = "Your assistant was briefed with the previous engine's limits. It may
                        suggest shot lengths {{model}} cannot make."                            [FS]
directorStaleAction  = "Start a new brief"
```

### `conversation.creativeStudio.models.blocked.*` — one sentence per reachable cause

```
noEngine             = "No engine is set for this kind of shot."                               [FS]
needsSetup           = "The engine for this kind of shot needs setup."                         [FS]
notAnswering         = "The engine is not answering."                                          [FS]
retired              = "The engine set for this shot no longer exists."                        [FS]
frame                = "This engine cannot make {{ratio}} at {{resolution}}."
duration             = "This engine cannot make a shot {{seconds}}s long."
firstFrame           = "This engine cannot start from a reference image."                      [FS]
catalogUnloaded      = "The engine list has not loaded yet."                                   [FS]
aria                 = "Cannot render. {{reason}}"
actionSetEngines     = "Set engines"
actionRemoveReference= "Remove the reference"
actionShorten        = "Shorten this shot"
```

No copy is written for the `kind` or `sceneId` branches of `routeSupportsScene`. `ShotGrid` supplies only `durationSeconds` and `hasReference`, and `kind` is pre-filtered — sentences for those branches would describe states no user can reach.

### Rewrites and deletions

```
REWRITE review.disabledMissingRoutes  = "{{count}} shots have no engine. Close this to set one."   [FS]
NEW     review.setEngines             = "Close and set engines"
NEW     review.excludedFirstFrame     = "{{count}} shots are not in this render — this engine
                                         cannot start from a frame."                                [FS]
NEW     phase.produce.batchExcluded       = "{{count}} shots are not here — {{reason}}"
NEW     phase.produce.batchExcluded_one   = "1 shot is not here — {{reason}}"
REWRITE phase.produce.askTeammateCopy = "Could you connect an image and a video engine in
                                         WePrompt Model settings for this workspace?"               [FS]
REWORD  library.readinessSetupRequired = "Engine setup required"
RENAME  settings › "Creative Studio media models" → "Creative Studio engines"

DELETE  phase.produce.changeEngines   — promised selection, delivered binding management
DELETE  phase.produce.engineKinds     — the strip names models now, not kinds
DELETE  phase.produce.engineSummary   — superseded by models.engine.summary
DELETE  review.missingRoute, review.invalidRoute — replaced by the specific refusal line
DELETE  the whole `routing` group (title, modelLabel, missingRoute, invalidRoute) — dies with
        GenerationControls' body; remove 'routing' from plannedGroups
```

**Vocabulary ruling, and it lands first, before any of the copy above.** **ENGINE** is the user-facing concept; **MODEL** is the model's name inside an engine (`gemini-3-pro-image`); **ROUTE** is retired from every user-facing string. "Route" is a store key that leaked into the UI, and four of its eight user-facing strings describe failure, which poisons the word. This is roughly 13 pre-existing strings across 12 locales plus an `i18n-keys.d.ts` regen — one morning. It must **not** be bundled with the much larger scene/shot/clip rename (71 of 437 English Studio strings say "scene"); that is its own slice.

Volume: ~57 new keys, 10 deleted, across 12 locales ≈ 680 translated strings. `studioI18n.test.ts` caps English-copied leaves at `max(4, 5% of keys)`, so machine-copying English **fails the gate**. Translation is a first-order build cost, not a tail task.

---

## 7. Answers to a–h

**(a) Where does a user choose between two video engines?** In the Video slot of the Engine Strip, in place, without leaving the phase. The slot's trigger is an Arco Dropdown wrapping the existing text Button; its menu lists `catalog.video.options`, one row per option, each labelled `{model} · {provider} · {integration}` with a second line `{resolution} · {min}–{max}s · {audio} · {frame}`. Choosing a row calls `studioModels.updateSelection({ role: 'video', selection: { choiceId } })` — the same CAS command auto-adoption already uses, so no new IPC and no new write path. Four mechanics are load-bearing: opening the menu awaits `models.refresh()` first (the catalog is otherwise frozen for the life of the mount, see §9); the integration label must reach the renderer or the menu shows identical rows; single-flight is visible as a disabled sibling trigger; and both slots lock while a render review is open. Settings remains reachable from the menu footer, demoted from cure to overflow. The "Change engines" button is deleted — it promised selection and delivered binding management, which is the naming trap at the centre of this bug.

**(b) One control or two?** **Two slots, one strip, one joint verdict line.** Two slots because they are two independent writes over a single-flight IPC, with two independent statuses computed per role in main and two independent failure reasons; collapsing them forces an Apply button, which forces a partial-success state nobody can render honestly. One strip with a joint verdict because the pair is the project's precondition, not two settings: a still on the image route becomes clip 1's `first_frame`, and every later clip takes the previous clip's last frame. This is already true before CS2 — `creativeStudioOutputRole.ts` routes a reference plate to the **image** route regardless of the scene's own media kind, so a video-only project already needs a live image engine the moment the Director queues a reference. The verdict line is the fix for the mixed-role blind spot: (image ready, video ambiguous) currently renders as a healthy project.

**(c) What does the no-route state say, and where?** "No video engine is set." on the slot, warning tone, with "Not set · 3 available" beneath, and the joint-verdict line above when the pair is affected. When the option list is genuinely empty, "No video engine fits this project." with "Connect one, or check it supports 16:9 at 1080p." It appears on **four** surfaces, in the order a user meets them: Brief and Write/Table first (earliest, and where duration is typed); Produce/Board unconditionally; the disabled Render control on each affected shot, carrying its own reason as visible text _and_ as its accessible description; and the Library card before the project is even opened. It must **not** offer "Open Model settings" in the two states where Settings cannot help — health flip, catalog fault. Those show the fact and no action.

**(d) Does sole-route auto-adoption survive?** No. See §8.

**(e) Per-project, per-section, or per-clip?** **Per project.** `routing` stays `{ storyboard, image, video }`. Three reasons in order of force. First, correctness: CS2's chain passes clip N's last frame into clip N+1 as `first_frame`, so a section boundary that is also an engine boundary is exactly where the chain breaks — a per-section engine is a chain-break control wearing an engine-picker costume, and shipping it before an explicit chain-break control ships a coherence bug with a UI on it. Second, it is a schema change, not a UI decision: `ROUTING_KEYS` is an exact key set enforced by `hasExactKeys`, unknown keys are rejected outright, and there is no `section` anywhere in the store or the type module — so this is two migrations at once, in a codebase with a documented silent-skip failure mode. Third, the Table's duration column would mean different things in different rows, and the Director's route catalog is a single frozen JSON snapshot in the MCP subprocess env, so per-section bounds are unanswerable to the one consumer that is told to trust them. The motivating use case — a stylised opener — is a _look_ problem, solvable with a different look reference on the same engine, which preserves the chain. The one thing an override would uniquely buy is cost arbitrage, and that is inexpressible: `StudioRouteCatalogEntry` carries no price, tier or credit estimate anywhere.

Three near-free moves keep the door open. `resolveShotEngine(project, shot)` behind every read, whose body today is `project.routing[shot.mediaKind]` — I verified there are exactly **four** read sites, at `StudioPage.tsx:137`, `studioRouteConstraints.ts:27`, and `GenerationControls.tsx:121` and `:159`. Correcting one proposal's claim: **all four are live.** The two in `GenerationControls` sit inside `resolvePersistedRoute` and `buildSingleSceneReviewRequest`, both exported and both imported by `ProducePhase` and `ShotGrid`. Second, the scope line "Used by every shot in this project," so a later override adds a second line to a place users already read. Third, the per-shot reason slot already exists and is where an override would later live — no new column.

Reopen the question only when all three hold: sections exist as versioned persisted records; an explicit chain-break control exists and is understood; and either the catalog carries cost, or reports show users wanting two video engines for a reason a look reference cannot serve.

**(f) How does capability honesty surface?** `supports_first_frame` gets a vocabulary in three places, and the enforcement gets a reason type. **Before choosing:** every option row carries the fact as a positive or a negative, never as an absence — "Starts from a frame" / "Cannot start from a frame" — beside resolution, `[min,max]` seconds and silent-vs-sound. A user comparing two video engines sees the coherence difference at the only moment it is cheap. **After choosing:** the slot's summary repeats it, and the pair line becomes "Coherence: off — this video engine cannot start from a frame." persistent and non-dismissable. **Per shot:** only shots that actually carry a reference lose their action, with "This engine cannot start from a reference image." and two remedies. This is not video-only: `providerResolver` sets `supportsFirstFrame = !isImagesApiModel(model)` for image routes and a gateway binding that omits the field defaults to false, so the chain can break at the still. Same words, image slot.

`silentOutput` is shown as **information only** and never disables a row — `routeSupport.ts` documents that main is the security boundary and duplicating the gate in the renderer would wrongly hide legitimate audio-capable OpenRouter routes. `health: 'unknown'` routes are offered, tagged "Not verified yet", never hidden; only `'unavailable'` is filtered. **Cost is not shown**, because nothing in the catalog knows it and a rank or estimate would be fabricated.

**(g) What happens when a chosen route becomes invalid?** The slot goes to error tone, **keeps the dead engine's name**, and never self-heals. The dangling ref in `project.json` is not cleared: clearing it destroys the only evidence of what the user chose, and main already distinguishes the state — it returns `unavailable` when `routing[role]` is set but the ref no longer resolves. The renderer simply never read the distinction. The ref is overwritten by the user's replacement choice and by nothing else. Five causes get five accurate sentences, two of them with no action offered; the catalog fault is neutral tone, not error tone, because it is not the user's problem. This is where deleting auto-adoption pays for itself: today the adoption trigger tests `media.selectedRoute !== null`, **not** `routing[role] === null`, so a broken _explicit_ choice with one surviving option is silently overwritten with no gesture and no record. A broken explicit choice is a repair conversation, never a substitution.

**(h) How does this relate to the money gate?** The gate stays exactly what it is: the single money moment, non-editable, naming the engine per scene. Four bindings. **Same words for the same thing** — the gate's per-scene Provider/Model rows and the slot summary render from one shared formatter, so a user recognises that the modal is billing the engine they picked; this is what forces the ENGINE/MODEL/no-ROUTE ruling. **The strip is visibly not a money control** — text-styled triggers, no primary fill, no "Generate", no cost figure, no confirmation step; selecting an engine costs nothing, so per the money rule it is direct: one click, saved. **Refusal with a door, not an edit** — selection is never reachable from inside the gate, because a route write bumps `project.revision` and `confirmGeneration` treats a mismatch as stale, and because re-aiming a paid submission at the moment of consent is what a consent dialog exists to prevent; the refusal names the fact and gains one secondary button that closes and moves focus. **The gate stops being the first disclosure** — today `deriveStudioReadiness` never consults `routing`, so "Generate 6 ready scenes" counts shots that cannot generate and the failure is first disclosed inside the spend dialog. The batch count must exclude route-blocked shots and name the exclusion in the strip's own voice: "2 shots are not here — no video engine is set."

---

## 8. Auto-adoption

**Auto-adoption dies. Selection becomes always-explicit.** Delete `studioRouteDefaults.ts`, delete `attemptedAdoptionsRef` and the adoption effect in `useStudioModels`, delete the `autoSelectSoleRoute` option and the `StudioPage` gate that feeds it. This design removes more routing code than it adds.

Five reasons, none of them taste.

Its stated justification is gone. Its own doc comment says it exists because "Produce sends engine work to Model Settings, which binds engines for the whole workspace and never writes a project route." Once the strip writes the route, the premise is false.

It is the one document write with no human in the loop, flagged in the architecture record as the single writer that bypasses the propose/accept protocol. The invariant is: tools propose, the human accepts, main writes. Adoption is the standing exception and there is no longer a reason for it.

It silently destroys explicit choices. The trigger tests `media.selectedRoute !== null`, not `routing[role] === null`, so a dangling explicit choice with one surviving option is overwritten with no gesture and no record — and provenance ("you chose this" / "chosen for you") is unbuilt and P3, so there is not even a way to disclose it. A design that cannot tell the truth about a write should not make the write. Killing adoption makes provenance trivially true and retires it from the critical path.

It is nondeterministic. Candidates are claimed before the first await and never cleared, so each gets one attempt per **mount**; `StudioPage` additionally withholds adoption entirely while any draft is unsaved. An adoption that would have succeeded can be permanently skipped because the user happened to be typing when the catalog arrived. And fixing bindings in Settings does not repair an already-open project.

Decisively, it is structurally incapable of fixing the case that blocks the product. `resolveSoleRouteAdoptions` requires `rivals.length === 0`. Two video bindings means zero adoptions, forever, with no in-app transition out. It automates the painless case and abandons the painful one.

**What replaces it: pre-arming, not pre-writing** (State C). When a role has exactly one option and nothing chosen, the slot renders that option's name greyed with "Not set" beside it, the trigger is styled as the phase's suggested next action, and opening the menu focuses that single row so Enter commits. One click, or two keystrokes, once per project, ever. Compare with today's cure for the same class of problem: leave the project, delete a binding in Settings, come back, hope the remount adopts.

Pre-arming must **never** fire into a dangling state, in any form. State E lists survivors under "Replacing seedance-1-0-lite" and pre-selects nothing.

**Migration: none.** Every project that already auto-adopted keeps its persisted route untouched. Only new projects pay the click.

**The honest cost, stated plainly:** a user with exactly one image and one video binding who creates a project now cannot render until they click twice. That is a real first-run regression on the common case, imposed to fix the uncommon one. I accept it deliberately, because the alternative is keeping a silent document writer that overwrites user decisions to save two clicks — and because selection is the only moment in the product where a user is looking at an engine and can be told that its clip floor is four seconds.

---

## 9. What this asks of engineering

### Two blocking contract changes

**1. Integration label on the renderer route projection.** `createStudioMediaChoiceId` hashes `providerId + adapterId + model + kind`; `toRendererRoute` (`creativeStudioService.ts:889-904`) does not carry `adapterId` or any label. Three video integrations exist. Two bindings of one model under two adapters therefore yield two distinct `choiceId`s that render as two identical menu rows — a picker that cannot resolve the reported bug. Add an integration label to `StudioRouteCatalogEntry`. This is cheap: `integrationForAdapter` already sits next to `toRendererRoute`, `MEDIA_INTEGRATIONS` already carries a `labelKey`, `labelKey` already reaches the renderer via `toConnectionRecord`, and `StudioRouteCatalogEntry` is never validated by `store.ts`'s `hasExactKeys`, so there is no migration. Note this is a deliberate reversal of the choice-id helper's comment ("without exposing the adapter tuple") — nothing leaks, but the decision should be made knowingly. **Land this first.**

**2. A reason-returning sibling to `routeSupportsScene`.** `routeSupport.ts:32-44` returns a bare boolean over health, kind, sceneId, aspect ratio, resolution, duration and first-frame — which is why a healthy engine that merely cannot start from a frame is reported as "This route is no longer valid." Add `explainRouteSupport(route, ctx): null | 'health' | 'frame' | 'resolution' | 'duration' | 'first_frame'` and redefine `routeSupportsScene` as `explainRouteSupport(...) === null`, so existing callers do not churn and the `silentOutput` security note stays where it is. Every honest sentence in §6's `models.blocked.*` keys off this. Write no branches for `kind` or `sceneId`.

### Renderer work

Create `components/EngineStrip/` with `getProjectEngineSlots(catalog, project)` returning both roles unconditionally. Delete `components/Models/StudioModelBar.tsx` and its ~148-line test. Move `EngineBar.tsx` out of `phases/produce/`; keep its Tooltip disclosure pattern verbatim (`trigger={['hover','focus','click']}` plus an `sr-only` `aria-describedby` mirror) because spend-relevant facts must never be hover-only.

Mount three times. `ProducePhase`: replace the `<StudioModelBar>` line and delete the `readyRoutes.length === 0` early return. `WritePhase`: add `variant="compact"`; the controller already has `models` and needs `openModelSettings` added to its `Pick`. `BriefPhase`: same variant; the controller needs both `models` and `openModelSettings` added.

`ShotCard`: **always render** the Render control. Today it is `{reviewAvailable && <Button …>}`, so in the blocked state there is no button, no disabled state, no tooltip and no accessible text — while the card's own status label still reads "ready." That single conditional is the incident's invisibility. `ShotGrid` must pass a reason, not just a null: add `describeSceneRenderBlock(project, catalog, scene, ctx)` returning the discriminated reason, and derive both the visible sentence and `aria-describedby` from it. `buildSingleSceneReviewRequest` keeps returning null for the paid path; the reason is computed alongside it, not instead of it.

`ProducePhase`: narrow `ConnectEngineCard` to "both roles have zero options" and render it inside the grid region; strip `data-studio-phase-heading` from it. Fix the batch count to exclude route-blocked shots and name the exclusion.

`useStudioModels`: add `refresh()` calls on strip mount, on `window` focus, and on return from Settings navigation, and await it in the dropdown's `onVisibleChange(true)`. This is not defensive polish — the refetch effect keys only on `projectCatalogKey`, nothing anywhere in `packages/desktop/src` subscribes to connection changes, and `openModelSettings` navigates away, so **today's only cure is an accidental unmount.** A design that stops leaving the page must replace that deliberately. Delete `resolveSoleRouteAdoptions`, `attemptedAdoptionsRef`, the adoption effect, and the `autoSelectSoleRoute` option and its `StudioPage` gate.

`GenerationReviewModal`: rewrite the refusal copy, add one secondary "Close and set engines" that closes and moves focus, add the first-frame exclusion line. **No new mutation callback.**

`StudioLibrary`: wire the badge. Correcting one judge's note — `library.readinessSetupRequired` is _not_ a free orphan: it is in `studioI18n.test.ts`'s guarded key list at line 145 and in a **negative** assertion in `StudioLibrary.dom.test.tsx:187`. Wiring it means rewording a guarded key and flipping that assertion.

Delete `GenerationControls`' component body and its ~393-line test. Move the four live helpers to `generationRequests.ts` unchanged.

Introduce `resolveShotEngine(project, shot)` and route all four `project.routing[kind]` reads through it.

### Store, IPC, migration

**No new IPC.** `updateModelSelection` already accepts a role plus `{ choiceId }` and validates it against the **project-filtered** options, so any option the picker can show is already an acceptable write. `listRoutes` already exists.

**No CAS machinery.** `updateSelection` already sends `expectedRevision` and, on `stale_project`, refetches the canonical project and refreshes the catalog.

**No store migration.** `routing` keeps `{ storyboard, image, video }`, so `ROUTING_KEYS` and its `hasExactKeys` enforcement are untouched. `StudioRouteCatalogEntry` is a DTO and is not validated by `hasExactKeys`, so the integration-label field needs no migration.

**No data migration.** Existing adopted routes are untouched.

### Tests that must change — and one nobody costed

**The full-journey e2e depends on the behaviour this design deletes.** `tests/e2e/features/workspaces/creative-studio.e2e.ts` documents sole-route adoption as the mechanism that gives a fresh project a video route (`:45-51`), asserts the adopted snapshot and a visible "Change engines" in `expectIdleProduceSurface` (`:308-330`), and asserts `routes.video` was adopted at create (`:408-419`). `expectConnectEngineDoor` (`:275-305`) additionally asserts that **no** Render/Generate button exists — which the always-render-disabled rule breaks by design. Not one of the four proposals named this spec. Budget the rewrite: the fresh-project happy path becomes pre-armed-then-one-click, and the connect-engine door asserts a _disabled_ Render with its reason instead of no Render.

`studioI18n.test.ts`: remove `'routing'` from `plannedGroups`; add the new key list to the guarded set; add the `[FS]` strings to `streamFullSentenceKeys`. Remember that the guard list stores keys **unprefixed**, so grepping the full key path misses the list that must move with them.

New guard test: exactly one `[data-studio-phase-heading]` per phase render, across all three mounts.

Regenerate `i18n-keys.d.ts` and run the i18n check.

---

## 10. What remains open, and what I could not verify

**Open for the design author.**

_German layout._ Each slot carries a model name, a four-part capability summary, and in the bad states a full sentence, and German runs about 30% longer. These are blocking and spend-relevant facts, so truncation is not permissible — the strip must wrap to a second and sometimes third line. That costs vertical space in a panel whose scarce axis is height. Someone has to draw the wrapped state at the narrowest supported width before this is built, or it will be discovered late.

_Whether "Coherence: on" earns its line._ I kept P2's positive readout in the full variant against P1's "silence is the healthy state." My reasoning is that the chain needs a name and this is the only place it gets one. A designer may reasonably rule that a permanent healthy-state sentence is noise and that only the off states should speak. Either call is defensible; the copy exists for both.

_Whether the Brief mount survives a CS2 shell decision._ It is one of three and nothing depends on it, so dropping it costs one mount and the zero-scene onboarding moment. Decide when Table/Board/Cut is real.

_The stale Director._ The route catalog is a frozen JSON snapshot serialised into the MCP subprocess env at server-create time, and `studio_list_routes` re-emits it verbatim while instructing the model to trust its `minDurationSeconds`. Making engine switching easy and in-place **increases** the rate at which the Director plans against dead bounds. I show a notice and offer a new brief, which is a weak remedy for "the Director will keep proposing 12-second clips to a 4–8s engine." The real fix is a refreshable snapshot, which is outside this surface's scope. This design creates the cost rather than inheriting it, and that should be recorded.

_The user who never opens a work view._ CS2's premise is that the Director does the work. Three mounts and a Library badge narrow the gap for someone who briefs entirely conversationally; they do not close it. If the panel later concludes the no-engine state must reach that user, this design has no answer that is not a second surface — and a second surface is exactly what it argues against.

_Cost._ The strip invites comparison on resolution, duration, audio and first-frame, then falls silent on the thing users compare hardest. A user reading two options side by side will assume the strip would have told them if one were more expensive. It would not, because nothing in the catalog knows.

**Could not verify.** The first-frame chain and the section object are CS2 semantics, not code in this branch — `grep -ci section` is zero in `creativeStudioTypes.ts` and `store.ts`, and `StudioScene` is a flat record with no parent. My refusal of per-section scope rests on the claim that the chain crosses section boundaries. If the chain in fact **resets** at every section boundary by design, cross-engine handoff costs nothing at those seams and the correctness argument collapses to a state-cost argument, which is much weaker. That is the one premise that would change the answer to (e), and it is why the exit criterion is written down.

I also did not verify how `settings › Creative Studio media models` renders the `supportsFirstFrame` it already reads, so the recommendation to add "Starts from a frame" / "Cannot start from a frame" to the binding row is a design intent, not a checked one-line change.
