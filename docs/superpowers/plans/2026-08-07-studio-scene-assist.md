# Creative Studio Scene Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-scene, stateless one-shot assist: instruction in, one revised scene out, changed fields landing in the unsaved draft where the user saves or discards them.

**Architecture:** One new planner method (`reviseScene`) reusing the storyboard planner's client/audit machinery with a bounded context (this scene + the brief + neighbours' titles), one read-only service method + IPC, and one shared popover component mounted from two triggers (ScriptRow, SceneInspector). Main never writes the project on this path; the renderer applies the patch through `updateSceneDraftById` under an apply-if-unchanged rule.

**Tech Stack:** TypeScript strict, zod payload schemas, Vitest 4 (`--project node` main, `--project dom` renderer), Arco Popover, i18n ×12.

**Design of record:** `docs/design/creative-studio-scene-assist-design.md` (committed on Projects `sprint2`, `57a2d3893`).

---

## Execution context (read first)

- **Repo:** the Documents clone — `/Users/lap16603/Documents/WePrompt`. Base branch **`creative-suite-sprint2`**, working branch `codex/studio-scene-assist` in a fresh worktree (superpowers:using-git-worktrees; `bun install` in the worktree before believing any red gate).
- **Sequencing:** independent of EPIC-006's slices; the only shared file is `useStoryboardEditor.ts` where this plan only *reads* existing exports. If Slice A's Task 11 has landed, rebase is trivial.
- **Gates:** `bunx tsc --noEmit`, `bun run lint:fix`, `bun run format`; i18n changes add `bun run i18n:types && node scripts/check-i18n.js`. Push via `just push` only. BUG-025 gate policy applies to full-suite runs.

### Measured facts this plan is built on

| Fact | Where |
| --- | --- |
| Draft seam: `updateSceneDraftById(sceneId: string, patch: Partial<StudioEditableScene>): void` exposed by the editor hook | `useStoryboardEditor.ts:89,:1137,:1595` |
| Client seam: `StudioStoryboardClient.createChatCompletion({model, messages, max_tokens, temperature, response_format: {type:'json_object'}}, {signal, timeout})` | `planning/storyboardPlanner.ts:51-62` |
| Planner deps own providers/client/audit/retry: `StudioStoryboardPlannerDeps` (`listProviders`, `createClient`, `sleep`, `now`, `jitter`, `emitAudit`); planner surface `{listModels, draft, dispose}` | `storyboardPlanner.ts:79-95` |
| The service template to mirror: `proposeStoryboard` resolves `project.routing.storyboard`, throws `planning_unavailable` when null or unlisted, calls `deps.storyboardPlanner.draft(...)`, maps errors via `plannerError` | `creativeStudioService.ts:1074-1112` |
| Text-role availability vocabulary the UI must reuse: `StudioRouteCatalog.storyboard.status: StudioModelAvailability` (`ready \| selection_required \| setup_required \| unavailable`); already consumed by `AssistantDock.tsx` and `StoryboardDraftModal.tsx` | `creativeStudioTypes.ts:419-433` |
| Editable-scene field set and caps precedent (title 256, purpose 2048, visualPrompt 4096, narration 4096, onScreenText 1024) | `creativeStudioTypes.ts:152-163`; caps mirror the Slice A propose schema |
| Trigger sites: ScriptRow reference figure block `ScriptRow.tsx:126,:378`; SceneInspector reference section `SceneInspector.tsx:241-267` | measured |
| `StudioCommandResult` error shape: `result.ok === false → result.error.messageKey` | `useStudioProject.ts:109-113` binding pattern |

---

### Task 1: bounded context + prompt builder

**Files:**
- Create: `packages/desktop/src/process/services/creative-studio/planning/sceneAssistPrompt.ts`
- Test: `tests/unit/process/creative-studio/sceneAssistPrompt.test.ts`

- [ ] **Step 1: Failing tests** (node project)

```typescript
import { describe, expect, it } from 'vitest';
import {
  buildSceneAssistMessages,
  type SceneAssistInput,
} from '@process/services/creative-studio/planning/sceneAssistPrompt';

const scene = (id: string, title: string) => ({
  id,
  title,
  purpose: `${title} purpose`,
  visualPrompt: `${title} visual`,
  narration: `${title} narration`,
  onScreenText: '',
  mediaKind: 'video' as const,
  durationSeconds: 5,
});

const input: SceneAssistInput = {
  brief: 'A 10-second teaser for a mountain coffee brand',
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  currentTotalSeconds: 20,
  scene: scene('scene_5', 'The pour'),
  previousScene: { title: 'Scene four', purpose: 'Build-up' },
  nextScene: { title: 'Scene six', purpose: 'Resolve' },
  instruction: 'Make the narration punchier',
};

describe('buildSceneAssistMessages', () => {
  it('is bounded: neighbours in, the rest of the script out', () => {
    const text = JSON.stringify(buildSceneAssistMessages(input));
    expect(text).toContain('Scene four');
    expect(text).toContain('Scene six');
    expect(text).toContain('mountain coffee brand');
    expect(text).toContain('The pour');
    // The killer assertion: nothing invites the whole script in.
    expect(text).not.toContain('scene_1');
    expect(text).not.toContain('sceneOrder');
  });

  it('handles missing neighbours (first/last scene) without placeholders', () => {
    const text = JSON.stringify(buildSceneAssistMessages({ ...input, previousScene: null, nextScene: null }));
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('tells the model the contract: five text fields, JSON only, change only what the instruction asks', () => {
    const system = buildSceneAssistMessages(input)[0].content;
    for (const field of ['title', 'purpose', 'visualPrompt', 'narration', 'onScreenText']) {
      expect(system).toContain(field);
    }
    expect(system).toMatch(/only .*json/i);
    expect(system).not.toContain('mediaKind'); // structural fields are context, never output
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bunx vitest run --project node tests/unit/process/creative-studio/sceneAssistPrompt.test.ts` · Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Follow `storyboardPrompt.ts`'s house style (system + user message pair, versioned prompt constant). The system message states: revise exactly one scene; return one JSON object with any subset of the five text fields; change only what the instruction asks; keep the film's tone from the brief; durations and media kind are fixed facts. The user message carries the brief, aspect/duration facts, the neighbours' `title`+`purpose` lines (omitted entirely when null), the scene's five fields, and the instruction.

- [ ] **Step 4: Run to verify pass.** · **Step 5: Commit** — `feat(creative-studio): build the bounded scene-assist prompt`

---

### Task 2: patch parser

**Files:**
- Create: `packages/desktop/src/process/services/creative-studio/planning/sceneAssistPatch.ts`
- Test: `tests/unit/process/creative-studio/sceneAssistPatch.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
// 1. 'accepts a subset of the five text fields' → {narration: 'x'} parses to exactly that patch.
// 2. 'strips structural fields silently' → {narration:'x', mediaKind:'image', durationSeconds: 9,
//    referenceAssetId:'a'} parses to {narration:'x'} — stripped, not rejected (models pad output).
// 3. 'rejects unknown keys, non-string values, over-cap lengths, and non-object JSON' → typed
//    parse error for each (title>256, narration>4096, etc.).
// 4. 'rejects an empty patch' → a reply that changes nothing is a typed no_change error the UI
//    can phrase honestly, not a silent success.
```

- [ ] **Step 2: Implement** — a zod schema (`.strict()` after stripping the three structural keys) with the five optional bounded string fields, `.refine(patch => Object.keys(patch).length > 0)`. Export `parseSceneAssistPatch(raw: string): Partial<StudioSceneAssistDraft>` (the five-field draft type Task 3 defines — declare it in this task and let Task 3 re-export from types) throwing a typed `SceneAssistParseError { code: 'malformed' | 'no_change' }`.

- [ ] **Step 3: Run to verify pass.** · **Step 4: Commit** — `feat(creative-studio): parse scene-assist replies strictly`

---

### Task 3: planner method + service method

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/planning/storyboardPlanner.ts` (add `reviseScene` to the planner surface)
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts` (add `reviseScene`)
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (request/response types + service interface entry)
- Test: extend `tests/unit/process/creative-studio/` planner and service suites (locate with `grep -rln "proposeStoryboard\|storyboardPlanner" tests/unit/process/creative-studio/`)

- [ ] **Step 1: Types.**

```typescript
export type StudioSceneAssistDraft = Pick<
  StudioEditableScene,
  'title' | 'purpose' | 'visualPrompt' | 'narration' | 'onScreenText'
>;

export type StudioReviseSceneRequest = StudioProjectRequest & {
  sceneId: string;
  instruction: string;
  draft: StudioSceneAssistDraft;
};

export type StudioReviseSceneResult = {
  patch: Partial<StudioSceneAssistDraft>;
};
```

- [ ] **Step 2: Failing planner tests** — inject a fake `createClient` through `StudioStoryboardPlannerDeps` (the existing planner tests show the harness):

```typescript
// 1. 'reviseScene sends one strict-JSON completion and returns the parsed patch' — assert the
//    client received response_format json_object and messages from buildSceneAssistMessages;
//    fake reply {"narration":"Punchy."} → {patch:{narration:'Punchy.'}}.
// 2. 'single attempt per call' — a failing client is called exactly once; the typed planner
//    error surfaces (no retry loop for this path even though draft() retries).
// 3. 'malformed reply → typed error, audit event failed' — assert emitAudit status 'failed'.
```

- [ ] **Step 3: Implement `reviseScene` on the planner** — mirror `draft()`'s provider-resolution and audit emission, but: single attempt, tighter `max_tokens` (the output is one small object), same timeout discipline, `parseSceneAssistPatch` on the reply. Reuse `StudioStoryboardPlannerError` codes (`provider_unavailable`, `request_failed`, `invalid_response` — match the existing member names at `storyboardPlanner.ts:27-35`).

- [ ] **Step 4: Failing service tests**

```typescript
// 1. 'resolves the storyboard text route and returns the patch' — mirror proposeStoryboard's
//    resolution: project.routing.storyboard null → 'planning_unavailable'; unlisted model →
//    'planning_unavailable'.
// 2. 'reads the scene but never writes' — assert store.updateProject is NOT called; the project
//    revision is unchanged after the call. (This is the design's main-never-writes property.)
// 3. 'unknown sceneId → not_found'; instruction over 2000 chars → invalid_payload.
// 4. 'context is built from the REQUEST draft, not the saved scene' — saved narration 'old',
//    request draft narration 'typed', assert the client prompt contains 'typed'.
```

- [ ] **Step 5: Implement the service method** — validate ids + instruction, load the project (read-only), locate the scene and its `sceneOrder` neighbours (saved `title`/`purpose` only), compute `currentTotalSeconds` as the sum of scene durations, build `SceneAssistInput` **using the request's draft for the target scene**, resolve the route exactly as `proposeStoryboard` does (`:1088-1097`), call `deps.storyboardPlanner.reviseScene`, map errors through the existing `plannerError`. No `expectedRevision` — nothing is written, so there is nothing to guard.

- [ ] **Step 6: Run both suites + typecheck.** · **Step 7: Commit** — `feat(creative-studio): revise one scene through the planner seam`

---

### Task 4: IPC schema + bridge

**Files:**
- Modify: `packages/desktop/src/common/adapter/native/payloadSchemas.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts` (next to the other creativeStudio bindings)
- Modify: `packages/desktop/src/process/bridge/creativeStudioBridge.ts`
- Test: the payload-schema suite (locate with `grep -rln "studioSubmitScenesSchema" tests/`)

- [ ] **Step 1: Failing schema tests** — valid request parses; missing draft field, over-cap instruction, unknown key each reject (`.strict()`).

- [ ] **Step 2: Implement**

```typescript
const studioSceneAssistDraftSchema = z
  .object({
    title: z.string().max(256),
    purpose: z.string().max(2048),
    visualPrompt: z.string().max(4096),
    narration: z.string().max(4096),
    onScreenText: z.string().max(1024),
  })
  .strict();

const studioReviseSceneSchema = z
  .object({
    projectId: safeIdSchema,
    sceneId: safeIdSchema,
    instruction: z.string().min(1).max(2000),
    draft: studioSceneAssistDraftSchema,
  })
  .strict();
```

ipcBridge binding:

```typescript
reviseScene: bridge.buildProvider<StudioCommandResult<StudioReviseSceneResult>, StudioReviseSceneRequest>(
  'creative-studio.revise-scene'
),
```

Bridge provider wires to the service method with the same error→`messageKey` mapping the other commands use.

- [ ] **Step 3: Run + typecheck.** · **Step 4: Commit** — `feat(creative-studio): expose scene revision over IPC`

---

### Task 5: apply-if-unchanged — the renderer rule

**Files:**
- Create: `packages/desktop/src/renderer/pages/studio/hooks/useSceneAssist.ts` (the pure rule + the hook)
- Test: `tests/unit/pages/studio/useSceneAssist.dom.test.tsx`

- [ ] **Step 1: Failing tests**

```typescript
// The pure function first:
// resolveSceneAssistPatch(captured, current, patch) → { apply: Partial<draft>, skipped: (keyof draft)[] }
// 1. 'applies fields unchanged since capture' — captured.narration === current.narration →
//    narration in apply.
// 2. 'skips fields edited mid-flight and names them' — current.narration differs from captured →
//    narration in skipped, NOT in apply; other patch fields still apply. THIS TEST FAILS ON
//    NAIVE APPLY — it is the design's §3 rule.
// 3. 'a fully-skipped patch applies nothing'.
// The hook:
// 4. 'run() captures the draft, invokes reviseScene, applies via updateSceneDraftById' — assert
//    the IPC payload carries the captured draft and the editor receives only `apply`.
// 5. 'a failed call changes no drafts' — updateSceneDraftById never called.
```

- [ ] **Step 2: Implement.** `useSceneAssist({ projectId, scene, editor })` exposing `{ state: 'idle' | 'pending' | 'error', skipped: string[], errorKey: string | null, run(instruction) }`. `run` snapshots the five draft fields, invokes `ipcBridge.creativeStudio.reviseScene.invoke`, resolves the patch with the pure rule against the *current* draft at response time, applies via `editor.updateSceneDraftById(scene.id, apply)`.

- [ ] **Step 3: Run.** · **Step 4: Commit** — `feat(creative-studio): apply scene-assist patches only to unchanged fields`

---

### Task 6: the shared popover

**Files:**
- Create: `packages/desktop/src/renderer/pages/studio/components/SceneAssist/SceneAssistPopover.tsx` (+ `SceneAssistPopover.module.css`)
- Test: `tests/unit/pages/studio/SceneAssistPopover.dom.test.tsx`

- [ ] **Step 1: Failing tests**

```typescript
// 1. 'renders instruction input, three chips that prefill it, and the disclosure footer' —
//    chips insert their instruction text into the input, nothing fires until submit.
// 2. 'submit runs the assist and reports skipped fields politely' — mock the hook; skipped
//    ['narration'] renders the kept-yours line in a polite live region.
// 3. 'availability gating' — storyboard.status 'setup_required' renders the existing
//    setup-required vocabulary (reuse the key AssistantDock/StoryboardDraftModal use) and no
//    input; 'ready' renders the form.
// 4. 'error state offers retry, single attempt per click' — error renders errorKey + retry
//    button; retry calls run() exactly once more.
```

- [ ] **Step 2: Implement** — Arco `Popover`/`Trigger` + `Input.TextArea` + three chip Buttons + primary submit. Footer carries the ambient disclosure key. Availability comes in as a prop (`storyboardStatus: StudioModelAvailability`) — the component never fetches. Remember the Arco text-button background trap (`.arco-btn-text` specificity) if styling chips as text buttons.

- [ ] **Step 3: Run.** · **Step 4: Commit** — `feat(creative-studio): add the scene-assist popover`

---

### Task 7: mount both triggers

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/write/ScriptRow.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Storyboard/SceneInspector.tsx`
- Test: extend both components' dom suites

- [ ] **Step 1: Failing tests** — each surface renders the assist trigger for a scene, opens the shared popover, and a submitted instruction reaches the same hook; the ScriptRow trigger does not steal focus from field editing (assert the row's inputs keep working after open/close).

- [ ] **Step 2: Implement** — ScriptRow: an icon trigger in the row's action cluster; SceneInspector: a section beside the reference controls (`:241-267`). Both mount `SceneAssistPopover` with the scene's draft, `storyboardStatus` from the same catalog source `AssistantDock` consumes, and the `useSceneAssist` hook instance. One popover open at a time is acceptable v1 behaviour (Arco default).

- [ ] **Step 3: Run both suites.** · **Step 4: Commit** — `feat(creative-studio): mount the scene assist in Write and the inspector`

---

### Task 8: i18n, gates, live acceptance

- [ ] **Step 1: i18n** — follow `.claude/skills/i18n/SKILL.md`; en-US values (translate ×12 properly):

```text
conversation.creativeStudio.sceneAssist.trigger        = "Assist"
conversation.creativeStudio.sceneAssist.title          = "Revise this scene"
conversation.creativeStudio.sceneAssist.placeholder    = "Tell the assistant what to change…"
conversation.creativeStudio.sceneAssist.chipPunchier   = "Punchier"
conversation.creativeStudio.sceneAssist.chipShorter    = "Shorter"
conversation.creativeStudio.sceneAssist.chipVisual     = "More visual detail"
conversation.creativeStudio.sceneAssist.submit         = "Revise"
conversation.creativeStudio.sceneAssist.disclosure     = "Uses your text model · may incur provider charges"
conversation.creativeStudio.sceneAssist.skippedKept    = "{{fields}} changed while I was thinking — kept yours"
conversation.creativeStudio.sceneAssist.noChange       = "The assistant had no changes for that instruction"
conversation.creativeStudio.sceneAssist.retry          = "Try again"
```

`skippedKept` interpolates a localized field-name list — if any locale pluralizes around it, follow the skill's CLDR guidance (ru/uk tested at 1/2/5).

- [ ] **Step 2: Full gates in a quiet window** — `bunx tsc --noEmit && bun run lint:fix && bun run format && bun run test` (BUG-025 policy applies).

- [ ] **Step 3: Live acceptance** (one real text-model call):
  1. Write phase, a scene with narration → Assist → "make the narration punchier" → revised narration lands as a dirty draft; save persists it; a second run + discard restores.
  2. Mid-flight edit: submit, immediately type in narration → response skips narration, reports "kept yours", other fields (if any changed) apply.
  3. Unset the text model → both triggers show setup-required vocabulary; no call possible.
  4. Inspector trigger reaches the same behaviour.

- [ ] **Step 4: Push** — `just push -u origin codex/studio-scene-assist`; verify by ref equality.

---

## Explicitly out of scope

Per-field affordances; N alternatives; streaming; instruction history; storyboard-structure operations; touching structural fields; KB access; any planner `draft()` change.

## Risk register

1. **Planner error-code names** (Task 3) — reuse the existing `StudioStoryboardPlannerErrorCode` members verbatim (`storyboardPlanner.ts:27-35`); inventing near-miss names breaks the service's `plannerError` mapping silently.
2. **Availability source for the popover** (Tasks 6-7) — must be the same catalog `AssistantDock` consumes, not a re-derivation; BUG-024 exists because readiness got re-derived once already.
3. **`skippedKept` interpolation** — a joined field list reads naturally in en but may need per-locale list formatting; the i18n skill's guidance wins over string concatenation.
