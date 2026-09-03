# BUG-014 Packaged Template and Initial Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship all built-in PPTX/DOCX reference files in packaged apps and retain a Guid first-turn template payload until AionRS is genuinely ready and execution succeeds.

**Architecture:** Use one manifest as the packaging/runtime inventory for all 12 built-in presentation packs. electron-builder copies the correct desktop resource directory, after-pack verifies every non-null reference, and the renderer uses an idempotent handoff state machine rather than deleting session payloads before execution.

**Tech Stack:** electron-builder, Node.js release scripts, strict TypeScript, React, Vitest 4, sessionStorage, Arco UI.

## Global Constraints

- Start from a fresh `origin/sprint2` containing `343b725c4`; do not cherry-pick local-only commit `46feec369`.
- Keep packaging inventory and renderer handoff as separate commits/MRs so either can be reverted independently.
- The package must contain exactly four PPTX and four DOCX reference files. The four HTML packs intentionally have `packagedReferenceFile: null`.
- Do not weaken Gallery behavior for ACP or HTML templates.
- Never remove a stored first-turn payload before `executeCommand` resolves successfully.
- Malformed session payloads are non-retryable and must be discarded with a sanitized log; transient runtime/send failures retain the original payload.

---

### Task 1: Define and enforce the package inventory

**Files:**

- Create: `packages/desktop/resources/presentation-templates/manifest.json`
- Create: `packages/shared-scripts/src/presentation-template-inventory.js`
- Modify: `packages/desktop/electron-builder.yml`
- Modify: `scripts/afterPack.js`
- Modify: `packages/desktop/src/process/resources/presentation-templates/index.ts`
- Modify: `packages/desktop/src/process/resources/presentation-templates/index.test.ts`
- Modify: `tests/unit/assets/afterPackAioncoreIsolation.test.ts`
- Modify: `tests/unit/releasePackagingConfig.test.ts`

**Inventory interface:**

```js
readPresentationTemplateInventory(manifestPath)
expectedPresentationTemplateFiles(inventory)
assertPresentationTemplateResources({ inventory, resourcesDirectory })
```

Each entry has `{ id, format: 'html' | 'pptx' | 'docx', packagedReferenceFile: string | null }`.

**Required entries:**

| ID | Format | Packaged reference |
| --- | --- | --- |
| editorial-field-report | html | `null` |
| simple-light | html | `null` |
| simple-dark | html | `null` |
| market-trends-report | html | `null` |
| business-review | pptx | `business-review.pptx` |
| project-kickoff | pptx | `project-kickoff.pptx` |
| monthly-steerco | pptx | `monthly-steerco.pptx` |
| connected-ops | pptx | `connected-ops.pptx` |
| business-report | docx | `business-report.docx` |
| decision-memo | docx | `decision-memo.docx` |
| operations-guide | docx | `operations-guide.docx` |
| proposal-sow | docx | `proposal-sow.docx` |

- [ ] Write failing inventory tests for all 12 IDs, exact format/reference pairing, duplicate IDs/files, traversal paths, wrong extensions, missing files, extra binary reference files, and an HTML entry with a non-null reference.
- [ ] Change `packages/desktop/electron-builder.yml` from root-relative `resources/presentation-templates` to `packages/desktop/resources/presentation-templates`, still targeting packaged `presentation-templates`.
- [ ] Implement the CommonJS inventory helper with strict JSON validation. Resolve only basenames inside the configured resource directory; reject symlinks, directories, and traversal.
- [ ] Make `scripts/afterPack.js` invoke `assertPresentationTemplateResources` against the actual packaged resources directory and fail non-zero when any of the exact eight references is absent.
- [ ] Make `BUILTIN_TEMPLATE_PACKS` and its test agree with the manifest so Gallery metadata and package verification cannot drift independently.
- [ ] Run:

```bash
bunx vitest run tests/unit/releasePackagingConfig.test.ts tests/unit/assets/afterPackAioncoreIsolation.test.ts packages/desktop/src/process/resources/presentation-templates/index.test.ts
bun run test
```

- [ ] Expect the focused command to fail before the corrected path/inventory exists and pass afterward. Commit `fix(packaging): verify manifest template inventory`.

### Task 2: Make Guid first-turn handoff retry-safe

**Files:**

- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`
- Modify: `tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx`
- Verify non-regression: `tests/unit/renderer/useGuidSend.dom.test.ts`

**Readiness contract:**

```ts
type InitialHandoffReadiness = {
  conversationId: string;
  modelId?: string;
  agentWarmed: boolean;
  runtimeGateHydrated: boolean;
  canSendMessage: boolean;
};
```

Processing is allowed only when every field is ready. The stored payload remains the source of truth until execution succeeds.

- [ ] Add failing tests proving no send occurs before model selection, runtime warmup, gate hydration, and `canSendMessage`; then prove the same payload sends once after all become ready.
- [ ] Add a failure test where `executeCommand` rejects once, readiness changes, and the original input/files/`injectSkills` are retried unchanged.
- [ ] Add React Strict Mode coverage proving one successful execution despite effect re-entry.
- [ ] Add malformed JSON and schema-invalid payload cases: log a bounded sanitized error, clear both payload and in-flight marker, and never call `executeCommand`.
- [ ] Replace the current pre-execution `processedKey`/payload deletion with an in-memory attempt ref plus a recoverable session state. Mark the attempt in flight immediately before execution; clear it on rejection; delete the payload only after resolution.
- [ ] Re-read the payload for each retry rather than retaining a partially parsed/mutated object. Accept only `{ input: string, files?: string[], injectSkills?: string[] }` with bounded arrays and strings.
- [ ] Do not treat an unavailable/busy runtime as an execution failure; leave the effect dormant until readiness changes.
- [ ] Run:

```bash
bunx vitest run tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx tests/unit/renderer/useGuidSend.dom.test.ts
bun run test
```

- [ ] Commit `fix(conversation): retry initial template handoff`.

### Task 3: Verify installed artifacts and first send

- [ ] Run `just check` and `bun run test:coverage` from the integration commit.
- [ ] Build macOS ARM, macOS Intel, and Windows packages. For each package, record the installer hash and assert the exact eight binary reference paths under packaged `presentation-templates/`.
- [ ] Launch each installed build with a disposable profile, open Template Gallery, and verify all four PPTX and four DOCX packs resolve their references.
- [ ] From Guid, select a PPTX template and create an AionRS conversation while delaying runtime readiness; verify one send occurs after readiness and the template payload survives one injected transient failure.
- [ ] Repeat a basic ACP template send to prove the packaging change has no ACP regression.

## Final Acceptance

- Builder configuration copies `packages/desktop/resources/presentation-templates`.
- A package missing any of the exact eight PPTX/DOCX files cannot complete after-pack.
- Runtime Gallery metadata and packaging use one validated inventory.
- Guid first-turn handoff waits for model, warmup, and runtime gate readiness.
- Transient failure retains and retries the exact payload; success removes it exactly once.
- Installed macOS ARM, macOS Intel, and Windows evidence is attached before BUG-014 closes.

