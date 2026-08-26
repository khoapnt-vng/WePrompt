# Creative Studio 3 — the shortest path to a watchable film

Written 2026-08-22. Scope agreed with the owner the same day.

**Owner-approved amendment — 2026-08-24:** the reference workflow in §6 and
`creative-studio-3-direction-and-answers.md` §14 supersedes this document's earlier decision to put
references after the film spine. The earlier Slice 5 evidence remains useful as a record of what the
old Cast/Look mechanism proved, but it is not the target workflow.

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

### Slice 4 — the Cut plays the film — **done 2026-08-22, verified in the running app**

Driven rather than planned, and the Cut turned out to be built: pressing Play ran a real three-Shot
film from `0:00` to `0:12`, auto-advancing across three separate sources without a click.

One thing stood between a pilot user and that: the last Shot's Take had never been chosen, and the
Cut would not say so — a disabled button and "No film preview is available." Choosing a Take is what
releases the next Shot's conditioning, so every earlier Shot is chosen on the way through the chain
and the last one is never asked about. BUG-106 has the fix and why the Take is named rather than
chosen automatically.

_Done when:_ a pilot user watches their film end to end without leaving the app. **Met.**

### Slice 5 — cast and look references — **historical mechanism; superseded 2026-08-24**

The plan assumed this slice was a round trip to verify. It was a missing screen. Every other part —
both IPCs, the Beat panel's per-Shot picker, twelve locales of authored copy — already existed, and
nothing in the renderer called any of it, so no project could ever hold a reference. BUG-107 has the
detail and the fix.

Two corrections the code forced on this plan's §1. `studio_request_reference_images` takes only shot
ids: it carries no role and no subject, so it never produced a `cast` or `look` tag — that tag comes
from importing a file. And a `video_take` request may not carry a Brief reference at all, so a
subject reaches a chain through its head Shot's **seed still**, not through each Shot.

_Done when:_ two shots in one Beat visibly share a subject. **Met 2026-08-23.** A three-Shot film of
a red vintage bicycle in the rain rendered its first two Shots through the chain, and the owner
confirmed the subject holds: _"still the same bicycle"_. The subject travels by conditioning — Shot 1
from its seed still, Shot 2 from Shot 1's last frame — which is the mechanism cast references feed.

**The reference round trip is proven separately and completely:** imported through the new panel,
stored as `briefReferenceRole: 'cast'`, read by the Director (which said unprompted that it would use
it to keep the subject consistent), and offered in the Beat panel's per-Shot picker — the picker that
had never had an option before BUG-107.

**One caveat that outlives this slice.** The subject here is an object. `bytedance/seedance-2.0`
refuses any first frame it believes depicts a real person (BUG-112), so cast references cannot yet
hold a _human_ subject on the only first-frame-capable model bound today. That is a model-policy
question, not a Studio one, and it needs answering before cast consistency is promised to pilot
users.

## 4. Explicitly out, and why

| Item                              | Reason                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One-file stitched export          | §6 rules it ffmpeg-class, spiked out and unbuilt. The Cut offers the editor folder instead — and §6 is explicit that the one-file option is hidden rather than shown and failing. |
| Voice generation and TTS          | Shooting script may contain voiceover direction, but the MVP has no audio/TTS lane or model. Real gap, own sequence.                                                              |
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

---

## 6. Creative Studio Reference Workflow Implementation Plan

**Owner-approved integration amendment — 2026-08-24:** execute this workflow with
`creative-studio-3-beat-and-shot-implementation-plan.md` as one clean schema-5 cutover. Creative
Studio has zero users, so do not implement project migration, legacy readers, draft recovery,
sidecar settlement, or legacy-job dispatch. Share one set of final contracts and one prompt composer.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved character-first, background-second References workflow and make every Board or first-frame generation consume an explicit, validated per-Shot reference binding.

**Architecture:** Cut the existing Creative Studio project, Director command, prepare/confirm spend,
job, media, and workspace contracts directly to schema 5. The Director writes semantic reference
plans and Shot bindings through typed, free authoring operations; the main process remains the only
authority that approves reference assets, resolves bindings to immutable asset snapshots, checks
route capacity, prices work, dispatches providers, and records provenance. The renderer exposes the
authoritative state in a persistent References view and never supplies conditioning asset ids at
spend time.

**Tech Stack:** TypeScript strict mode, Electron main/preload/renderer IPC, React, Arco Design, UnoCSS/CSS Modules, Zod 4 MCP schemas, Vitest 4, Testing Library, Playwright E2E, i18next.

**Spec:** `docs/superpowers/specs/2026-08-24-creative-studio-reference-flow-design.md` and tracked direction `docs/prds/creative-studio/creative-studio-3-direction-and-answers.md` §14.

## Global Constraints

- Read `CONTRIBUTING.md`, `.claude/skills/architecture/SKILL.md`, `.claude/skills/testing/SKILL.md`, and `.claude/skills/i18n/SKILL.md` before implementation.
- Preserve the process boundary: filesystem, pricing, provider resolution, approval, and dispatch stay in main; renderer uses `ipcBridge` only.
- Use Arco components for interactions, `@icon-park/react` for icons, semantic tokens, and i18n keys for every changed user-facing string.
- Keep `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/` at ten direct children by adding one `References/` directory and removing the superseded `ProjectReferences.tsx` in the same UI task.
- Keep the MVP exclusions intact: no costume/expression variants, prop library, layers, masks, manual compositing, face replacement, relationship graph, or reference-strength control.
- Spend confirmation remains mandatory for reference generation, regeneration, Board generation, and seed-still generation. Free plan, approval, and binding edits never start paid work.
- The renderer must never send conditioning asset ids. It sends only a generation target; main resolves current approved assets, freezes ids and SHA-256 values into the quote, and rejects stale confirmation by project revision.
- Share the clean schema-5 contracts and independently versioned sidecar protocols defined in the
  Story/Shooting Script implementation plan. Schema 1–4 remain unsupported and byte-identical; a
  fresh schema-5 project is the only recovery path during this zero-user phase.
- Hold this plan Tasks 1–9 uncommitted with the Story/Shooting Script plan. Focused tests may run at
  each seam, but do not run an intermediate full typecheck, stage, commit, or hand off. The Story/
  Shooting Script plan Task 7 is the single build, acceptance, staging, and commit gate.
- `docs/superpowers/` is intentionally ignored. Do not force-add this plan or its spec.
- Use `apply_patch` for edits. Preserve unrelated work. Run focused tests after each task and the complete verification matrix in Task 9.

---

## Canonical schema-5 contracts

Use these names and shapes consistently; do not create a second catalogue or renderer-only binding model.

```ts
export type StudioReferenceKindV2 = 'character' | 'background';

export type StudioReferenceDraftV2 = {
  id: string;
  kind: StudioReferenceKindV2;
  label: string;
  prompt: string;
};

export type StudioProjectReferenceV2 = StudioReferenceDraftV2 & {
  approvedAssetId: string | null;
  candidateAssetId: string | null;
  supersededAssetIds: string[];
  jobIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type StudioShotReferenceBindingV2 = {
  status: 'unassigned' | 'ready';
  characterReferenceIds: string[];
  backgroundReferenceId: string | null;
};

export type StudioGenerationTargetV2 = { kind: 'shot'; shotId: string } | { kind: 'reference'; referenceId: string };

export type StudioGenerationReferenceInputSnapshot = {
  referenceId: string;
  kind: StudioReferenceKindV2;
  assetId: string;
  sha256: string;
};
```

Add these project facts:

```ts
referencePlanStatus: 'unplanned' | 'planned';
referenceOrder: string[];
references: Record<string, StudioProjectReferenceV2>;
```

Add `referenceBinding: StudioShotReferenceBindingV2` to every `StudioShot`. New Shots start `unassigned`. `status: 'ready'` with an empty character array and `backgroundReferenceId: null` is the explicit “no references required” decision.

The shared clean cutover creates the final storage fields in one tranche. Every request snapshot and
job has plural `referenceInputs` and a nonnull `composition`; every asset has required nullable
`projectReferenceId`, ordered `generationReferenceAssetIds`, nullable `producerJobId`, and nullable
`compositionDigest`; and every job, quoted generation, renderer quote, and prepare choice uses
`target` instead of top-level `shotId`. There is no singular or legacy reference field. Authorizations
inherit targets through their frozen quote items, while receipts retain immutable authorization/item
identity. Task 4 makes every new prepare, confirm, and dispatch path populate those exact fields.

The only new job purpose is `reference_image`. Character and background reference generation both use it; `target.referenceId` carries the semantic distinction.

---

## Task 1: Add reference state to the clean schema-5 contract

Execute these reference assertions inside Story/Shooting Script Plan Task 1. They are one durable
contract, not a separately committable cutover. When the focused contract tests are green, mark this
task complete and continue here at Task 2 without staging.

**Files:**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/factories.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/mutations/index.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/factories.test.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/validation.test.ts`
- Test: `tests/unit/process/creative-studio/store.test.ts`
- Test: `tests/integration/creative-studio/schema2Cutover.integration.test.ts`

- [ ] **Step 1: Add failing factory and validation tests for the exact schema-5 shape.**

Assert that a new project contains an unplanned empty catalogue, every newly added Shot has an
unassigned binding, duplicate reference ids fail, a ready binding may be explicitly empty, and exact
schema 1–4 payloads remain unsupported and byte-identical.

```ts
expect(project).toMatchObject({
  schemaVersion: 5,
  referencePlanStatus: 'unplanned',
  referenceOrder: [],
  references: {},
});
expect(project.shots.shot_1.referenceBinding).toEqual({
  status: 'unassigned',
  characterReferenceIds: [],
  backgroundReferenceId: null,
});
```

- [ ] **Step 2: Run the focused tests and confirm the contract is absent.**

Run:

```bash
bunx vitest run tests/unit/process/creative-studio/service/schema2/factories.test.ts tests/unit/process/creative-studio/service/schema2/validation.test.ts tests/unit/process/creative-studio/store.test.ts tests/integration/creative-studio/schema2Cutover.integration.test.ts
```

Expected: FAIL on schema version 4 and missing `referencePlanStatus`, `referenceOrder`, `references`, and `referenceBinding`.

- [ ] **Step 3: Add the complete canonical storage types within the shared atomic cutover.**

Add the project-reference, Shot-binding, and draft contracts from “Canonical schema-5 contracts,”
plus the final target, snapshot, job, asset, composition, and provenance fields specified in the
Story/Shooting Script plan. Decouple persisted sidecar protocol constants before bumping
`STUDIO_PROJECT_SCHEMA_VERSION` to 5. Do not add unions with schema-4 records or optional
compatibility fields. Add these bounds:

```ts
export const STUDIO_MAX_PROJECT_REFERENCES = 24;
export const STUDIO_MAX_REFERENCE_LABEL_LENGTH = 120;
export const STUDIO_MAX_REFERENCE_PROMPT_LENGTH = 4 * 1024;
```

- [ ] **Step 4: Seed the empty catalogue and unassigned Shot binding in every factory/reducer creation path.**

Update `createEmptyStudioProjectV2`, `add_shot`, `apply_coverage`, restore paths, and test factories. Park/restore preserves a still-valid binding; restore resets it to `unassigned` if any referenced catalogue id no longer exists.

- [ ] **Step 5: Extend exact-key and graph validation.**

Validation must prove:

- `referenceOrder` is a unique safe-id array and names every own key in `references` exactly once;
- reference kind, label, prompt, timestamps, asset lists, and job lists are bounded and canonical;
- candidate/approved/superseded asset ids, when present, resolve to project-owned image assets with `shotId: null`;
- reference job ids, when present, resolve to project-owned image jobs with a discriminated target;
- ready bindings use unique character ids of kind `character` and an optional id of kind `background`;
- unassigned bindings contain no ids;
- referenced entities have an approved asset when a binding is ready;
- a binding cannot contain duplicate semantic references.

- [ ] **Step 6: Keep old prototypes unsupported.**

Keep schema 1–4 byte-for-byte untouched and return `unsupported_prototype_schema`. Malformed
schema-5 records fail closed without a partial write. Do not add a converter, backup, archive,
recovery prompt, sidecar reconciliation pass, or automatic deletion.

- [ ] **Step 7: Re-run the focused tests.**

```bash
bunx vitest run tests/unit/process/creative-studio/service/schema2/factories.test.ts tests/unit/process/creative-studio/service/schema2/validation.test.ts tests/unit/process/creative-studio/store.test.ts tests/integration/creative-studio/schema2Cutover.integration.test.ts
```

Expected: these focused tests pass. Update their typed project/Shot fixtures mechanically to the
exact schema-5 fields; do not make the new fields optional to shorten the cutover. The combined
typecheck remains deferred until all main and renderer consumers move.

- [ ] **Step 8: Hold the reference state for the shared Task 7 gate.**

```bash
git diff --check
git status --short
```

Expected: only planned Delivery-A paths are modified. Do not commit or hand off the incomplete
schema cutover; continue to Task 2.

## Task 2: Add reversible reference-plan, approval, and Shot-binding authoring

**Files:**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/mutations/index.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Modify: `packages/desktop/src/process/bridge/creativeStudioBridge.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/mutations/index.test.ts`
- Test: `tests/unit/process/creative-studio/service/directorCommandContracts.test.ts`
- Test: `tests/unit/process/bridge/creativeStudioBridge.test.ts`
- Test: `tests/unit/process/creative-studio/service/index.test.ts`

- [ ] **Step 1: Write failing mutation tests for the three operations.**

Use these exact operation shapes:

```ts
type StudioMutationOperationV2 =
  | {
      kind: 'set_reference_plan';
      references: StudioReferenceDraftV2[];
    }
  | {
      kind: 'approve_reference';
      referenceId: string;
      candidateAssetId: string;
    }
  | {
      kind: 'set_shot_reference_binding';
      shotId: string;
      characterReferenceIds: string[];
      backgroundReferenceId: string | null;
    }
  | ExistingOperations;
```

Cover successful initial plan creation, an empty planned catalogue, duplicate ids, second-plan refusal, approval without a candidate, candidate promotion while retaining the old approved asset as superseded, wrong-kind binding, unapproved binding, duplicate character ids, inactive Shot, undo, and stale revision.

- [ ] **Step 2: Run the focused mutation/bridge tests.**

```bash
bunx vitest run tests/unit/process/creative-studio/service/schema2/mutations/index.test.ts tests/unit/process/creative-studio/service/directorCommandContracts.test.ts tests/unit/process/bridge/creativeStudioBridge.test.ts tests/unit/process/creative-studio/service/index.test.ts
```

Expected: FAIL because the operation union, reducer, IPC allowlist, and Director disposition table do not know these kinds.

- [ ] **Step 3: Implement `set_reference_plan`.**

It is valid only while `referencePlanStatus === 'unplanned'`. It creates all records using the reducer timestamp, preserves Director order, changes status to `planned`, and emits one new undo patch:

```ts
type StudioUndoPatch =
  | {
      kind: 'reference_catalog';
      before: Pick<StudioProjectV2, 'referencePlanStatus' | 'referenceOrder' | 'references'>;
      afterDigest: string;
    }
  | ExistingUndoPatches;
```

- [ ] **Step 4: Implement `approve_reference`.**

Require the named current candidate. Move the previous approved asset to `supersededAssetIds`, set `approvedAssetId` to the candidate, clear `candidateAssetId`, update the timestamp, and make any prepared quote stale through the project revision change. Do not delete media.

- [ ] **Step 5: Implement `set_shot_reference_binding`.**

Validate only active Shots and approved project references. Persist `status: 'ready'`; an empty/null input is the explicit no-reference decision. Capture the change through the existing `shot_fields` undo patch.

- [ ] **Step 6: Expose only the intended authorities.**

- Add all three operations to renderer authoring so References can approve/correct.
- Mark `set_reference_plan` and `set_shot_reference_binding` as Director `direct`.
- Mark `approve_reference` as `operation_not_permitted` for the Director.
- Keep all three out of reviewed proposal-only flows; binding changes must not create proposal cards.

- [ ] **Step 7: Re-run the focused changed-boundary tests.**

```bash
bunx vitest run tests/unit/process/creative-studio/service/schema2/mutations/index.test.ts tests/unit/process/creative-studio/service/directorCommandContracts.test.ts tests/unit/process/bridge/creativeStudioBridge.test.ts tests/unit/process/creative-studio/service/index.test.ts
```

Expected: the focused tests pass; full typecheck remains deferred to the shared Task 7 gate.

- [ ] **Step 8: Hold reversible authoring for Delivery C.**

Run `git diff --check`; do not stage or commit. Continue with Story/Shooting Script Plan Task 2 and
this plan Task 3 as Delivery C.

## Task 3: Give the Director typed reference catalogue and request contracts

**Files:**

- Modify: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioReferenceRequestWriter.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioPendingRecordWriter.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorRail/openingTurn.ts`
- Test: `tests/unit/process/creative-studio/service/index.test.ts`
- Test: `tests/unit/process/creative-studio/service/directorCommandContracts.test.ts`
- Test: `tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts`
- Test: `tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`
- Test: `tests/unit/pages/studio/workspace/DirectorOpeningTurn.test.ts`

- [ ] **Step 1: Write failing read/tool contract tests.**

`read_storyboard` must return:

```ts
{
  referencePlanStatus: 'planned',
  references: [
    {
      id: 'ref_ming',
      kind: 'character',
      label: 'Ming',
      approvalStatus: 'approved',
      approvedAssetId: 'asset_ming',
    },
  ],
  shots: {
    shot_1: {
      referenceBinding: {
        status: 'ready',
        characterReferenceIds: ['ref_ming'],
        backgroundReferenceId: 'ref_dai_pai_dong',
      },
    },
  },
}
```

Update the request schema to `{ referenceIds: string[] }`; reject unknown, repeated, already-pending, already-running, wrong-order, or background-before-characters-approved ids.

- [ ] **Step 2: Run the Director-focused tests.**

```bash
bunx vitest run tests/unit/process/creative-studio/service/index.test.ts tests/unit/process/creative-studio/service/directorCommandContracts.test.ts tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts tests/unit/pages/studio/workspace/DirectorOpeningTurn.test.ts
```

Expected: FAIL on the old `briefReferences`/`shotIds` contracts.

- [ ] **Step 3: Replace `briefReferences` in `read_storyboard`.**

Return the ordered catalogue with derived `approvalStatus: 'awaiting_generation' | 'candidate_ready' | 'approved'`, the approved asset id only, and every active Shot binding. Do not expose filesystem paths, hashes, provider credentials, superseded assets, or candidate internals.

- [ ] **Step 4: Change `studio_request_reference_images` and sidecars to reference ids.**

Use:

```ts
export const STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION = 5 as const;

export type StudioReferenceRequestV2 = {
  schemaVersion: typeof STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION;
  id: string;
  projectId: string;
  referenceIds: string[];
  status: 'pending';
  createdAt: string;
};
```

Rename the request limit to `STUDIO_MAX_REFERENCE_REQUEST_ITEMS`. This is an independently versioned
semantic-reference protocol, not the project schema constant. Keep the pending-record authority
fence, byte limit, TTL, uniqueness, immutable request/decision/receipt model, and atomic collision
handling. Old Shot-based request sidecars are unsupported; do not add a compatibility reader.

- [ ] **Step 5: Make the request card action mean “review spend,” not another authoring approval.**

Keep the request sidecar as the exact paid scope. The UI action records the existing `generation_gate` decision and opens the spend review in the same user action. Chat text alone remains non-authoritative; the explicit spend confirmation is still required.

- [ ] **Step 6: Update Director instructions.**

Add rules that require this order:

1. agree the story direction;
2. call `read_storyboard`;
3. write one `set_reference_plan` through `studio_apply_edits`;
4. request character ids first;
5. after character approval, request background ids;
6. after all approvals, write one `set_shot_reference_binding` per active Shot;
7. never invent ids and never imply a request generated media.

- [ ] **Step 7: Re-run the focused tests.**

Expected: PASS, including stale snapshot and duplicate pending-request races.

- [ ] **Step 8: Hold the Director contracts for Delivery D.**

Run `git diff --check`; do not stage or commit. Continue to Tasks 4–6 and the Story/Shooting Script
composition task.

## Task 4: Generalize paid generation to reference targets and multiple frozen inputs

The final fields below already exist after the shared clean schema cutover. This task changes
new-record creation, quote/confirmation behavior, dispatch, and provenance population only. Every
new request and job must have a nonnull canonical composition and plural semantic reference inputs.

**Files:**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/generationRequest.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/submissionIdentity.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/authorization.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/estimate.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/chain.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/generation/generationRequest.test.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/generation/submissionIdentity.test.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/pricing/authorization.test.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/pricing/estimate.test.ts`
- Test: `tests/unit/process/creative-studio/jobManager.test.ts`
- Test: `tests/unit/process/creative-studio/mediaStore.test.ts`
- Test: `tests/integration/creative-studio/generationLifecycle.integration.test.ts`

- [ ] **Step 1: Write failing tests for discriminated targets and multi-reference snapshots.**

Cover a reference target, a Shot target with three ordered reference inputs, duplicate input rejection, lowercase hash enforcement, deterministic identity changes when order/id/hash changes, route-capacity rejection, and output-asset provenance.

```ts
expect(job.target).toEqual({ kind: 'shot', shotId: 'shot_1' });
expect(job.requestSnapshot?.referenceInputs.map(({ assetId }) => assetId)).toEqual([
  'asset_ming',
  'asset_mei',
  'asset_dai_pai_dong',
]);
expect(output.generationReferenceAssetIds).toEqual(['asset_ming', 'asset_mei', 'asset_dai_pai_dong']);
```

- [ ] **Step 2: Run the generation-core tests.**

```bash
bunx vitest run tests/unit/process/creative-studio/service/schema2/generation/generationRequest.test.ts tests/unit/process/creative-studio/service/schema2/generation/submissionIdentity.test.ts tests/unit/process/creative-studio/service/schema2/pricing/authorization.test.ts tests/unit/process/creative-studio/service/schema2/pricing/estimate.test.ts tests/unit/process/creative-studio/jobManager.test.ts tests/unit/process/creative-studio/mediaStore.test.ts tests/integration/creative-studio/generationLifecycle.integration.test.ts
```

Expected: FAIL because new prepare/dispatch paths still populate singular `referenceInput` and read
Shot-only identities despite the final schema fields being present.

- [ ] **Step 3: Add `reference_image`, then make every new path use the existing `target` fields.**

Remove active top-level `shotId` reads/writes from choices, quote items, jobs, renderer quotes, and
identity material. Authorizations continue to freeze quote items; receipts continue to identify the
authorized item. Do not modify the final schema.

Add strict helpers:

```ts
export const studioGenerationTargetKey = (target: StudioGenerationTargetV2): string =>
  target.kind === 'shot' ? `shot:${target.shotId}` : `reference:${target.referenceId}`;
```

All uniqueness, in-flight, retry, cancellation, and authorization checks use that key plus purpose. Chain and frame-extraction logic must reject non-Shot targets before reading Shot state.

- [ ] **Step 4: Populate immutable `referenceInputs` on every new request.**

Clone and validate a dense unique ordered list. Video templates require `[]`; image templates permit
the list subject to the selected route. Keep conditioning frames separate in `conditioningInput`.
Reject singular reference fields everywhere.

- [ ] **Step 5: Dispatch every frozen reference input.**

In `jobManager.ts`, re-resolve each asset, prove the persisted SHA-256 still matches, preserve order, and pass all inputs through the existing adapter contract:

```ts
const conditioningImages = await Promise.all(
  snapshot.referenceInputs.map(({ assetId, sha256 }) => {
    const asset = ownValueV2(project.assets, assetId);
    if (asset?.sha256 !== sha256) throw new StudioJobManagerError('invalid_request');
    return deps.mediaStore.resolveProviderInputV2(project.id, assetId);
  })
);
```

Pass `conditioningImageLimit: route.constraints.maxConditioningImages` and fail before provider
submission when the frozen list exceeds it. Cover queued-local, submitting/retry, and
resumed-after-restart jobs using only the canonical plural snapshot.

- [ ] **Step 6: Persist generation ownership and provenance.**

- Reference job output: `shotId: null`, `projectReferenceId: target.referenceId`.
- Shot job output: `shotId: target.shotId`, `projectReferenceId: null`.
- Any generated output: `generationReferenceAssetIds` equals the frozen `referenceInputs` asset order.
- Imports and extracted frames: `projectReferenceId: null`, `generationReferenceAssetIds: []`.

On reference success, append the job id and atomically set `candidateAssetId`; if a prior unapproved candidate exists, move it to `supersededAssetIds`. Never replace `approvedAssetId`.

- [ ] **Step 7: Re-run the generation tests and source audit.**

Expected: PASS with zero singular-reference fields or unqualified Shot-only quote assumptions.

```bash
bunx vitest run tests/unit/process/creative-studio/service/schema2/generation/generationRequest.test.ts tests/unit/process/creative-studio/service/schema2/generation/submissionIdentity.test.ts tests/unit/process/creative-studio/service/schema2/pricing/authorization.test.ts tests/unit/process/creative-studio/service/schema2/pricing/estimate.test.ts tests/unit/process/creative-studio/jobManager.test.ts tests/unit/process/creative-studio/mediaStore.test.ts tests/integration/creative-studio/generationLifecycle.integration.test.ts
rg -n "referenceInput|\.shotId" packages/desktop/src/process/services/creative-studio packages/desktop/src/renderer/pages/studio
```

Review every match; allowed `.shotId` matches must be behind `target.kind === 'shot'` or unrelated authored Shot state.

- [ ] **Step 8: Hold the generation contract for Tasks 5–6.**

Run `git diff --check`; do not stage, commit, or claim a green typecheck yet.

## Task 5: Price and run project-reference generation with recoverable handoffs

**Files:**

- Add: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/referenceRequest.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/index.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/estimate.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/spendGate.ts`
- Add: `tests/unit/process/creative-studio/service/schema2/generation/referenceRequest.test.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/pricing/estimate.test.ts`
- Test: `tests/unit/process/creative-studio/store.test.ts`
- Test: `tests/unit/pages/studio/workspace/SpendGate.dom.test.tsx`
- Test: `tests/integration/creative-studio/generationLifecycle.integration.test.ts`

- [ ] **Step 1: Add failing prompt and quote tests for character/background reference targets.**

Freeze these prompt contracts:

```ts
const referenceOutputInstruction = (kind: StudioReferenceKindV2): string =>
  kind === 'character'
    ? 'Create one clean character reference sheet in a single image with front, three-quarter, side, and back views. Keep identity, age, wardrobe, proportions, and art style consistent. Do not add captions, borders, UI, or multiple alternative identities.'
    : 'Create one clean environment reference image with no characters. Establish the recurring location, layout, materials, palette, period, and art style. Do not add captions, borders, UI, or a contact-sheet grid.';
```

Assert that character targets can be quoted together, backgrounds are refused until every character record has an approved asset, approved references can be regenerated without clearing the current approval, and a retry selects only failed reference ids.

- [ ] **Step 2: Run the focused reference-generation tests.**

```bash
bunx vitest run tests/unit/process/creative-studio/service/schema2/generation/referenceRequest.test.ts tests/unit/process/creative-studio/service/schema2/pricing/estimate.test.ts tests/unit/process/creative-studio/store.test.ts tests/unit/pages/studio/workspace/SpendGate.dom.test.tsx tests/integration/creative-studio/generationLifecycle.integration.test.ts
```

Expected: FAIL because `reference_image` quote construction and target-aware handoffs are not implemented.

- [ ] **Step 3: Build the canonical reference request plan.**

`createStudioReferenceGenerationRequestPlan(project, reference)` must use project Brief/rules, the Director-authored reference prompt, the kind-specific output instruction, project aspect ratio/resolution, fixed four-second image plumbing, `referenceInputs: []`, and `conditioningInput: null`.

- [ ] **Step 4: Derive reference spend only from persisted ids.**

Change `handoffGateDraft` to create choices like:

```ts
{
  target: { kind: 'reference', referenceId: 'ref_ming' },
  purpose: 'reference_image',
}
```

Main re-reads the request, catalogue, project revision, reference state, character-first gate, image route, and in-flight jobs. It refuses caller-added or omitted targets and freezes the exact reference label/kind into the renderer quote display projection.

- [ ] **Step 5: Extend the handoff projection into a derived lifecycle.**

Use this renderer-safe shape:

```ts
export type StudioRendererReferenceGenerationHandoffV2 = {
  handoffId: string;
  requestId: string;
  referenceIds: string[];
  decidedAt: string;
  status: 'awaiting_spend' | 'running' | 'succeeded' | 'partially_failed' | 'failed' | 'dismissed';
  counts: {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  resultAssetIds: string[];
  failedReferenceIds: string[];
  completedAt: string | null;
};
```

Derive it from the immutable request/decision/receipt plus the authorization and current jobs. Confirmation stores the authorization id but does not collapse running work into “completed.” A handoff is succeeded only when every requested reference has a successful job output; partial/failed states retain successes.

- [ ] **Step 6: Add retry authority for failed targets only.**

The retry UI creates a new reference request containing `failedReferenceIds`. Existing succeeded targets are excluded from the new quote, keep their candidate/approved asset, and cannot be charged again by that retry.

- [ ] **Step 7: Re-run focused tests.**

Expected: PASS for initial generation, regeneration, reload while running, partial failure, failed-only retry, and approved-asset stability.

- [ ] **Step 8: Hold reference generation and handoffs for Task 6.**

Run `git diff --check`; do not stage or commit.

## Task 6: Resolve bindings deterministically for Board and first-frame generation

**Files:**

- Add: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/referenceBinding.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/index.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/boardRequest.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/generationRequest.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/estimate.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/authorization.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/spendGate.ts`
- Add: `tests/unit/process/creative-studio/service/schema2/generation/referenceBinding.test.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/generation/boardRequest.test.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/generation/generationRequest.test.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/pricing/estimate.test.ts`
- Test: `tests/unit/process/creative-studio/service/schema2/pricing/authorization.test.ts`
- Test: `tests/unit/pages/studio/workspace/SpendGate.dom.test.tsx`

- [ ] **Step 1: Write the fail-closed binding resolver tests first.**

Use a result union with Shot-specific recovery facts:

```ts
export type StudioReferenceBindingResolutionV2 =
  | { ok: true; referenceInputs: StudioGenerationReferenceInputSnapshot[] }
  | {
      ok: false;
      shotId: string;
      reason:
        | 'unassigned'
        | 'unknown_reference'
        | 'wrong_kind'
        | 'unapproved_reference'
        | 'missing_asset'
        | 'capacity_exceeded';
    };
```

Cover ordered characters followed by background, explicit no-reference, unassigned, deleted/stale ids, wrong kind, unapproved candidate, missing asset, duplicate asset, route limit 0/1/N, and project ownership.

- [ ] **Step 2: Run the focused binding/Board tests.**

```bash
bunx vitest run tests/unit/process/creative-studio/service/schema2/generation/referenceBinding.test.ts tests/unit/process/creative-studio/service/schema2/generation/boardRequest.test.ts tests/unit/process/creative-studio/service/schema2/generation/generationRequest.test.ts tests/unit/process/creative-studio/service/schema2/pricing/estimate.test.ts tests/unit/process/creative-studio/service/schema2/pricing/authorization.test.ts tests/unit/pages/studio/workspace/SpendGate.dom.test.tsx
```

Expected: FAIL because Board hard-codes an empty reference and seed-still selection still accepts renderer asset ids.

- [ ] **Step 3: Implement the pure resolver.**

Resolve semantic reference ids to the current approved asset ids and hashes in binding order. Capacity is checked against the main-resolved image route. `status: 'ready'` with no refs returns `{ ok: true, referenceInputs: [] }`; `unassigned` never silently becomes empty.

- [ ] **Step 4: Make Board and seed-still builders accept only resolved snapshots.**

```ts
createStudioBoardGenerationRequestPlan({
  ...authoredFacts,
  referenceInputs: resolution.referenceInputs,
});

createStudioGenerationRequestTemplate({
  purpose: 'seed_still',
  ...authoredFacts,
  referenceInputs: resolution.referenceInputs,
});
```

Video remains `referenceInputs: []`; its continuity `conditioningInput` is unchanged.

- [ ] **Step 5: Remove renderer-selected reference assets from all spend drafts.**

The Beat panel and `SpendGateDraft` send target/purpose only. `boardGateDraft`, per-Beat Board, retry Board, seed-still, and reference handoff drafts never contain asset ids. Main derives, prices, displays, and freezes the exact inputs.

- [ ] **Step 6: Add exact references to spend review and stale confirmation.**

Project each quote item's resolved inputs as renderer-safe `{ referenceId, label, kind, assetId }[]`. Display them under the target name. Because approval, binding, route, or asset changes increment project revision, `confirmSubmission` rejects the old quote as stale before any job or charge.

- [ ] **Step 7: Surface Shot-specific refusal data.**

Extend pricing refusal output with safe `{ shotId, reason }` details for binding failures. Renderer maps them to “Review Shot binding” and navigates to the exact row in References; provider diagnostics and paths remain private.

- [ ] **Step 8: Re-run the focused deterministic-binding tests.**

```bash
bunx vitest run tests/unit/process/creative-studio/service/schema2/generation/referenceBinding.test.ts tests/unit/process/creative-studio/service/schema2/generation/boardRequest.test.ts tests/unit/process/creative-studio/service/schema2/generation/generationRequest.test.ts tests/unit/process/creative-studio/service/schema2/pricing/estimate.test.ts tests/unit/process/creative-studio/service/schema2/pricing/authorization.test.ts tests/unit/pages/studio/workspace/SpendGate.dom.test.tsx
```

Expected: PASS. Tests must prove Board and first-frame plans carry exact bindings, an unassigned Shot produces no quote, and over-capacity fails before provider dispatch.

- [ ] **Step 9: Hold the complete reference core for the shared Task 7 gate.**

Run `git diff --check`, then continue with Story/Shooting Script Plan Tasks 4–6 and this plan Tasks
7–8. Do not run the full typecheck or create a partial commit.

## Task 7: Build the persistent References workspace and retire the conflicting picker

**Files:**

- Add: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/References/index.tsx`
- Add: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/References/References.module.css`
- Add: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/References/referenceStatus.ts`
- Delete: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/ProjectReferences.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/index.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/WorkspaceControls.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/viewTypes.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/WorkspaceProjectMenu.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/BeatPanel/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/WorkspaceShell.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/studioPhaseRoute.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/{zh-CN,en-US,ja-JP,zh-TW,ko-KR,tr-TR,ru-RU,uk-UA,pt-BR,de-DE,es-ES,fa-IR}/conversation.json`
- Add: `tests/unit/pages/studio/workspace/ReferencesView.dom.test.tsx`
- Delete: `tests/unit/pages/studio/workspace/ProjectReferences.dom.test.tsx`
- Test: `tests/unit/pages/studio/workspace/TableView.dom.test.tsx`
- Test: `tests/unit/pages/studio/StudioPage.dom.test.tsx`
- Test: `tests/unit/process/bridge/creativeStudioBridge.test.ts`
- Test: `tests/unit/pages/studio/studioI18n.test.ts`

- [ ] **Step 1: Write failing navigation and References-view DOM tests.**

Assert `STUDIO_VIEWS` is exactly `['references', 'table', 'board', 'cut']`;
`/studio/:id/references` receives close-preflight protection; Characters renders before Backgrounds;
background generation is disabled until every character is approved; approved and replacement
candidate states are distinct; Shot bindings list every active Shot; and Continue to Table appears
once every required reference is approved. Unassigned or invalid bindings remain visibly actionable
in References and fail closed later at Board/first-frame preparation; they do not hide navigation.

- [ ] **Step 2: Run the focused renderer tests.**

```bash
bunx vitest run tests/unit/pages/studio/workspace/ReferencesView.dom.test.tsx tests/unit/pages/studio/workspace/TableView.dom.test.tsx tests/unit/pages/studio/StudioPage.dom.test.tsx tests/unit/process/bridge/creativeStudioBridge.test.ts tests/unit/pages/studio/studioI18n.test.ts
```

Expected: FAIL because `references` is not a view and no page exists.

- [ ] **Step 3: Add `references` to the shared route vocabulary.**

Keep `defaultStudioView()` as `table`. The existing shared `STUDIO_VIEWS` continues to drive renderer links and main-process close preflight. Add the navigation translation key in all twelve locale files.

- [ ] **Step 4: Implement the three-section page.**

- **Characters:** label, approved image, optional pending candidate, status, Approve, Regenerate.
- **Backgrounds:** same card contract; generation disabled with an explanatory status until character approvals are complete.
- **Shot bindings:** Beat/Shot label, character multi-select, background select, save action, and a specific invalid/capacity alert.

Use Arco `Card`, `Button`, `Select`, `Alert`, `Progress`, and `Empty`. Use `createManagedStudioAssetUrl` for image URLs. Approval and binding save call the shared authoring batch with the current revision.

- [ ] **Step 5: Wire generation actions without bypassing spend.**

An initial Director request reaches the normal prepare/confirm spend gate through its durable handoff. A card's Regenerate action opens the same gate for exactly that persisted reference target with `originReferenceHandoffId: null`; it does not manufacture a second Director request and never calls a provider directly. Disable it while that reference already has an open request or in-flight job.

- [ ] **Step 6: Remove the conflicting Cast/Look path.**

Remove `ProjectReferences` from `WorkspaceProjectMenu`, the Beat panel `referenceAssetId` preference/dropdown/localStorage contract, `beatPanelBriefReferenceOptions`, and the renderer's ability to choose a reference asset at spend time. Leave managed import/detach main APIs only if another non-Studio caller exists; otherwise delete their bridge/service/tests in this same task.

- [ ] **Step 7: Keep Table semantics unchanged.**

Table thumbnails remain Board panels only. No character/background control or image is added to Table rows. Update tests to prove successful reference assets do not change “panels drawn,” Board freshness, or the Board thumbnail slot.

- [ ] **Step 8: Complete i18n and accessibility checks.**

Add English source copy and structurally matching translations for all twelve configured languages. Every thumbnail has a reference-kind/name alt; icon buttons have labels; sections use headings; binding errors use `role='alert'`; progress updates use a polite live region.

```bash
bun run i18n:types
node scripts/check-i18n.js
```

Expected: PASS.

- [ ] **Step 9: Re-run the focused renderer tests.**

Expected: PASS with no `ProjectReferences`, `briefReferenceOptions`, or Beat-panel `referenceAssetId` references.

- [ ] **Step 10: Hold the References workspace for the shared Task 7 gate.**

```bash
git diff --check
git status --short
```

Expected: only planned cross-plan paths are modified. Do not stage or commit; continue to Task 8.

## Task 8: Return progress and results to References

**Files:**

- Modify: `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposals.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/References/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/hooks/useStudioProject.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/studioPhaseRoute.ts`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/{zh-CN,en-US,ja-JP,zh-TW,ko-KR,tr-TR,ru-RU,uk-UA,pt-BR,de-DE,es-ES,fa-IR}/conversation.json`
- Test: `tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx`
- Test: `tests/unit/pages/studio/workspace/ReferencesView.dom.test.tsx`
- Test: `tests/unit/pages/studio/StudioPage.dom.test.tsx`
- Test: `tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx`

- [ ] **Step 1: Write failing handoff and navigation tests.**

Cover awaiting spend, queued/running counts, all-success thumbnails, partial-failure thumbnails plus failed-only Retry, Review references navigation, exact-card focus/highlight, and reload reconstruction. Also cover one-time auto-open and “do not steal focus again.”

- [ ] **Step 2: Run the focused UI tests.**

```bash
bunx vitest run tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx tests/unit/pages/studio/workspace/ReferencesView.dom.test.tsx tests/unit/pages/studio/StudioPage.dom.test.tsx tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx
```

Expected: FAIL because handoffs currently expose only open/dismissed/confirmed text and no result action.

- [ ] **Step 3: Render the durable handoff lifecycle.**

The card names references, shows spend review before confirmation, renders queued/running/succeeded/failed counts after confirmation, keeps successful thumbnails on partial failure, and exposes only failed ids to Retry. `succeeded` and `partially_failed` show **Review references**.

- [ ] **Step 4: Implement exact-result navigation without changing the Studio URL grammar.**

Keep a renderer-local focus intent in `StudioPage`:

```ts
type StudioReferenceFocusIntent = {
  projectId: string;
  referenceIds: string[];
  nonce: number;
};
```

`Review references` sets the intent and navigates to `studioViewPath(projectId, 'references')`. `ReferencesView` scrolls the first matching card into view, focuses its heading, highlights every matching card for one animation cycle, then reports the intent consumed. Do not add query parameters that would bypass the main route matcher.

- [ ] **Step 5: Auto-open only once.**

When `referencePlanStatus` first becomes `planned` with at least one reference, navigate to References only if localStorage lacks `aionui:creative-studio:references-opened:<projectId>`. Set the key before navigation. Later candidates, approvals, bindings, and reloads never pull the user away. Explicit Review references always navigates.

- [ ] **Step 6: Re-run i18n and focused UI tests.**

```bash
bun run i18n:types
node scripts/check-i18n.js
bunx vitest run tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx tests/unit/pages/studio/workspace/ReferencesView.dom.test.tsx tests/unit/pages/studio/StudioPage.dom.test.tsx tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Hold the result handoff for the shared Task 7 gate.**

```bash
git diff --check
git status --short
```

Expected: only planned cross-plan paths are modified. Do not stage or commit; continue to Task 9.

## Task 9: Prove the complete workflow and prepare the branch

**Files:**

- Modify: `tests/e2e/features/workspaces/creative-studio.e2e.ts`
- Modify: `tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`
- Modify: `tests/integration/creative-studio/generationLifecycle.integration.test.ts`
- Modify: `tests/integration/creative-studio/projectRecovery.integration.test.ts`
- Modify: `docs/prds/creative-studio/creative-studio-3-direction-and-answers.md` only if implementation changes a documented contract; otherwise leave the approved §14 unchanged.

- [ ] **Step 1: Add one E2E happy path with deterministic fake media.**

The scenario must:

1. create a brief containing Ming, Mei, and the dai pai dong;
2. apply the Director reference plan;
3. confirm two character generations;
4. approve both sheets;
5. confirm one background generation;
6. approve the background;
7. apply explicit bindings to two Shots;
8. open Table and draw the next Board batch;
9. assert each provider request receives the exact expected reference asset order;
10. assert resulting jobs/assets retain provenance;
11. assert Review references focuses the three reference cards;
12. reload and assert catalogue, approvals, bindings, and handoff state persist.

- [ ] **Step 2: Add fail-closed integration coverage.**

Cover unassigned binding, unapproved reference, reference replacement after quote, route changed
after quote, capacity exceeded, one provider failure among three references, failed-only retry, app
restart while jobs run, fresh exact schema-5 creation, and schema 1–4 unsupported without rewrite.

- [ ] **Step 3: Run the Creative Studio coverage gate.**

```bash
bun run test:coverage:creative-studio
```

Expected: PASS with changed Creative Studio code at or above the repository's 80% target.

- [ ] **Step 4: Return to the shared final verification gate.**

Execute Story/Shooting Script Plan Task 7 Steps 4–7. Those steps are the sole final repository gate
and commit for both plans; their results satisfy this task Steps 4–7.

- [ ] **Step 5: Confirm the shared full-suite and E2E evidence.**

Expected: Story/Shooting Script Plan Task 7 Steps 4–5 pass. If an environment-limited E2E launch
fails, rerun the exact affected test in the permitted desktop/browser context and record that
evidence separately; do not label it a code failure without reproduction.

- [ ] **Step 6: Confirm the shared source and structure audit.**

Expected:

- `git diff --check` exits 0;
- Views has at most ten direct children;
- every `referenceInput` match is the canonical plural `referenceInputs` name or an explicit
  negative test proving the singular key is rejected; no active singular or legacy field remains;
- no tracked file under `docs/superpowers/` appears in status.

- [ ] **Step 7: Use the one shared feature commit.**

Expected: Story/Shooting Script Plan Task 7 Step 7 creates the only implementation commit. Do not
stage or commit a second time here.

- [ ] **Step 8: Request code review before any push.**

Review specifically for process-boundary violations, quote staleness, sidecar authority races, asset/job reverse links, retry double-charge risk, route capacity, background-before-character gating, accessibility, i18n parity, and the absence of silent unconditioned fallback.

- [ ] **Step 9: Defer push to the shared Story/Shooting Script Task 7 gate.**

After the shared feature commit exists, follow Story/Shooting Script Plan Task 7 Step 8. Push only
after explicit owner authorization and use `just push`, never raw `git push`.

---

## Acceptance trace

| Approved criterion                                                            | Owning tasks |
| ----------------------------------------------------------------------------- | ------------ |
| Character cards precede backgrounds; independent approve/regenerate           | 1, 2, 5, 7   |
| Backgrounds wait for all characters                                           | 3, 5, 7      |
| Persistent References tab before Table; one-time auto-open; Continue to Table | 7, 8         |
| Director uses app-provided ids and typed Shot bindings                        | 2, 3         |
| App validates approval, ownership, kind, active Shot, and route capacity      | 1, 2, 6      |
| Board and first-frame generation consume persisted bindings                   | 4, 6         |
| Spend freezes and displays exact reference assets                             | 4, 6         |
| Jobs/assets retain exact provenance                                           | 4, 9         |
| Missing/stale/unapproved/over-capacity bindings fail closed                   | 6, 9         |
| Handoff shows progress, partial success, retry, thumbnails, Review references | 5, 8         |
| Table thumbnails remain Board-only                                            | 7            |
| Paid confirmation remains mandatory                                           | 5, 6, 7      |
| Restart/reload recovery                                                       | 5, 8, 9      |

## Self-review checklist

- [ ] Every approved criterion maps to at least one implementation task and one test.
- [ ] The plan contains no alternate source of truth for references or bindings.
- [ ] The renderer never supplies conditioning asset ids or provider credentials.
- [ ] Free authoring and paid generation authorities remain separate.
- [ ] Reference regeneration cannot replace an approved asset without explicit approval.
- [ ] Reference retry cannot include or recharge successful targets.
- [ ] Board/seed generation cannot fall back to an empty reference list from an unassigned binding.
- [ ] Fresh schema-5 creation and schema 1–4 unsupported behavior are explicit and tested.
- [ ] All changed UI copy is present in twelve locales.
- [ ] No new directory exceeds ten direct children.
- [ ] No `docs/superpowers/` file is force-added.

---

## Assignable follow-on — editor-folder export from the project menu

**Status (updated 2026-08-26 night):** the BUG-122/BUG-123 preconditions landed long ago, and
export service code now exists on this branch (`service/schema2/exports/`). **Verify the shipped
behaviour against this section's acceptance list rather than starting fresh.** Original status:
owner-approved 2026-08-25. Implement only from the latest combined Creative Studio head
after BUG-122 and BUG-123 land. The rejected `feat/studio-export-menu` branch at `5b747030f` is
behavioral evidence only: do not merge, rebase, or cherry-pick it wholesale. Its focused baseline
passed 475 tests and TypeScript, but it is sixteen commits behind this line, produces eleven content
conflicts, reads the retired Action/Look/Line/Narration schema, carries an unrelated spend-gate
change, and adds only one of twenty-four export keys outside `en-US`.

### Problem and goal

Creative Studio can compose an editor package, but the working export surface is buried in Cut and
does not communicate partial coverage cleanly. Put one explicit **Export editor folder…** action in
the project menu so an owner can hand the current film to an editor without generating media,
approving spend, or leaving the active workspace.

### Required product behavior

- The project `⋮` menu is the only place that starts a new editor-folder export. Remove the obsolete
  export controls from Cut only after the menu path works.
- The action runs immediately. It must never prepare a quote, request confirmation, authorize spend,
  or dispatch image/video generation.
- Every run creates a new timestamped folder and never overwrites an earlier export. Keep at most five
  editor-folder exports; move evicted folders to the existing recoverable quarantine.
- Before the click, the menu states either **Export editor folder…**, **Export editor folder · N
  slates…**, or one exact disabled reason. Disable when there are no Beats, when an empty Beat has no
  usable duration, while another workspace mutation is active, or while this export is running.
- A rendered Shot contributes its canonical trimmed video in film order. A Shot without a rendered
  video contributes one shared, resolution- and aspect-ratio-correct slate image whose duration is
  recorded in the timeline. Stable film ordinals do not renumber when a neighbouring Shot is a slate.
- An empty Beat with a known target duration contributes the same kind of timed slate. Missing media
  is disclosed as slates; corrupt, unverifiable, stale, or noncanonical media fails closed instead of
  being silently treated as missing.
- Every folder contains the ordered media, optional selected bed audio, `timeline.json`, `script.md`,
  and a manifest of relative path, byte size, and SHA-256 digest. `script.md` is derived from the
  schema-5 project name, Brief, each Beat title and Story, and each Shot Shooting script. It must not
  restore Action, Look, Line, Narration, or On-screen text as independent authoring fields.
- Pin both the project revision and export-catalog revision at submission. Main re-reads authority and
  validates ownership, media kind, digest, byte size, trim bounds, canonical generation provenance,
  retention, containment, and arithmetic before publishing.
- Renderer preview and main composition use the same canonical eligibility rule. Renderer payloads
  never expose absolute managed paths.

### Status and recovery

- Show a non-modal, indeterminate **Exporting…** status that explicitly says no media is being
  generated.
- On success, show the new folder name, total byte size, file count, slate Shot numbers, and the count
  of older exports moved aside. Offer **Reveal in Finder** and **Dismiss**; successful status may
  auto-dismiss after eight seconds without deleting the export.
- On failure, show the specific mapped error as an assertive alert, offer Dismiss, and never offer
  Reveal for a folder that was not published.
- Keep the catalog monotonic across reload and concurrent reads. A stale or conflicting catalog never
  replaces newer renderer state.

### Required implementation corrections

- Rebuild against schema 5 and the current project menu, References flow, Studio page, export service,
  and tests. Resolve current behavior deliberately instead of importing stale conflict resolutions.
- Keep the change atomic: exclude the old branch's unrelated spend-gate layout commit.
- Add every new or changed user-facing key to all twelve configured locales and regenerate the i18n
  key types.
- Use Arco controls, `@icon-park/react`, semantic color tokens, and the existing renderer/main IPC
  boundary. Do not import Node or Electron APIs into the renderer.

### Explicit non-goals

- A single playable final film, FFmpeg concat/mux/transitions, or an **Export film…** action.
- Determinate per-file progress or a new progress event channel.
- Export-history UI, Files-panel redesign, Finder-drop ingestion, or a storage-layout migration.
- Capturing arbitrary Cut frames as references or adding new reference nouns.
- Any paid generation, provider routing, or credentials work.

### Acceptance boundary

The task is complete only when focused tests and the full repository gate prove all of the following:

1. A mixed project exports rendered Shots and correctly timed slates in stable film order.
2. `timeline.json`, schema-5 `script.md`, optional bed audio, manifest, sizes, and digests are
   deterministic and internally consistent.
3. Empty, pending-duration, stale-revision, stale-catalog, corrupt-media, noncanonical-media,
   retention, reveal, dismissal, reload, and concurrent-catalog cases behave as specified.
4. Export does not touch prepare, confirm, authorization, generation, or spend paths.
5. The Cut export controls are gone only after the project-menu path is covered.
6. TypeScript, i18n generation/checks, focused main/renderer tests, Creative Studio coverage, the full
   test suite, format, lint, and `git diff --check` pass from the exact final head.

---

## Assignable follow-on — References redesign and Shot-level binding

**Status — shipped; superseded as a surface, standing as rulings (2026-08-26 night).** The
substance of this assignment is in the tree: implicit approval shipped, `candidateAssetId` is gone
from the schema (item 5's collapse), and the Shot-level binding editor exists with the shared
`count / limit` budget counter (BUG-134's fix). Verify against this section's acceptance list rather
than re-implementing. The **References panel** assignment below is the successor for the card/panel
surface; this section's ruling that **binding lives per-Shot** is standing context for that panel's
blocked `Bind to all shots` decision. Original status: owner-approved 2026-08-25. Two related
changes to the same surface; implement them together from the latest combined Creative Studio head. Full direction lives in
[References card redesign](../../design/creative-studio-3-references-card-redesign.md) and
[binding belongs on the Shot](../../design/creative-studio-3-binding-belongs-on-the-shot.md); this
section is the assignment, not the specification.

### Problem and goal

The References view does two jobs badly. Its cards bury a large prompt paragraph under a small
image, so the picture — the only thing worth judging — is the smallest element on screen. And it
hosts a per-Shot binding form repeated once for every Shot in the film, without the Shot's own panel
visible to bind against.

The goal is one view about pictures, and binding where the Shot is.

### Required product behavior

1. **One large image per reference.** The prompt leaves the card and reappears only inside the
   regenerate flow.
2. **Three hover actions on the image:** view full screen (reuse `FullscreenMediaFrame.tsx`),
   regenerate, and choose among previously generated images (already retained in
   `supersededAssetIds`).
3. **Regenerate proposes an editable prompt.** Creative Studio composes it; the user may edit it
   before anything is generated. `regenerate(referenceId)` takes no prompt today, so this is a new
   request shape.
4. **No explicit Approve.** The newest generated image is current, and current is approved.
   Rejection becomes regeneration. Choosing an older image re-points the same field.
5. **Collapse `candidateAssetId` into `approvedAssetId`.** Under implicit approval the candidate
   holds no state of its own; keep one current pointer plus `supersededAssetIds`, and rewrite the
   `validation.ts:672` invariant that kept them distinct. Do this now while the zero-user schema-5
   argument still holds.
6. **Move per-Shot binding to the Board panel strip** in the Table's Beat detail — character
   multi-select, background select, capacity warning, unassigned/invalid states and save.
7. **Retire Continue to Table.** Readiness is a state, not a door. Where progress is worth stating,
   state it as progress.

Everything above applies to characters and recurring backgrounds identically: they are one entity
rendered through one shared `renderCard`.

### Explicit non-goals

- No change to `StudioShotReferenceBindingV2` or to the refusal in
  `generation/referenceBinding.ts:34` to generate a Shot whose binding is not `ready`.
- No weakening of character-first ordering, and no path by which the Director can cause approval on
  its own. A human still confirms the spend that produces every image.
- No permanent ordinals, tombstones, cast sheets or eviction tiers — see the
  [reference scope ruling](../creative-studio/creative-studio-3-reference-scope-ruling.md).

### Acceptance boundary

1. The character-first gate still refuses background generation before characters exist, now
   measuring generation rather than a separate approval act. Reword the plan criterion that reads
   "approvals precede Continue" to match.
2. An unbound Shot still cannot reach paid generation from any surface.
3. Reference image history remains reachable and reverting to an earlier image costs nothing.
4. TypeScript, i18n generation/checks, focused main/renderer tests, Creative Studio coverage, the
   full test suite, format, lint, and `git diff --check` pass from the exact final head.

## Assignable follow-on — the error-message class: stop laundering causes at boundaries

**Status:** implemented and verified 2026-08-26. One deliberate pass over a defect class that has now been
filed **five times** and point-fixed three times without stopping. Implement from the latest combined
Creative Studio head. This section is the assignment; the five bug entries in
[the bug list](creative-studio-3-bug-list.md) are the evidence and remain the per-instance specs.

### Problem and goal

Five separate bugs, one mechanism: **the cause is known at the throw site and thrown away at a
boundary**, leaving the user a generic label that points at the wrong subsystem.

| Bug         | Distinct causes collapsed into one message                              | Status             |
| ----------- | ----------------------------------------------------------------------- | ------------------ |
| **BUG-062** | 3 unrelated Director failures → "could not read or save this workspace" | closed `ecc43f718` |
| **BUG-065** | `unsupported` / `auth` / `timeout` / `unknown` → one validation string  | closed `b01c565ee` |
| **BUG-093** | 140 IPC operations → `invalid operation payload`, no operation or field | closed `fa777eb6b` |
| **BUG-126** | every non-401/402/429 4xx → `invalid_request`                           | closed `e19f53021` |
| **BUG-127** | runtime-inactive → `provider_error`                                     | closed             |

Three closures did not stop it, because each fixed one call site and none changed what makes the
next one easy to write. The goal of this task is the opposite: leave behind a rule and a guard, so
instance six is prevented rather than filed.

The class takes exactly three forms, all visible in the table above:

1. **The bare `catch {}`** — the caught error is not even bound. `v2Service.ts:1517-1524` is the
   clearest case: a typed `CreativeStudioStoreError('storage_error', 'Creative Studio runtime is not
active')` arrives and is replaced by a fresh `provider_error` carrying nothing (BUG-127).
2. **The collapse to a single value** — a discriminated result is narrowed to `null` or one string
   before it reaches the UI (`StudioMediaModelsSection.tsx:243`, BUG-065).
3. **The log-only side channel** — the cause is parsed, printed to the console, and dropped from the
   returned error. `openRouterVideoAdapter.ts:487` extracts `upstreamCode` into
   `OpenRouterHttpErrorEvidence` and never puts it in the `SanitizedProviderError` (BUG-126).

### Scope, measured

- **8** `CreativeStudioServiceError('provider_error')` throw sites, all in `v2Service.ts`; **2** sit
  directly inside a bare `catch {}`.
- **154** bare `} catch {` in `process/services/creative-studio`, **87** in `renderer/pages/studio`.

Treat 241 as the **search space, not the defect count.** Most are legitimate — optional parses,
probes, best-effort cleanup. In scope is only the subset that **discards a typed cause and then
produces a user-visible message or a persisted error code**. Do not "fix" catches that swallow
nothing anyone reads.

### Required product behavior

1. **Close BUG-126 and BUG-127** to their own entries' fix directions. They are the two open
   instances and the reason this task exists.
2. **Audit the in-scope subset above.** For each: bind the error, preserve a bounded cause, and
   choose the message from that cause. Where a call genuinely cannot know, keep the generic code —
   an honest generic beats a confident wrong one.
3. **`provider_error` must mean the provider.** BUG-127's case never contacts a provider, so the
   name accuses the one component that is provably innocent. Any throw that is not a provider fault
   needs a different code.
4. **Write the rule down** where the next contributor will meet it — the same place the existing
   `mapStatusError` doc comment lives, since that comment already argues this case correctly for 402
   and was still not generalized.
5. **Add a guard.** A test or lint rule that fails when a bare `catch {}` rethrows a user-visible
   error code. Without it, this list reaches six. Oxlint has no such rule enabled today, so a focused
   repo test asserting the in-scope call sites stay bound is acceptable — state which you chose.

### Do not weaken

- **The redaction boundary holds.** `safeEvidenceTag` and `nestedUpstreamCode` exist so raw provider
  prose never escapes to the renderer. Carry a **bounded enum**, never the provider's message string.
  This task must not become a licence to widen what reaches the UI.
- **Status-first mapping stays.** A body-informed 4xx refinement must not let an unrecognized body
  downgrade a 401/402/429.
- **No behavior changes** beyond error reporting. Quarantine stays fail-closed; the activation gate
  stays; no retry policy loosens except where BUG-126 explicitly asks that `retry-job` be withheld
  for an input the provider will refuse identically.
- **No scope expansion.** Do not refactor unrelated error types, and do not renumber or restructure
  existing bug entries.

### Acceptance

1. BUG-126 and BUG-127 are closed with their evidence recorded in the bug list, in the file's
   existing style.
2. Each in-scope call site either names its cause or is explicitly justified as legitimately generic.
3. No user-visible message names a subsystem that the failing path does not touch.
4. The guard from item 5 exists, fails on a deliberately reintroduced bare-catch launder, and passes
   on the fixed tree.
5. TypeScript, i18n generation/checks, focused main/renderer tests, Creative Studio coverage, the
   full test suite, format, lint, and `git diff --check` pass from the exact final head.

### Implementation result

- Runtime-inactive and quarantined-project conditions cross the service and IPC boundaries as their
  own bounded causes. The quarantined form carries one deterministic safe project id, never a path.
- Local provider-list, connection-candidate and route-catalog failures are storage/runtime causes;
  `provider_error` remains only for malformed or unadmitted responses after provider validation.
- Save-time connection revalidation preserves its existing seven-value sanitized failure reason.
- `errorBoundaryGuard.test.ts` is the chosen guard. Its synthetic counterexample proves the AST
  check detects a bare-catch service-error launder, and its repository assertion keeps every
  user-visible rethrow in `v2Service.ts` attached to a caught cause.
- Focused tests passed (6 files, 477 tests). Creative Studio coverage passed (658 files, 9,960 tests),
  and the full repository suite passed (658 files, 9,960 tests). TypeScript, i18n generation and
  validation, lint, format and `git diff --check` also passed.

## Assignable follow-on — the First frames panel

**Status — superseded in part, 2026-08-26 night.** This panel was **built** (`42473b5a2`, the
`BeatPanel/FirstFrames` component) and its frames-region design has since been **superseded by the
Beat panel shot composer** assignment below (owner ruling §1a: slots are the view, this panel's list
becomes the START slot's picker). Do not do further work from this section alone — read the composer
assignment first. The five owner rulings recorded here **remain binding** and carry over as follows:

| Ruling | Fate under the composer |
| --- | --- |
| 1 — takes replace, with retained history | **Carries over unchanged** (store behaviour, not layout) |
| 2 — staleness is a tag, never a fifth status word | **Carries over** — the composer handoff is silent on it; the `FIRST FRAME CHANGED · NOT RE-RUN` tag must appear under the composer's own "tags are exceptions" rule, not be dropped |
| 3 — current picture gets a full-screen view; its filmstrip is take history | **Carries over but is homeless** — the composer card shows inputs only and has no current-picture region. Open question for design: where do the rendered take and its history live in the composer layout? |
| 4 — the `⋯` menus, exactly | **Carries over** — the composer's slot and card `⋯` menus are unspecified in its README; use these ruled contents |
| 5 — panel widens to 1320 | **Done** — verified shipped in `BeatPanel.module.css` |

Original status: designer handoff received 2026-08-26, owner-forwarded for implementation. Full direction
lives in [the First frames panel](../../design/creative-studio-3-first-frames-panel.md); the two
source bundles are committed beside this plan and are the authority for anything that document
paraphrases. This section is the assignment, not the specification.

- `creative-studio-3-first-frames-handoff-notes.html.txt` — sha256 `a854abf83b0ffba2…ea340879`
- `creative-studio-3-first-frames-reference.html.txt` — sha256 `0f95a879778b7043…bc8430f9`

Both are JS-bundled: they render nothing with scripts disabled. Read them in a browser; stripping
tags yields the string "This page requires JavaScript to display."

### Problem and goal

The Beat panel has no surface for the stills a Shot begins on. First frames arrive from three places
— imported, generated, or inherited as the previous Shot's last frame — and today the choice among
them is implicit, invisible, and only inspectable through the store.

The goal: **frames feed in on the left, the picture comes out on the right.** One horizontal band of
inputs, one output card, and a full-screen view where a frame is judged, pinned and re-run.

### Required product behavior

1. **Two halves, one divider.** First frames (inputs) left, Current picture (output) right. The
   picture card carries a `→` control that sends its last frame to the next Shot. Nothing else lives
   in this region.
2. **Current is automatic; pinning is a hold.** The newest eligible frame is current by default;
   pinning freezes it against future arrivals. **This is what the code already does** —
   `chain.ts:104` falls back to the newest eligible asset when `seedStillId` is `null`. Build on
   `seedStillId` as the explicit hold; do not introduce a second notion of currency.
3. **A fixed 178px band that scrolls sideways.** Eight frames must be the same height as two, so the
   timeline rail keeps its place. Frame tile 132×74 in-panel, current picture 190×107, import tile
   64×74 doubling as the drop target.
4. **Picture first, words last.** One 9px mono caption line — frame identity left, origin right.
   Pinned state is three wordless signals: 2px orange border, `CURRENT` badge, lit pin. Hover
   controls (full screen, pin, more) float on the thumbnail at 140ms.
5. ~~Four status words, no fifth~~ — **superseded by the composer's six** (`QUEUED` and `FAILED`
   added); see the composer assignment. Original text: `NOT READY` / `READY TO RENDER` /
   `RENDERING` / `RENDERED`, and
   the rail and Shot header must say the same word.
6. **Full-screen frame view.** 94% black, image contained never cropped, filmstrip and arrows to
   navigate, pin as primary action, regenerate with a live prompt, download and remove secondary.
   Keyboard `← → P R Esc`, with `R` suppressed while the prompt field has focus.
7. **One prompt rule, applied everywhere a render is fired.** Always visible, always editable
   including mid-run; a run uses the text as fired; afterwards a divergent field is tagged
   `EDITED · NOT YET RUN`. Primary buttons become _Cancel run_ while working, and the Shot button
   names its target — "Generate Shot 1", never "Generate again".

### Decided — owner rulings, 2026-08-26

The five questions below were open at handoff and are now **ruled**. The full rulings, with their
code evidence, live in [the design doc](../../design/creative-studio-3-first-frames-panel.md#9--settled--owner-rulings-2026-08-26);
this is the binding summary. Do not re-open them by implementation default.

1. **Takes: replace, with retained history.** One Shot → one `videoAssetId` stands (`1750f9627`);
   the outgoing current is already pushed into `supersededVideoAssetIds` (`mediaStore.ts:4038`,
   invariant-guarded). No switcher and no take number on the card; history lives in the full-screen
   picture view, and re-pointing to an older take is free.
2. **Staleness is the prompt rule, generalized.** Divergence is an attribute tag —
   `FIRST FRAME CHANGED · NOT RE-RUN` — never a fifth status word. Consume the existing main-side
   machinery (`continuity_stale`, `staleCauses`, `studioConditioningInputsEqual`); the renderer must
   not recompute freshness.
3. **The current picture gets its own full-screen view.** Symmetric with the frame view, Shot prompt
   underneath, "Generate Shot N" behind the existing spend gate — and its filmstrip navigates takes,
   which is where Ruling 1's history surfaces.
4. **The `⋯` menus, exactly.** Frame: Download · Copy prompt (generated only) · Remove. Current
   picture: Download · Previous takes · Remove take. Duplicate, Replace and Reveal-in-library are
   rejected with reasons. Menu items never spend.
5. **The panel widens to 1320.** `BeatPanel.module.css:3-4` moves from a 1100 cap to
   `min(1320px, calc(100vw - 32px))`; the 178px band height is adopted exactly. Verify the existing
   panel content still renders correctly at 1320.

### Do not weaken

- **Spend governance is untouched.** Regenerate and Generate Shot enter the existing prepare/confirm
  quote path. This panel is a surface over that flow, never a new way to spend. Pinning stays free.
- **`RENDERING` percentage is optional, not assumed.** `openRouterVideoAdapter` returns bare
  `{status:'queued'}` / `{status:'running'}` with no progress (lines 686, 690); only
  `mediaGatewayAdapter` parses 0–100. Render the number **when present** and a determinate-free state
  otherwise. Do not design a bar that needs a value the provider never sends.
- **Respect the existing seed eligibility rule.** A `boardStills` asset is not auto-eligible as
  current (`chain.ts:94` accepts only `assets` and `imports`) but _can_ be pinned explicitly. Decide
  deliberately whether the strip surfaces that asymmetry; do not discover it mid-build.
- **No scope expansion.** This is the frames region of the Beat panel. It is not a Cut change, not a
  References change, and not a schema migration.

### Acceptance

1. The frames band holds its height at any frame count, and the timeline rail does not move.
2. A Shot with no eligible frame reads `NOT READY` and cannot reach paid generation from any surface.
3. Pinning a frame updates the card, the full-screen badge and the Shot status without a render, and
   costs nothing.
4. A run fired before a prompt edit completes against the text as fired, and the field afterwards
   reads `EDITED · NOT YET RUN`.
5. The implementation matches the five rulings above: an older take is restorable for free from the
   full-screen picture view, a diverged first frame is tagged rather than given a fifth status word,
   the menus contain exactly the ruled items, and the panel measures 1320 at full width.
6. TypeScript, i18n generation/checks, focused main/renderer tests, Creative Studio coverage, the
   full test suite, format, lint, and `git diff --check` pass from the exact final head.

## Assignable follow-on — the Beat panel shot composer

**Status:** designer handoff received 2026-08-26 evening, owner-forwarded. Full direction lives in
[the Beat panel shot composer](../../design/creative-studio-3-beat-panel-composer.md); the
designer's own README is committed verbatim beside this plan, along with both prototypes. This
section is the assignment, not the specification.

- `creative-studio-3-beat-panel-composer-handoff.md` — the designer's README
- `creative-studio-3-beat-panel-composer.html.txt` — sha256 `c1875fae52a9e604…85c3b488`
- `creative-studio-3-shot-composer-states.html.txt` — sha256 `f879f1cf53f0424f…9db04e6b`

Both prototypes open offline. Fidelity is **high** — colours, type, spacing, radii and copy are
final unless design says otherwise — but the HTML is a reference to rebuild with WePrompt's existing
components, not code to copy.

### Notes for the implementer — read in this order

Four things were found while capturing this handoff. Two are **blocked on a decision**, one is
**already ruled**, one is **a message back to design**. They are listed here because each lives in a
different section below and the dependency order is easy to miss.

| # | Note | Status | Who acts |
| --- | --- | --- | --- |
| 1 | This handoff **replaces the data model** of the First Frames panel already shipped in `42473b5a2`. | **RULED 2026-08-26 night** — slots are the view, the shipped list-with-pin stays the model; the band becomes the START slot's picker. §2 "Current vs pinned" is re-confirmed. See §1a of the design doc. | Codex |
| 2 | The **queue state has no failure sibling** — `QUEUED` as drawn is indistinguishable from a permanently dead chain (BUG-133/BUG-137). | **RULED** — the dead chain wears `FAILED` with a **Fix — free** button; six words preserved, the button differentiates. Both underlying defects are since fixed (`4e56f8f6f`), so the state covers retry exhaustion. See §1a. | Codex |
| 3 | The **end slot ships inert**, and **chaining skips already-rendered current Shots**. | **Ruled** — see *Owner rulings* below. Build to it. | Codex |
| 4 | The panel prototype's margin still reads `SHOT STATUS · FOUR WORDS`; the README and states board specify **six**. The prototype annotation is stale. | **Message back to design** — build the six, and tell design the two files disagree. | Owner relays |

**Carried forward from the First Frames rulings** (see the mapping table in that assignment's
status block): the takes model (ruling 1) and the `FIRST FRAME CHANGED · NOT RE-RUN` staleness tag
(ruling 2) apply to this panel even though its handoff never mentions them; the ruled `⋯` menu
contents (ruling 4) fill this handoff's unspecified menus; and ruling 3's current-picture/take-history
view **has no home in this layout** — the composer card shows inputs only. Where the rendered take
and its history live is an open question for design, alongside the four-vs-six status-word note.

**Both former blockers are resolved** — the owner ruled the same evening, and Codex's
`4e56f8f6f` independently landed the two pipeline fixes the ruling leans on (extraction created
atomically with every successful take; failed extractions auto-retried with a bounded attempt
count). Nothing in this assignment is blocked. The frames-region design of record is §1a of
[the design doc](../../design/creative-studio-3-beat-panel-composer.md).

### Do not start before reading this

**This supersedes a design already shipped.** It is the next revision of the First Frames panel
handoff, which Codex implemented in `42473b5a2`. It is **not a restyle**: the frames region changes
from an open list of candidate stills with newest-is-current and a pin, to **three fixed slots**
(start, end, image refs) selected by position. **Resolved by owner ruling — see §1a of the design
doc:** the slot geometry is the view, the shipped list-with-pin is the model, and the band is
re-parented as the START slot's picker. §2 "Current vs pinned" in
[the First Frames doc](../../design/creative-studio-3-first-frames-panel.md) is re-confirmed; do not
re-derive the frames region from the prototype alone.

### Required product behavior

1. **The card never changes shape.** Header, frames row, three slots, prompt, action row — eight rows
   in every state, so states can be compared without re-reading.
2. **Six status words, one place.** Not ready, ready to render, queued, rendering, rendered, failed —
   top right of the header, tinted, never bold. *(The panel prototype's margin still says "four
   words"; it is stale — take the six from the README and states board, and tell design.)*
3. **The button carries the state.** Inert Generate when inputs are missing, filled Generate when
   ready, Cancel run mid-flight, outlined Regenerate once rendered, filled again the moment the
   prompt drifts from what was fired.
4. **Tags are exceptions.** The area beside the button stays empty in ordinary states and fills only
   for `EDITED · NOT YET RUN` and for a failure, so a tag always means something needs attention.
5. **`Generate all N · chained`** above the shot strip runs the beat in order, each Shot starting on
   the last frame of the one before; `Stop the chain` halts after the Shot in flight and finished
   Shots keep their pictures.
6. **The end slot ships as a placeholder** — see the ruling below.

### Owner rulings

1. **End slot: build it now, inert.** *"Use the End slot as a placeholder now. With Seedance 2.5 or
   MiniMax, we will have that capability."* Render the third cell so the geometry matches, but do
   **not** let it affect a run, and **suppress state 03's `END FRAME SET · THE SHOT HAS TO LAND ON
   THAT PICTURE` footnote** until the capability is live — that copy must never appear while the run
   cannot honour it. Gate the unlock on the **bound route reporting last-frame support**, read the
   way `supportsFirstFrame` already is; do not hard-code a model id, which is the
   `MANAGED_FIRST_FRAME_MODELS` pattern and will need editing for the model after that.
2. **Chaining should skip Shots already rendered and current** (answering the designer's open
   question). Today a re-run re-prices and re-renders the head — measured at 60 minor units per
   12-second take, and $1.80 of pure repeat work across three chains in one session — and replaces a
   take the owner had already reviewed. `Generate all N · chained` must state how many Shots will run
   and what it will cost before it is pressed.

### Decide before building

- ~~The queue state needs a failure sibling~~ — **ruled** (see §1a): the dead chain wears `FAILED`
  with a `Fix start frame — free` action, distinct from the paid `Try again`; `QUEUED` is reserved
  for genuinely healthy waits. The underlying pipeline defects are fixed in `4e56f8f6f`.
- **States 07 and 08 are design proposals, not observed behaviour** — the designer says so. Confirm
  queue and failure semantics against the real job states (`queued_local`, `queued_remote`,
  `waiting_for_conditioning`, `needs_attention`, `failed`) before drawing them as final.

### Do not weaken

- **Spend governance is untouched.** Generate, Regenerate, Try again and Generate-chained all enter
  the existing prepare/confirm quote path. Filling a slot, pinning, removing a join and editing a
  prompt stay free. `Cancel run` and `Stop the chain` must never be able to spend.
- **`RENDERING · 40%` is optional, not assumed.** `openRouterVideoAdapter` returns bare
  `{status:'queued'}` / `{status:'running'}` with no progress; only `mediaGatewayAdapter` parses
  0–100. Render the number when present and a determinate-free state otherwise.
- **Respect the two-image conditioning budget.** `maxConditioningImages: 2` counts characters **and**
  background together; a `REFS 2` badge plus a background binding is already at the limit. Show the
  budget rather than let the user meet it as an error (BUG-134).
- **The `✕` between chips is `set_hard_cut`**, an owner-only control the Director may not call. Route
  it through the existing `continuityChange` prepare shape so the consequences — possible new seed
  and re-renders — are priced, not applied silently.

### Acceptance

1. Every one of the eight states renders with the same eight rows, one tinted status word, and the
   button carrying the state.
2. A Shot with no start frame reads `NOT READY`, shows the inert Generate, and cannot reach paid
   generation from any surface.
3. The end slot is visible, never affects a run, and never displays the end-frame footnote while the
   bound engine lacks last-frame support.
4. `Generate all N · chained` skips already-rendered current Shots, and states the count and cost
   before running.
5. A chain stalled behind a failed or missing conditioning frame is visually distinct from a healthy
   queue and offers the recovery.
6. TypeScript, i18n generation/checks, focused main/renderer tests, Creative Studio coverage, the
   full test suite, format, lint, and `git diff --check` pass from the exact final head.

## Assignable follow-on — show the estimate, ask only for the spend

**Status:** owner-directed 2026-08-26 night. Small, self-contained, and independent of the composer
work — it can ship on its own.

### Problem

The generation gate asks the user for permission to perform a **free** action. Opening it lands on a
`choices` step whose body reads *"Preparing an estimate is free. Only the explicit Confirm action can
submit paid work."* — and then requires a **`Prepare estimate`** click before any number appears.
The owner's reaction on meeting it mid-run: *"it is redundant that WP keep asking users for
permission to generate an estimate… duh? Just give them the number."*

That is two clicks and a modal step to reach a figure that costs nothing to compute, and the copy
explaining the step is longer than the number it is withholding.

### The step guards nothing — verified

`v2Service.ts:3043-3073` (`prepareSubmission`) loads the project, preflights, refreshes generation
routes, derives the quote graph, and returns it. It performs:

- **no project write** — no revision bump, nothing persisted to `project.json`;
- **no provider call** — pricing is computed from the rate card and the route catalogue;
- **no spend** — no job, no authorization, no `spendReceipt`.

The only durable effect is an entry in the **in-memory** `preparedSubmissionCache`. Confirmed
empirically as well: `prepareSubmission` was called dozens of times across six projects in one
session, including on quotes never confirmed, and charged nothing.

### Required behavior

1. **Open the gate straight into `review`.** Prepare the estimate automatically when the gate opens
   and show the number, the item count and the per-item breakdown immediately. The `choices` step
   and the `Prepare estimate` button are removed for the ordinary path.
2. **Keep exactly one confirmation, and keep it explicit.** `Confirm` remains the only action that
   spends, keeps its own copy, and must never be the default focus or fire on `Enter`.
3. **Preserve every refusal path.** Preparation can fail — `missing_conditioning`, `invalid_route`,
   `missing_route`, `invalid_reference`, `in_flight`, `stale_project`, `invalid_prepare_request`,
   `quote_too_large`, `quote_cache_full`. Those states stay exactly as they are; the change is that
   the user reaches them without a click, not that they disappear. A gate that opens onto a refusal
   should say what is wrong, not show an empty estimate.
4. **Handle TTL silently.** A prepared quote lives `STUDIO_PREPARED_QUOTE_TTL_SECONDS` (5 minutes)
   and `confirmSubmission` claims it from the cache. Auto-preparing on open means a quote can expire
   while the user reads it. On expiry, re-prepare in place and show the refreshed figure — the
   existing `refresh_required` phase already models this; do not surface it as an error the user has
   to clear, and never confirm against a stale quote.
5. **Keep the "free" reassurance, demoted.** The fact that looking costs nothing is worth stating
   once, quietly, beside the estimate — not as a step the user must acknowledge.

### Do not weaken

- **This is not a relaxation of spend governance.** One explicit, unambiguous confirmation before any
  paid work remains the rule the owner set; this task removes a confirmation that guards nothing and
  leaves the one that guards everything untouched.
- **Do not auto-prepare anything that costs.** The change applies to quote preparation only. Nothing
  here may pre-warm a provider, pre-generate a seed, or reserve capacity.
- **Do not collapse `Confirm` into the same click as opening the gate.** Removing the free step must
  not shorten the paid path.

### Acceptance

1. Opening the generation gate shows a priced estimate with no intermediate click.
2. No path reaches paid work without one explicit `Confirm` on a currently-valid quote.
3. Every preparation-refusal state is reachable and explains itself.
4. A quote that expires while the gate is open refreshes in place; confirming after expiry never
   submits against the stale quote.
5. TypeScript, i18n generation/checks, focused main/renderer tests, Creative Studio coverage, the
   full test suite, format, lint, and `git diff --check` pass from the exact final head.

## Assignable follow-on — the References panel

**Status:** designer handoff received 2026-08-26 night, owner-forwarded. Full direction lives in
[the References panel](../../design/creative-studio-3-references-panel.md); the designer's README and
the prototype are committed beside this plan. This section is the assignment, not the specification.

- `creative-studio-3-references-panel-handoff.md` — the designer's README
- `creative-studio-3-references-panel.html.txt` — sha256 `fd2c57db3656ddf1…89ba8ce8`

Fidelity is **high**. The designer states this shares a design language with the beat panel composer
handoff — *"same card shape, same status vocabulary, same accent. Build them as one family"* — so
build it alongside that assignment, not independently.

### Notes for the implementer — read in this order

| # | Note | Status | Who acts |
| --- | --- | --- | --- |
| 1 | **`Bind to all shots` overflows the conditioning budget at three references.** The image route allows `maxConditioningImages: 2` counted across characters **and** background; the design pushes the whole current set to every Shot. The prototype's own `2 / 3 SET` counter is already over, so the panel's completion state is one where its primary action cannot legally run. | **Blocked** — needs a product decision on per-Shot binding vs a gated bind-all. See §2. | Owner |
| 2 | **`+ Add character` has no supported mutation.** `amend_reference_plan` rejects non-background additions (`payloadSchemas.ts:429`); the only alternative replaces the entire plan. | **Ruled** — ship `+ Add place`, and omit or disable `+ Add character` with a reason. Do **not** implement it via `set_reference_plan`. | Codex |
| 3 | **Handles renumber when the current take changes.** `select_reference_image` pushes the outgoing current to the end of `supersededAssetIds`, so array order is recency-of-demotion, not creation. | **Ruled** — derive the ordinal from `asset.createdAt`, which no mutation rewrites. See §4. | Codex |
| 4 | **Naming a photo in a prompt does not make the engine use it.** Conditioning comes from the binding and the first frame, not from prose. | **Ruled** — do not ship copy claiming a named photo wins over the bound one until `@handle` resolves to a binding change. | Codex |
| 5 | The README claims *"same status vocabulary"* as the composer, but uses three different words (`NO PHOTO` / `CURRENT SET` / `GENERATING`) against the composer's six. Different object, so likely intentional — but the claim as written is false. | **Message back to design**, alongside the composer's four-vs-six note. | Owner relays |

### Required product behavior

1. **`contain`, not `cover`, on the picture band**, matted on the parchment ground — never a dark
   ground. This is the BUG-138 fix and is not negotiable; references arrive in every aspect ratio.
2. **Generate appends a take and makes it current**, never overwrites — matching the shipped
   `approvedAssetId` + `supersededAssetIds` model and the owner's References ruling.
3. **Characters before backgrounds.** Already enforced by `estimate.ts:1095`; the panel should make
   the order legible rather than let the user meet `invalid_reference`.
4. **Three status words**, one place, never bold: `NO PHOTO`, `CURRENT SET`, `GENERATING`. The
   generating state is determinate-free — the image route reports no progress, so draw no percentage.
5. **Handles are derived, never stored**, and re-slug on rename — with the ordinal taken from
   `asset.createdAt` per note 3.

### Decide before building

- **Removing a take has no mutation.** `✕` on the picture "drops the current take", but the store has
  only `select_reference_image`, which re-points and never deletes. If removal ships it needs its own
  operation, plus an explicit rule for a reference whose last take is removed
  (`approvedAssetId → null`, back to `NO PHOTO`).
- **Panel width.** 1000px here versus 1320px for the composer, inside the same Studio shell. Confirm
  the two agree about their container before both are built.

### Do not weaken

- **Spend governance is untouched.** Generate paths enter the existing prepare/confirm quote path at
  3 minor units per image. Naming, switching current take, importing, binding and editing a prompt
  stay free; `Cancel run` must never spend.
- **Do not let bind produce over-budget bindings.** Whatever resolution note 1 takes, an
  over-`maxConditioningImages` binding must be refused at the point of binding, not discovered later
  as a per-Shot error at the generation gate.
- **Do not implement `+ Add character` by replacing the reference plan.** That risks every existing
  character reference and its takes.

### Acceptance

1. A reference of any aspect ratio displays whole, matted, never cropped — including a 9:16 portrait.
2. Generating a second photo leaves the first reachable and switchable; switching current does not
   renumber any handle.
3. No binding action can produce a Shot carrying more than `maxConditioningImages` references.
4. A reference with no photo reads `NO PHOTO` and the panel cannot reach a bound-complete state.
5. TypeScript, i18n generation/checks, focused main/renderer tests, Creative Studio coverage, the
   full test suite, format, lint, and `git diff --check` pass from the exact final head.
