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

# AionRS Provider Reasoning Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AionRS advertise, validate, apply, restore, and observe exact-model provider-native reasoning controls through contract v1 without exposing adapter-private request mappings.

**Architecture:** Public provider-neutral DTOs live in `aion-types`; exact-model evidence and closed native mappings live in `aion-config`; `aion-agent` owns the complete validated selection set and observed envelope; `aion-protocol` publishes only mapping-free DTOs. `aion-providers` receives only a validated closed projection. Unknown models and unknown contract versions remain non-writable and resolve feature-facing behavior to `unsupported`.

**Tech Stack:** Rust 2021, Serde, Cargo workspace tests.

## Immutable bases and verification status

- The controlling WePrompt evidence and implementation base is detached worktree commit `e5e9fb1365357a94e3da43949c3ac1187475b6cc`, the verified current `origin/sprint2` tip for this planning wave.
- The AionRS implementation base remains the matrix-recorded `origin/main` commit `4cf42f2d5d0a04d44462bda3df7c1ed66c03be81`.
- Every AionRS path marked **Modify** below exists in the stored tree for `4cf42f2d5d0a04d44462bda3df7c1ed66c03be81` and in the read-only checkout at `/Users/lap16603/Projects/aionrs`.
- The read-only checkout itself is on `fix/compact-reasoning-empty-response` at `e4c4ed982f3114c20563cbeecb8938d3d84800fe`, not the implementation base. Implementation must use a clean isolated checkout at the immutable base; this planning wave does not fetch, switch, or modify AionRS.

## Global Constraints

- At execution time, refresh `origin/main`, record its immutable SHA, and stop for Controller re-admission if it differs from `4cf42f2d5d0a04d44462bda3df7c1ed66c03be81`.
- Copy canonical JSON values exactly from WePrompt `docs/design/provider-reasoning-capability-matrix.md` at `e5e9fb1365357a94e3da43949c3ac1187475b6cc`.
- Unknown contract versions, unknown control kinds, unknown models, and generic OpenAI-compatible models are non-writable; their feature-facing result is `unsupported`.
- `provider_default` is an application sentinel: projection omits the native field, while observation retains `provider_default` and its verified `resolvedDefault`.
- Public DTOs and protocol payloads must recursively reject `request_mapping`, `requestMapping`, `native_field`, `nativeField`, `field_path`, `fieldPath`, `api_field`, and `apiField`.
- Never log prompts, responses, headers, credentials, provider bodies, private reasoning, native payloads, or provider-defined free-text values.
- No Kimi, Moonshot, GreenNode, or other provider/model branch may enter shared validation, protocol, or selection logic.
- Kimi K3 and K2.7 variants remain fixture-only evidence. Do not create production adapter rules for them without a separately approved rollout decision.

---

### Task 1: Admission preflight

**Owner:** TBD (Controller)

**Files:**

- Read: WePrompt `docs/design/provider-reasoning-capability-matrix.md`
- Read: WePrompt `docs/prds/conversations/model-selector.md`
- Read: `Cargo.lock`

**Interfaces:** No code output. Produces a recorded implementation base and a Controller decision that the AionCore-to-AionRS scope/revision input contract is pinned.

- [ ] **Step 1:** Verify `git rev-parse HEAD` in the isolated AionRS implementation checkout equals `4cf42f2d5d0a04d44462bda3df7c1ed66c03be81`; stop and replan if it does not.
- [ ] **Step 2:** Verify the WePrompt matrix and selector contract are read from `e5e9fb1365357a94e3da43949c3ac1187475b6cc`; stop if either tracked document differs.
- [ ] **Step 3:** Record the exact AionCore caller contract for supplying `{ backend, providerId, capabilityRevision, modelId }` to AionRS. Stop before Task 5 if the Controller has not approved the signature and transport location.
- [ ] **Step 4:** Confirm only exact `kimi-k2.6` and compatibility-retained exact `kimi-k2.5` are admitted adapter mappings; record K3 and K2.7 variants as non-rollout fixtures.

### Task 2: Canonical public DTOs and raw-version gate

**Owner:** TBD (Controller)

**Files:**

- Create: `crates/aion-types/src/reasoning.rs`
- Create: `crates/aion-types/src/reasoning_test.rs`
- Modify: `crates/aion-types/src/lib.rs`
- Create: `crates/aion-types/tests/fixtures/reasoning/unsupported.json`
- Create: `crates/aion-types/tests/fixtures/reasoning/fixed.json`
- Create: `crates/aion-types/tests/fixtures/reasoning/enum.json`
- Create: `crates/aion-types/tests/fixtures/reasoning/boolean.json`
- Create: `crates/aion-types/tests/fixtures/reasoning/bounded-integer.json`
- Create: `crates/aion-types/tests/fixtures/reasoning/dependent-multi-control.json`
- Create: `crates/aion-types/tests/fixtures/reasoning/observed-dependent.json`
- Create: `crates/aion-types/tests/fixtures/reasoning/unknown-version.json`

**Interfaces:** Produce `MODEL_REASONING_CONTRACT_VERSION: u16 = 1`, `ReasoningControlValue`, `ReasoningSelectionValue`, `ReasoningDependency`, `ReasoningControlDescriptor`, `CapabilitySource`, `ModelReasoningProfile`, `ReasoningModelScope`, `ReasoningSelection`, `ObservedModelReasoningProfile`, and `ReasoningProfileError`. Produce `parse_model_reasoning_profile(raw: &serde_json::Value) -> Result<ModelReasoningProfile, ReasoningProfileError>` so the raw contract version is checked before v1 deserialization.

- [ ] **Step 1 (RED):** Add `unsupported_fixture_roundtrips_without_extra_keys` in `crates/aion-types/src/reasoning_test.rs`; assert `serde_json::to_value(parse_model_reasoning_profile(&raw)?)? == raw`. It fails today because `reasoning` and the parser do not exist.
- [ ] **Step 2 (RED):** Add `fixed_fixture_roundtrips_with_zero_controls` in `crates/aion-types/src/reasoning_test.rs`; assert `profile.controls().is_empty()` and serialized JSON equals `crates/aion-types/tests/fixtures/reasoning/fixed.json`. It fails today because no profile type exists.
- [ ] **Step 3 (RED):** Add `enum_fixture_preserves_opaque_choice_values` in `crates/aion-types/src/reasoning_test.rs`; assert the values equal `minimal`, `xhigh`, and `ultra` in source order. It fails today because no enum-control DTO exists.
- [ ] **Step 4 (RED):** Add `boolean_fixture_preserves_provider_default` in `crates/aion-types/src/reasoning_test.rs`; assert `defaultValue` remains the tagged `provider_default` value and `resolvedDefault == true`. It fails today because no tagged default DTO exists.
- [ ] **Step 5 (RED):** Add `bounded_integer_fixture_preserves_bounds` in `crates/aion-types/src/reasoning_test.rs`; assert `(minimum, maximum, step) == (1024, 32768, 1024)`. It fails today because no integer-control DTO exists.
- [ ] **Step 6 (RED):** Add `dependent_fixture_preserves_all_predicates` in `crates/aion-types/src/reasoning_test.rs`; assert the budget control contains exactly `[visibleWhen(controlId = "enabled", equals = true)]`. It fails today because dependencies are not modeled.
- [ ] **Step 7 (RED):** Add `observed_fixture_roundtrips_complete_envelope` in `crates/aion-types/src/reasoning_test.rs`; assert serialized `scope`, `profile`, both `selections`, and both `activeControlIds` equal `crates/aion-types/tests/fixtures/reasoning/observed-dependent.json`. It fails today because the observed-envelope DTO does not exist.
- [ ] **Step 8 (RED):** Add `unknown_contract_version_is_non_writable` in `crates/aion-types/src/reasoning_test.rs`; assert parsing `crates/aion-types/tests/fixtures/reasoning/unknown-version.json` returns `Err(ReasoningProfileError::UnsupportedContractVersion(2))`. It fails today because the current code has no raw-version gate before Serde narrowing.
- [ ] **Step 9:** Run `cargo test -p aion-types reasoning`; expected RED is compilation failure for unresolved `aion_types::reasoning` symbols, not an unrelated workspace failure.
- [ ] **Step 10:** Implement the closed DTOs in `crates/aion-types/src/reasoning.rs`.
- [ ] **Step 11:** Implement the raw-version parser in `crates/aion-types/src/reasoning.rs`.
- [ ] **Step 12:** Mount `reasoning` and `reasoning_test` from `crates/aion-types/src/lib.rs`.
- [ ] **Step 13:** Run `cargo test -p aion-types reasoning`; expect all eight named tests to pass.
- [ ] **Step 14:** Commit only Task 2 files with `feat(types): define reasoning contract`.

### Task 3: Contract validation and forbidden-key rejection

**Owner:** TBD (Controller)

**Files:**

- Continue creation from Task 2: `crates/aion-types/src/reasoning.rs`
- Continue creation from Task 2: `crates/aion-types/src/reasoning_test.rs`

**Interfaces:** Produce `validate_model_reasoning_profile(profile: &ModelReasoningProfile) -> Result<(), ReasoningProfileError>` and `validate_observed_model_reasoning_profile(envelope: &ObservedModelReasoningProfile) -> Result<(), ReasoningProfileError>`.

- [ ] **Step 1 (RED):** Add `public_profile_rejects_forbidden_mapping_key_at_any_depth` in `crates/aion-types/src/reasoning_test.rs`; insert `request_mapping` below a choice and assert `Err(ReasoningProfileError::ForbiddenPublicKey("request_mapping"))`. It fails today because Task 2 only parses known fields.
- [ ] **Step 2 (RED):** Add `configurable_profile_rejects_duplicate_control_ids` in `crates/aion-types/src/reasoning_test.rs`; assert duplicate `enabled` IDs return `Err(ReasoningProfileError::DuplicateControlId(_))`. It fails today because uniqueness is not validated.
- [ ] **Step 3 (RED):** Add `integer_control_rejects_misaligned_explicit_default` in `crates/aion-types/src/reasoning_test.rs`; set `resolvedDefault` to `1500` and assert `Err(ReasoningProfileError::UnalignedIntegerValue(_))`. It fails today because alignment is not validated.
- [ ] **Step 4 (RED):** Add `dependency_rejects_missing_controller` in `crates/aion-types/src/reasoning_test.rs`; reference `missing` and assert `Err(ReasoningProfileError::UnknownDependencyControl(_))`. It fails today because dependency targets are not validated.
- [ ] **Step 5 (RED):** Add `dependency_rejects_cycle` in `crates/aion-types/src/reasoning_test.rs`; create `a -> b -> a` and assert `Err(ReasoningProfileError::DependencyCycle)`. It fails today because cycle detection is absent.
- [ ] **Step 6 (RED):** Add `observed_envelope_rejects_partial_selection_set` in `crates/aion-types/src/reasoning_test.rs`; remove `budgetTokens` while leaving it active and assert `Err(ReasoningProfileError::IncompleteObservedEnvelope)`. It fails today because completeness is not checked.
- [ ] **Step 7:** Run `cargo test -p aion-types reasoning`; expect the six named assertions to fail, with no parser compilation error.
- [ ] **Step 8:** Implement recursive forbidden-key scanning in `crates/aion-types/src/reasoning.rs`.
- [ ] **Step 9:** Implement normative v1 validation in `crates/aion-types/src/reasoning.rs`; do not coerce strings, booleans, or numbers.
- [ ] **Step 10:** Run `cargo test -p aion-types reasoning`; expect PASS.
- [ ] **Step 11:** Commit only Task 3 files with `feat(types): validate reasoning contract`.

### Task 4: Exact-model adapter rules

**Owner:** TBD (Controller)

**Files:**

- Modify: `crates/aion-config/src/compat.rs`
- Modify: `crates/aion-config/src/compat_test.rs`
- Modify: `crates/aion-config/src/lib.rs`

**Interfaces:** Add public `ProviderCompat::reasoning_profile_for_model(&self, model: &str) -> ModelReasoningProfile`. Add crate-private `reasoning_rule_for_model(&self, model: &str) -> Option<&AdapterReasoningControlRule>`, `AdapterReasoningControlRule { descriptor, request_mapping }`, and a closed `ReasoningRequestMapping` enum. Shared callers receive descriptors only.

- [ ] **Step 1 (RED):** Add `kimi_k2_6_exact_model_returns_toggle_profile` in `crates/aion-config/src/compat_test.rs`; assert the control ID is `thinking` and choice values are exactly `enabled` and `disabled`. It fails today because `ProviderCompat` has only provider-wide thinking/effort flags.
- [ ] **Step 2 (RED):** Add `kimi_k2_5_exact_model_returns_distinct_evidence_source` in `crates/aion-config/src/compat_test.rs`; assert its source version differs from K2.6 while the public descriptor shape matches. It fails today because no exact-model rule table exists.
- [ ] **Step 3 (RED):** Add `unknown_openai_compatible_model_is_unsupported` in `crates/aion-config/src/compat_test.rs`; assert `openai_defaults().reasoning_profile_for_model("openai/gpt-5").state == Unsupported`. It fails today because `openai_defaults()` exposes provider-wide effort support.
- [ ] **Step 4 (RED):** Add `model_matching_never_uses_substrings` in `crates/aion-config/src/compat_test.rs`; assert `prefix-kimi-k2.6-suffix` is unsupported. It fails today because no exact resolver exists.
- [ ] **Step 5 (RED):** Add `evidence_only_models_have_no_runtime_rule` in `crates/aion-config/src/compat_test.rs`; assert `kimi-k3`, `kimi-k2.7-code`, and `kimi-k2.7-code-highspeed` return no private rule. It fails today because no rule boundary exists.
- [ ] **Step 6:** Run `cargo test -p aion-config reasoning`; expect unresolved resolver/rule symbols.
- [ ] **Step 7:** Implement the exact K2.6 rule entry in `crates/aion-config/src/compat.rs`; keep native `thinking.type` mapping private.
- [ ] **Step 8:** Implement the distinct exact K2.5 compatibility rule in `crates/aion-config/src/compat.rs`.
- [ ] **Step 9:** Remove new-profile derivation from provider-wide `openai_defaults()` in `crates/aion-config/src/compat.rs`.
- [ ] **Step 10:** Run `cargo test -p aion-config reasoning`; expect PASS.
- [ ] **Step 11:** Commit only Task 4 files with `feat(config): add exact reasoning rules`.

### Task 5: Mapping-free protocol projection

**Owner:** TBD (Controller)

**Files:**

- Modify: `crates/aion-protocol/src/events.rs`
- Modify: `crates/aion-protocol/src/events_test.rs`
- Modify: `crates/aion-agent/src/output/protocol_sink.rs`

**Interfaces:** Add `model_reasoning: ModelReasoningProfile` to `Capabilities` while retaining `thinking`, `effort`, and `effort_levels` for one compatibility release. Add `observed_model_reasoning: Option<ObservedModelReasoningProfile>` to the config-change event that confirms a mutation. `ProtocolSink` receives only mapping-free public DTOs.

- [ ] **Step 1 (RED):** Add `ready_serializes_mapping_free_model_reasoning` in `crates/aion-protocol/src/events_test.rs`; assert `json["capabilities"]["model_reasoning"] == enum_fixture` and recursively assert every forbidden key is absent. It fails today because `Capabilities` has no `model_reasoning` field.
- [ ] **Step 2 (RED):** Add `config_changed_serializes_complete_observed_reasoning` in `crates/aion-protocol/src/events_test.rs`; assert the event subtree equals `crates/aion-types/tests/fixtures/reasoning/observed-dependent.json`. It fails today because config changes carry no observed envelope.
- [ ] **Step 3 (RED):** Add `protocol_sink_projects_selected_model_profile` inside `crates/aion-agent/src/output/protocol_sink.rs`; assert a K2.6-ready event contains its public profile and not `request_mapping`. It fails today because the sink emits only provider-wide capabilities.
- [ ] **Step 4:** Run `cargo test -p aion-protocol events`; expect missing-field assertion failures.
- [ ] **Step 5:** Run `cargo test -p aion-agent protocol_sink`; expect the named sink assertion to fail.
- [ ] **Step 6:** Add `model_reasoning` to `Capabilities` in `crates/aion-protocol/src/events.rs`; import DTOs from `aion-types`, not `aion-config`.
- [ ] **Step 7:** Add `observed_model_reasoning` to the config-change event in `crates/aion-protocol/src/events.rs`.
- [ ] **Step 8:** Project the selected model's public profile in `crates/aion-agent/src/output/protocol_sink.rs`.
- [ ] **Step 9:** Re-run `cargo test -p aion-protocol events` and `cargo test -p aion-agent protocol_sink`; expect PASS.
- [ ] **Step 10:** Commit only Task 5 files with `feat(protocol): publish reasoning profiles`.

### Task 6: Atomic selection mutation and complete observation

**Owner:** TBD (Controller)

**Files:**

- Modify: `crates/aion-agent/src/engine.rs`
- Modify: `crates/aion-agent/src/engine_test.rs`
- Modify: `crates/aion-agent/src/session.rs`
- Modify: `crates/aion-agent/src/session_test.rs`
- Modify: `crates/aion-agent/src/spawner.rs`
- Modify: `crates/aion-agent/src/spawner_test.rs`

**Interfaces:** Add `reasoning_scope: Option<ReasoningModelScope>` and `reasoning_selections: Vec<ReasoningSelection>` to session/runtime configuration. Add `Engine::apply_reasoning_selection(&mut self, scope: &ReasoningModelScope, control_id: &str, value: ReasoningSelectionValue) -> Result<ObservedModelReasoningProfile, ReasoningSelectionError>`. The engine replaces a validated full set under its existing lock and returns a complete observed envelope.

- [ ] **Step 1 (RED):** Add `provider_default_mutation_keeps_tagged_default` in `crates/aion-agent/src/engine_test.rs`; assert the returned selection value is `ProviderDefault`. It fails today because the engine stores only scalar thinking/effort fields.
- [ ] **Step 2 (RED):** Add `dependent_control_uses_logical_and` in `crates/aion-agent/src/engine_test.rs`; assert `activeControlIds` omits the dependent when any predicate is false. It fails today because the engine has no dependency evaluator.
- [ ] **Step 3 (RED):** Add `stale_capability_revision_rejects_without_mutation` in `crates/aion-agent/src/engine_test.rs`; assert `Err(ReasoningSelectionError::StaleScope)` and the pre-call selection set is unchanged. It fails today because no full-scope comparison exists.
- [ ] **Step 4 (RED):** Add `fixed_profile_rejects_write` in `crates/aion-agent/src/engine_test.rs`; assert `Err(ReasoningSelectionError::NotWritable)` and an empty selection set. It fails today because fixed profiles do not exist in engine state.
- [ ] **Step 5 (RED):** Add `successful_mutation_returns_complete_envelope` in `crates/aion-agent/src/engine_test.rs`; assert equality of `scope`, `profile`, full `selections`, and authoritative `activeControlIds`. It fails today because current setters return no observed envelope.
- [ ] **Step 6 (RED):** Add `partial_adapter_acknowledgement_rolls_back` in `crates/aion-agent/src/engine_test.rs`; inject a partial acknowledgement and assert an error plus unchanged engine state. It fails today because current scalar setters accept ignored/partial behavior.
- [ ] **Step 7 (RED):** Add `model_switch_invalidates_previous_scope` in `crates/aion-agent/src/session_test.rs`; assert selections for model A are absent after installing model B. It fails today because values are not model/revision scoped.
- [ ] **Step 8 (RED):** Add `restart_restores_only_exact_scope` in `crates/aion-agent/src/session_test.rs`; assert mismatched backend, provider, revision, model, or contract version produces an empty default set. It fails today because session restore has no complete scope.
- [ ] **Step 9:** Run `cargo test -p aion-agent reasoning`; expect all eight named assertions to fail against scalar state.
- [ ] **Step 10:** Add full-scope spawn configuration fields in `crates/aion-agent/src/spawner.rs`.
- [ ] **Step 11:** Add full-scope session configuration fields in `crates/aion-agent/src/session.rs`.
- [ ] **Step 12:** Replace scalar writable state with the bounded scoped selection set in `crates/aion-agent/src/engine.rs`.
- [ ] **Step 13:** Implement fail-closed dependency evaluation in `crates/aion-agent/src/engine.rs`.
- [ ] **Step 14:** Implement complete observed-envelope construction in `crates/aion-agent/src/engine.rs`.
- [ ] **Step 15:** Implement rollback on partial/ignored adapter confirmation in `crates/aion-agent/src/engine.rs`.
- [ ] **Step 16:** Implement exact-scope session restore in `crates/aion-agent/src/session.rs`.
- [ ] **Step 17:** Add sanitized mutation logs containing only provider ID, model ID, control kind, result category, and sanitized request ID.
- [ ] **Step 18:** Run `cargo test -p aion-agent reasoning`; expect PASS.
- [ ] **Step 19:** Commit only Task 6 files with `feat(agent): observe reasoning selections`.

### Task 7: Closed Kimi request projection

**Owner:** TBD (Controller)

**Files:**

- Modify: `crates/aion-types/src/llm.rs`
- Modify: `crates/aion-types/src/llm_test.rs`
- Modify: `crates/aion-providers/src/projector.rs`
- Modify: `crates/aion-providers/src/projector_test.rs`

**Interfaces:** `LlmRequest` carries the validated provider-neutral selection set and a closed adapter projection token; it never carries an arbitrary JSON path. `OpenAiProjector` may emit `thinking.type` only when the closed exact-model rule authorizes it.

- [ ] **Step 1 (RED):** Add `kimi_enabled_projects_thinking_type_enabled` in `crates/aion-providers/src/projector_test.rs`; assert `body["thinking"] == json!({"type": "enabled"})`. It fails today because projection is driven by generic `ThinkingConfig`, not an exact-model rule.
- [ ] **Step 2 (RED):** Add `kimi_disabled_projects_thinking_type_disabled` in `crates/aion-providers/src/projector_test.rs`; assert `body["thinking"] == json!({"type": "disabled"})`. It fails today because exact-model authorization is absent.
- [ ] **Step 3 (RED):** Add `kimi_provider_default_omits_thinking` in `crates/aion-providers/src/projector_test.rs`; assert `body.get("thinking").is_none()`. It fails today because provider default is not represented as a tagged selection.
- [ ] **Step 4 (RED):** Add `unknown_openai_model_cannot_emit_reasoning_fields` in `crates/aion-providers/src/projector_test.rs`; assert both `body.get("thinking")` and `body.get("reasoning_effort")` are `None`. It fails today because generic compatibility can emit those fields.
- [ ] **Step 5 (RED):** Add `llm_request_has_no_arbitrary_mapping_path` in `crates/aion-types/src/llm_test.rs`; serialize a request and recursively assert forbidden mapping keys are absent. It fails today because the closed projection token does not exist.
- [ ] **Step 6:** Run `cargo test -p aion-providers reasoning`; expect the four projector assertions to fail.
- [ ] **Step 7:** Add the closed adapter projection token to `crates/aion-types/src/llm.rs`.
- [ ] **Step 8:** Implement exact Kimi `thinking.type` projection in `crates/aion-providers/src/projector.rs`.
- [ ] **Step 9:** Restrict existing non-EPIC-003 scalar behavior to compatibility reads in `crates/aion-providers/src/projector.rs`; do not create new writable profiles from it.
- [ ] **Step 10:** Run `cargo test -p aion-providers reasoning` and `cargo test -p aion-types llm`; expect PASS.
- [ ] **Step 11:** Commit only Task 7 files with `feat(providers): project exact reasoning rules`.

### Task 8: Repository gate and stop conditions

**Owner:** TBD (Controller)

**Files:** No file modifications.

- [ ] **Step 1:** Run `cargo fmt --all -- --check`; require exit code 0.
- [ ] **Step 2:** Run `cargo clippy -p aion-types -p aion-config -p aion-protocol -p aion-agent -p aion-providers --all-targets -- -D warnings`; require exit code 0.
- [ ] **Step 3:** Run `cargo test -p aion-types -p aion-config -p aion-protocol -p aion-agent -p aion-providers`; require exit code 0 and do not describe the workspace suite as passing.
- [ ] **Step 4:** Serialize `Ready`, config-change, and observed-envelope fixtures and recursively assert all forbidden mapping keys are absent.
- [ ] **Step 5:** Re-run `unknown_openai_compatible_model_is_unsupported`; require an `unsupported` profile and no writable setter path.
- [ ] **Step 6:** Stop on canonical fixture mismatch, target drift, non-exact model matching, provider data in diagnostics, incomplete observation, missing AionCore scope input, or reviewer BLOCK.
- [ ] **Step 7:** Do not tag, push, release, package, pin, or enable a model without separate Controller authorization.

## Open questions that block implementation admission

1. Which exact AionCore request/startup DTO supplies `providerId` and AionCore-owned `capabilityRevision` to AionRS? The matrix defines ownership but not the cross-repository transport signature.
2. What immutable AionRS commit is approved for AionCore consumption after this plan lands? No pin is authorized by this plan.
3. Is compatibility-retained K2.5 still admitted at implementation time given its documented 2026-08-31 sunset? If not, its runtime rule must remain absent while its fixture remains valid evidence.
