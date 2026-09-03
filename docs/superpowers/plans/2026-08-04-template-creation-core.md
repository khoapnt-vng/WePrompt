# Template Creation — Core Machinery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` and execute this plan task by task. Use the project
> `architecture`, `testing`, and `i18n` skills when their scopes begin.

**Date:** 2026-08-04

**Plan status:** Revised after implementation-readiness review

**Goal:** A completed assistant reply can propose an HTML, PPTX, or DOCX template;
WePrompt validates and snapshots the proposal, shows an informed review card, and adds
or discards it idempotently. Nothing reaches the Template Gallery without confirmation.

**Architecture:** The assistant writes a candidate pack under the exact workspace path
`.template-staging/<slug>/` and ends its completed reply with one terminal, versioned
`template-proposal` block. The renderer only classifies the marker. The main process
resolves the conversation workspace, verifies source identity, copies bytes into an
immutable app-owned proposal directory, validates the visual theme/reference, creates a
preview, and persists a strict proposal record. Commit revalidates the reviewed bytes
and installs through `PresentationTemplateService`; the proposal service never writes
the gallery store directly.

**Tech stack:** Electron main process, React 19 renderer, TypeScript strict mode,
Vitest 4, SWR, Arco Design, OfficeCLI JSON operations, filesystem-backed app-owned
proposal records.

## Decisions and non-negotiable constraints

- This plan implements **core machinery only**. Skill authoring, AionCore auto-inject
  registration, the named AionRS/ACP capability matrix, trigger evaluations, and
  packaged-app platform smokes remain T4 in a separate plan.
- **Privacy contract selected by this plan:** Office references are retained in the
  installed pack and may be attached to future model calls. The card must name the
  retained source, expose source/theme inspection, and state that future providers may
  receive it. Approving this plan approves that contract. If product chooses
  sanitization instead, stop before Task 4 and replace the source-copy, hash, preview,
  inspection, and acceptance-test contract; sanitization is not a copy-only change.
- PPTX/DOCX are artifact-derived. Their marker must name an authoritative
  workspace-relative source artifact. The main process copies that source itself; it
  does not trust an agent-created reference as the source of truth.
- HTML may be artifact-derived or description-only. An artifact-derived HTML source is
  hash-bound during review but is not retained in the installed pack.
- Renderer-facing proposal objects never expose snapshot paths, proposal-store paths,
  internal record keys, or app-owned hashes.
- Subjective composition checks remain outside mechanical readiness gates. This plan
  validates a bounded visual-theme contract and reference integrity; EPIC-001 owns
  rendered quality judgment.
- `changed` is in scope. If the authoritative Office source changes after review,
  commit fails closed, records `changed`, and requires a fresh proposal.
- All renderer-visible failures use a typed code. Raw filesystem/OfficeCLI error text
  is logged in main and never returned over IPC.
- No new conversation artifact kind is required. The marker lives in the persisted
  assistant text; durable proposal state lives in the app-owned proposal store.
- Implementation starts from fresh `origin/sprint1`, not this dirty `sprint2` checkout.
  At review time local `sprint2` was `5bb330c57`; upstream was `54cfef7a7`.
- Do not push. Project rules require an explicit user request and `just push`.

## Protocol and public contract

The only valid marker is a terminal fenced JSON block:

````text
```template-proposal
{"v":1,"dir":".template-staging/qbr","name":"Quarterly Review","format":"pptx","sourceArtifact":"artifacts/Q3 Review.pptx"}
```
````

The JSON contract is:

```typescript
export type TemplateProposalMarker =
  | {
      v: 1;
      dir: string;
      name: string;
      format: 'pptx' | 'docx';
      sourceArtifact: string;
    }
  | {
      v: 1;
      dir: string;
      name: string;
      format: 'html';
      sourceArtifact?: string;
    };
```

Marker limits:

- one terminal block only; opening fence must be on its own line;
- JSON body at most 4 KiB and no unknown keys;
- `name`: trimmed, 1–80 characters, no control characters;
- `dir`: exactly `.template-staging/<slug>`, where slug matches
  `[a-z0-9][a-z0-9-]{0,47}`;
- `sourceArtifact`: required for Office and optional for artifact-derived HTML; relative
  path, at most 1,024 characters, no empty, `.` or `..`
  segment, no URL scheme, drive prefix, UNC prefix, leading slash, or NUL;
- Office extension must match `format`; macro-enabled formats are rejected.

## State model

```text
not-found -> validating -> proposed -> committing -> committed
                         |          |
                         |          +-> changed -> validating (explicit retry)
                         +-> failed -> validating (explicit retry)
                         +-> discarded
                         +-> expired
```

- `validating` is a local renderer state while the main-process stage request runs.
- All other states are durable.
- `stage`, `get`, `commit`, and `discard` are idempotent for the same conversation,
  message, marker digest, and proposal ID.
- `committing` is recoverable after restart by matching the installed pack's private
  origin sidecar to the proposal ID.
- Discard never removes an already committed gallery pack.

## Directory plan

Measured on `origin/sprint1` (`54cfef7a7`) on 2026-08-04:

| Directory | Current direct children | Plan |
| --- | ---: | --- |
| `process/services/presentation-template/` | 10 | Move four colocated tests under `tests/`; move scratch service into `scratch/`; add one `proposals/` directory. End below 10. |
| `process/services/office-artifact/` | 10 | Modify existing runner/index only; add tests under `tests/`. |
| `renderer/pages/conversation/Messages/components/` | 21 | Move the two skill-suggest files into `SkillSuggest/`; add `TemplateProposal/`. End count stays 21, not worse. |
| `renderer/components/chat/TemplateGallery/` | 10 | Modify nothing directly for this feature. |
| `renderer/utils/file/` | 9 | Add one central internal-workspace-path filter. End at 10. |

New source directories must have at least two files and at most ten direct children.
All new tests live under `tests/**`.

Focused test commands below are fast feedback. Per the project testing workflow, run
`bun run test` successfully before **every** commit as well as at the final gate.

Recommended delivery slices:

1. **Safe first slice — Tasks 0–6:** contracts, shared OfficeCLI inspection, immutable
   intake, durable store, and atomic catalog installer behind tests; no renderer entrypoint.
2. **Main-process vertical slice — Tasks 7–8:** durable lifecycle plus authorized,
   schema-gated IPC.
3. **Review experience — Tasks 9–11:** defensive classification, localized consent UI,
   hidden staging surfaces, and integration gates.

---

### Task 0: Create a clean worktree and prove the baseline

**Files:** none

- [ ] Before implementation, read `ONBOARDING.md`, `CONTRIBUTING.md`,
  `docs/contributing/file-structure.md`, and the complete project `architecture`,
  `testing`, and `i18n` skill entrypoints. Re-read live i18n config in Task 10.

- [ ] Create a fresh worktree without touching the user's dirty `sprint2` checkout.

```bash
git fetch origin
git worktree add ../WePrompt-template-creation-core -b codex/template-creation-core origin/sprint1
cd ../WePrompt-template-creation-core
bun install
```

- [ ] Record the base and counts.

```bash
git rev-parse --short HEAD
git ls-tree --name-only HEAD:packages/desktop/src/process/services/presentation-template
git ls-tree --name-only HEAD:packages/desktop/src/process/services/office-artifact
git ls-tree --name-only HEAD:packages/desktop/src/renderer/pages/conversation/Messages/components
```

Expected base at plan review: `54cfef7a7`. If upstream moved, use the new upstream and
recalculate the ledger before adding files.

- [ ] Run the untouched baseline.

```bash
bun run test
bunx tsc --noEmit
```

If baseline fails, record the exact pre-existing failure and stop. Do not repair unrelated
work as part of this feature.

---

### Task 1: Add strict shared contracts and bounded manifest tokens

**Files:**

- Modify: `packages/desktop/src/common/types/office/presentationTemplate.ts`
- Modify: `packages/desktop/src/process/services/presentation-template/templateManifest.ts`
- Move: `packages/desktop/src/process/services/presentation-template/templateManifest.test.ts`
  → `tests/unit/process/presentation-template/templateManifest.test.ts`

- [ ] Move the existing test first, then add failing cases for:

  - Office marker/source discriminated-union usage at compile time;
  - `sampleTokens` absent remains backward-compatible;
  - more than 12 tokens fails;
  - empty, duplicate-after-normalization, control-character, or over-80-character token
    fails;
  - a valid bounded token list is trimmed and preserved;
  - public proposal summaries contain no absolute/internal path field.

- [ ] Add these public types. Keep record/storage types out of `common/`.

```typescript
export type TemplateProposalStatus =
  | 'proposed'
  | 'committing'
  | 'committed'
  | 'changed'
  | 'failed'
  | 'discarded'
  | 'expired';

export type TemplateProposalFailureCode =
  | 'NOT_FOUND'
  | 'INVALID_MARKER'
  | 'WORKSPACE_UNAVAILABLE'
  | 'OUTSIDE_WORKSPACE'
  | 'SOURCE_MISSING'
  | 'SOURCE_CHANGED'
  | 'INVALID_STAGING'
  | 'THEME_INVALID'
  | 'REFERENCE_INVALID'
  | 'INVALID_SAMPLE_TOKENS'
  | 'OPEN_SOURCE_FAILED'
  | 'OFFICECLI_UNAVAILABLE'
  | 'STORAGE_CORRUPT'
  | 'INSTALL_FAILED'
  | 'CLEANUP_FAILED'
  | 'EXPIRED'
  | 'ALREADY_DISCARDED';

export type TemplateProposalPreviewStatus = 'rendered' | 'fallback' | 'unavailable';

export type TemplateProposalSummary = {
  proposalId: string;
  status: TemplateProposalStatus;
  name: string;
  format: PresentationTemplateFormat;
  desiredTemplateId: string;
  committedTemplateId?: string;
  sourceArtifactName?: string;
  sourceArtifactRelativePath?: string;
  retainsReference: boolean;
  themeMarkdown?: string;
  sampleTokenCandidates: string[];
  approvedSampleTokens?: string[];
  previewDataUrl?: string;
  previewStatus: TemplateProposalPreviewStatus;
  failureCode?: TemplateProposalFailureCode;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type TemplateProposalResult =
  | { ok: true; proposal: TemplateProposalSummary }
  | { ok: false; code: TemplateProposalFailureCode };

export type TemplateProposalActionResult =
  | { ok: true }
  | { ok: false; code: TemplateProposalFailureCode };
```

- [ ] Add `sampleTokens?: string[]` to `PresentationTemplateManifest` and enforce:

```typescript
export const MAX_TEMPLATE_SAMPLE_TOKENS = 12;
export const MAX_TEMPLATE_SAMPLE_TOKEN_LENGTH = 80;
```

Normalize with `trim()` and case-insensitive uniqueness, but preserve the first token's
display spelling. Do not reject old manifests that omit the field. Do not claim unknown
manifest fields are rejected: the existing validator projects known fields and that
behavior remains unchanged in this task.

- [ ] Run the focused test and typecheck.

```bash
bun run test -- tests/unit/process/presentation-template/templateManifest.test.ts
bunx tsc --noEmit
```

- [ ] Commit.

```bash
git add packages/desktop/src/common/types/office/presentationTemplate.ts packages/desktop/src/process/services/presentation-template/templateManifest.ts tests/unit/process/presentation-template/templateManifest.test.ts
git commit -m "feat(templates): define proposal contracts"
```

---

### Task 2: Extend the shared OfficeCLI runner with bounded JSON inspection

**Files:**

- Modify: `packages/desktop/src/process/services/office-artifact/officeCliRunner.ts`
- Modify: `packages/desktop/src/process/services/office-artifact/index.ts`
- Modify: `tests/unit/process/services/officeArtifact/officeCliRunner.test.ts`

- [ ] Write failure-first runner tests. The fake `execFile` must assert exact argv and
  exercise malformed JSON, `success:false`, command failure, and the two success shapes.

Expected commands:

```typescript
[
  'view',
  '/work/reference.pptx',
  'text',
  '--max-lines',
  '200',
  '--json',
];

[
  'view',
  '/work/reference.pptx',
  'screenshot',
  '--page',
  '1-12',
  '--grid',
  'auto',
  '--screenshot-width',
  '1600',
  '--screenshot-height',
  '1200',
  '--out',
  '/work/preview.png',
  '--json',
];

[
  'view',
  '/work/reference.docx',
  'screenshot',
  '--page',
  '1',
  '--screenshot-width',
  '1600',
  '--screenshot-height',
  '1200',
  '--out',
  '/work/preview.png',
  '--json',
];
```

- [ ] Extend the runner without exposing its private `invoke` function.

```typescript
export type OfficeCliTemplatePreviewKind = 'pptx-contact-sheet' | 'docx-first-page';

export type OfficeCliRunner = {
  get: (file: string, path: string) => Promise<unknown>;
  replaceText: (file: string, path: string, find: string, replace: string) => Promise<unknown>;
  formatRange: (
    file: string,
    path: string,
    start: number,
    end: number,
    property: 'bold' | 'italic' | 'underline',
    enabled: boolean
  ) => Promise<unknown>;
  setCell: (file: string, path: string, input: string) => Promise<unknown>;
  validate: (file: string) => Promise<unknown>;
  viewText: (file: string, maxLines: number) => Promise<unknown>;
  renderTemplatePreview: (file: string, outputPath: string, kind: OfficeCliTemplatePreviewKind) => Promise<void>;
  close: (file: string) => Promise<unknown>;
  watch: (file: string) => Promise<OfficeCliPreviewSession>;
};
```

`viewText` rejects a non-integer limit outside 1–500 before invoking the binary.
`renderTemplatePreview` parses the standard JSON envelope and ignores its `data`; the
caller verifies the output file exists, is regular, is PNG, and is within the size cap.
PPTX preview is a contact sheet of at most the first 12 slides; the source-inspection
action covers larger decks without unbounded render cost.

- [ ] Share the production runner instance instead of constructing a second one.

```typescript
export const officeCliRunner = createOfficeCliRunner();

export const officeArtifactService = new OfficeArtifactService({
  runner: officeCliRunner,
  snapshots: snapshotStore,
  resolveArtifact: resolveOfficeArtifactPath,
  hashArtifact: hashOfficeArtifact,
  workingFiles: new OfficeArtifactWorkingFiles(),
  retainPreviewOrigin: retainOfficePreviewOrigin,
});
```

The proposal bridge added later imports `officeCliRunner` from this module.

- [ ] Run and commit.

```bash
bun run test -- tests/unit/process/services/officeArtifact/officeCliRunner.test.ts
bunx tsc --noEmit
git add packages/desktop/src/process/services/office-artifact/index.ts packages/desktop/src/process/services/office-artifact/officeCliRunner.ts tests/unit/process/services/officeArtifact/officeCliRunner.test.ts
git commit -m "feat(office): add bounded template inspection ops"
```

---

### Task 3: Factor the service directory and add visual/reference validation

**Files:**

- Move: `packages/desktop/src/process/services/presentation-template/ArtifactScratchService.ts`
  → `packages/desktop/src/process/services/presentation-template/scratch/ArtifactScratchService.ts`
- Create: `packages/desktop/src/process/services/presentation-template/scratch/index.ts`
- Move: `packages/desktop/src/process/services/presentation-template/ArtifactScratchService.test.ts`
  → `tests/unit/process/presentation-template/scratch/ArtifactScratchService.test.ts`
- Modify: `packages/desktop/src/process/services/presentation-template/bridge.ts`
- Create: `packages/desktop/src/process/services/presentation-template/proposals/types.ts`
- Create: `packages/desktop/src/process/services/presentation-template/proposals/visualTheme.ts`
- Create: `packages/desktop/src/process/services/presentation-template/proposals/referenceInspector.ts`
- Create: `packages/desktop/src/process/services/presentation-template/proposals/sampleTokens.ts`
- Create: `packages/desktop/src/process/services/presentation-template/proposals/index.ts`
- Move: `packages/desktop/src/process/services/presentation-template/themeThumbnail.test.ts`
  → `tests/unit/process/presentation-template/themeThumbnail.test.ts`
- Create: `tests/unit/process/presentation-template/proposals/visualTheme.test.ts`
- Create: `tests/unit/process/presentation-template/proposals/referenceInspector.test.ts`
- Create: `tests/unit/process/presentation-template/proposals/sampleTokens.test.ts`

- [ ] Move scratch code/tests and update the bridge import before adding proposal files.
  The `scratch/` barrel exports `ArtifactScratchService`.

- [ ] Define main-only internal records in `proposals/types.ts`. No type in this file may
  be imported by renderer code.

```typescript
export type TemplateProposalRecord = {
  schemaVersion: 1;
  proposalId: string;
  proposalKey: string;
  conversationId: string;
  messageId: string;
  markerDigest: string;
  contentFingerprint?: string;
  desiredTemplateId: string;
  status: 'proposed' | 'committing' | 'committed' | 'changed' | 'failed' | 'discarded' | 'expired';
  name: string;
  format: 'html' | 'pptx' | 'docx';
  sourceArtifactRelativePath?: string;
  sourceArtifactName?: string;
  sourceHash?: string;
  sourceSnapshotFileName?: 'source.html';
  themeHash?: string;
  referenceHash?: string;
  previewHash?: string;
  previewStatus: 'rendered' | 'fallback' | 'unavailable';
  sampleTokenCandidates: string[];
  approvedSampleTokens?: string[];
  committedTemplateId?: string;
  failureCode?: TemplateProposalFailureCode;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};
```

Proposal records contain file names relative to their own app-owned directory; they do
not persist arbitrary deletion targets.

- [ ] Add a format-aware visual-theme validator. Its exact v1 contract is:

  - UTF-8 Markdown, 1 byte–256 KiB, no NUL/control characters;
  - exactly one H1 name;
  - required H2 sections: `Palette`, `Typography`, `Layout Catalog`, and
    `Visual Language`;
  - allowed H2 aliases: `Colors` for `Palette`, `Layouts` for `Layout Catalog`, and
    `Motif` for `Visual Language`;
  - no other H1/H2 section; H3 is allowed only inside an accepted H2;
  - reject headings containing `workflow`, `instruction`, `delivery gate`, `follow-up`,
    `tool`, `command`, `system`, or `prompt`;
  - reject `template-proposal` fences and HTML script/iframe/object/embed tags;
  - palette must expose 3–12 unique `#RGB`/`#RRGGBB` colors;
  - typography must identify non-empty heading and body font values;
  - layout catalog requires at least 3 named layouts for PPTX, 2 for DOCX, and 1 for
    HTML;
  - each section is capped at 2,000 characters and the whole document at 8,000 words.

Return normalized colors/fonts/layout names for preview derivation, but preserve the
exact original Markdown for the review card and installed pack. This validator is a
mechanical safety/shape check, not a claim that the design is attractive.

- [ ] Add a narrow inspector around the shared runner.

```typescript
export type ReferenceInspection = {
  extractedText: string[];
  previewStatus: 'rendered' | 'fallback';
};

export type TemplateReferenceInspector = {
  inspect: (input: {
    format: 'pptx' | 'docx';
    referencePath: string;
    previewPath: string;
  }) => Promise<ReferenceInspection>;
};
```

Implementation requirements:

  1. Inspect the OOXML package lazily before OfficeCLI: at most 5,000 entries and 200 MiB
     declared uncompressed total; reject `vbaProject.bin`, ActiveX, OLE/package
     embeddings, custom UI, malformed relationship XML, and any relationship whose
     `TargetMode` is `External`. This catches renamed macro/active files, not only bad
     extensions.
  2. `runner.validate(referencePath)` must pass.
  3. `runner.viewText(referencePath, 200)` must match one of the verified OfficeCLI
     JSON data shapes:
     - PPTX: `{ totalSlides, slides: [{ index, path, texts: string[] }] }`;
     - DOCX: `{ totalElements, elements: [{ path, type, text: string }] }`.
  4. At least one non-blank text item is required. This is the grounding gate for an
     Office reference; empty extraction is a hard `REFERENCE_INVALID` failure.
  5. PPTX requests `pptx-contact-sheet`; DOCX requests `docx-first-page`.
  6. A screenshot failure is not a hard failure. Return `fallback`; the proposal service
     writes a deterministic SVG and the card discloses degraded preview evidence.
  7. A reported screenshot success is accepted only if the PNG is a regular file,
     1 byte–10 MiB, inside the proposal directory.

- [ ] Add deterministic, bounded sample-token candidates. Normalize whitespace, exclude
  email addresses, URLs, UUIDs, file paths, strings over 80 characters, and a fixed list
  of common months/weekdays/generic labels. Rank explicit placeholders first, then
  repeated proper-name/period/number candidates; require two occurrences for non-
  placeholders; use Unicode property escapes so Vietnamese/other diacritics and acronyms
  are not silently dropped; return at most 12 unique values. These are review candidates
  only. Commit writes only the exact candidate subset selected on the card to
  `sampleTokens`.

- [ ] Tests must cover renamed macros, active/OLE content, external relationships,
  package-entry/expanded-size caps, malformed OfficeCLI shapes, empty extraction,
  preview fallback, wrong format, forbidden theme sections, short hex normalization, Office typography,
  Vietnamese/diacritic names, acronyms, dates, currency, token exclusions, deduplication,
  and caps.

- [ ] Run and commit.

```bash
bun run test -- tests/unit/process/presentation-template/scratch/ArtifactScratchService.test.ts tests/unit/process/presentation-template/themeThumbnail.test.ts tests/unit/process/presentation-template/proposals/visualTheme.test.ts tests/unit/process/presentation-template/proposals/referenceInspector.test.ts tests/unit/process/presentation-template/proposals/sampleTokens.test.ts
bunx tsc --noEmit
git add packages/desktop/src/process/services/presentation-template/scratch/ArtifactScratchService.ts packages/desktop/src/process/services/presentation-template/scratch/index.ts packages/desktop/src/process/services/presentation-template/proposals/types.ts packages/desktop/src/process/services/presentation-template/proposals/visualTheme.ts packages/desktop/src/process/services/presentation-template/proposals/referenceInspector.ts packages/desktop/src/process/services/presentation-template/proposals/sampleTokens.ts packages/desktop/src/process/services/presentation-template/proposals/index.ts packages/desktop/src/process/services/presentation-template/bridge.ts tests/unit/process/presentation-template/scratch/ArtifactScratchService.test.ts tests/unit/process/presentation-template/themeThumbnail.test.ts tests/unit/process/presentation-template/proposals/visualTheme.test.ts tests/unit/process/presentation-template/proposals/referenceInspector.test.ts tests/unit/process/presentation-template/proposals/sampleTokens.test.ts
git commit -m "refactor(templates): factor proposal validation services"
```

---

### Task 4: Snapshot trusted source bytes without path or TOCTOU gaps

**Files:**

- Create: `packages/desktop/src/process/services/presentation-template/proposals/stagingIntake.ts`
- Create: `tests/unit/process/presentation-template/proposals/stagingIntake.test.ts`

- [ ] Write failure-first tests for:

  - absolute/traversal/wrong-prefix staging paths;
  - staging root, child, theme, source, or staged reference symlinks;
  - hard-linked agent-staging files;
  - directory/FIFO/socket/unexpected entry;
  - changed file between open/copy/final `fstat`;
  - mismatched staged reference hash versus authoritative source hash;
  - source outside the authorized workspace or inside `.template-staging`;
  - extension/format mismatch and macro-enabled Office formats;
  - file count and size caps;
  - partial destination cleanup on any failure;
  - successful Office and HTML snapshots.

- [ ] Implement one intake contract:

```typescript
export type StagingSnapshot = {
  themeFileName: 'THEME.md';
  referenceFileName: 'reference.pptx' | 'reference.docx' | null;
  sourceSnapshotFileName?: 'source.html';
  sourceArtifactRelativePath?: string;
  sourceArtifactName?: string;
  sourceHash?: string;
  themeHash: string;
  referenceHash?: string;
};

export async function snapshotStagingCandidate(input: {
  workspaceRoot: string;
  marker: TemplateProposalMarker;
  destinationDir: string;
}): Promise<StagingSnapshot>;
```

`destinationDir` must be the newly created path returned by `TemplateProposalStore`; it
is never accepted from renderer input or loaded as an arbitrary path from a record.

Security sequence:

1. `realpath` and `lstat` the workspace; require a real directory owned by the current
   user when UID is available.
2. Resolve `marker.dir` by segments, `realpath` it, and use `path.relative` containment.
   Never use string `startsWith` for path containment.
3. Require exact entries:
   - HTML: `THEME.md` only;
   - PPTX: `THEME.md` and `reference.pptx`;
   - DOCX: `THEME.md` and `reference.docx`.
4. Open each staging file with `O_RDONLY | O_NOFOLLOW` on POSIX; on Windows open by
   handle, compare pre/post `fstat`, and verify the final canonical path again. Require a
   regular single-link staging file. Read/copy from the held handle, not by reopening a
   path after validation.
5. Enforce `THEME.md` ≤256 KiB and Office reference ≤50 MiB.
6. For Office, resolve `sourceArtifact` independently inside the authorized workspace,
   outside `.template-staging`, require a matching non-macro extension, and copy from a
   held source handle into the app-owned destination. Compare the agent-staged reference
   hash to the authoritative source hash; reject mismatch. The authoritative copy becomes
   `reference.pptx`/`reference.docx`.
7. For artifact-derived HTML, accept only `.html`/`.htm`, copy the authoritative source
   into the proposal snapshot as `source.html`, and hash-bind it for changed-source
   detection. It is never copied into the installed pack. Description-only HTML omits
   `sourceArtifact` and has no source snapshot.
8. Create `destinationDir` exclusively with mode `0700`; write files with mode `0600`.
9. Hash bytes while copying, `fsync` outputs, and compare source/staging file identity,
   size, and timestamps before and after the copy. Any change returns `SOURCE_CHANGED`.
10. Remove only the app-owned destination on failure. Never remove `marker.dir` or any
   workspace path.

- [ ] Run and commit.

```bash
bun run test -- tests/unit/process/presentation-template/proposals/stagingIntake.test.ts
bunx tsc --noEmit
git add packages/desktop/src/process/services/presentation-template/proposals/stagingIntake.ts tests/unit/process/presentation-template/proposals/stagingIntake.test.ts
git commit -m "feat(templates): snapshot trusted proposal bytes"
```

---

### Task 5: Persist strict per-proposal records and safe garbage collection

**Files:**

- Create: `packages/desktop/src/process/services/presentation-template/proposals/proposalStore.ts`
- Create: `tests/unit/process/presentation-template/proposals/proposalStore.test.ts`

- [ ] Write tests for exclusive creation, atomic record updates through two store instances, restart reload,
  idempotent key lookup, malformed JSON, invalid schema, corrupt-record preservation,
  UUID containment, orphan temp cleanup, expiry, terminal metadata compaction, and
  concurrent writes.

- [ ] Use one app-owned directory per proposal instead of a single mutable
  `proposals.json`:

```text
<userData>/template-proposals/
  <proposal-uuid>/
    record.json
    THEME.md
    reference.pptx | reference.docx
    preview.png | preview.svg
  .creating-<proposal-uuid>/
```

Root and proposal directories are `0700`; records/assets are `0600`. The store API is:

```typescript
export type TemplateProposalStore = {
  createWorkingDirectory: (proposalId: string) => Promise<string>;
  finalize: (proposalId: string, record: TemplateProposalRecord) => Promise<void>;
  load: (proposalId: string) => Promise<TemplateProposalRecord | null>;
  findByKey: (proposalKey: string) => Promise<TemplateProposalRecord | null>;
  findLatestByMarker: (input: {
    conversationId: string;
    messageId: string;
    markerDigest: string;
  }) => Promise<TemplateProposalRecord | null>;
  withRequestLock: <T>(requestKey: string, action: () => Promise<T>) => Promise<T>;
  update: (
    proposalId: string,
    updater: (record: TemplateProposalRecord) => TemplateProposalRecord
  ) => Promise<TemplateProposalRecord>;
  removeSnapshotAssets: (proposalId: string) => Promise<void>;
  runMaintenance: (now: Date) => Promise<void>;
};
```

Store rules:

- UUID validation happens before every path resolution; resolve from root plus UUID only.
- `record.json` is strict, versioned, and validated before use.
- Atomic writes use a unique sibling temp name, `fsync`, then rename.
- `ENOENT` means not found. Malformed JSON/schema means `STORAGE_CORRUPT`; never coerce it
  to an empty store and never overwrite/delete the corrupt record automatically.
- Per-proposal updates serialize through an in-process promise tail and an exclusive
  app-root lock directory, so two service instances cannot lose an update. The final
  store method re-reads the current record before writing.
- `withRequestLock` accepts only a 64-character lowercase SHA-256 key and uses an
  exclusive `.request-<key>` lock directory with bounded retry. Stage creation runs
  inside this lock across app instances. Lock metadata records PID/time; cleanup removes
  only validated inactive locks older than one hour.
- `findLatestByMarker` sorts by `updatedAt`, then `createdAt`, then proposal UUID so its
  result is deterministic.
- `.creating-*` directories older than one hour are removed only after UUID/prefix,
  ownership, canonical-root, and real-directory checks.
- `proposed` snapshots expire after seven days: remove heavy assets and persist an
  `expired` tombstone. `changed`, `failed`, and `discarded` snapshots are removed after
  24 hours. `committed` snapshots are removed immediately after install.
- After 30 days, terminal tombstones drop source-artifact path/name, content hashes, failure
  detail, and token candidates; they keep only marker ownership, proposal/name/format,
  terminal status, timestamps, and committed ID when applicable.
- Compact tombstone records remain so old chat history cannot accidentally restage an
  already committed/discarded/expired marker. Conversation-deletion compaction is future scope.

- [ ] Run and commit.

```bash
bun run test -- tests/unit/process/presentation-template/proposals/proposalStore.test.ts
bunx tsc --noEmit
git add packages/desktop/src/process/services/presentation-template/proposals/proposalStore.ts tests/unit/process/presentation-template/proposals/proposalStore.test.ts
git commit -m "feat(templates): persist durable proposal state"
```

---

### Task 6: Make PresentationTemplateService the sole atomic installer

**Files:**

- Modify: `packages/desktop/src/process/services/presentation-template/PresentationTemplateService.ts`
- Move: `packages/desktop/src/process/services/presentation-template/PresentationTemplateService.test.ts`
  → `tests/unit/process/presentation-template/PresentationTemplateService.test.ts`

- [ ] Move the current tests and add failure-first coverage for simultaneous same-name
  installs, stale reservation cleanup, copy/write/rename failures, existing destination,
  restart recovery by origin ID, manifest validation before publish, and import-theme
  regression.

- [ ] Add this main-only install API:

```typescript
export type InstallUserTemplatePackInput = {
  proposalId: string;
  desiredId: string;
  name: string;
  description: string;
  format: 'html' | 'pptx' | 'docx';
  kind: 'report' | 'deck' | 'document';
  themeSourcePath: string;
  referenceSourcePath: string | null;
  previewSourcePath: string;
  sampleTokens: string[];
  createdAt: string;
};

export type PresentationTemplateInstaller = Pick<
  PresentationTemplateService,
  'installUserPack' | 'findByProposalId' | 'getById'
>;
```

Installation algorithm:

1. `ensureInitialized()` and run stale `.reserve-*`/`.install-*` cleanup under the
   service root. Hidden work directories older than one hour are eligible; normal pack
   directories are never cleanup targets.
2. Slug the desired ID and choose suffixes `-2`, `-3`, and so on.
3. Reserve a candidate across app instances with exclusive
   `mkdir(.reserve-<candidate>)`. While held, confirm the final directory is absent.
4. Build `.install-<uuid>` under the same root, mode `0700`.
5. Copy theme/reference/preview, write a private `.aionui-origin.json` containing
   `{ "version": 1, "proposalId": "<uuid>" }`, then write and validate `template.json`.
   Use the passed name as description when no user/source description exists; do not
   invent an English UI sentence in main.
6. Re-hash copied files and verify preview readability before publication.
7. Rename the complete temp directory to the final candidate while the reservation is
   held. This same-volume rename is the visibility boundary.
8. Remove the reservation. On any failure remove only the hidden temp/reservation and
   return a typed install failure; no partial final pack may remain.
9. `findByProposalId` scans only valid user packs and their strict private origin
   sidecar. It supports recovery when the process died after rename but before the
   proposal record reached `committed`.

Refactor `importThemeSpec()` to call `installUserPack()` with a generated proposal-like
origin ID or a dedicated internal install path that uses the same reservation/publish
primitive. Do not leave `uniqueId()` as a check-then-create race.

- [ ] Run and commit.

```bash
bun run test -- tests/unit/process/presentation-template/PresentationTemplateService.test.ts
bunx tsc --noEmit
git add packages/desktop/src/process/services/presentation-template/PresentationTemplateService.ts tests/unit/process/presentation-template/PresentationTemplateService.test.ts
git commit -m "fix(templates): install user packs atomically"
```

---

### Task 7: Implement the durable proposal lifecycle

**Files:**

- Create: `packages/desktop/src/process/services/presentation-template/proposals/inspectionCopies.ts`
- Create: `packages/desktop/src/process/services/presentation-template/proposals/TemplateProposalService.ts`
- Modify: `packages/desktop/src/process/services/presentation-template/proposals/index.ts`
- Create: `tests/unit/process/presentation-template/proposals/inspectionCopies.test.ts`
- Create: `tests/unit/process/presentation-template/proposals/TemplateProposalService.test.ts`

- [ ] Write the state-transition tests before the service. Each `describe` block must
  have a failure path. Cover:

  - same marker under StrictMode-like duplicate calls creates one snapshot;
  - same conversation/message with a changed marker creates a new proposal; changed
    source transitions to `changed`, and explicit retry creates a new proposal;
  - failed stage is durable and retries only with `retry: true`;
  - get after a new service/store instance returns the prior state;
  - commit checks snapshot hashes and authoritative source hash;
  - changed source transitions to `changed` and never installs;
  - double commit returns the same committed ID;
  - two simultaneous same-name proposals get deterministic distinct installed IDs;
  - restart from `committing` recovers via `findByProposalId`;
  - install failure remains retryable without claiming committed;
  - discard is idempotent and does not remove a committed pack;
  - expiry/GC removes only proposal-owned assets;
  - preview fallback remains proposed with a visible degraded status.
  - opening retained source uses a disposable copy; modifying it cannot change snapshot
    or installed reference hashes; expired inspection copies are cleaned safely.

- [ ] Implement this dependency-injected surface:

```typescript
export type TemplateInspectionCopyService = {
  create: (input: {
    proposalId: string;
    sourcePath: string;
    extension: '.pptx' | '.docx';
  }) => Promise<string>;
  runMaintenance: (now: Date) => Promise<void>;
};

export type TemplateProposalServiceDependencies = {
  store: TemplateProposalStore;
  templates: PresentationTemplateInstaller;
  referenceInspector: TemplateReferenceInspector;
  inspectionCopies: TemplateInspectionCopyService;
  openPath: (filePath: string) => Promise<string>;
  now: () => Date;
};

export class TemplateProposalService {
  constructor(dependencies: TemplateProposalServiceDependencies);

  get(input: {
    conversationId: string;
    messageId: string;
    marker: TemplateProposalMarker;
  }): Promise<TemplateProposalResult>;

  stage(input: {
    conversationId: string;
    messageId: string;
    workspaceRoot: string;
    marker: TemplateProposalMarker;
    retry: boolean;
  }): Promise<TemplateProposalResult>;

  commit(input: {
    conversationId: string;
    messageId: string;
    workspaceRoot: string;
    proposalId: string;
    approvedSampleTokens: string[];
  }): Promise<TemplateProposalResult>;

  discard(input: {
    conversationId: string;
    messageId: string;
    proposalId: string;
  }): Promise<TemplateProposalResult>;

  openRetainedSource(input: {
    conversationId: string;
    messageId: string;
    proposalId: string;
  }): Promise<TemplateProposalActionResult>;

  runMaintenance(): Promise<void>;
}
```

Stage rules:

1. Strictly validate the marker again in main.
2. Compute `markerDigest = sha256(canonical JSON)` and a private request key from
   conversation ID, message ID, and marker digest. Do not send either value to renderer.
3. Serialize this full resolve/create flow with the store's cross-instance request lock
   plus an in-process promise tail. With
   `retry: false`, return `findLatestByMarker()` immediately when a durable record exists;
   ordinary history reload must not touch staging again. A `failed`/`changed` record is
   replaced only under explicit `retry: true`.
4. Create `.creating-<uuid>`, snapshot trusted bytes, validate the theme, inspect Office
   content, derive bounded token candidates, and create PNG or deterministic SVG preview.
5. Derive `contentFingerprint` from framed theme/reference/source/preview hashes and
   derive `proposalKey` from the request key plus that fingerprint. If an identical record
   already exists, remove the new working directory and return the existing proposal.
   This lets an explicit retry after changed bytes create a new proposal without losing
   the old consent tombstone.
6. Derive kind strictly: HTML → `report`, PPTX → `deck`, DOCX → `document`.
7. Persist `record.json` before atomically renaming the working directory to the UUID.
8. On a known failure, persist a minimal failed tombstone keyed to the marker; remove
   partial assets and return it as an `ok: true` durable `failed` summary. On an unexpected
   exception, log details and return the nearest typed `ok: false` failure code.

Commit rules:

1. Verify proposal ownership with conversation/message IDs and reject terminal states
   honestly.
2. Re-hash the immutable theme/reference/preview and compare every stored hash.
3. For Office, resolve and hash the authoritative source again. A mismatch persists
   `changed` and returns `SOURCE_CHANGED` without installation. Apply the same rule to
   artifact-derived HTML; description-only HTML has no source recheck.
4. Re-run visual validation and Office `validate`/structured-text extraction. Screenshot
   need not run again because preview bytes are hash-bound.
5. Validate `approvedSampleTokens` as a normalized subset of the persisted candidates;
   reject forged/duplicate/over-limit values. Persist `committing`, call
   `templates.installUserPack()` with only that subset, then persist `committed`, the
   approved subset, and its actual collision-resolved ID.
6. If a `committing` record is loaded, call `findByProposalId()` first; finalize when the
   pack already exists, otherwise retry installation from the intact snapshot.
7. After committed state is durable, remove proposal snapshot assets but retain the
   tombstone record. `getById()` supplies preview data for committed history cards.

Discard removes snapshot assets before persisting `discarded`. A deletion failure returns
`CLEANUP_FAILED` and leaves the prior retryable state; it must not claim that retained
source bytes were removed.

`openRetainedSource` is user-triggered and verifies record ownership. It copies the
immutable Office snapshot before commit, or installed reference after commit, into a
separate app-owned inspection directory, makes the copy read-only where supported, and
calls the injected opener with that disposable path. It never opens the authoritative
snapshot/installed file and returns no path. Inspection copies expire after 24 hours and
use the same UUID/ownership/containment cleanup rules. HTML sources are not retained and therefore return
`NOT_FOUND`; artifact-derived HTML may inspect the original workspace file as read-only
content through the existing renderer preview path.

Summary mapping reads proposal files internally and returns only the public fields from
Task 1. For an Office proposal, `sourceArtifactRelativePath` is the already-validated
workspace-relative value and `sourceArtifactName` is its basename; no snapshot path is
returned.

- [ ] Run and commit.

```bash
bun run test -- tests/unit/process/presentation-template/proposals/inspectionCopies.test.ts tests/unit/process/presentation-template/proposals/TemplateProposalService.test.ts
bunx tsc --noEmit
git add packages/desktop/src/process/services/presentation-template/proposals/inspectionCopies.ts packages/desktop/src/process/services/presentation-template/proposals/TemplateProposalService.ts packages/desktop/src/process/services/presentation-template/proposals/index.ts tests/unit/process/presentation-template/proposals/inspectionCopies.test.ts tests/unit/process/presentation-template/proposals/TemplateProposalService.test.ts
git commit -m "feat(templates): add durable proposal lifecycle"
```

---

### Task 8: Add authorized IPC providers and exhaustive native schemas

**Files:**

- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Modify: `packages/desktop/src/common/adapter/native/constants.ts`
- Modify: `packages/desktop/src/common/adapter/native/payloadSchemas.ts`
- Modify: `packages/desktop/src/process/services/presentation-template/bridge.ts`
- Modify: `tests/unit/process/bridge/nativePayloadSchemas.test.ts`
- Create: `tests/integration/presentationTemplateProposalBridge.test.ts`

- [ ] Add these exact native provider keys:

```text
presentation-templates.proposals.get
presentation-templates.proposals.stage
presentation-templates.proposals.commit
presentation-templates.proposals.discard
presentation-templates.proposals.open-retained-source
```

- [ ] Add bridge providers with `TemplateProposalResult` returns and these payloads:

```typescript
type ProposalLookupPayload = {
  conversation_id: string;
  message_id: string;
  marker: TemplateProposalMarker;
};

type ProposalStagePayload = ProposalLookupPayload & { retry?: boolean };

type ProposalMutationPayload = {
  conversation_id: string;
  message_id: string;
  proposal_id: string;
};

type ProposalCommitPayload = ProposalMutationPayload & {
  approved_sample_tokens: string[];
};
```

`commit` uses `ProposalCommitPayload`. `discard` and `open-retained-source` use
`ProposalMutationPayload`; `open-retained-source` returns
`TemplateProposalActionResult`. Main invokes Electron `shell.openPath`; a non-empty error
string is logged and mapped to `OPEN_SOURCE_FAILED`, never returned to renderer.

- [ ] Add strict Zod schemas for all five providers. The marker schema is a discriminated union, rejects unknown
  keys, applies every protocol limit from this plan, requires `sourceArtifact` for Office,
  and allows it for HTML. IDs use the existing bounded ID schema; proposal IDs also
  require UUID syntax. Add valid fixtures for all five keys and invalid cases for unknown
  fields, traversal, wrong format/source combination, overlong strings, bad UUID, and
  missing conversation/message IDs. The commit token array is capped at 12; each value
  is trimmed, 1–80 characters, control-free, and case-insensitively unique. The native
  schema exhaustiveness test must remain green.

- [ ] Resolve the authorized workspace in `bridge.ts` with the real existing API; do not
  leave a guessed `resolveConversationWorkspace` symbol:

```typescript
async function resolveConversationWorkspace(conversationId: string): Promise<string | null> {
  try {
    const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
    const workspace = conversation.extra?.workspace;
    return typeof workspace === 'string' && workspace.trim().length > 0 ? workspace : null;
  } catch {
    return null;
  }
}
```

`get`, `stage`, `commit`, and `open-retained-source` require this authorization. `discard`
does not need to read workspace bytes but still requires a resolvable conversation and record ownership.
Never accept a renderer-supplied workspace path.

- [ ] Construct one singleton proposal service using:

  - proposal root `path.join(app.getPath('userData'), 'template-proposals')`;
  - inspection-copy root
    `path.join(app.getPath('userData'), 'template-proposal-inspection')`;
  - existing template service singleton;
  - shared `officeCliRunner` from `@process/services/office-artifact`;
  - the injected inspector/store clock.

Run maintenance during bridge initialization. Do not permanently set a “GC done” flag
before maintenance succeeds; a later call may retry after failure. Also run it through
one retryable, rate-limited service call before proposal operations, with a six-hour
minimum interval, so a long-running app does not retain expired source indefinitely.

- [ ] Integration-test authorization, typed errors, status after a new service instance,
  exact retained-source opener selection before/after commit, and that no
  app-owned/internal path crosses the provider boundary.

- [ ] Run and commit.

```bash
bun run test -- tests/unit/process/bridge/nativePayloadSchemas.test.ts tests/integration/presentationTemplateProposalBridge.test.ts
bunx tsc --noEmit
git add packages/desktop/src/common/adapter/ipcBridge.ts packages/desktop/src/common/adapter/native/constants.ts packages/desktop/src/common/adapter/native/payloadSchemas.ts packages/desktop/src/process/services/presentation-template/bridge.ts tests/unit/process/bridge/nativePayloadSchemas.test.ts tests/integration/presentationTemplateProposalBridge.test.ts
git commit -m "feat(templates): expose authorized proposal IPC"
```

---

### Task 9: Parse only one valid terminal assistant marker

**Files:**

- Create: `packages/desktop/src/common/types/office/presentationTemplateProposal.ts`
- Create: `tests/unit/common/office/presentationTemplateProposal.test.ts`

- [ ] Write parser tests for valid LF/CRLF blocks, non-terminal blocks, malformed JSON,
  unknown keys, multiple markers, over-4-KiB body, traversal/absolute source paths,
  Office without source, HTML with/without source, invalid slug/name/control characters, and an
  example marker quoted in ordinary Markdown.

- [ ] Implement one pure classifier:

```typescript
export type ParsedTemplateProposal = {
  marker: TemplateProposalMarker;
  canonicalMarker: string;
  visibleContent: string;
};

export function parseTerminalTemplateProposal(content: string): ParsedTemplateProposal | null;
```

Rules:

- Count opening `template-proposal` fences first; anything other than exactly one returns
  `null`.
- Match only a block ending the string, allowing one final newline and horizontal
  whitespace after the closing fence.
- Parse and strictly validate all keys/limits.
- Return canonical JSON key order, not a renderer-generated cryptographic digest. Main
  hashes this canonical string for its private key; renderer uses the string only as a
  stable SWR-key segment.
- `visibleContent` removes the exact matched block and trims only its preceding separator
  newline.
- There is no standalone “strip” function. Malformed/unclassified content remains
  visible verbatim.
- Keep this pure protocol classifier in `common/types/office/` so MessageText, exports,
  minimap, context handoff, and main validation can share valid-only sanitization without
  creating a renderer-utils → page-component dependency.

- [ ] Run the parser test.

```bash
bun run test -- tests/unit/common/office/presentationTemplateProposal.test.ts
bunx tsc --noEmit
```

Do not commit yet; Task 10 wires every user-facing consumer.

---

### Task 10: Add localized review UI and wire completed assistant messages

**Files:**

- Move: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageSkillSuggest.tsx`
  → `packages/desktop/src/renderer/pages/conversation/Messages/components/SkillSuggest/MessageSkillSuggest.tsx`
- Move: `packages/desktop/src/renderer/pages/conversation/Messages/components/SkillSuggestCard.tsx`
  → `packages/desktop/src/renderer/pages/conversation/Messages/components/SkillSuggest/SkillSuggestCard.tsx`
- Create: `packages/desktop/src/renderer/pages/conversation/Messages/components/SkillSuggest/index.ts`
- Create: `packages/desktop/src/renderer/pages/conversation/Messages/components/TemplateProposal/TemplateProposalCard.tsx`
- Create: `packages/desktop/src/renderer/pages/conversation/Messages/components/TemplateProposal/MessageTemplateProposal.tsx`
- Create: `packages/desktop/src/renderer/pages/conversation/Messages/components/TemplateProposal/useTemplateProposal.ts`
- Create: `packages/desktop/src/renderer/pages/conversation/Messages/components/TemplateProposal/index.ts`
- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx`
- Modify: `packages/desktop/src/renderer/utils/chat/conversationExport.ts`
- Create: `packages/desktop/src/renderer/utils/file/internalWorkspacePaths.ts`
- Modify: `packages/desktop/src/renderer/utils/file/workspaceMentions.ts`
- Modify: `packages/desktop/src/renderer/hooks/file/useAutoPreviewOfficeFiles.ts`
- Modify: `packages/desktop/src/renderer/pages/conversation/Workspace/hooks/useWorkspaceTree.ts`
- Modify: `packages/desktop/src/renderer/pages/conversation/Workspace/utils/treeHelpers.ts`
- Modify: `packages/desktop/src/renderer/pages/project/hooks/useProjectFiles.ts`
- Modify: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/utils/exportHelpers.ts`
- Modify: `packages/desktop/src/renderer/pages/conversation/components/ConversationTitleMinimap/minimapUtils.ts`
- Modify: every
  `packages/desktop/src/renderer/services/i18n/locales/<supported-language>/conversation.json`
- Generate: `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`
- Create: `tests/unit/renderer/templateProposal/TemplateProposalCard.dom.test.tsx`
- Create: `tests/unit/renderer/templateProposal/MessageTextTemplateProposal.dom.test.tsx`
- Modify: `tests/unit/renderer/conversation/conversationExport.test.ts`
- Create: `tests/unit/renderer/conversation/templateProposalExports.test.ts`
- Create: `tests/unit/renderer/conversation/minimapTemplateProposal.test.ts`
- Create: `tests/unit/renderer/utils/internalWorkspacePaths.test.ts`
- Modify: `tests/unit/renderer/utils/workspaceMentions.test.ts`
- Modify: `tests/unit/renderer/useAutoPreviewOfficeFiles.dom.test.ts`
- Modify: `tests/unit/pages/project/useProjectFiles.test.ts`
- Modify: `tests/unit/workspace/treeHelpers.test.ts`
- Modify: `tests/unit/renderer/messageList.dom.test.tsx`
- Modify: `tests/unit/renderer/messageListStreaming.dom.test.tsx`

- [ ] Before editing locale files, read
  `packages/desktop/src/common/config/i18n-config.json`. At review time it defines 12
  languages and the existing `conversation` module. Add natural translations to every
  configured language; do not create a new module.

Required key tree:

```text
conversation.templateProposal.title
conversation.templateProposal.status.validating
conversation.templateProposal.status.proposed
conversation.templateProposal.status.committing
conversation.templateProposal.status.committed
conversation.templateProposal.status.changed
conversation.templateProposal.status.failed
conversation.templateProposal.status.discarded
conversation.templateProposal.status.expired
conversation.templateProposal.actions.add
conversation.templateProposal.actions.discard
conversation.templateProposal.actions.retry
conversation.templateProposal.actions.inspectTheme
conversation.templateProposal.actions.inspectSource
conversation.templateProposal.previewFallback
conversation.templateProposal.previewMissing
conversation.templateProposal.previewAlt
conversation.templateProposal.retainedReference
conversation.templateProposal.futureProviderDisclosure
conversation.templateProposal.sourceNotRetained
conversation.templateProposal.sampleTokensTitle
conversation.templateProposal.sampleTokensApproval
conversation.templateProposal.transportError
conversation.templateProposal.actionFailed
conversation.templateProposal.errors.invalidMarker
conversation.templateProposal.errors.workspaceUnavailable
conversation.templateProposal.errors.outsideWorkspace
conversation.templateProposal.errors.sourceMissing
conversation.templateProposal.errors.sourceChanged
conversation.templateProposal.errors.invalidStaging
conversation.templateProposal.errors.themeInvalid
conversation.templateProposal.errors.referenceInvalid
conversation.templateProposal.errors.invalidSampleTokens
conversation.templateProposal.errors.openSourceFailed
conversation.templateProposal.errors.officecliUnavailable
conversation.templateProposal.errors.storageCorrupt
conversation.templateProposal.errors.installFailed
conversation.templateProposal.errors.cleanupFailed
conversation.templateProposal.errors.expired
conversation.templateProposal.errors.alreadyDiscarded
conversation.templateProposal.errors.notFound
```

Use an exhaustive `Record<TemplateProposalFailureCode, i18n-key>` mapping; never pass raw
main-process text to `t()`.

- [ ] Move skill-suggest components and update their relative imports. Update
  `MessageList.tsx` to import from `./components/SkillSuggest`; `MessageText.tsx` is not
  the skill-suggest render owner.

- [ ] Implement `useTemplateProposal` with one stable SWR key:

```typescript
['template-proposal', conversationId, messageId, canonicalMarker]
```

The fetcher calls the idempotent `stage({ retry: false })` directly; do not implement a
renderer-side `get → stage` check-then-act sequence. The main service returns an existing
record under its per-key lock. Configure no focus revalidation and no automatic error
retries. SWR's shared in-flight promise prevents duplicate transport work;
main-process locking remains the final guard. `retry` explicitly calls stage with
`retry: true`.
Use `useSWRConfig().mutate('presentation-templates')` only after a successful commit.
Handle rejected IPC promises as typed local failure instead of leaving an unhandled
promise.

- [ ] Implement the Arco review card. It must:

  - render `validating`, all seven durable states, and busy mutation state;
  - model request state as loading, ready, or transport error, and mutation state as
    `pendingAction: 'commit' | 'discard' | null`;
  - expose live state changes through `aria-live='polite'`;
  - show preview plus localized alt text, a visible fallback warning, or an explicit
    no-preview placeholder;
  - show exact source filename and retained-reference/future-provider disclosure for
    Office;
  - open the exact retained Office snapshot/installed reference through the main-process
    `open-retained-source` action without receiving its internal path; artifact-derived
    HTML may inspect its non-retained original through the validated workspace-relative
    path and existing read-only preview hook;
  - show complete `themeMarkdown` as escaped plain text in an Arco modal/drawer; do not
    execute/render embedded HTML from the candidate;
  - list every sample-token candidate in an Arco Checkbox group, let the user deselect
    false positives, initialize a new proposed card with all candidates selected, and
    state that **Add** approves retaining only the selected values;
  - disable Add/Discard during mutation and ignore double click;
  - keep the proposal/actions visible after commit/discard rejection and show a localized
    action error;
  - show Retry only for `failed`/`changed`;
  - never offer Discard as an uninstall action after `committed`;
  - use Arco interactive components and semantic color tokens; no raw button/input and
    no hardcoded user-facing string.

- [ ] Wire `MessageText` only when all are true:

```typescript
message.position === 'left' &&
(message.status === 'finish' || message.status === undefined) &&
isStreaming === false &&
message.hidden !== true &&
message.content.cronMeta === undefined &&
message.content.teammateMessage !== true &&
typeof message.content.content === 'string'
```

Parse after reasoning extraction and before Markdown/JSON formatting. A valid marker's
`visibleContent` becomes the rendered/copied answer, and `MessageTemplateProposal`
renders after visible assistant content and before the copy/timestamp row. User,
streaming, pending/work/error, malformed, multiple-marker, and quoted
example content remains visible and causes no IPC call. Use primitive digest/ID values in
dependencies; use `message.msg_id ?? message.id` as the stable persisted message ID and
do not recreate a marker object that retriggers effects on every render. If the answer is
only a valid marker, render the card without an empty Markdown bubble or copy action.

- [ ] Hide only successfully validated machine blocks from other user-facing text
  consumers while retaining the raw persisted message for audit:

  - `readMessageContent()` returns `visibleContent` for an eligible completed assistant
    text marker and raw content for every invalid/ineligible case. This automatically
    keeps context handoff/compaction from recycling valid machine metadata.
  - Text/Markdown and JSON export helpers clone/sanitize eligible assistant message
    content; they do not mutate persisted messages.
  - Minimap preview uses the same display-content helper.
  - User, streaming, teammate, cron, hidden, malformed, and unsupported marker text stays
    unchanged in copy/export/minimap output.

- [ ] Keep `.template-staging` out of normal user surfaces without assuming the backend
  hides dot-directories. Add pure, slash-normalized helpers that match only the exact
  relative root `.template-staging` and descendants. Apply them to conversation/project
  file trees, workspace search, `@file` mentions, automatic Office preview bootstrap and
  file-added events, and exported workspace ZIP traversal. Do not hide other dotfiles.
  The raw workspace directory remains untouched because only app-owned proposal data is
  eligible for deletion.

```typescript
export function isInternalWorkspaceRelativePath(relativePath: string): boolean;

export function isInternalWorkspaceFile(input: {
  workspace: string;
  filePath: string;
  relativePath?: string;
}): boolean;

export function filterInternalWorkspaceTree(nodes: IDirOrFile[]): IDirOrFile[];
```

`isInternalWorkspaceFile` first trusts a supplied relative path, otherwise removes the
normalized workspace prefix only at a path-segment boundary. It must not use an arbitrary
`includes('.template-staging')` check.

- [ ] DOM tests must cover:

  - validating → proposed;
  - fallback preview warning;
  - exact retained-source disclosure and inspect actions;
  - token approval disclosure;
  - deselecting a token omits it from commit; a forged/non-candidate token is rejected in
    the main-process service test;
  - typed failure mapping;
  - changed → retry;
  - committed/discarded/expired terminal cards;
  - commit cache refresh only on success;
  - rejected IPC promise;
  - StrictMode/rerender/history remount does not create duplicate stage work;
  - assistant-finished marker is hidden and card shown;
  - assistant-streaming, user, malformed, non-terminal, and multiple markers stay visible
    with zero stage calls.
  - text, Markdown, JSON export, context-display reads, and minimap hide a valid marker
    only; invalid/user markers remain byte-for-byte visible.
  - `.template-staging` and Windows-separator variants are absent from file tree, search,
    mention, auto-preview, and export results; `.env` and ordinary dotfiles remain.

- [ ] Generate/validate i18n, run focused tests, and commit.

```bash
bun run i18n:types
node scripts/check-i18n.js
bun run test -- tests/unit/common/office/presentationTemplateProposal.test.ts tests/unit/renderer/templateProposal/TemplateProposalCard.dom.test.tsx tests/unit/renderer/templateProposal/MessageTextTemplateProposal.dom.test.tsx tests/unit/renderer/conversation/conversationExport.test.ts tests/unit/renderer/conversation/templateProposalExports.test.ts tests/unit/renderer/conversation/minimapTemplateProposal.test.ts tests/unit/renderer/utils/internalWorkspacePaths.test.ts tests/unit/renderer/utils/workspaceMentions.test.ts tests/unit/renderer/useAutoPreviewOfficeFiles.dom.test.ts tests/unit/pages/project/useProjectFiles.test.ts tests/unit/workspace/treeHelpers.test.ts tests/unit/renderer/messageList.dom.test.tsx tests/unit/renderer/messageListStreaming.dom.test.tsx
bunx tsc --noEmit
git add packages/desktop/src/common/types/office/presentationTemplateProposal.ts packages/desktop/src/renderer/pages/conversation/Messages packages/desktop/src/renderer/pages/conversation/GroupedHistory/utils/exportHelpers.ts packages/desktop/src/renderer/pages/conversation/components/ConversationTitleMinimap/minimapUtils.ts packages/desktop/src/renderer/pages/conversation/Workspace/hooks/useWorkspaceTree.ts packages/desktop/src/renderer/pages/conversation/Workspace/utils/treeHelpers.ts packages/desktop/src/renderer/pages/project/hooks/useProjectFiles.ts packages/desktop/src/renderer/hooks/file/useAutoPreviewOfficeFiles.ts packages/desktop/src/renderer/utils/chat/conversationExport.ts packages/desktop/src/renderer/utils/file/internalWorkspacePaths.ts packages/desktop/src/renderer/utils/file/workspaceMentions.ts packages/desktop/src/renderer/services/i18n tests/unit/common/office/presentationTemplateProposal.test.ts tests/unit/renderer/templateProposal tests/unit/renderer/conversation tests/unit/renderer/utils/internalWorkspacePaths.test.ts tests/unit/renderer/utils/workspaceMentions.test.ts tests/unit/renderer/useAutoPreviewOfficeFiles.dom.test.ts tests/unit/pages/project/useProjectFiles.test.ts tests/unit/workspace/treeHelpers.test.ts tests/unit/renderer/messageList.dom.test.tsx tests/unit/renderer/messageListStreaming.dom.test.tsx
git commit -m "feat(conversation): review template proposals in chat"
```

---

### Task 11: Verify the end-to-end core contract and release boundary

**Files:**

- Modify as failures require: tests created in Tasks 1–10 only
- Create: `tests/integration/templateProposalLifecycle.test.ts`
- Create: `tests/integration/templateProposalRendererFlow.dom.test.tsx`

- [ ] Add an integration fixture using temp workspace, proposal, and template roots plus
  a fake inspector. Exercise:

  1. create valid Office staging/source;
  2. stage and inspect the sanitized public result;
  3. construct a new store/service instance and get the same proposal;
  4. deselect one candidate, commit, list the installed gallery pack, and verify
     theme/reference/preview hashes plus only the approved token subset;
  5. commit again and receive the same ID;
  6. create another same-name proposal and receive the `-2` ID;
  7. change the authoritative source after review and verify `changed`, no install;
  8. discard a third proposal and prove unrelated workspace files remain;
  9. run maintenance and prove corrupt/unknown directories are preserved, not deleted.

- [ ] Add a controlled renderer integration test that injects a **completed assistant**
  text message (not a user-pasted message), runs parser → MessageText → proposal IPC
  facade → card, and verifies validating → proposed → Add plus gallery cache refresh. Its
  negative case injects the same syntax as a user/right message and asserts raw visibility
  plus zero staging calls. Do not depend on the deferred T4 skill to produce the marker.

- [ ] Run all focused proposal tests together.

```bash
bun run test -- tests/unit/process/services/officeArtifact/officeCliRunner.test.ts tests/unit/process/presentation-template tests/unit/process/bridge/nativePayloadSchemas.test.ts tests/unit/common/office/presentationTemplateProposal.test.ts tests/unit/renderer/templateProposal tests/integration/presentationTemplateProposalBridge.test.ts tests/integration/templateProposalLifecycle.test.ts tests/integration/templateProposalRendererFlow.dom.test.tsx
```

- [ ] Run project gates without broad auto-fix commands that could mutate unrelated
  files.

```bash
bun run i18n:types
node scripts/check-i18n.js
bun run lint
bun run format:check
bunx tsc --noEmit
bun run test
bun run test:coverage
```

Coverage must remain at least 80% for changed/new files. A failure is work remaining, not
a note to waive.

- [ ] Review the diff for path/internal-data leaks and directory count regressions.

```bash
git diff --check origin/sprint1...HEAD
git diff --stat origin/sprint1...HEAD
git status --short
```

- [ ] Commit final integration coverage.

```bash
git add tests/integration/templateProposalLifecycle.test.ts tests/integration/templateProposalRendererFlow.dom.test.tsx
git commit -m "test(templates): cover proposal lifecycle"
```

- [ ] Stop here. Do not push and do not claim the user-facing feature is released.

## T4 follow-up plan — deliberately not implemented here

- Author the template-creation skill and update its marker/source-copy instructions to
  match this exact protocol.
- Add it to the AionCore-owned embedded auto-inject corpus and update builtin inventory
  tests.
- Verify discovery/materialization separately for AionRS and every named supported ACP
  backend; show honest unavailable/fallback behavior where hot loading is unsupported.
- Add positive/negative trigger evals, including separation from the existing general
  skill-creation flow.
- Run packaged macOS ARM/Intel and Windows creation → review → gallery-use smokes.
- Do not enable Office creation before EPIC-001 2B supplies/consumes the canonical
  artifact contract and BUG-014 packaged template handoff passes. Coordinate the backend
  bundle/version change with BUG-013. Reuse BUG-003 validation plumbing without
  reopening BUG-003.

## Implementation self-review checklist

- [ ] Every public field is required by the card; no app-owned path/hash/key crosses IPC.
- [ ] Every filesystem deletion starts from a validated app-owned UUID directory.
- [ ] No `startsWith` path containment, check-then-create destination ID, or shared JSON
  store remains.
- [ ] OfficeCLI calls use `--json`, bounded extraction, and format-specific preview mode.
- [ ] Empty Office extraction fails closed; screenshot failure is visibly degraded.
- [ ] Marker classification is strict, terminal, singular, and defensive.
- [ ] User/streaming/malformed content is never hidden.
- [ ] Proposal state survives restart and duplicate render/click calls.
- [ ] Source changes require fresh consent.
- [ ] Complete theme/source/token/privacy information is reviewable before Add.
- [ ] Native provider constants, schemas, fixtures, and bridge definitions are exhaustive.
- [ ] All configured locales and generated i18n types are current.
- [ ] New/modified runtime behavior has risk-first failure tests and ≥80% coverage.
- [ ] Directory limits are no worse than the measured upstream base.
- [ ] Core machinery is not represented as T4/platform release completion.
