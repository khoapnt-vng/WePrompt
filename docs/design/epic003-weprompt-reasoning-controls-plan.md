> [!WARNING]
> **Published 2026-08-11 from a gitignored working copy. Authored 2026-08-07 against a baseline that no longer applies — do NOT execute this plan as written.**
>
> **Why it is published:** it existed only inside one untracked git worktree. It was one `git worktree remove` from being lost, and a gitignored path cannot be shared with the engineer who owns EPIC-003. Sprint 2 lost three separate documents this way.
>
> **What is stale — read before starting.** This plan was written when EPIC-003's entry gate was DR-3: bump `ACCEPTED_AIONCORE_SOURCE_COMMIT` to upstream `v0.1.62` and extend the accepted migration lineage 27 -> 37, picking up ten upstream migrations including `project_bind`, `user_scope`, and `conversation_fork`.
>
> **That gate is dead.** The Sprint 3 release line is the VNG/GitHub `v0.1.51` tag, `d4d8e877`, which carries migrations `001...027` **only** - none of those ten exist on it (verified by grepping the `.sql` and `.rs` trees). Any step here that assumes them, or that assumes migration numbers above `037`, is targeting a baseline we do not ship.
>
> **The T5.1 re-charter is DONE (2026-08-11) — read it before this plan:** [Sprint 3 plan, T5.1](../readme/sprint3-plan.md). Verdict **ADMISSIBLE** — the epic is NOT blocked by the `001...027` baseline, and the migration cost is mechanical (`038`/`039` become `028`/`029`). **But six non-migration gates now apply (EG-1..EG-6), and the first is serious: DR-2's discovery seam does not exist on the shipped backend** (`capabilities.reasoning` returns zero hits), nor does the precedent DR-2 cites for it. DR-2's premise that WePrompt makes no runtime call to AionCore is also false — `/health` exists and is already polled.
>
> **This plan's own base pin will halt you at step one.** It pins a commit that is not what we ship and orders "stop and replan" on mismatch. See T5.1 PD-3. Execution order is also corrected there (PD-12): the WePrompt fail-closed slice is the only one startable today.
>
> **What still holds:** DR-2 - contract discovery rides the startup boundary as a success-path `capabilities.reasoning` stage, absent => `unsupported`, one source for both floors. DR-1 changes only in that pins now reference the GitHub release line rather than upstream. See [the corrected release-line record](aioncore-sprint3-release-line.md).
>
> The plan is published **verbatim** below. Nothing in it has been edited to match current reality - treat every step as needing revalidation, not as reviewed and accepted.

---

# WePrompt Provider Reasoning Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse the canonical contract, render generic adaptive reasoning controls across every admitted launch surface, and remain feature-closed until an immutable AionCore contract is approved.

**Architecture:** Strict common-layer parsing produces immutable profiles and fully scoped observed state. Existing ACP/AionRS acquisition hooks normalize complete envelopes into one provider-neutral renderer. Pre-chat, assistant, project, team, and schedule state stores bounded full-scope selection sets. Backend wire changes remain sequenced after the upstream contract is pinned; packaging, release, dependency pinning, and feature enablement are outside this plan.

**Tech Stack:** Strict TypeScript, React, Arco Design, i18next, Vitest 4, Electron IPC.

## Immutable base and verification status

- The WePrompt implementation/evidence base is this detached worktree commit `e5e9fb1365357a94e3da43949c3ac1187475b6cc`, verified as the current `origin/sprint2` tip for this planning wave.
- Every path marked **Modify** below exists at `e5e9fb1365357a94e3da43949c3ac1187475b6cc`.
- This planning task did not fetch, rebase, switch, or merge. Execution must still stop for Controller re-admission if `origin/sprint2` moves after this plan is approved.

## Global Constraints

- Implement only from an immutable Controller-admitted base. Treat `e5e9fb1365357a94e3da43949c3ac1187475b6cc` as this plan's base until the Controller explicitly refreshes it.
- Do not modify `packages/desktop/src/common/adapter/ipcBridge.ts` before the AionCore v1 wire contract, schema floor, and immutable release commit are approved.
- Unknown versions, unknown kinds, incomplete observations, unknown provider behavior, and unavailable backend contracts are non-writable and resolve feature-facing behavior to `unsupported`/hidden.
- `provider_default` is a tagged sentinel. Never translate it to a provider value; submit field omission and retain the verified `resolvedDefault` only for dependency evaluation.
- Accept mutation success only from a complete matching observed envelope; command acknowledgement and partial selections are failure.
- No Kimi, Moonshot, GreenNode, ACP, AionRS, provider, or model branch may enter shared parser, state, dependency, renderer, or launch-surface logic.
- Use Arco components for interactive UI, `@icon-park/react` for icons, UnoCSS or semantic tokens for styling, and no raw interactive HTML.
- All new or changed user-facing text uses i18n keys in every configured locale.
- Preserve legacy scalar thought-level fields for read compatibility only; never write or apply an unscoped scalar to a v1 profile.
- This plan does not authorize dependency pinning, packaging, release, tag, push, provider/model enablement, or edits to production seeds for evidence-only models.

---

### Task 1: Admission preflight

**Owner:** TBD (Controller)

**Files:**

- Read: `docs/design/provider-reasoning-capability-matrix.md`
- Read: `docs/prds/conversations/model-selector.md`
- Read: `package.json`
- Read: `packages/desktop/src/common/adapter/ipcBridge.ts`

**Interfaces:** No code output. Produces the admitted WePrompt base and the approved AionCore wire/version discovery contract needed by Task 12.

- [ ] **Step 1:** Verify `git rev-parse HEAD` equals `e5e9fb1365357a94e3da43949c3ac1187475b6cc`; stop and replan if it does not.
- [ ] **Step 2:** Verify the tracked matrix declares contract version 1 and still marks unknown behavior non-writable; stop if the evidence gate changed.
- [ ] **Step 3:** Record the Controller-approved immutable AionRS and AionCore commits; stop before Task 12 if either is absent.
- [ ] **Step 4:** Record the exact AionCore response/endpoint that reports reasoning contract version and schema floor; stop before Task 12 if that wire shape is not approved.
- [ ] **Step 5:** Compare the admitted base with current `origin/sprint2`; stop for re-admission on any overlap with EPIC-002 or provider/model-selector work.

### Task 2: Canonical TypeScript contract and fixture compiler

**Owner:** TBD (Controller)

**Files:**

- Create: `packages/desktop/src/common/types/provider/modelReasoning.ts`
- Create: `packages/desktop/src/common/types/provider/modelReasoningSchema.ts`
- Modify: `packages/desktop/src/common/config/storage.ts`
- Modify: `packages/desktop/src/common/types/provider/providerApi.ts`
- Modify: `packages/desktop/src/common/types/platform/acpTypes.ts`
- Create: `tests/unit/providers/reasoning/modelReasoningSchema.test.ts`
- Create: `tests/unit/providers/reasoning/tsconfig.json`
- Create: `tests/unit/providers/reasoning/fixtures/unsupported.json`
- Create: `tests/unit/providers/reasoning/fixtures/fixed.json`
- Create: `tests/unit/providers/reasoning/fixtures/enum.json`
- Create: `tests/unit/providers/reasoning/fixtures/boolean.json`
- Create: `tests/unit/providers/reasoning/fixtures/bounded-integer.json`
- Create: `tests/unit/providers/reasoning/fixtures/dependent-multi-control.json`
- Create: `tests/unit/providers/reasoning/fixtures/observed-dependent.json`
- Create: `tests/unit/providers/reasoning/fixtures/unknown-version.json`

**Interfaces:** Export closed `ModelReasoningProfile`, `ReasoningModelScope`, `ReasoningSelection`, and `ObservedModelReasoningProfile` types. Export `parseModelReasoningProfile(raw: unknown): ParseResult<ModelReasoningProfile>` and `parseObservedModelReasoningProfile(raw: unknown): ParseResult<ObservedModelReasoningProfile>`. Raw parsing checks the version and forbidden keys before v1 narrowing. Extend `ModelSettings` additively with `reasoning_profile?: ModelReasoningProfile`.

- [ ] **Step 1 (RED):** Add `roundtrips unsupported fixture exactly` in `tests/unit/providers/reasoning/modelReasoningSchema.test.ts`; assert `parse(...).value` serializes equal to `tests/unit/providers/reasoning/fixtures/unsupported.json`. It fails today because the schema module does not exist.
- [ ] **Step 2 (RED):** Add `roundtrips fixed fixture with zero controls` in `tests/unit/providers/reasoning/modelReasoningSchema.test.ts`; assert state `fixed`, controls length 0, and exact JSON equality. It fails today because no fixed profile type exists.
- [ ] **Step 3 (RED):** Add `preserves enum opaque values and order` in `tests/unit/providers/reasoning/modelReasoningSchema.test.ts`; assert values equal `['minimal', 'xhigh', 'ultra']`. It fails today because no generic enum descriptor exists.
- [ ] **Step 4 (RED):** Add `preserves boolean provider default` in `tests/unit/providers/reasoning/modelReasoningSchema.test.ts`; assert the tagged default and `resolvedDefault === true`. It fails today because defaults are scalar thought levels.
- [ ] **Step 5 (RED):** Add `preserves integer bounds without coercion` in `tests/unit/providers/reasoning/modelReasoningSchema.test.ts`; assert `[minimum, maximum, step]` equals `[1024, 32768, 1024]`. It fails today because no integer descriptor exists.
- [ ] **Step 6 (RED):** Add `preserves dependent multi-control predicates` in `tests/unit/providers/reasoning/modelReasoningSchema.test.ts`; assert the exact `visibleWhen` array. It fails today because dependencies are not modeled.
- [ ] **Step 7 (RED):** Add `roundtrips complete observed envelope` in `tests/unit/providers/reasoning/modelReasoningSchema.test.ts`; assert exact equality for scope, profile, both selections, and both active IDs. It fails today because no observed-envelope type exists.
- [ ] **Step 8 (RED):** Add `rejects contract version 2 before narrowing` in `tests/unit/providers/reasoning/modelReasoningSchema.test.ts`; assert `{ ok: false, code: 'unsupported_contract_version' }`. It fails today because no raw-version gate exists.
- [ ] **Step 9 (RED):** Add `rejects forbidden mapping keys recursively` in `tests/unit/providers/reasoning/modelReasoningSchema.test.ts`; inject `requestMapping` below a choice and assert `{ ok: false, code: 'forbidden_public_key' }`. It fails today because no recursive key scan exists.
- [ ] **Step 10:** Run `bunx tsc -p tests/unit/providers/reasoning/tsconfig.json --noEmit`; expected RED is unresolved imports for `modelReasoning`/`modelReasoningSchema`.
- [ ] **Step 11:** Run `bunx vitest run tests/unit/providers/reasoning/modelReasoningSchema.test.ts`; expected RED is module-not-found, not an unrelated test failure.
- [ ] **Step 12:** Implement closed contract types in `packages/desktop/src/common/types/provider/modelReasoning.ts` without `any`.
- [ ] **Step 13:** Implement the raw-version parser in `packages/desktop/src/common/types/provider/modelReasoningSchema.ts` without coercion.
- [ ] **Step 14:** Implement recursive forbidden-key scanning in `packages/desktop/src/common/types/provider/modelReasoningSchema.ts`.
- [ ] **Step 15:** Implement normative bounds/default/dependency validation in `packages/desktop/src/common/types/provider/modelReasoningSchema.ts`.
- [ ] **Step 16:** Add `reasoning_profile` to `ModelSettings` in `packages/desktop/src/common/config/storage.ts` and its provider API mirror.
- [ ] **Step 17:** Run the TypeScript and Vitest commands from Steps 10-11; expect PASS.
- [ ] **Step 18:** Commit only Task 2 files with `feat(models): add reasoning capability contract`.

### Task 3: Provider metadata preservation without seed expansion

**Owner:** TBD (Controller)

**Files:**

- Modify: `packages/desktop/src/common/config/storage.ts`
- Modify: `packages/desktop/src/common/types/provider/providerApi.ts`
- Modify: `packages/desktop/src/common/adapter/apiModelMapper.ts`
- Modify: `tests/unit/common-adapter/apiModelMapper.test.ts`
- Modify: `packages/desktop/src/process/utils/seedBuiltinProviders.ts`
- Modify: `packages/desktop/src/process/utils/seedBuiltinProviders.test.ts`
- Modify: `tests/unit/common-config/storage.test.ts`

**Interfaces:** Provider read/write/merge paths preserve `model_settings[model].reasoning_profile` and `capability_revision` exactly. Built-in seed merge is non-destructive and may attach profiles only to exact models admitted by the matrix; it must not add an evidence-only model or provider branch to shared code.

- [ ] **Step 1 (RED):** Add `api mapper preserves reasoning profile and capability revision` in `tests/unit/common-adapter/apiModelMapper.test.ts`; assert exact deep equality after backend-to-storage mapping. It fails today because neither field is mapped.
- [ ] **Step 2 (RED):** Add `storage roundtrip preserves every canonical profile shape` in `tests/unit/common-config/storage.test.ts`; parameterize six v1 profiles and assert deep equality after serialize/reload. It fails today because storage types omit profiles/revision.
- [ ] **Step 3 (RED):** Add `seed merge preserves user credential` in `packages/desktop/src/process/utils/seedBuiltinProviders.test.ts`; assert the credential is unchanged after merge. It fails against any destructive reconstruction path.
- [ ] **Step 4 (RED):** Add `seed merge preserves user URL` in `packages/desktop/src/process/utils/seedBuiltinProviders.test.ts`; assert the URL is unchanged after merge. It fails against any destructive reconstruction path.
- [ ] **Step 5 (RED):** Add `seed merge preserves user-added model` in `packages/desktop/src/process/utils/seedBuiltinProviders.test.ts`; assert the added model remains. It fails against any full seeded replacement.
- [ ] **Step 6 (RED):** Add `seed merge preserves user-removed model` in `packages/desktop/src/process/utils/seedBuiltinProviders.test.ts`; assert the removed model is not recreated. It fails against any full seeded replacement.
- [ ] **Step 7 (RED):** Add `seed merge preserves unrelated model settings` in `packages/desktop/src/process/utils/seedBuiltinProviders.test.ts`; assert `image_input` and `openai_api_mode` survive reasoning-profile merge. It fails if the current merge replaces `model_settings` entries.
- [ ] **Step 8 (RED):** Add `seed merge never enables evidence-only models` in `packages/desktop/src/process/utils/seedBuiltinProviders.test.ts`; assert `kimi-k3`, K2.7 variants, GreenNode MiniMax, and GreenNode GPT-5 are not added. It fails if evidence fixtures are mistaken for rollout authorization.
- [ ] **Step 9:** Run `bunx vitest run tests/unit/common-adapter/apiModelMapper.test.ts tests/unit/common-config/storage.test.ts packages/desktop/src/process/utils/seedBuiltinProviders.test.ts`; expect the named field-preservation assertions to fail.
- [ ] **Step 10:** Preserve reasoning profile/revision in `packages/desktop/src/common/adapter/apiModelMapper.ts` without provider/model branches.
- [ ] **Step 11:** Preserve the additive fields in `packages/desktop/src/common/config/storage.ts` and `packages/desktop/src/common/types/provider/providerApi.ts`.
- [ ] **Step 12:** Implement non-destructive metadata merge in `packages/desktop/src/process/utils/seedBuiltinProviders.ts` without enabling evidence-only models.
- [ ] **Step 13:** Re-run the exact Vitest command from Step 9; expect PASS.
- [ ] **Step 14:** Commit only Task 3 files with `feat(models): preserve reasoning capability metadata`.

### Task 4: Complete observed-state normalization

**Owner:** TBD (Controller)

**Files:**

- Modify: `packages/desktop/src/renderer/hooks/agent/useAcpConfigOptions.ts`
- Modify: `packages/desktop/src/renderer/hooks/agent/useAcpModelInfo.ts`
- Modify: `packages/desktop/src/renderer/utils/model/agentRuntimeCatalog.ts`
- Modify: `tests/unit/acpConfigOptions.test.ts`
- Modify: `tests/unit/renderer/useAcpModelInfo.dom.test.ts`

**Interfaces:** Return `{ reasoningProfile, reasoningSelections, reasoningControls, activeControlIds, scope, pending }`. Expose `setReasoningSelection(controlId, value): Promise<ObservedModelReasoningProfile>`. Install returned state only when the complete envelope matches the current generation and full scope.

- [ ] **Step 1 (RED):** Add `normalizes arbitrary ACP enum values without scale mapping` in `tests/unit/acpConfigOptions.test.ts`; assert opaque values/labels survive exactly. It fails today because normalization derives only select-oriented thought level.
- [ ] **Step 2 (RED):** Add `normalizes boolean control` in `tests/unit/acpConfigOptions.test.ts`; assert the input kind and tagged default match `tests/unit/providers/reasoning/fixtures/boolean.json`. It fails today because `deriveSelectOption` handles only selects.
- [ ] **Step 3 (RED):** Add `normalizes integer control` in `tests/unit/acpConfigOptions.test.ts`; assert input kind, minimum, maximum, and step match `tests/unit/providers/reasoning/fixtures/bounded-integer.json`. It fails today because `deriveSelectOption` handles only selects.
- [ ] **Step 4 (RED):** Add `unknown contract version is hidden and non-writable` in `tests/unit/acpConfigOptions.test.ts`; assert `reasoningProfile === null` and setter absence/disablement. It fails today because there is no version-aware profile.
- [ ] **Step 5 (RED):** Add `partial acknowledgement leaves prior envelope installed` in `tests/unit/acpConfigOptions.test.ts`; return command acknowledgement with no complete envelope and assert object identity/equality of prior state. It fails today because setters accept current config-option confirmation paths.
- [ ] **Step 6 (RED):** Add `stale generation response is ignored` in `tests/unit/acpConfigOptions.test.ts`; resolve request A after request B and assert B remains installed. It fails today because current selection state is not guarded by full profile generation.
- [ ] **Step 7 (RED):** Add `same ids with new revision resets selections` in `tests/unit/acpConfigOptions.test.ts`; change only `capabilityRevision` and assert an empty/default set. It fails today because current scope is option/model based.
- [ ] **Step 8 (RED):** Add `model refresh rejects old model envelope` in `tests/unit/renderer/useAcpModelInfo.dom.test.ts`; assert old model controls never render after model switch. It fails today because the hook exposes scalar thought level independently of full scope.
- [ ] **Step 9:** Run `bunx vitest run tests/unit/acpConfigOptions.test.ts tests/unit/renderer/useAcpModelInfo.dom.test.ts`; expect the eight named assertions to fail.
- [ ] **Step 10:** Implement complete-envelope normalization in `packages/desktop/src/renderer/hooks/agent/useAcpConfigOptions.ts`.
- [ ] **Step 11:** Add generation/full-scope response guards in `packages/desktop/src/renderer/hooks/agent/useAcpConfigOptions.ts`.
- [ ] **Step 12:** Reject old-model envelopes in `packages/desktop/src/renderer/hooks/agent/useAcpModelInfo.ts`.
- [ ] **Step 13:** Implement fail-closed dependency evaluation in `packages/desktop/src/renderer/utils/model/agentRuntimeCatalog.ts`.
- [ ] **Step 14:** Expose the generic setter from `packages/desktop/src/renderer/hooks/agent/useAcpConfigOptions.ts`.
- [ ] **Step 15:** Re-run the exact Vitest command from Step 9; expect PASS.
- [ ] **Step 16:** Commit only Task 4 files with `refactor(agent): normalize reasoning observations`.

### Task 5: Generic reasoning-controls renderer

**Owner:** TBD (Controller)

**Files:**

- Create: `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx`
- Create: `tests/unit/providers/reasoning/ReasoningControls.dom.test.tsx`

**Interfaces:** `ReasoningControlsProps` accepts only profile, selections, authoritative active IDs, pending state, and the generic setter. It has no backend/provider/model prop used for branching. It renders `Select`, `Switch`, and `InputNumber` from Arco.

- [ ] **Step 1 (RED):** Add `renders enum choices in adapter order` in `tests/unit/providers/reasoning/ReasoningControls.dom.test.tsx`; assert option text order is Minimal, Extra high, Ultra. It fails today because the component does not exist.
- [ ] **Step 2 (RED):** Add `renders boolean as accessible switch` in `tests/unit/providers/reasoning/ReasoningControls.dom.test.tsx`; assert role `switch` has the adapter label and current checked state. It fails today because the component does not exist.
- [ ] **Step 3 (RED):** Add `enforces integer minimum maximum and step` in `tests/unit/providers/reasoning/ReasoningControls.dom.test.tsx`; assert the Arco input receives 1024, 32768, and 1024. It fails today because the component does not exist.
- [ ] **Step 4 (RED):** Add `uses authoritative active ids for visibility` in `tests/unit/providers/reasoning/ReasoningControls.dom.test.tsx`; assert a dependent absent from `activeControlIds` is not rendered. It fails today because no generic dependency UI exists.
- [ ] **Step 5 (RED):** Add `prechat dependency evaluation uses logical and and provider default` in `tests/unit/providers/reasoning/ReasoningControls.dom.test.tsx`; assert a dependent appears only when every predicate resolves true. It fails today because no pre-chat evaluator exists.
- [ ] **Step 6 (RED):** Add `fixed profile renders summary without input` in `tests/unit/providers/reasoning/ReasoningControls.dom.test.tsx`; assert summary text exists and no combobox/switch/spinbutton exists. It fails today because fixed state has no renderer.
- [ ] **Step 7 (RED):** Add `unsupported profile renders nothing` in `tests/unit/providers/reasoning/ReasoningControls.dom.test.tsx`; assert container is absent. It fails today because unsupported state has no renderer.
- [ ] **Step 8 (RED):** Add `pending state disables every input` in `tests/unit/providers/reasoning/ReasoningControls.dom.test.tsx`; assert each interactive Arco control is disabled. It fails today because pending is scalar selector state.
- [ ] **Step 9 (RED):** Add `stale setter response is not announced as success` in `tests/unit/providers/reasoning/ReasoningControls.dom.test.tsx`; resolve an old-scope promise and assert no success message/state replacement. It fails today because no scope-aware renderer exists.
- [ ] **Step 10:** Run `bunx vitest run tests/unit/providers/reasoning/ReasoningControls.dom.test.tsx`; expected RED is module-not-found.
- [ ] **Step 11:** Create the mapping-free `ReasoningControls` component shell and props in `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx`.
- [ ] **Step 12:** Render enum controls with Arco `Select` in `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx`.
- [ ] **Step 13:** Render boolean controls with Arco `Switch` in `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx`.
- [ ] **Step 14:** Render integer controls with Arco `InputNumber` in `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx`.
- [ ] **Step 15:** Apply active-ID visibility and pre-chat dependency results in `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx`.
- [ ] **Step 16:** Implement the fixed presentation state in `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx`.
- [ ] **Step 17:** Implement the hidden unsupported state in `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx`.
- [ ] **Step 18:** Implement the disabled pending state in `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx`.
- [ ] **Step 19:** Add keyboard/focus behavior in `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx`.
- [ ] **Step 20:** Add provider-neutral i18n lookups in `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx` using semantic styling only.
- [ ] **Step 21:** Run the exact Vitest command from Step 10; expect PASS.
- [ ] **Step 22:** Commit only Task 5 files with `feat(conversation): add generic reasoning controls`.

### Task 6: Active ACP and AionRS conversation wiring

**Owner:** TBD (Controller)

**Files:**

- Modify: `packages/desktop/src/renderer/components/agent/AcpModelSelector.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`
- Modify: `tests/unit/renderer/AcpModelSelector.dom.test.tsx`
- Modify: `tests/unit/renderer/AionrsModelSelector.dom.test.tsx`
- Modify: `tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx`
- Modify: `tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx`

**Interfaces:** Both selector/send-box stacks consume `ReasoningControls`; acquisition and submission remain backend-specific. Fixed/unsupported profiles submit no selection. Neither stack derives a shared scale from thought level.

- [ ] **Step 1 (RED):** Add `ACP selector renders all normalized controls` in `tests/unit/renderer/AcpModelSelector.dom.test.tsx`; assert enum plus dependent integer are both present. It fails today because the selector renders only one `thoughtLevel` menu.
- [ ] **Step 2 (RED):** Add `AionRS selector renders all normalized controls` in `tests/unit/renderer/AionrsModelSelector.dom.test.tsx`; assert boolean plus dependent integer are both present. It fails today because the selector accepts one `AcpDerivedOption`.
- [ ] **Step 3 (RED):** Add `ACP send box sends generic control id and primitive value` in `tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx`; assert `setReasoningSelection('budgetTokens', 16384)`. It fails today because it calls string-only `setConfigOption` for thought level.
- [ ] **Step 4 (RED):** Add `AionRS send box sends generic control id and primitive value` in `tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx`; assert `setReasoningSelection('budgetTokens', 16384)`. It fails today because it calls thought-level setter wiring.
- [ ] **Step 5 (RED):** Add `ACP fixed profile sends nothing` in `tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx`; assert zero setter calls. It fails today because writability is inferred from scalar option presence.
- [ ] **Step 6 (RED):** Add `ACP unsupported profile sends nothing` in `tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx`; assert zero setter calls. It fails today because unsupported state is not represented.
- [ ] **Step 7 (RED):** Add `AionRS fixed profile sends nothing` in `tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx`; assert zero setter calls. It fails today because writability is inferred from scalar option presence.
- [ ] **Step 8 (RED):** Add `AionRS unsupported profile sends nothing` in `tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx`; assert zero setter calls. It fails today because unsupported state is not represented.
- [ ] **Step 9:** Run `bunx vitest run tests/unit/renderer/AcpModelSelector.dom.test.tsx tests/unit/renderer/AionrsModelSelector.dom.test.tsx tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx`; expect the named assertions to fail against single-select behavior.
- [ ] **Step 10:** Replace thought-level rendering in `packages/desktop/src/renderer/components/agent/AcpModelSelector.tsx` with `ReasoningControls`.
- [ ] **Step 11:** Replace thought-level rendering in `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector.tsx` with `ReasoningControls`.
- [ ] **Step 12:** Wire the generic setter in `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx` while retaining ACP acquisition.
- [ ] **Step 13:** Wire the generic setter in `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx` while retaining AionRS acquisition.
- [ ] **Step 14:** Re-run the exact Vitest command from Step 9; expect PASS.
- [ ] **Step 15:** Commit only Task 6 files with `feat(conversation): wire reasoning controls`.

### Task 7: Guid pre-chat scope and send payload

**Owner:** TBD (Controller)

**Files:**

- Modify: `packages/desktop/src/renderer/pages/guid/GuidPage.tsx`
- Modify: `packages/desktop/src/renderer/pages/guid/components/GuidActionRow.tsx`
- Modify: `packages/desktop/src/renderer/pages/guid/components/GuidModelSelector.tsx`
- Modify: `packages/desktop/src/renderer/pages/guid/hooks/useGuidAssistantSelection.ts`
- Modify: `packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts`
- Modify: `packages/desktop/src/renderer/pages/guid/utils/assistantDefaults.ts`
- Modify: `tests/unit/renderer/hooks/guidModelSelector.dom.test.tsx`
- Modify: `tests/unit/renderer/useGuidAgentSelection.dom.test.ts`
- Modify: `tests/unit/renderer/useGuidSend.dom.test.ts`
- Modify: `tests/unit/renderer/assistantDefaults.test.ts`

**Interfaces:** Guid state stores a bounded `ReasoningSelection[]` plus full scope. Auto model implies Auto reasoning until a compatible observed runtime set exists. Pre-chat active IDs use the normative fail-closed dependency evaluator.

- [ ] **Step 1 (RED):** Add `assistant change clears incompatible reasoning scope` in `tests/unit/renderer/useGuidAgentSelection.dom.test.ts`; assert selections become empty when assistant/backend/provider/model/revision changes. It fails today because the hook resets only a scalar thought-level value.
- [ ] **Step 2 (RED):** Add `same ids with new revision clears Guid selection` in `tests/unit/renderer/useGuidAgentSelection.dom.test.ts`; assert the old explicit value is absent. It fails today because revision is not part of the current selection key.
- [ ] **Step 3 (RED):** Add `auto model keeps reasoning at provider default` in `tests/unit/renderer/useGuidAgentSelection.dom.test.ts`; assert no explicit selection is produced before a compatible observed scope. It fails today because first thought-level option can become selected.
- [ ] **Step 4 (RED):** Add `Guid model selector renders dependent controls` in `tests/unit/renderer/hooks/guidModelSelector.dom.test.tsx`; assert fail-closed visibility from resolved defaults. It fails today because the selector accepts one thought-level option.
- [ ] **Step 5 (RED):** Replace the scalar assertion in `tests/unit/renderer/useGuidSend.dom.test.ts` with `Guid send emits complete reasoning_selections`; assert exact full-scope set and absence of writable `thought_level`. It fails today because payload contains only `conversation_overrides.thought_level`.
- [ ] **Step 6 (RED):** Add `legacy assistant scalar is read but not applied to mismatched scope` in `tests/unit/renderer/assistantDefaults.test.ts`; assert no v1 selection is produced. It fails today because legacy scalar resolution is scope-free.
- [ ] **Step 7:** Run `bunx vitest run tests/unit/renderer/hooks/guidModelSelector.dom.test.tsx tests/unit/renderer/useGuidAgentSelection.dom.test.ts tests/unit/renderer/useGuidSend.dom.test.ts tests/unit/renderer/assistantDefaults.test.ts`; expect the six named assertions to fail.
- [ ] **Step 8:** Replace scalar Guid state with the bounded full-scope set in `packages/desktop/src/renderer/pages/guid/hooks/useGuidAssistantSelection.ts`.
- [ ] **Step 9:** Pass shared renderer props through `packages/desktop/src/renderer/pages/guid/GuidPage.tsx`, `packages/desktop/src/renderer/pages/guid/components/GuidActionRow.tsx`, and `packages/desktop/src/renderer/pages/guid/components/GuidModelSelector.tsx`.
- [ ] **Step 10:** Apply fail-closed pre-chat dependency results in `packages/desktop/src/renderer/pages/guid/GuidPage.tsx`.
- [ ] **Step 11:** Emit the complete-set payload in `packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts`.
- [ ] **Step 12:** Re-run the exact Vitest command from Step 7; expect PASS.
- [ ] **Step 13:** Commit only Task 7 files with `feat(guid): scope reasoning selections`.

### Task 8: Project New Chat scope

**Owner:** TBD (Controller)

**Files:**

- Modify: `packages/desktop/src/renderer/pages/project/components/ProjectNewChatComposer.tsx`
- Modify: `tests/unit/pages/project/ProjectNewChatComposer.dom.test.tsx`

**Interfaces:** Project New Chat uses the same full scope, complete set, Auto behavior, and dependency evaluator as Guid; project identity does not weaken provider/model/revision scoping.

- [ ] **Step 1 (RED):** Add `project assistant change clears incompatible reasoning selections` in `tests/unit/pages/project/ProjectNewChatComposer.dom.test.tsx`; assert an empty set after assistant switch. It fails today because the composer tracks scalar thought level.
- [ ] **Step 2 (RED):** Add `project model change clears incompatible reasoning selections` in `tests/unit/pages/project/ProjectNewChatComposer.dom.test.tsx`; assert an empty set after model switch. It fails today because model/revision are not part of the scalar value.
- [ ] **Step 3 (RED):** Add `project same ids new revision clears selections` in `tests/unit/pages/project/ProjectNewChatComposer.dom.test.tsx`; assert no explicit value survives. It fails today because capability revision is not tracked.
- [ ] **Step 4 (RED):** Add `project new chat sends complete scoped set` in `tests/unit/pages/project/ProjectNewChatComposer.dom.test.tsx`; assert exact `reasoning_selections` and no writable legacy scalar. It fails today because the composer resolves thought-level defaults only.
- [ ] **Step 5:** Run `bunx vitest run tests/unit/pages/project/ProjectNewChatComposer.dom.test.tsx`; expect the four named assertions to fail.
- [ ] **Step 6:** Replace scalar selection state with the bounded full-scope set in `packages/desktop/src/renderer/pages/project/components/ProjectNewChatComposer.tsx`.
- [ ] **Step 7:** Pass shared renderer props in `packages/desktop/src/renderer/pages/project/components/ProjectNewChatComposer.tsx`.
- [ ] **Step 8:** Emit the complete-set New Chat payload in `packages/desktop/src/renderer/pages/project/components/ProjectNewChatComposer.tsx`.
- [ ] **Step 9:** Re-run `bunx vitest run tests/unit/pages/project/ProjectNewChatComposer.dom.test.tsx`; expect PASS.
- [ ] **Step 10:** Commit only Task 8 files with `feat(project): scope new-chat reasoning`.

### Task 9: Assistant defaults and preferences

**Owner:** TBD (Controller)

**Files:**

- Modify: `packages/desktop/src/common/types/agent/assistantTypes.ts`
- Modify: `packages/desktop/src/renderer/hooks/assistant/useAssistantEditor.ts`
- Modify: `packages/desktop/src/renderer/pages/settings/AssistantSettings/types.ts`
- Modify: `packages/desktop/src/renderer/pages/settings/AssistantSettings/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/settings/AssistantSettings/AssistantEditorSections.tsx`
- Modify: `packages/desktop/src/renderer/pages/settings/AssistantSettings/editor/DefaultsSection.tsx`
- Modify: `tests/unit/assistants/useAssistantEditor.dom.test.ts`
- Modify: `tests/unit/assistants/AssistantEditorSections.dom.test.tsx`
- Modify: `tests/unit/settings/DefaultsSectionSearch.dom.test.tsx`

**Interfaces:** Assistant defaults/preferences use `auto` or a complete bounded scoped selection set. Legacy `thought_level` and `last_thought_level_value` remain readable but cannot create a v1 set without an exact matching scope.

- [ ] **Step 1 (RED):** Add `assistant editor saves complete scoped reasoning default` in `tests/unit/assistants/useAssistantEditor.dom.test.ts`; assert exact scope plus all selected controls. It fails today because the request saves one `thought_level` scalar.
- [ ] **Step 2 (RED):** Add `assistant editor rejects mixed scope default` in `tests/unit/assistants/useAssistantEditor.dom.test.ts`; assert validation error and no save call. It fails today because scalar state has no cross-scope validation.
- [ ] **Step 3 (RED):** Add `assistant change resets editor reasoning state` in `tests/unit/assistants/useAssistantEditor.dom.test.ts`; assert the previous assistant's set is absent. It fails today because editor state restores scalar mode/value.
- [ ] **Step 4 (RED):** Add `defaults section renders every active control` in `tests/unit/assistants/AssistantEditorSections.dom.test.tsx`; assert enum, boolean, and integer fixtures each render through `ReasoningControls`. It fails today because the section renders a thought-level select.
- [ ] **Step 5 (RED):** Add `legacy scalar is displayed as compatibility information but not saved as v1` in `tests/unit/assistants/useAssistantEditor.dom.test.ts`; assert save payload has no scoped selection until user chooses against a verified profile. It fails today because legacy value is writable.
- [ ] **Step 6:** Run `bunx vitest run tests/unit/assistants/useAssistantEditor.dom.test.ts tests/unit/assistants/AssistantEditorSections.dom.test.tsx tests/unit/settings/DefaultsSectionSearch.dom.test.tsx`; expect the five named assertions to fail.
- [ ] **Step 7:** Add typed assistant scoped defaults/preferences in `packages/desktop/src/common/types/agent/assistantTypes.ts` and `packages/desktop/src/renderer/pages/settings/AssistantSettings/types.ts`.
- [ ] **Step 8:** Replace scalar assistant editor state/save mapping in `packages/desktop/src/renderer/hooks/assistant/useAssistantEditor.ts`.
- [ ] **Step 9:** Pass scoped profiles/defaults through `packages/desktop/src/renderer/pages/settings/AssistantSettings/AssistantEditorSections.tsx`.
- [ ] **Step 10:** Replace thought-level controls with `ReasoningControls` in `packages/desktop/src/renderer/pages/settings/AssistantSettings/editor/DefaultsSection.tsx`.
- [ ] **Step 11:** Re-run the exact Vitest command from Step 6; expect PASS.
- [ ] **Step 12:** Commit only Task 9 files with `feat(assistants): scope reasoning defaults`.

### Task 10: Team warmup and active member scope

**Owner:** TBD (Controller)

**Files:**

- Modify: `packages/desktop/src/renderer/pages/team/TeamPage.tsx`
- Modify: `packages/desktop/src/renderer/pages/team/hooks/teamConfigOptions.ts`
- Modify: `packages/desktop/src/renderer/pages/team/hooks/useTeamWarmup.ts`
- Modify: `tests/unit/renderer/team/TeamPageCronJobManager.dom.test.tsx`
- Modify: `tests/unit/renderer/team/useTeamWarmup.dom.test.tsx`

**Interfaces:** Team warmup consumes each member conversation's complete observed scope and assistant default set. It never shares a selection across member conversations merely because control/model IDs match.

- [ ] **Step 1 (RED):** Add `team page renders complete member reasoning controls` in `tests/unit/renderer/team/TeamPageCronJobManager.dom.test.tsx`; assert all active controls from the member envelope are visible. It fails today because `TeamPage` passes one thought-level option.
- [ ] **Step 2 (RED):** Add `team warmup keeps member scopes isolated` in `tests/unit/renderer/team/useTeamWarmup.dom.test.tsx`; create two members with identical IDs but different revisions and assert neither receives the other's values. It fails today because warmup/config options are scalar-ID based.
- [ ] **Step 3 (RED):** Add `team warmup rejects partial member observation` in `tests/unit/renderer/team/useTeamWarmup.dom.test.tsx`; assert no setter call and feature-closed state for that member. It fails today because command/config-option acknowledgement can be treated as ready.
- [ ] **Step 4 (RED):** Add `team warmup restart restores exact member scope` in `tests/unit/renderer/team/useTeamWarmup.dom.test.tsx`; assert exact match restores and one-field mismatch resets. It fails today because restored state has no full scope.
- [ ] **Step 5:** Run `bunx vitest run tests/unit/renderer/team/TeamPageCronJobManager.dom.test.tsx tests/unit/renderer/team/useTeamWarmup.dom.test.tsx`; expect the four named assertions to fail.
- [ ] **Step 6:** Consume member-scoped envelopes in `packages/desktop/src/renderer/pages/team/hooks/teamConfigOptions.ts`.
- [ ] **Step 7:** Apply complete scoped sets during warmup in `packages/desktop/src/renderer/pages/team/hooks/useTeamWarmup.ts`.
- [ ] **Step 8:** Render the active member envelope in `packages/desktop/src/renderer/pages/team/TeamPage.tsx` without team-specific provider/model mapping.
- [ ] **Step 9:** Re-run the exact Vitest command from Step 5; expect PASS.
- [ ] **Step 10:** Commit only Task 10 files with `feat(team): scope member reasoning controls`.

### Task 11: Scheduled-task edit and run scope

**Owner:** TBD (Controller)

**Files:**

- Modify: `packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/TaskDetailPage.tsx`
- Modify: `packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/resolveCronAgentConfig.ts`
- Modify: `tests/unit/renderer/cron/TaskDetailPage.dom.test.tsx`
- Modify: `tests/unit/renderer/cron/resolveCronAgentConfig.test.ts`

**Interfaces:** Scheduled tasks persist and submit a complete bounded scoped set. Edit-time profile change resets incompatible values. Run-time mismatch or incomplete observation sends no reasoning selection.

- [ ] **Step 1 (RED):** Add `scheduled task editor renders generic profile controls` in `tests/unit/renderer/cron/TaskDetailPage.dom.test.tsx`; assert enum/boolean/integer fixtures render via `ReasoningControls`. It fails today because detail UI displays a reasoning-effort string section.
- [ ] **Step 2 (RED):** Add `scheduled task edit clears same ids with new revision`; assert old values are absent. It fails today because revision is not stored in `config_options`.
- [ ] **Step 3 (RED):** Replace the scalar case in `tests/unit/renderer/cron/resolveCronAgentConfig.test.ts` with `schedule run submits complete exact-scope set`; assert exact `reasoning_selections`. It fails today because resolver emits `{ reasoning_effort: 'high' }`.
- [ ] **Step 4 (RED):** Add `schedule run sends nothing for stale scope` in `tests/unit/renderer/cron/resolveCronAgentConfig.test.ts`; assert no reasoning field/setter input. It fails today because string config options have no scope guard.
- [ ] **Step 5 (RED):** Add `schedule run sends nothing for fixed profile` in `tests/unit/renderer/cron/resolveCronAgentConfig.test.ts`; assert no reasoning field. It fails today because scalar config is independent of profile state.
- [ ] **Step 6 (RED):** Add `schedule run sends nothing for unsupported profile` in `tests/unit/renderer/cron/resolveCronAgentConfig.test.ts`; assert no reasoning field. It fails today because unsupported state is not represented.
- [ ] **Step 7:** Run `bunx vitest run tests/unit/renderer/cron/TaskDetailPage.dom.test.tsx tests/unit/renderer/cron/resolveCronAgentConfig.test.ts`; expect the six named assertions to fail.
- [ ] **Step 8:** Implement scoped edit serialization in `packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/TaskDetailPage.tsx`.
- [ ] **Step 9:** Implement scoped run serialization in `packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/resolveCronAgentConfig.ts`.
- [ ] **Step 10:** Implement fail-closed scheduled-task restore in `packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/resolveCronAgentConfig.ts`.
- [ ] **Step 11:** Re-run the exact Vitest command from Step 7; expect PASS.
- [ ] **Step 12:** Commit only Task 11 files with `feat(cron): scope reasoning selections`.

### Task 12: Backend wire seam after upstream admission

**Owner:** TBD (Controller)

**Files:**

- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Modify: `tests/unit/common-adapter/ipcBridgeConversation.test.ts`
- Modify: `packages/desktop/src/common/types/provider/providerApi.ts`
- Modify: `packages/desktop/src/common/types/platform/acpTypes.ts`

**Interfaces:** Exact signatures must match the Controller-approved AionCore contract from Task 1. Provider CRUD transports `capability_revision` and `model_settings.reasoning_profile`; conversation/config mutation transports `reasoning_selections` and receives a complete `ObservedModelReasoningProfile`. Unknown/unavailable contract version hides/disables controls.

- [ ] **Step 1:** Reconfirm the approved immutable AionCore commit, schema floor, contract version field, and response DTO; stop without editing if any item is missing or changed.
- [ ] **Step 2 (RED):** Add `provider IPC preserves capability revision and profile` in `tests/unit/common-adapter/ipcBridgeConversation.test.ts`; assert exact deep equality at the bridge boundary. It fails today because IPC types omit the fields.
- [ ] **Step 3 (RED):** Add `conversation create sends complete reasoning selections` in `tests/unit/common-adapter/ipcBridgeConversation.test.ts`; assert the exact approved snake_case request field and full scopes. It fails today because the bridge sends only optional `thought_level`.
- [ ] **Step 4 (RED):** Add `mutation requires complete observed envelope` in `tests/unit/common-adapter/ipcBridgeConversation.test.ts`; return command acknowledgement/partial data and assert a typed feature-closed error. It fails today because no v1 mutation response exists.
- [ ] **Step 5 (RED):** Add `future backend contract disables write` in `tests/unit/common-adapter/ipcBridgeConversation.test.ts`; report version 2 and assert the mutation rejects before IPC. It fails today because there is no contract gate.
- [ ] **Step 6 (RED):** Add `missing backend contract disables write` in `tests/unit/common-adapter/ipcBridgeConversation.test.ts`; omit the version and assert the mutation rejects before IPC. It fails today because there is no contract gate.
- [ ] **Step 7:** Run `bunx vitest run tests/unit/common-adapter/ipcBridgeConversation.test.ts`; expect the five named assertions to fail.
- [ ] **Step 8:** Add approved provider/profile wire fields to `packages/desktop/src/common/types/provider/providerApi.ts`.
- [ ] **Step 9:** Add approved observed-envelope wire fields to `packages/desktop/src/common/types/platform/acpTypes.ts`.
- [ ] **Step 10:** Bridge provider and conversation fields in `packages/desktop/src/common/adapter/ipcBridge.ts`; retain legacy scalar read compatibility.
- [ ] **Step 11:** Add the fail-closed backend contract gate in `packages/desktop/src/common/adapter/ipcBridge.ts`.
- [ ] **Step 12:** Re-run the exact Vitest command from Step 7; expect PASS.
- [ ] **Step 13:** Commit only Task 12 files with `feat(ipc): bridge reasoning observations`.

### Task 13: Provider-neutral locale coverage

**Owner:** TBD (Controller)

**Files:**

- Modify: `packages/desktop/src/renderer/services/i18n/locales/de-DE/acp.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/en-US/acp.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/es-ES/acp.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/fa-IR/acp.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/ja-JP/acp.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/ko-KR/acp.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/pt-BR/acp.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/ru-RU/acp.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/tr-TR/acp.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/uk-UA/acp.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/zh-CN/acp.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/zh-TW/acp.json`
- Create: `tests/unit/providers/reasoning/reasoningControlsI18n.test.ts`
- Generate (gitignored; never edit or add): `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`

**Interfaces:** Add only provider-neutral shared copy for Auto/provider default, fixed summary fallback, pending state, invalid/stale reset, and mutation failure. Adapter-supplied labels/descriptions remain opaque runtime text and are not translated through shared provider/model keys.

- [ ] **Step 1 (RED):** Add `every configured locale contains reasoning control keys` in `tests/unit/providers/reasoning/reasoningControlsI18n.test.ts`; enumerate languages from `packages/desktop/src/common/config/i18n-config.json` and assert each required key is a non-empty string. It fails today because the keys do not exist.
- [ ] **Step 2 (RED):** Add `shared keys contain no provider or model names` in `tests/unit/providers/reasoning/reasoningControlsI18n.test.ts`; recursively assert key names and English shared values contain none of `kimi`, `moonshot`, `greennode`, `acp`, or `aionrs`. It fails until the new key set is defined and guards future branching.
- [ ] **Step 3:** Run `bunx vitest run tests/unit/providers/reasoning/reasoningControlsI18n.test.ts`; expect missing-key failures.
- [ ] **Step 4:** Add the provider-neutral key set to `packages/desktop/src/renderer/services/i18n/locales/en-US/acp.json`.
- [ ] **Step 5:** Add the same key set to `packages/desktop/src/renderer/services/i18n/locales/de-DE/acp.json`.
- [ ] **Step 6:** Add the same key set to `packages/desktop/src/renderer/services/i18n/locales/es-ES/acp.json`.
- [ ] **Step 7:** Add the same key set to `packages/desktop/src/renderer/services/i18n/locales/fa-IR/acp.json`.
- [ ] **Step 8:** Add the same key set to `packages/desktop/src/renderer/services/i18n/locales/ja-JP/acp.json`.
- [ ] **Step 9:** Add the same key set to `packages/desktop/src/renderer/services/i18n/locales/ko-KR/acp.json`.
- [ ] **Step 10:** Add the same key set to `packages/desktop/src/renderer/services/i18n/locales/pt-BR/acp.json`.
- [ ] **Step 11:** Add the same key set to `packages/desktop/src/renderer/services/i18n/locales/ru-RU/acp.json`.
- [ ] **Step 12:** Add the same key set to `packages/desktop/src/renderer/services/i18n/locales/tr-TR/acp.json`.
- [ ] **Step 13:** Add the same key set to `packages/desktop/src/renderer/services/i18n/locales/uk-UA/acp.json`.
- [ ] **Step 14:** Add the same key set to `packages/desktop/src/renderer/services/i18n/locales/zh-CN/acp.json`.
- [ ] **Step 15:** Add the same key set to `packages/desktop/src/renderer/services/i18n/locales/zh-TW/acp.json`.
- [ ] **Step 16:** Review the new `zh-TW` values for Taiwan terminology.
- [ ] **Step 17:** Run `bun run i18n:types`; require exit code 0. `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts` is generated and gitignored; do not add or edit it manually.
- [ ] **Step 18:** Run `node scripts/check-i18n.js`; require exit code 0.
- [ ] **Step 19:** Re-run `bunx vitest run tests/unit/providers/reasoning/reasoningControlsI18n.test.ts`; expect PASS.
- [ ] **Step 20:** Commit only the 12 locale JSON files and `tests/unit/providers/reasoning/reasoningControlsI18n.test.ts` with `feat(i18n): localize reasoning controls`.

### Task 14: Repository gate and stop conditions

**Owner:** TBD (Controller)

**Files:** No file modifications.

- [ ] **Step 1:** Run `bunx tsc --noEmit`; require exit code 0.
- [ ] **Step 2:** Run `bun run i18n:types`; require exit code 0.
- [ ] **Step 3:** Run `node scripts/check-i18n.js`; require exit code 0.
- [ ] **Step 4:** Run `bunx vitest run tests/unit/providers/reasoning tests/unit/common-adapter/apiModelMapper.test.ts tests/unit/common-adapter/ipcBridgeConversation.test.ts tests/unit/common-config/storage.test.ts packages/desktop/src/process/utils/seedBuiltinProviders.test.ts tests/unit/acpConfigOptions.test.ts tests/unit/renderer/useAcpModelInfo.dom.test.ts tests/unit/renderer/AcpModelSelector.dom.test.tsx tests/unit/renderer/AionrsModelSelector.dom.test.tsx tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx tests/unit/renderer/hooks/guidModelSelector.dom.test.tsx tests/unit/renderer/useGuidAgentSelection.dom.test.ts tests/unit/renderer/useGuidSend.dom.test.ts tests/unit/renderer/assistantDefaults.test.ts tests/unit/pages/project/ProjectNewChatComposer.dom.test.tsx tests/unit/assistants/useAssistantEditor.dom.test.ts tests/unit/assistants/AssistantEditorSections.dom.test.tsx tests/unit/settings/DefaultsSectionSearch.dom.test.tsx tests/unit/renderer/team/TeamPageCronJobManager.dom.test.tsx tests/unit/renderer/team/useTeamWarmup.dom.test.tsx tests/unit/renderer/cron/TaskDetailPage.dom.test.tsx tests/unit/renderer/cron/resolveCronAgentConfig.test.ts`; require exit code 0.
- [ ] **Step 5:** Run `bun run lint`; require exit code 0 and judge warnings by exit status as required by repository policy.
- [ ] **Step 6:** Run `bun run format:check`; require exit code 0.
- [ ] **Step 7:** Run `bun run test` only after every focused gate passes; require exit code 0 before claiming the repository suite passed.
- [ ] **Step 8:** Recursively scan public fixtures, storage values, IPC payloads, and rendered props; require every forbidden adapter-mapping key to be absent.
- [ ] **Step 9:** Stop on target drift, EPIC-002 overlap, canonical fixture mismatch, missing immutable upstream contracts, unknown backend contract/version field, mapping leakage, stale-state acceptance, failed i18n/type/test gate, or reviewer BLOCK.
- [ ] **Step 10:** Do not push, package, release, tag, pin AionCore/AionRS, enable a provider/model, or run coverage/packaging without separate Controller authorization.

## Open questions that block implementation admission

1. What exact AionCore endpoint/response field reports reasoning contract version 1 and the required schema floor? The matrix does not define runtime version discovery.
2. What immutable AionCore and AionRS commits are approved for WePrompt consumption? This plan intentionally performs no pinning.
3. Is compatibility-retained K2.5 still enabled at implementation time given its documented 2026-08-31 sunset? The answer affects seed metadata only; absence of approval means no new K2.5 rollout behavior.
