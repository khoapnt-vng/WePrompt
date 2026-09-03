# Short Video Templates for CS3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CS3 a gallery of templates for short videos, where picking one, filling a few inputs and authorizing a price produces a single generated clip the person then watches in the Cut view.

**Architecture:** Port the template half of the entry kit (a renderer-only presentation layer) onto CS3's `Library/`, and replace its CS2-era five-call pipeline with CS3's quote-gated protocol: a free phase that creates the project, pins rules, authors one beat and one shot, probes admission and requests a price; then a paid phase that is a single `confirm-submission` plus a navigation. No multi-clip stitching, no film export, no ffmpeg.

**Tech Stack:** Electron + React 18, TypeScript (strict), Arco Design, UnoCSS + CSS Modules, i18next (12 locales), Vitest (node + jsdom projects), oxlint + oxfmt.

**Spec:** `docs/superpowers/specs/2026-09-03-entry-kit-cs3-integration-design.md`

---

## Before you start

**Branch off the CS3 base, not `main`:**

```bash
git switch -c feat/studio-short-templates codex/creative-studio-table-board-ui-design
```

**Add the source of the port as a remote.** The entry kit lives in a separate private monorepo whose
tree is prefixed `WePrompt/`:

```bash
git remote add entrykit https://github.com/legacyrohuy/Video.git
git fetch entrykit feat/creative-studio-entry-kit
```

Read a source file with:

```bash
git show "entrykit/feat/creative-studio-entry-kit:WePrompt/packages/desktop/src/renderer/pages/studio/components/EntryKit/types.ts"
```

**zsh trap:** always brace the ref — `"${REF}:path"`. Unbraced, `$REF:t` is parsed as a zsh history
modifier and you get silent empty output, not an error. This wasted real time during design.

**Verify the baseline is green before touching anything:**

```bash
bun install
bun run test
```

If it is red, run `bun install` in this worktree first — a red gate in a fresh worktree here is
usually stale `node_modules`, and some worktrees symlink `node_modules` to a sibling, which compiles
another branch's source.

---

## File structure

**New — the launch pipeline (one responsibility each, all renderer-side):**

| File | Responsibility |
|---|---|
| `packages/desktop/src/renderer/pages/studio/components/EntryKit/lib/spine.ts` | Pure. Inputs → the three authoring operations for one beat and one shot. No IPC. |
| `.../EntryKit/lib/prepareLaunch.ts` | Phase A: create → set-rules → author → capability → prepare. Returns a quote. Spends nothing. |
| `.../EntryKit/lib/runPaidLaunch.ts` | Phase B: `confirm-submission`. The only file that can spend. |
| `.../EntryKit/templates/ConfirmPanel.tsx` | Renders a quote: engine, itemization, price range, budget verdict, expiry. |
| `.../EntryKit/templates/ConfirmPanel.module.css` | Its styles. |

**Ported from `entrykit/feat/creative-studio-entry-kit` (renderer-only, no CS2 coupling):**

| Destination | Source basename |
|---|---|
| `.../EntryKit/types.ts` | `types.ts` (duration ladder replaced — Task 1) |
| `.../EntryKit/data/{templates,templateCopy,entrySettings,entryPlatforms}.ts` | same |
| `.../EntryKit/coverArt/{CoverArt.tsx,artLanguage.tsx,makeRng.ts,projectArtFormat.ts,CoverArt.module.css}` | last file renamed from `coverArt.module.css` |
| `.../EntryKit/templates/{TemplateGallery,TemplateCard,TemplateModal,SettingsBlock}.tsx` | same |
| `.../EntryKit/templates/{TemplateModal,SettingsBlock}.module.css` | renamed from lowerCamelCase |
| `.../EntryKit/lib/{composeInstruction,formatDuration}.ts` | same |
| `.../EntryKit/StudioEntry.tsx` | same (tabs reduced — Task 9) |
| `.../EntryKit/EntryKit.module.css` | renamed from `entryKit.module.css` |

**Not ported:** `runLaunch.ts`, `LaunchFlow.tsx`, `launchFlow.module.css`, `planSpine.ts`,
`QuickSuggestions.tsx`, the whole `explore/` directory, `data/{exploreItems,exploreCopy,suggestions}.ts`.

**Modified:**

| File | Change |
|---|---|
| `.../components/Library/Composer.tsx` | Lift `sentence` to props |
| `.../components/Library/StudioLibrary.tsx` | Own `sentence`, mount `StudioEntry` |
| `.../components/Library/ProjectCard.tsx` | Clickable poster + cover art |
| `.../components/layout/Layout.tsx` | `id` + `relative` so Arco portals the modal below the title bar |
| `.../components/Library/index.ts` | Export additions |

**Tests:** `tests/unit/pages/studio/entry/` for node tests (`*.test.ts`),
`*.dom.test.tsx` for jsdom. Note `tests/` is **not** in `tsconfig.json`'s `include`, so nothing here
is typechecked — assertions are the only guard, and fakes must be built from real exported types.

---

## Task 1: Duration ladder from the engine window

The source ladder is 14 fixed values from 15s to 210s and asserts *no template target under twenty
seconds*, because sub-20s meant "one clip". One clip is now the goal, so the invariant inverts.

**Files:**
- Create: `packages/desktop/src/renderer/pages/studio/components/EntryKit/types.ts`
- Create: `packages/desktop/src/renderer/pages/studio/components/EntryKit/data/templates.ts`
- Create: `packages/desktop/src/renderer/pages/studio/components/EntryKit/data/templateCopy.ts`
- Test: `tests/unit/pages/studio/entry/entryCatalog.test.ts`

- [ ] **Step 1: Copy the four catalogue files verbatim**

```bash
REF=entrykit/feat/creative-studio-entry-kit
SRC=WePrompt/packages/desktop/src/renderer/pages/studio/components/EntryKit
DEST=packages/desktop/src/renderer/pages/studio/components/EntryKit
mkdir -p "$DEST/data" "$DEST/lib" "$DEST/coverArt" "$DEST/templates"
for f in types.ts data/templates.ts data/templateCopy.ts data/entrySettings.ts data/entryPlatforms.ts; do
  git show "${REF}:${SRC}/${f}" > "${DEST}/${f}"
done
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/pages/studio/entry/entryCatalog.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { STUDIO_TEMPLATES } from '@renderer/pages/studio/components/EntryKit/data/templates';
import { studioShortDurations } from '@renderer/pages/studio/components/EntryKit/types';

describe('short-video duration ladder', () => {
  it('offers only durations one clip can hold', () => {
    expect(studioShortDurations({ minDurationSeconds: 4, maxDurationSeconds: 12 })).toEqual([4, 6, 8, 10, 12]);
  });

  it('never offers a duration below the engine minimum', () => {
    expect(studioShortDurations({ minDurationSeconds: 5, maxDurationSeconds: 8 })).toEqual([5, 6, 8]);
  });

  it('states no ladder at all when no engine is connected', () => {
    expect(studioShortDurations(null)).toEqual([]);
  });

  it('gives every template a default that one clip can hold', () => {
    const window = { minDurationSeconds: 4, maxDurationSeconds: 12 };
    const offending = STUDIO_TEMPLATES.filter(
      (template) =>
        template.defaultDurationSeconds < window.minDurationSeconds ||
        template.defaultDurationSeconds > window.maxDurationSeconds
    ).map((template) => `${template.id}:${template.defaultDurationSeconds}s`);

    expect(offending).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `bunx vitest run tests/unit/pages/studio/entry/entryCatalog.test.ts`
Expected: FAIL — `studioShortDurations` is not exported, and `defaultDurationSeconds` does not exist.

- [ ] **Step 4: Replace the ladder in `types.ts`**

Delete `STUDIO_ENTRY_DURATIONS` and the `durationsSeconds` field's long comment. Add:

```ts
import type { StudioClipWindow } from '@renderer/pages/studio/studioRouteConstraints';

/**
 * The durations a single clip can hold on the connected engine.
 *
 * Derived, never hardcoded: the source branch shipped a fixed 15-210s ladder, which is a multi-clip
 * range and wrong for every one-shot engine. Steps of two seconds inside the window, always including
 * both bounds, so the middle entry is a real default rather than an arbitrary one.
 *
 * Empty when nothing is connected. A guessed window is indistinguishable to the person from a real
 * one, and offering a length the engine will refuse turns a free mistake into a failed call.
 */
export const studioShortDurations = (clipWindow: StudioClipWindow | null): number[] => {
  if (clipWindow === null) return [];
  const { minDurationSeconds: min, maxDurationSeconds: max } = clipWindow;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max < min) return [];
  const values: number[] = [];
  for (let seconds = min; seconds < max; seconds += 2) values.push(seconds);
  values.push(max);
  return values;
};
```

In `StudioTemplate`, replace `durationsSeconds: readonly number[]` with:

```ts
  /**
   * The length this template is written for, in seconds.
   *
   * A single number, not a range: one clip has one length. The modal offers whatever the engine's
   * window allows and opens on this value clamped into it.
   */
  defaultDurationSeconds: number;
```

- [ ] **Step 5: Re-author every template's duration**

In `data/templates.ts`, replace each `durationsSeconds: [...]` with a single
`defaultDurationSeconds:` value in the 4-12s band. Use 8 for anything previously ≥60s, 6 for
`[20, 25, 30]`, and 10 for trailer-shaped templates. Exact values are editorial; the test only
requires they fit one clip.

- [ ] **Step 6: Run the test and confirm it passes**

Run: `bunx vitest run tests/unit/pages/studio/entry/entryCatalog.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/components/EntryKit tests/unit/pages/studio/entry
git commit -m "feat(studio): derive short-video durations from the engine clip window"
```

---

## Task 2: The spine — one beat, one shot

**Files:**
- Create: `.../EntryKit/lib/spine.ts`
- Test: `tests/unit/pages/studio/entry/spine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pages/studio/entry/spine.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildSingleShotSpine } from '@renderer/pages/studio/components/EntryKit/lib/spine';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;

const input = {
  brief: 'Context from the creator: playful tone.\n\nOpen on the logo.',
  durationSeconds: 8,
};

describe('buildSingleShotSpine', () => {
  it('emits set_brief, set_routes, add_beat and add_shot, in that order', () => {
    const { operations } = buildSingleShotSpine(input);

    expect(operations.map((operation) => operation.kind)).toEqual([
      'set_brief',
      'set_routes',
      'add_beat',
      'add_shot',
    ]);
  });

  /**
   * Measured, not inferred: a fresh project has both route ids null, and `prepare-submission` then
   * returns `invalid_route` at step 5 -- not a `no_engine` capability block at step 4. Both routes
   * are set because `estimate.ts:742` picks `imageRouteId` for a seed still and `videoRouteId` for a
   * take, and the text-only path needs both.
   */
  it('sets both routes, because a seed still is image work', () => {
    const { operations } = buildSingleShotSpine({ ...input, imageRouteId: 'img-1', videoRouteId: 'vid-1' });

    expect(operations[1]).toEqual({ kind: 'set_routes', imageRouteId: 'img-1', videoRouteId: 'vid-1' });
  });

  it('carries the brief verbatim', () => {
    const { operations } = buildSingleShotSpine(input);
    const [setBrief] = operations;

    expect(setBrief).toEqual({ kind: 'set_brief', brief: input.brief });
  });

  it('gives the shot the chosen duration and the brief as its shooting script', () => {
    const { operations, shotId } = buildSingleShotSpine(input);
    const addShot = operations[3];

    expect(addShot).toEqual({
      kind: 'add_shot',
      beatId: expect.any(String),
      shotId,
      shot: { shootingScript: input.brief, durationSeconds: 8 },
      beforeShotId: null,
    });
  });

  it('gives the beat the whole duration', () => {
    const { operations, beatId } = buildSingleShotSpine(input);
    const addBeat = operations[2];

    expect(addBeat).toEqual({
      kind: 'add_beat',
      beatId,
      beat: { title: 'Shot 1', story: input.brief, targetSeconds: 8 },
      beforeBeatId: null,
    });
  });

  it('anchors the shot to the beat it just created', () => {
    const { operations, beatId } = buildSingleShotSpine(input);

    expect(operations[3]).toMatchObject({ beatId });
  });

  it('mints ids main will accept', () => {
    const { beatId, shotId } = buildSingleShotSpine(input);

    expect(beatId).toMatch(SAFE_ID);
    expect(shotId).toMatch(SAFE_ID);
    expect(beatId).not.toBe(shotId);
  });

  it('mints fresh ids on every call', () => {
    expect(buildSingleShotSpine(input).shotId).not.toBe(buildSingleShotSpine(input).shotId);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bunx vitest run tests/unit/pages/studio/entry/spine.test.ts`
Expected: FAIL — cannot resolve `lib/spine`.

- [ ] **Step 3: Write `spine.ts`**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioRendererAuthoringOperationV2 } from '@/common/types/project/creativeStudioTypes';

export type SingleShotSpineInput = {
  /** The composed brief: creator context followed by the template's instruction, verbatim. */
  brief: string;
  durationSeconds: number;
  /** Both required. A fresh project has neither, and `prepare-submission` answers `invalid_route`. */
  imageRouteId: string | null;
  videoRouteId: string | null;
};

export type SingleShotSpine = {
  beatId: string;
  shotId: string;
  operations: StudioRendererAuthoringOperationV2[];
};

/**
 * The whole authoring payload for a one-shot video.
 *
 * One beat holding one shot, because a short video is a single engine clip. There is nothing to
 * merge and no section spine to map: `StudioTemplate` carries rules and a prose instruction, not
 * sections, so the brief is the only content there is.
 *
 * The shooting script is the composed brief rather than a per-shot visual prompt. That is deliberate
 * and inherited: the catalogue's founding decision seeds rules and an instruction and explicitly
 * refuses prefab visual prompts, because a template cannot know the person's cast or look.
 *
 * Ids are minted here because `add_beat` and `add_shot` require the caller to supply them, which
 * also means the shot id is known before the batch is sent — exactly what `prepare-submission`
 * needs. `crypto.randomUUID()` satisfies main's `/^[A-Za-z0-9_-]{1,256}$/`.
 */
export const buildSingleShotSpine = ({
  brief,
  durationSeconds,
  imageRouteId,
  videoRouteId,
}: SingleShotSpineInput): SingleShotSpine => {
  const beatId = crypto.randomUUID();
  const shotId = crypto.randomUUID();
  return {
    beatId,
    shotId,
    operations: [
      { kind: 'set_brief', brief },
      // Measured on the CS3 base: without these, prepare-submission returns `invalid_route`. The
      // image route matters even for a video, because the conditioning seed still is image work.
      { kind: 'set_routes', imageRouteId, videoRouteId },
      {
        kind: 'add_beat',
        beatId,
        beat: { title: 'Shot 1', story: brief, targetSeconds: durationSeconds },
        beforeBeatId: null,
      },
      {
        kind: 'add_shot',
        beatId,
        shotId,
        shot: { shootingScript: brief, durationSeconds },
        beforeShotId: null,
      },
    ],
  };
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bunx vitest run tests/unit/pages/studio/entry/spine.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/components/EntryKit/lib/spine.ts tests/unit/pages/studio/entry/spine.test.ts
git commit -m "feat(studio): build the single-shot authoring spine"
```

---

## Task 3: Phase A — everything free, ending in a quote

**Files:**
- Create: `.../EntryKit/lib/prepareLaunch.ts`
- Test: `tests/unit/pages/studio/entry/prepareLaunch.test.ts`

Phase A must thread `expectedRevision` from each commit result into the next call. Asserting that
explicitly is the point of this task: *assuming* it was the root cause of a confirmed spend defect in
the source branch, where a hand-rolled `revision += 1` went stale against CAS-free writes and left
paid jobs running.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pages/studio/entry/prepareLaunch.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createProject = vi.fn();
const setRules = vi.fn();
const applyAuthoringBatch = vi.fn();
const getGenerationCapability = vi.fn();
const prepareSubmission = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: {
      createProject: { invoke: (input: unknown) => createProject(input) },
      setRules: { invoke: (input: unknown) => setRules(input) },
      applyAuthoringBatch: { invoke: (input: unknown) => applyAuthoringBatch(input) },
      getGenerationCapability: { invoke: (input: unknown) => getGenerationCapability(input) },
      prepareSubmission: { invoke: (input: unknown) => prepareSubmission(input) },
    },
  },
}));

const { prepareLaunch } = await import('@renderer/pages/studio/components/EntryKit/lib/prepareLaunch');

const QUOTE = {
  id: 'quote-1',
  projectId: 'p1',
  projectRevision: 4,
  expiresAt: '2026-09-03T10:00:00.000Z',
  currency: 'USD',
  baseItems: [],
  cascadeItems: [],
  lowerMinorUnits: 250,
  upperMinorUnits: 250,
  budget: { kind: 'no_policy' as const },
};

const request = {
  name: 'Patch trailer',
  brief: 'Open on the logo.',
  aspectRatio: '16:9' as const,
  resolution: '720p' as const,
  durationSeconds: 8,
  rules: [{ id: 'no-likenesses', text: 'No real likenesses', predicate: null }],
};

const happyPath = (): void => {
  createProject.mockResolvedValue({ ok: true, data: { id: 'p1', revision: 1 } });
  setRules.mockResolvedValue({ ok: true, data: { projectId: 'p1', projectRevision: 2 } });
  applyAuthoringBatch.mockResolvedValue({
    ok: true,
    data: { projectId: 'p1', projectRevision: 3, createdBeatIds: ['b1'], createdShotIds: ['s1'] },
  });
  getGenerationCapability.mockImplementation((input: { items: { target: { shotId: string } }[] }) =>
    Promise.resolve({
      ok: true,
      data: {
        projectId: 'p1',
        projectRevision: 3,
        catalogVersion: 'v1',
        supportedItems: input.items,
        blocks: [],
      },
    })
  );
  prepareSubmission.mockResolvedValue({ ok: true, data: { baseOnly: QUOTE, withCascade: null } });
};

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
});

describe('prepareLaunch', () => {
  it('calls the five free steps in order', async () => {
    const order: string[] = [];
    createProject.mockImplementation(() => {
      order.push('create');
      return Promise.resolve({ ok: true, data: { id: 'p1', revision: 1 } });
    });
    setRules.mockImplementation(() => {
      order.push('rules');
      return Promise.resolve({ ok: true, data: { projectId: 'p1', projectRevision: 2 } });
    });
    applyAuthoringBatch.mockImplementation(() => {
      order.push('author');
      return Promise.resolve({
        ok: true,
        data: { projectId: 'p1', projectRevision: 3, createdBeatIds: ['b1'], createdShotIds: ['s1'] },
      });
    });
    getGenerationCapability.mockImplementation((input: { items: unknown[] }) => {
      order.push('capability');
      return Promise.resolve({
        ok: true,
        data: { projectId: 'p1', projectRevision: 3, catalogVersion: null, supportedItems: input.items, blocks: [] },
      });
    });
    prepareSubmission.mockImplementation(() => {
      order.push('prepare');
      return Promise.resolve({ ok: true, data: { baseOnly: QUOTE, withCascade: null } });
    });

    await prepareLaunch(request);

    expect(order).toEqual(['create', 'rules', 'author', 'capability', 'prepare']);
  });

  it('threads the revision from each commit into the next call', async () => {
    await prepareLaunch(request);

    expect(setRules).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }));
    expect(applyAuthoringBatch).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }));
    expect(getGenerationCapability).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));
    expect(prepareSubmission).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));
  });

  /**
   * A `video_take` cannot generate from nothing: it is refused twice with `missing_conditioning`
   * (`estimate.ts:754`, `:815`) and the plan factory throws "direct video requests require
   * conditioning input". With a `seed_still` base and an empty cascade, main derives the
   * continuation at *the same* shot index (`estimate.ts:430`), so the cascade is that shot's take.
   */
  it('prices a seed still whose derived cascade is the take, when no first frame exists', async () => {
    await prepareLaunch(request);

    const [{ baseChoices, cascadeChoices }] = prepareSubmission.mock.calls[0] as [
      { baseChoices: unknown[]; cascadeChoices: unknown[] },
    ];
    const [{ operations }] = applyAuthoringBatch.mock.calls[0] as [{ operations: { shotId?: string }[] }];
    const mintedShotId = operations[3]!.shotId;

    expect(baseChoices).toEqual([{ target: { kind: 'shot', shotId: mintedShotId }, purpose: 'seed_still' }]);
    expect(cascadeChoices).toEqual([]);
  });

  it('returns the cascade quote on the text-only path, because that is the one that includes the take', async () => {
    const withCascade = { ...QUOTE, id: 'quote-2' };
    prepareSubmission.mockResolvedValue({ ok: true, data: { baseOnly: QUOTE, withCascade } });

    const result = await prepareLaunch(request);

    expect(result).toMatchObject({ status: 'quoted', quote: withCascade });
  });

  it('prices a take directly when the template supplied a first frame', async () => {
    await prepareLaunch({ ...request, firstFrameAssetId: 'asset-1' });

    const [{ baseChoices }] = prepareSubmission.mock.calls[0] as [{ baseChoices: { purpose: string }[] }];

    expect(baseChoices[0]!.purpose).toBe('video_take');
  });

  it('returns the base-only quote and the revision to confirm against', async () => {
    const result = await prepareLaunch(request);

    expect(result).toEqual({ status: 'quoted', projectId: 'p1', revision: 3, quote: QUOTE });
  });

  it('stops on a rejected duration without asking for a price', async () => {
    applyAuthoringBatch.mockResolvedValue({ ok: false, error: { code: 'invalid_payload', messageKey: 'k' } });

    const result = await prepareLaunch(request);

    expect(result).toEqual({ status: 'stopped', step: 'author', projectId: 'p1', messageKey: 'k' });
    expect(prepareSubmission).not.toHaveBeenCalled();
  });

  it('stops when main will not admit the generation, naming the block', async () => {
    getGenerationCapability.mockResolvedValue({
      ok: true,
      data: {
        projectId: 'p1',
        projectRevision: 3,
        catalogVersion: null,
        supportedItems: [],
        blocks: [{ role: 'video', blocks: [{ code: 'no_engine', role: 'video' }] }],
      },
    });

    const result = await prepareLaunch(request);

    expect(result).toMatchObject({ status: 'stopped', step: 'capability', projectId: 'p1' });
    expect(prepareSubmission).not.toHaveBeenCalled();
  });

  it('keeps a rules failure non-fatal and still reaches a quote', async () => {
    setRules.mockResolvedValue({ ok: false, error: { code: 'invalid_payload', messageKey: 'k' } });

    const result = await prepareLaunch(request);

    expect(result).toMatchObject({ status: 'quoted' });
    expect(applyAuthoringBatch).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }));
  });

  it('never reaches a later step once creation fails', async () => {
    createProject.mockResolvedValue({ ok: false, error: { code: 'storage', messageKey: 'k' } });

    const result = await prepareLaunch(request);

    expect(result).toEqual({ status: 'stopped', step: 'create', projectId: null, messageKey: 'k' });
    expect(setRules).not.toHaveBeenCalled();
    expect(applyAuthoringBatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bunx vitest run tests/unit/pages/studio/entry/prepareLaunch.test.ts`
Expected: FAIL — cannot resolve `lib/prepareLaunch`.

- [ ] **Step 3: Write `prepareLaunch.ts`**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';

import type {
  StudioAspectRatio,
  StudioRendererSubmissionQuoteV2,
  StudioResolution,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioBriefRuleDraft } from '@/common/types/project/creativeStudioRules';

import { buildSingleShotSpine } from './spine';

export type PrepareLaunchStep = 'create' | 'rules' | 'author' | 'capability' | 'prepare';

export type PrepareLaunchRequest = {
  name: string;
  /** Composed brief: creator context, then the template's instruction verbatim. */
  brief: string;
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  durationSeconds: number;
  rules: StudioBriefRuleDraft[];
  /** Both required: a fresh project has neither and pricing answers `invalid_route`. */
  imageRouteId: string | null;
  videoRouteId: string | null;
  /** An imported first frame, when the template supplies one. Null means a seed still is priced. */
  firstFrameAssetId: string | null;
};

export type PrepareLaunchResult =
  | { status: 'quoted'; projectId: string; revision: number; quote: StudioRendererSubmissionQuoteV2 }
  | { status: 'stopped'; step: PrepareLaunchStep; projectId: string | null; messageKey: string };

const STORAGE_MESSAGE_KEY = 'conversation.creativeStudio.errors.storage';
const BLOCK_MESSAGE_KEY = 'conversation.creativeStudio.entry.launch.notAdmitted';

/** A bridge call that resolves null instead of throwing, so every stop is one shape. */
const attempt = async <T>(run: () => Promise<T>): Promise<T | null> => {
  try {
    return await run();
  } catch {
    return null;
  }
};

/**
 * Everything free, ending in a price nobody has agreed to yet.
 *
 * Split from the paid half deliberately. CS3 prices work and then waits for authorization, so this
 * phase can be re-run at no cost — which is what makes an expired quote a non-event rather than an
 * error. Nothing here can spend money.
 *
 * The revision is threaded from each commit result into the next call rather than incremented. The
 * source branch incremented, and because job-status writes advance the same counter without CAS, one
 * interleaved write went stale and left paid work running. Read the number, never guess it.
 */
export const prepareLaunch = async (request: PrepareLaunchRequest): Promise<PrepareLaunchResult> => {
  const created = await attempt(() =>
    ipcBridge.creativeStudio.createProject.invoke({
      name: request.name,
      brief: request.brief,
      aspectRatio: request.aspectRatio,
      targetDurationSeconds: request.durationSeconds,
      resolution: request.resolution,
    })
  );
  if (created === null) return { status: 'stopped', step: 'create', projectId: null, messageKey: STORAGE_MESSAGE_KEY };
  if (created.ok === false) {
    return { status: 'stopped', step: 'create', projectId: null, messageKey: created.error.messageKey };
  }
  const projectId = created.data.id;
  let revision = created.data.revision;

  if (request.rules.length > 0) {
    const pinned = await attempt(() =>
      ipcBridge.creativeStudio.setRules.invoke({ projectId, expectedRevision: revision, rules: request.rules })
    );
    // Non-fatal: the project exists and the Rules drawer can pin them later. Stopping here would
    // strand a usable project behind a failure the person can fix in one place.
    if (pinned !== null && pinned.ok) revision = pinned.data.projectRevision;
  }

  const spine = buildSingleShotSpine({
    brief: request.brief,
    durationSeconds: request.durationSeconds,
    imageRouteId: request.imageRouteId,
    videoRouteId: request.videoRouteId,
  });
  const authored = await attempt(() =>
    ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
      projectId,
      expectedRevision: revision,
      operations: spine.operations,
    })
  );
  if (authored === null) return { status: 'stopped', step: 'author', projectId, messageKey: STORAGE_MESSAGE_KEY };
  if (authored.ok === false) {
    // Main owns duration validity and answers `invalid_shot_duration` here, which is why a stale
    // display window costs a failed free call and never a wrong charge.
    return { status: 'stopped', step: 'author', projectId, messageKey: authored.error.messageKey };
  }
  revision = authored.data.projectRevision;

  /*
   * The purpose depends on whether a first frame exists, because a take cannot generate from nothing.
   *
   * No conditioning -> `seed_still`, and an empty `cascadeChoices` makes main derive the continuation
   * at the SAME shot index (`estimate.ts:430`), so the cascade is this shot's take: one prepare, one
   * confirm, two priced generations. With a first frame, `effectiveSeedAsset` resolves
   * (`estimate.ts:502`) and the take prices directly as one charge.
   */
  const purpose = request.firstFrameAssetId === null ? ('seed_still' as const) : ('video_take' as const);
  const items = [{ target: { kind: 'shot' as const, shotId: spine.shotId }, purpose }];
  const capability = await attempt(() =>
    ipcBridge.creativeStudio.getGenerationCapability.invoke({ projectId, expectedRevision: revision, items })
  );
  if (capability === null || capability.ok === false) {
    return { status: 'stopped', step: 'capability', projectId, messageKey: STORAGE_MESSAGE_KEY };
  }
  // An admission probe, not a window probe: it answers whether main will take this generation at all.
  // Asking before the price means "no engine connected" costs nothing.
  const admitted = capability.data.supportedItems.some(
    (item) => item.target.kind === 'shot' && item.target.shotId === spine.shotId
  );
  if (!admitted) return { status: 'stopped', step: 'capability', projectId, messageKey: BLOCK_MESSAGE_KEY };

  const prepared = await attempt(() =>
    ipcBridge.creativeStudio.prepareSubmission.invoke({
      projectId,
      expectedRevision: revision,
      originReferenceHandoffId: null,
      baseChoices: items,
      // Explicitly empty rather than omitted: an empty array asks main to derive a canonical
      // continuation, and a one-shot video has nothing to continue. We confirm `baseOnly` regardless.
      cascadeChoices: [],
    })
  );
  if (prepared === null) return { status: 'stopped', step: 'prepare', projectId, messageKey: STORAGE_MESSAGE_KEY };
  if (prepared.ok === false) {
    return { status: 'stopped', step: 'prepare', projectId, messageKey: prepared.error.messageKey };
  }

  // The cascade quote is the one that includes the take when we based on a seed still. Falling back
  // to `baseOnly` would authorize an image and no video.
  const quote = purpose === 'seed_still' ? (prepared.data.withCascade ?? prepared.data.baseOnly) : prepared.data.baseOnly;
  return { status: 'quoted', projectId, revision, quote };
};
```

- [ ] **Step 4: Confirm no explicit route selection is needed**

The spec left this open. `set_routes` is an authoring operation taking
`{ imageRouteId, videoRouteId }`, and a fresh project may have neither set. Check whether
`prepare-submission` requires them:

```bash
git grep -n 'videoRouteId' -- packages/desktop/src/process/services/creative-studio/ | head -20
```

If a route is required before pricing, add a fourth operation to the spine's batch:
`{ kind: 'set_routes', imageRouteId: null, videoRouteId: <the connected video route id from list-routes> }`,
and extend `spine.test.ts` to assert its presence and position. If routes are resolved by main — which
the `no_engine` capability block suggests, since that block exists precisely to answer "nothing is
connected" — change nothing and record the finding in the task's commit message.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bunx vitest run tests/unit/pages/studio/entry/prepareLaunch.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/components/EntryKit/lib/prepareLaunch.ts tests/unit/pages/studio/entry/prepareLaunch.test.ts
git commit -m "feat(studio): prepare a priced one-shot launch without spending"
```

---

## Task 4: Phase B — the only file that can spend

**Files:**
- Create: `.../EntryKit/lib/runPaidLaunch.ts`
- Test: `tests/unit/pages/studio/entry/runPaidLaunch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pages/studio/entry/runPaidLaunch.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const confirmSubmission = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: { confirmSubmission: { invoke: (input: unknown) => confirmSubmission(input) } },
  },
}));

const { runPaidLaunch } = await import('@renderer/pages/studio/components/EntryKit/lib/runPaidLaunch');

const authorization = { projectId: 'p1', quoteId: 'quote-1', revision: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  confirmSubmission.mockResolvedValue({ ok: true, data: { projectId: 'p1', projectRevision: 4 } });
});

describe('runPaidLaunch', () => {
  it('confirms exactly the authorized quote', async () => {
    await runPaidLaunch(authorization);

    expect(confirmSubmission).toHaveBeenCalledWith({ projectId: 'p1', quoteId: 'quote-1', expectedRevision: 3 });
  });

  it('reports the project to open once confirmed', async () => {
    await expect(runPaidLaunch(authorization)).resolves.toEqual({ status: 'submitted', projectId: 'p1' });
  });

  it('confirms once even when called twice for the same quote', async () => {
    await Promise.all([runPaidLaunch(authorization), runPaidLaunch(authorization)]);

    expect(confirmSubmission).toHaveBeenCalledTimes(1);
  });

  it('confirms again for a different quote', async () => {
    await runPaidLaunch(authorization);
    await runPaidLaunch({ ...authorization, quoteId: 'quote-2' });

    expect(confirmSubmission).toHaveBeenCalledTimes(2);
  });

  it('reports a refused confirmation without claiming a submission', async () => {
    confirmSubmission.mockResolvedValue({ ok: false, error: { code: 'stale_project', messageKey: 'k' } });

    await expect(runPaidLaunch({ ...authorization, quoteId: 'quote-3' })).resolves.toEqual({
      status: 'refused',
      projectId: 'p1',
      messageKey: 'k',
    });
  });

  it('reports a thrown confirmation as refused rather than hanging', async () => {
    confirmSubmission.mockRejectedValue(new Error('bridge closed'));

    await expect(runPaidLaunch({ ...authorization, quoteId: 'quote-4' })).resolves.toMatchObject({
      status: 'refused',
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bunx vitest run tests/unit/pages/studio/entry/runPaidLaunch.test.ts`
Expected: FAIL — cannot resolve `lib/runPaidLaunch`.

- [ ] **Step 3: Write `runPaidLaunch.ts`**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';

export type PaidLaunchAuthorization = {
  projectId: string;
  /** The quote the person authorized. Single-use at main, and the idempotency key here. */
  quoteId: string;
  revision: number;
};

export type PaidLaunchResult =
  | { status: 'submitted'; projectId: string }
  | { status: 'refused'; projectId: string; messageKey: string };

const STORAGE_MESSAGE_KEY = 'conversation.creativeStudio.errors.storage';

/**
 * Quotes already confirmed in this window.
 *
 * The whole spend guard, and it is this small because CS3 made it small: a confirmation authorizes
 * one specific priced quote, so the quote id is a natural idempotency key. The source branch tracked
 * submitted *projects* in a set and hand-rolled a cancel loop around a long-running wait; both are
 * gone, and with them the defect that loop carried.
 */
const confirmed = new Set<string>();

/**
 * The one call in this feature that costs money.
 *
 * Deliberately the whole of the paid phase: confirm, then let CS3's own views take over. There is no
 * in-popup wait to abort, no job polling and no film export, because a short video is a single clip
 * and that clip is the deliverable.
 */
export const runPaidLaunch = async ({
  projectId,
  quoteId,
  revision,
}: PaidLaunchAuthorization): Promise<PaidLaunchResult> => {
  if (confirmed.has(quoteId)) return { status: 'submitted', projectId };
  confirmed.add(quoteId);
  try {
    const result = await ipcBridge.creativeStudio.confirmSubmission.invoke({
      projectId,
      quoteId,
      expectedRevision: revision,
    });
    if (result.ok === false) return { status: 'refused', projectId, messageKey: result.error.messageKey };
    return { status: 'submitted', projectId };
  } catch {
    return { status: 'refused', projectId, messageKey: STORAGE_MESSAGE_KEY };
  }
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bunx vitest run tests/unit/pages/studio/entry/runPaidLaunch.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/components/EntryKit/lib/runPaidLaunch.ts tests/unit/pages/studio/entry/runPaidLaunch.test.ts
git commit -m "feat(studio): confirm one authorized quote, once"
```

---

## Task 5: The confirm panel, with its 12 locales

The source popup showed a clip count and no price. CS3 hands us the price, the engine and a budget
verdict, so the panel states all three.

**Files:**
- Create: `.../EntryKit/templates/ConfirmPanel.tsx`
- Create: `.../EntryKit/templates/ConfirmPanel.module.css`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/<12 locales>/conversation.json`
- Test: `tests/unit/pages/studio/entry/ConfirmPanel.dom.test.tsx`

- [ ] **Step 1: Add the English keys**

In `locales/en-US/conversation.json`, under `creativeStudio.entry`, add:

```json
"confirm": {
  "title": "Generate this video",
  "engine": "Engine",
  "length": "Length",
  "price": "Price",
  "priceRange": "{{lower}}–{{upper}} {{currency}}",
  "priceExact": "{{amount}} {{currency}}",
  "expires": "This price holds until {{time}}",
  "expired": "This price expired. Re-checking.",
  "overCap": "This costs more than your per-batch cap of {{cap}} {{currency}}.",
  "currencyMismatch": "This is priced in {{quoted}} but your cap is set in {{policy}}.",
  "generate": "Generate",
  "cancel": "Cancel"
}
```

- [ ] **Step 2: Mirror the keys into the other 11 locales and declare them pending**

The repo requires every referenced key to exist in **all 12** locales, so this cannot be a later
task — batching it would design in a red window. Copy the same block into `de-DE`, `es-ES`, `fa-IR`,
`ja-JP`, `ko-KR`, `pt-BR`, `ru-RU`, `tr-TR`, `uk-UA`, `zh-CN`, `zh-TW`, then declare the untranslated
English:

```bash
bun run i18n:pending --declare "short video templates: confirm panel"
node scripts/check-i18n.js
```

Expected: `check-i18n.js` passes. Do **not** machine-translate to make it pass.

- [ ] **Step 3: Write the failing DOM test**

Create `tests/unit/pages/studio/entry/ConfirmPanel.dom.test.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  // More than `{ t }`: a mock without `i18n` breaks anything reading `i18n.language`.
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

const { ConfirmPanel } = await import('@renderer/pages/studio/components/EntryKit/templates/ConfirmPanel');

const quote = {
  id: 'q1',
  projectId: 'p1',
  projectRevision: 3,
  expiresAt: '2026-09-03T10:00:00.000Z',
  currency: 'USD',
  baseItems: [
    {
      target: { kind: 'shot' as const, shotId: 's1' },
      referenceTarget: null,
      purpose: 'video_take' as const,
      route: { providerId: 'byteplus', model: 'seedance-1-5-pro-251215' },
      generationCount: 1,
      durationSeconds: 8,
      conditioningAssetId: null,
      oneGenerationMinorUnits: 250,
      requestedTotalMinorUnits: 250,
      composition: {},
    },
  ],
  cascadeItems: [],
  lowerMinorUnits: 250,
  upperMinorUnits: 250,
  budget: { kind: 'no_policy' as const },
};

describe('ConfirmPanel', () => {
  it('names the engine that will be billed', () => {
    render(<ConfirmPanel quote={quote as never} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/seedance-1-5-pro-251215/)).toBeTruthy();
  });

  it('states an exact price when the range is a single value', () => {
    render(<ConfirmPanel quote={quote as never} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/priceExact.*2\.5.*USD/)).toBeTruthy();
  });

  it('states a range when the bounds differ', () => {
    const ranged = { ...quote, upperMinorUnits: 500 };
    render(<ConfirmPanel quote={ranged as never} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/priceRange/)).toBeTruthy();
  });

  it('warns when the quote exceeds the per-batch cap', () => {
    const over = {
      ...quote,
      budget: { kind: 'over_cap' as const, policyCurrency: 'USD', maxPerBatchMinorUnits: 100 },
    };
    render(<ConfirmPanel quote={over as never} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/overCap/)).toBeTruthy();
  });

  it('warns when the cap is set in another currency', () => {
    const mismatch = {
      ...quote,
      budget: { kind: 'currency_mismatch' as const, policyCurrency: 'EUR', maxPerBatchMinorUnits: 100 },
    };
    render(<ConfirmPanel quote={mismatch as never} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/currencyMismatch/)).toBeTruthy();
  });

  it('hands the confirm handler the quote id', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmPanel quote={quote as never} onConfirm={onConfirm} onCancel={vi.fn()} />);

    screen.getByRole('button', { name: /entry\.confirm\.generate/ }).click();

    expect(onConfirm).toHaveBeenCalledWith('q1');
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `bunx vitest run tests/unit/pages/studio/entry/ConfirmPanel.dom.test.tsx`
Expected: FAIL — cannot resolve `templates/ConfirmPanel`.

- [ ] **Step 5: Write `ConfirmPanel.tsx`**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioRendererSubmissionQuoteV2 } from '@/common/types/project/creativeStudioTypes';

import styles from './ConfirmPanel.module.css';

export type ConfirmPanelProps = {
  quote: StudioRendererSubmissionQuoteV2;
  onConfirm: (quoteId: string) => void;
  onCancel: () => void;
};

/** Minor units are the wire format; people read major units. */
const major = (minorUnits: number): string => (minorUnits / 100).toFixed(2);

/**
 * The price, before anything is spent.
 *
 * This panel exists because CS3 gives us something the source popup never had: an itemized quote
 * naming the engine, a price range and a budget verdict. The source flow stated a clip count and
 * charged silently; a review found no user-facing mention of cost anywhere in it.
 */
export const ConfirmPanel: React.FC<ConfirmPanelProps> = ({ quote, onConfirm, onCancel }) => {
  const { t } = useTranslation();
  // Both collections, because a text-only launch prices a seed still (base) and its take (cascade).
  // Showing only `baseItems` would state an image's price for a video.
  const items = [...quote.baseItems, ...quote.cascadeItems];
  const item = items[0] ?? null;
  const exact = quote.lowerMinorUnits === quote.upperMinorUnits;

  return (
    <section className={styles.panel} aria-label={t('conversation.creativeStudio.entry.confirm.title')}>
      <h3 className={styles.title}>{t('conversation.creativeStudio.entry.confirm.title')}</h3>

      {item !== null ? (
        <dl className={styles.facts}>
          <dt>{t('conversation.creativeStudio.entry.confirm.engine')}</dt>
          <dd>{items.map((quoted) => quoted.route.model).join(' → ')}</dd>
          <dt>{t('conversation.creativeStudio.entry.confirm.length')}</dt>
          <dd>{item.durationSeconds}s</dd>
          <dt>{t('conversation.creativeStudio.entry.confirm.price')}</dt>
          <dd>
            {exact
              ? t('conversation.creativeStudio.entry.confirm.priceExact', {
                  amount: major(quote.lowerMinorUnits),
                  currency: quote.currency,
                })
              : t('conversation.creativeStudio.entry.confirm.priceRange', {
                  lower: major(quote.lowerMinorUnits),
                  upper: major(quote.upperMinorUnits),
                  currency: quote.currency,
                })}
          </dd>
        </dl>
      ) : null}

      {quote.budget.kind === 'over_cap' ? (
        <p role='alert' className={styles.warning}>
          {t('conversation.creativeStudio.entry.confirm.overCap', {
            cap: major(quote.budget.maxPerBatchMinorUnits),
            currency: quote.budget.policyCurrency,
          })}
        </p>
      ) : null}

      {quote.budget.kind === 'currency_mismatch' ? (
        <p role='alert' className={styles.warning}>
          {t('conversation.creativeStudio.entry.confirm.currencyMismatch', {
            quoted: quote.currency,
            policy: quote.budget.policyCurrency,
          })}
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button onClick={onCancel}>{t('conversation.creativeStudio.entry.confirm.cancel')}</Button>
        <Button type='primary' onClick={() => onConfirm(quote.id)}>
          {t('conversation.creativeStudio.entry.confirm.generate')}
        </Button>
      </div>
    </section>
  );
};
```

- [ ] **Step 6: Write `ConfirmPanel.module.css`**

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16px;
  color: var(--color-text-1);
}

.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 16px;
  margin: 0;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-text-2);
}

.facts dd {
  margin: 0;
  color: var(--color-text-1);
}

.warning {
  margin: 0;
  color: var(--color-warning-6);
  font-family: var(--font-body);
  font-size: 13px;
}

.actions {
  /*
   * Shared rather than a fourth copy. The source branch defined byte-identical `.actions` and
   * `.error` rules in three separate modal stylesheets; the review counted ~45 duplicated lines.
   * These files already compose typography, so compose the chrome too.
   */
  composes: modalActions from './TemplateModal.module.css';
}
```

Add the composable base to `TemplateModal.module.css`:

```css
.modalActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

`composes:` must sit on a rule whose selector is exactly one bare local class — a compound selector
makes PostCSS fail the stylesheet at import time in a way neither `tsc`, oxlint nor jsdom catches.
`tests/unit/pages/studio/studioStylesheetComposes.test.ts` guards exactly that.

- [ ] **Step 7: Run the test and confirm it passes**

Run: `bunx vitest run tests/unit/pages/studio/entry/ConfirmPanel.dom.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/components/EntryKit/templates packages/desktop/src/renderer/services/i18n/locales tests/unit/pages/studio/entry/ConfirmPanel.dom.test.tsx
git commit -m "feat(studio): state the engine and the price before generating"
```

---

## Task 6: Port cover art, with its two review fixes

**Files:**
- Create: `.../EntryKit/coverArt/{CoverArt.tsx,artLanguage.tsx,makeRng.ts,projectArtFormat.ts,CoverArt.module.css}`
- Test: `tests/unit/pages/studio/entry/coverArt.test.ts`

- [ ] **Step 1: Copy the five files, renaming the stylesheet**

```bash
REF=entrykit/feat/creative-studio-entry-kit
SRC=WePrompt/packages/desktop/src/renderer/pages/studio/components/EntryKit/coverArt
DEST=packages/desktop/src/renderer/pages/studio/components/EntryKit/coverArt
for f in CoverArt.tsx artLanguage.tsx makeRng.ts projectArtFormat.ts; do
  git show "${REF}:${SRC}/${f}" > "${DEST}/${f}"
done
git show "${REF}:${SRC}/coverArt.module.css" > "${DEST}/CoverArt.module.css"
```

`AGENTS.md` allows `kebab-case` or `ComponentName.module.css`; the source used lowerCamelCase, which
is neither, and every pre-existing studio stylesheet complies.

- [ ] **Step 2: Fix the import and the hardcoded color**

In `CoverArt.tsx`, change `from './coverArt.module.css'` to `from './CoverArt.module.css'`.

In `CoverArt.module.css`, replace the hardcoded scrim
`background: linear-gradient(180deg, rgb(0 0 0 / 0%) 34%, rgb(0 0 0 / 62%) 100%);` with:

```css
  background: linear-gradient(180deg, transparent 34%, var(--color-mask-bg) 100%);
```

- [ ] **Step 3: Write the failing test for the hash de-duplication**

Create `tests/unit/pages/studio/entry/coverArt.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { makeRng } from '@renderer/pages/studio/components/EntryKit/coverArt/makeRng';
import { resolveProjectArtFormat } from '@renderer/pages/studio/components/EntryKit/coverArt/projectArtFormat';

describe('makeRng', () => {
  it('replays one seed and diverges across seeds', () => {
    expect(makeRng('a')()).toBe(makeRng('a')());
    expect(makeRng('a')()).not.toBe(makeRng('b')());
  });

  it('stays inside the unit interval', () => {
    const rng = makeRng('seed');
    for (let index = 0; index < 64; index += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('resolveProjectArtFormat', () => {
  it('draws portrait projects portrait and landscape landscape', () => {
    expect(['tiktok', 'reels']).toContain(resolveProjectArtFormat('p1', '9:16'));
    expect(['motion-graphics', 'trailer']).toContain(resolveProjectArtFormat('p1', '16:9'));
  });

  it('is stable for one id and varies across ids', () => {
    expect(resolveProjectArtFormat('p1', '16:9')).toBe(resolveProjectArtFormat('p1', '16:9'));
  });

  /** One seeding scheme per directory: it must not carry a second bespoke hash beside makeRng. */
  it('seeds from makeRng rather than its own hash', () => {
    const source = resolveProjectArtFormat.toString();

    expect(source).not.toMatch(/charCodeAt/);
  });
});
```

- [ ] **Step 4: Run it and confirm the last test fails**

Run: `bunx vitest run tests/unit/pages/studio/entry/coverArt.test.ts`
Expected: FAIL on "seeds from makeRng" — the ported file hashes with `Math.imul(hash, 31) + charCodeAt`.

- [ ] **Step 5: Replace the bespoke hash with the sibling RNG**

In `projectArtFormat.ts`, add `import { makeRng } from './makeRng';` and replace the body of
`resolveProjectArtFormat` with:

```ts
export const resolveProjectArtFormat = (projectId: string, aspectRatio: StudioAspectRatio): StudioEntryArtFormat => {
  const candidates = FORMATS_BY_ORIENTATION[orientationOf(aspectRatio)];
  // One seeding scheme for the directory. A second bespoke hash beside makeRng's FNV-1a meant two
  // independent definitions of "deterministic pick from an id" three files apart.
  const index = Math.floor(makeRng(projectId)() * candidates.length);
  return candidates[Math.min(index, candidates.length - 1)]!;
};
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `bunx vitest run tests/unit/pages/studio/entry/coverArt.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/components/EntryKit/coverArt tests/unit/pages/studio/entry/coverArt.test.ts
git commit -m "feat(studio): port seeded cover art with one hash and a colour token"
```

---

## Task 7: Port the brief composer

**Files:**
- Create: `.../EntryKit/lib/{composeInstruction.ts,formatDuration.ts}`
- Test: `tests/unit/pages/studio/entry/composeInstruction.test.ts`

- [ ] **Step 1: Copy both files and fix their import aliases**

```bash
REF=entrykit/feat/creative-studio-entry-kit
SRC=WePrompt/packages/desktop/src/renderer/pages/studio/components/EntryKit/lib
DEST=packages/desktop/src/renderer/pages/studio/components/EntryKit/lib
for f in composeInstruction.ts formatDuration.ts; do
  git show "${REF}:${SRC}/${f}" > "${DEST}/${f}"
done
```

In `composeInstruction.ts`, replace `from '../../../studioRouteConstraints'` with
`from '@renderer/pages/studio/studioRouteConstraints'`. `AGENTS.md` requires the path aliases.

- [ ] **Step 2: Delete `formatDurationClock`**

It duplicates `formatRuntime` in `PhaseShell/StudioPhaseShell.tsx`, which additionally handles hours
and guards non-finite input. Only `TemplateCard` used it, and Task 8 renders a single duration, so
remove the function and keep `formatDurationLabel`.

- [ ] **Step 3: Write the failing test**

Create `tests/unit/pages/studio/entry/composeInstruction.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { composeInstruction } from '@renderer/pages/studio/components/EntryKit/lib/composeInstruction';
import { STUDIO_DEFAULT_PROJECT_SETTINGS } from '@/common/types/project/creativeStudioTypes';

const base = {
  toneLabel: 'Playful',
  durationLabel: '8 seconds',
  formatLabel: 'Trailer',
  aspectRatio: '16:9' as const,
  about: 'A patch trailer',
  settings: STUDIO_DEFAULT_PROJECT_SETTINGS,
  lookCount: 0,
  clipWindow: { minDurationSeconds: 4, maxDurationSeconds: 12 },
  instruction: 'Cut hard on the beat.',
};

describe('composeInstruction', () => {
  it('keeps the template instruction verbatim at the end', () => {
    expect(composeInstruction(base).endsWith('Cut hard on the beat.')).toBe(true);
  });

  it('states the connected engine clip window', () => {
    expect(composeInstruction(base)).toContain('between 4 and 12 seconds');
  });

  it('says the window is unknown rather than guessing', () => {
    expect(composeInstruction({ ...base, clipWindow: null })).toContain('clip length limits are unknown');
  });

  it('states an unspecified subject instead of dropping the line', () => {
    expect(composeInstruction({ ...base, about: '   ' })).toContain('not specified yet');
  });
});
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bunx vitest run tests/unit/pages/studio/entry/composeInstruction.test.ts`
Expected: PASS, 4 tests. (The ported implementation already satisfies these; the test pins behaviour
we are relying on rather than driving new code.)

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/components/EntryKit/lib tests/unit/pages/studio/entry/composeInstruction.test.ts
git commit -m "feat(studio): port the brief composer onto CS3 aliases"
```

---

## Task 8: Port the gallery and the modal

**Files:**
- Create: `.../EntryKit/templates/{TemplateGallery.tsx,TemplateCard.tsx,TemplateModal.tsx,SettingsBlock.tsx}`
- Create: `.../EntryKit/templates/{TemplateModal.module.css,SettingsBlock.module.css}`
- Create: `.../EntryKit/{StudioEntry.tsx,EntryKit.module.css}`
- Test: `tests/unit/pages/studio/entry/TemplateModal.dom.test.tsx`

- [ ] **Step 1: Copy the components and stylesheets, renaming as you go**

```bash
REF=entrykit/feat/creative-studio-entry-kit
SRC=WePrompt/packages/desktop/src/renderer/pages/studio/components/EntryKit
DEST=packages/desktop/src/renderer/pages/studio/components/EntryKit
for f in TemplateGallery.tsx TemplateCard.tsx TemplateModal.tsx SettingsBlock.tsx; do
  git show "${REF}:${SRC}/templates/${f}" > "${DEST}/templates/${f}"
done
git show "${REF}:${SRC}/templates/templateModal.module.css" > "${DEST}/templates/TemplateModal.module.css"
git show "${REF}:${SRC}/templates/settingsBlock.module.css" > "${DEST}/templates/SettingsBlock.module.css"
git show "${REF}:${SRC}/StudioEntry.tsx" > "${DEST}/StudioEntry.tsx"
git show "${REF}:${SRC}/entryKit.module.css" > "${DEST}/EntryKit.module.css"
```

- [ ] **Step 2: Apply the mechanical edits**

1. Update every `*.module.css` import to the new capitalised filename.
2. Replace `from '../../../studioRouteConstraints'` with
   `from '@renderer/pages/studio/studioRouteConstraints'` in `TemplateModal.tsx`.
3. In `TemplateModal.module.css`, replace `color: #fff;` and `color: rgb(255 255 255 / 78%);` with
   `color: var(--studio-take-text);` — the same token `EntryKit.module.css` already uses for
   white-on-media text.
4. In `TemplateModal.tsx`, replace `STUDIO_ENTRY_DURATIONS` with `studioShortDurations(clipWindow)`
   and the template's `durationsSeconds` middle entry with `template.defaultDurationSeconds`.
5. Delete the `formatDurationClock` import and the `~{clock} · {ratio}` line in `TemplateCard.tsx`;
   render `formatDurationLabel(template.defaultDurationSeconds, t)` instead.

- [ ] **Step 3: Reduce `StudioEntry.tsx` to two tabs**

Delete the `explore` tab, the `QuickSuggestions` element, the `ExploreGallery`/`ExploreDetail`
elements and their imports, and the `openExploreItem` state. Delete `LaunchFlow` and replace it with
the `launch` state driving Task 9's wiring. `STUDIO_ENTRY_TABS` in `types.ts` becomes
`['templates', 'projects'] as const`.

- [ ] **Step 4: Write the failing DOM test**

Create `tests/unit/pages/studio/entry/TemplateModal.dom.test.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

const { TemplateModal } = await import('@renderer/pages/studio/components/EntryKit/templates/TemplateModal');
const { STUDIO_TEMPLATES } = await import('@renderer/pages/studio/components/EntryKit/data/templates');

describe('TemplateModal', () => {
  it('offers only durations the engine can render in one clip', () => {
    render(
      <TemplateModal
        template={STUDIO_TEMPLATES[0]!}
        clipWindow={{ minDurationSeconds: 4, maxDurationSeconds: 8 }}
        onCancel={vi.fn()}
        onProcess={vi.fn()}
      />
    );

    expect(screen.queryByText('12')).toBeNull();
  });

  it('renders nothing when no template is open', () => {
    const { container } = render(
      <TemplateModal template={null} clipWindow={null} onCancel={vi.fn()} onProcess={vi.fn()} />
    );

    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 5: Run the whole suite**

Run: `bun run test`
Expected: PASS. If `studioI18n` fails on missing keys, add the referenced keys to all 12 locales and
declare them pending — never machine-translate to go green.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/components/EntryKit tests/unit/pages/studio/entry
git commit -m "feat(studio): port the short-video template gallery and modal"
```

---

## Task 9: Graft the entry surface onto the CS3 library

**Files:**
- Modify: `.../components/Library/Composer.tsx`
- Modify: `.../components/Library/StudioLibrary.tsx`
- Modify: `.../components/Library/ProjectCard.tsx`
- Modify: `.../components/Library/index.ts`
- Test: `tests/unit/pages/studio/entry/StudioLibraryEntry.dom.test.tsx`

- [ ] **Step 1: Lift `sentence` out of `Composer`**

In `Composer.tsx`, delete `const [sentence, setSentence] = useState('');` and add to `ComposerProps`:

```ts
  /**
   * Lifted because the template modal writes into it. A control the parent cannot reach would force
   * the modal to create the project itself, which is the one thing it must not do before a price is
   * agreed.
   */
  sentence: string;
  onSentenceChange: (sentence: string) => void;
```

Destructure both, and replace every `setSentence(` call with `onSentenceChange(`.

- [ ] **Step 2: Own the state and mount the entry surface in `StudioLibrary`**

Add `const [sentence, setSentence] = useState('');` and a `clipWindow` fetch. Pass
`sentence`/`onSentenceChange` to `Composer`. Then replace the `projectsBlock` JSX (the
`projects.length > 0 ? (...) : null` block) with `<StudioEntry>`, handing the existing projects
markup in as the `projects` prop so there is one implementation of the listing:

```tsx
<StudioEntry
  disabled={mutationBusy || deleteCandidate !== null}
  clipWindow={clipWindow}
  initialTab='templates'
  projects={projectsMarkup}
  onFillComposer={setSentence}
  onOpenProject={(projectId) => navigate(studioEntryPath(projectId))}
/>
```

Extract the existing grid into a `projectsMarkup` const immediately above the return.

- [ ] **Step 3: Give `ProjectCard` a clickable poster**

Wrap the poster region in the existing `onOpen` handler and render `<CoverArt>` behind it, seeded
from the project id and formatted by its aspect ratio:

```tsx
<CoverArt {...{ seed: project.id, format: resolveProjectArtFormat(project.id, project.aspectRatio) }} />
```

Read `CoverArt.tsx`'s exported prop type first and match it exactly — it was ported verbatim in
Task 6, so its prop names are whatever that file declares, not whatever this snippet guesses.

Keep every existing prop (`projectRevision`, `projectStatus`, `locale`) untouched — CS3's card
carries more than the source branch's did. The review measured the source change as taking the
clickable area from 583px² to 74,529px² (0.45% to 57% of the card), so verify the whole poster is
clickable, not just the title.

Add JSDoc to any exported function or component you touch that lacks it — `AGENTS.md` requires it and
the review counted 16 exports in the source branch without it.

- [ ] **Step 4: Write the failing DOM test**

Create `tests/unit/pages/studio/entry/StudioLibraryEntry.dom.test.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

const { StudioEntry } = await import('@renderer/pages/studio/components/EntryKit/StudioEntry');

describe('StudioEntry', () => {
  it('lands on Templates, because it is the only thing here not reachable elsewhere', () => {
    render(
      <StudioEntry
        disabled={false}
        clipWindow={{ minDurationSeconds: 4, maxDurationSeconds: 12 }}
        initialTab='templates'
        projects={<div>project list</div>}
        onFillComposer={vi.fn()}
        onOpenProject={vi.fn()}
      />
    );

    expect(screen.getByRole('tab', { name: /tabTemplates/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows the library its own project markup on the Projects tab', () => {
    render(
      <StudioEntry
        disabled={false}
        clipWindow={null}
        initialTab='projects'
        projects={<div>project list</div>}
        onFillComposer={vi.fn()}
        onOpenProject={vi.fn()}
      />
    );

    expect(screen.getByText('project list')).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run the suite**

Run: `bun run test`
Expected: PASS. CS3's existing `StudioLibrary` DOM tests must stay green — the listing markup moved
but did not change, and those tests require projects to be visible immediately.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/components tests/unit/pages/studio/entry
git commit -m "feat(studio): mount the template gallery in the CS3 library"
```

---

## Task 10: Wire the flow, and hand off to the project

**Files:**
- Modify: `.../EntryKit/StudioEntry.tsx`
- Test: `tests/unit/pages/studio/entry/launchWiring.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pages/studio/entry/launchWiring.dom.test.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const prepareLaunch = vi.fn();
const runPaidLaunch = vi.fn();

vi.mock('@renderer/pages/studio/components/EntryKit/lib/prepareLaunch', () => ({ prepareLaunch }));
vi.mock('@renderer/pages/studio/components/EntryKit/lib/runPaidLaunch', () => ({ runPaidLaunch }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

const { StudioEntry } = await import('@renderer/pages/studio/components/EntryKit/StudioEntry');

const quote = {
  id: 'q1',
  projectId: 'p1',
  projectRevision: 3,
  expiresAt: '2099-01-01T00:00:00.000Z',
  currency: 'USD',
  baseItems: [],
  cascadeItems: [],
  lowerMinorUnits: 250,
  upperMinorUnits: 250,
  budget: { kind: 'no_policy' },
};

describe('launch wiring', () => {
  it('opens the project only after the quote is confirmed', async () => {
    prepareLaunch.mockResolvedValue({ status: 'quoted', projectId: 'p1', revision: 3, quote });
    runPaidLaunch.mockResolvedValue({ status: 'submitted', projectId: 'p1' });
    const onOpenProject = vi.fn();

    render(
      <StudioEntry
        disabled={false}
        clipWindow={{ minDurationSeconds: 4, maxDurationSeconds: 12 }}
        initialTab='templates'
        projects={<div />}
        onFillComposer={vi.fn()}
        onOpenProject={onOpenProject}
      />
    );

    screen.getAllByRole('button', { name: /templateCard/ })[0]!.click();
    await waitFor(() => screen.getByRole('button', { name: /entry\.launch\.proceed/ }));
    screen.getByRole('button', { name: /entry\.launch\.proceed/ }).click();

    await waitFor(() => screen.getByRole('button', { name: /entry\.confirm\.generate/ }));
    expect(onOpenProject).not.toHaveBeenCalled();

    screen.getByRole('button', { name: /entry\.confirm\.generate/ }).click();

    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('p1'));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bunx vitest run tests/unit/pages/studio/entry/launchWiring.dom.test.tsx`
Expected: FAIL — no confirm button appears; the wiring does not exist.

- [ ] **Step 3: Wire the two phases in `StudioEntry.tsx`**

Add state and handlers:

```tsx
const [quote, setQuote] = useState<
  { projectId: string; revision: number; quote: StudioRendererSubmissionQuoteV2 } | null
>(null);
const [stopMessageKey, setStopMessageKey] = useState<string | null>(null);
const submittingRef = useRef(false);

const beginLaunch = useCallback(async (request: PrepareLaunchRequest): Promise<void> => {
  setStopMessageKey(null);
  const result = await prepareLaunch(request);
  if (result.status === 'stopped') {
    setStopMessageKey(result.messageKey);
    return;
  }
  setQuote({ projectId: result.projectId, revision: result.revision, quote: result.quote });
}, []);

const confirmLaunch = useCallback(
  async (quoteId: string): Promise<void> => {
    if (quote === null) return;
    // A synchronous latch closed before the first await: `setQuote` does not unmount the button
    // until React re-renders, so two fast clicks both reach this function in the same tick.
    if (submittingRef.current) return;
    submittingRef.current = true;
    const result = await runPaidLaunch({ projectId: quote.projectId, quoteId, revision: quote.revision });
    submittingRef.current = false;
    if (result.status === 'refused') {
      setStopMessageKey(result.messageKey);
      return;
    }
    setQuote(null);
    // Navigate to the project, not to Cut: `studioViewReadiness` gates `cut` on the cut stage having
    // content, and `StudioPage` replaces the route with a ready view, so a direct jump would bounce.
    onOpenProject(result.projectId);
  },
  [onOpenProject, quote]
);
```

Render `<ConfirmPanel>` inside the modal when `quote !== null`, and an alert when
`stopMessageKey !== null`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bunx vitest run tests/unit/pages/studio/entry/launchWiring.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/components/EntryKit tests/unit/pages/studio/entry
git commit -m "feat(studio): quote, confirm, then open the project"
```

---

## Task 11: Portal the modal below the title bar

**Files:**
- Create: `packages/desktop/src/renderer/utils/ui/appContentArea.ts`
- Modify: `packages/desktop/src/renderer/components/layout/Layout.tsx`
- Test: `tests/unit/renderer/appContentArea.dom.test.tsx`

- [ ] **Step 1: Copy the helper**

```bash
git show "entrykit/feat/creative-studio-entry-kit:WePrompt/packages/desktop/src/renderer/utils/ui/appContentArea.ts" \
  > packages/desktop/src/renderer/utils/ui/appContentArea.ts
```

- [ ] **Step 2: Add the id and the positioning to `Layout.tsx`**

Import `APP_CONTENT_AREA_ID` and change the root `ArcoLayout` to:

```tsx
<ArcoLayout id={APP_CONTENT_AREA_ID} className={'size-full layout flex-1 min-h-0 relative'}>
```

Pass `getPopupContainer={appContentArea}` to `TemplateModal`'s Arco `Modal`.

- [ ] **Step 3: Write the test**

Create `tests/unit/renderer/appContentArea.dom.test.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { APP_CONTENT_AREA_ID, appContentArea } from '@renderer/utils/ui/appContentArea';

describe('appContentArea', () => {
  it('mounts overlays inside the content area when the shell is present', () => {
    const host = document.createElement('div');
    host.id = APP_CONTENT_AREA_ID;
    document.body.append(host);

    expect(appContentArea()).toBe(host);

    host.remove();
  });

  it('falls back to the body so component tests still mount somewhere real', () => {
    expect(appContentArea()).toBe(document.body);
  });
});
```

- [ ] **Step 4: Run it**

Run: `bunx vitest run tests/unit/renderer/appContentArea.dom.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Check the blast radius by hand**

`relative` makes this element the containing block for every absolutely-positioned descendant in the
shell — 55 files under `pages/` and `components/` contain such elements, and jsdom cannot catch
layout. Launch the app and look at the sidebar, dropdowns, popovers and the settings modal:

```bash
bun run dev
```

Expected: no element shifts by the title-bar height and nothing is newly clipped. `position: fixed`
descendants are unaffected.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/utils/ui/appContentArea.ts packages/desktop/src/renderer/components/layout/Layout.tsx tests/unit/renderer/appContentArea.dom.test.tsx
git commit -m "feat(studio): portal the template modal below the title bar"
```

---

## Task 12: Green gate and a real generation

**Files:** none

- [ ] **Step 1: Run every gate**

Run the **same recipe the push gate runs**, not a looser hand-rolled set. The gate is
`push *ARGS: lint-strict fmt-check typecheck i18n-check test-for-push` (`justfile:342`):

```bash
just lint-strict
just fmt-check
just typecheck
just i18n-check
just test-for-push
```

Expected: all five clean. A checklist that runs `bun run lint` and `bun run test` instead goes green
on a looser set and can still fail the real gate. **Never** run `prettier --write` — the gate formats
with oxfmt, and prettier rewrites unrelated files.

Remember `tsc` typechecks none of `tests/`, so a fake bridge drifting from the real V2 types fails
nowhere. If a payload assertion looks odd, check it against the exported type by hand.

- [ ] **Step 2: Generate one real video**

```bash
bun run dev
```

Open Creative Studio, pick a template, accept the default length, click through to the confirm panel.
Verify the panel names a real engine and a real price, then confirm.

Expected: one job appears; when it succeeds the Cut view becomes reachable and plays a single clip of
the chosen length. No ffmpeg is required, because nothing is stitched.

- [ ] **Step 3: Verify the free phase really is free**

Repeat to the confirm panel and cancel instead. Expected: a project exists with one beat and one
shot, and **no job and no charge**.

- [ ] **Step 4: Commit any fixes and open the merge request**

`AGENTS.md` is explicit: *"AI agents must not push unless explicitly asked. When pushing, use
`just push`, never `git push`."* A bare `git push` bypasses the entire gate.

```bash
just push -u ghk feat/studio-short-templates
```

Target `codex/creative-studio-table-board-ui-design`. Judge success by exit code, not output volume —
`just push` lints with `--quiet` and the repo carries many pre-existing warnings. Self-review before
pushing: a Draft flag does not block merging here and merges land within minutes.

---

## Before Task 8: prove the path with one template

Do not port the catalogue before the pipeline works. Tasks 1-5 plus a stub gallery holding **one
hand-authored template** exercise the whole route — routes set, spine authored, admission probed,
quote priced, confirm authorized, clip watched — for a fraction of the work.

This is promoted out of a footnote for a reason. The templates' prose becomes the `shootingScript`
**verbatim**, and all 40 instructions are currently written as multi-section guidance. Shipping the
catalogue as-is would feed multi-section instructions to a one-shot generator. Task 1 fixes their
durations; the prose is untouched.

So: Tasks 1-5, one template, one real generation. Then decide whether the catalogue is worth
re-authoring at all.

## Deferred, deliberately

- The `_pending` register's 90-day expiry is advisory and never fails a build.
- `scripts/i18nPending.js` and `scripts/i18n-pending.js` differ by one hyphen.
- Quote expiry: `expiresAt` is displayed but not yet enforced with a re-prepare. Phase A is free, so
  the fix is a re-run; it needs a small timer and its own test.
- Re-authoring all 40 template instructions for one-shot phrasing — gated behind the one-template
  proof above, not merely deferred.
