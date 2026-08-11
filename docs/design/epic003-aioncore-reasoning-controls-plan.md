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

# AionCore Provider Reasoning Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AionCore own contract-v1 profiles, opaque capability revisions, complete ACP/AionRS observations, and revision-scoped persistence with atomic invalidation.

**Architecture:** `aionui-api-types` defines the provider-neutral wire contract. Existing provider `model_settings` stores immutable per-model profiles, while a provider-row opaque revision scopes every selection. ACP and AionRS adapters normalize into one complete observed envelope. Migrations `038` and `039` are candidates only: execution must re-prove availability before creating them.

**Tech Stack:** Rust 2024, Serde, SQLx, SQLite, ACP SDK, Cargo tests.

## Immutable bases and verification status

- The controlling WePrompt evidence and implementation base is detached worktree commit `e5e9fb1365357a94e3da43949c3ac1187475b6cc`, the verified current `origin/sprint2` tip for this planning wave.
- The AionCore implementation base remains the matrix-recorded `origin/main` commit `81ef258913e6ac5076a86d4adcc7edcc0f8f21ef`.
- Every AionCore path marked **Modify** below exists in the stored tree for `81ef258913e6ac5076a86d4adcc7edcc0f8f21ef`.
- The read-only checkout at `/Users/lap16603/Projects/aioncore` is local `main` at `928f91c8981bb2475040ff05792f01940eaebc97`, 153 commits behind its stored `origin/main`. Paths introduced after that local commit cannot be verified from the working-tree filesystem; they were verified read-only through `git ls-tree`/`git show` at the immutable object. No fetch, pull, switch, or file modification is authorized in this planning wave.

## Global Constraints

- At execution time, refresh `origin/main`, record its immutable SHA, and stop for Controller re-admission if it differs from `81ef258913e6ac5076a86d4adcc7edcc0f8f21ef`.
- At execution time, recheck every `origin/*` ref immediately before creating migrations. `038` and `039` are unreserved candidates; stop if either is occupied or if `039` would not immediately follow `038`.
- `crates/aionui-db/migrations/027_provider_model_settings.sql` owns `model_settings`; never edit or recreate it.
- AionCore alone generates the random opaque `capabilityRevision`. It must not encode or hash credentials, URLs, Bedrock configuration, provider bodies, or other configuration.
- Unknown versions, unknown kinds, incomplete observations, and unknown provider behavior are non-writable and resolve feature-facing behavior to `unsupported`.
- A successful mutation requires a complete observed envelope. HTTP success, command acknowledgement, or a partial selection is failure.
- Keep migration-019 scalar thought-level fields readable for one compatibility release, but never apply an unscoped scalar to an arbitrary profile.
- Do not add persistent reasoning state to `AcpAgentManager`; use the existing session snapshot/engine ownership unless an independently reviewed design proves it impossible.
- No Kimi, Moonshot, GreenNode, ACP agent, or AionRS branch may enter shared validation, persistence, invalidation, or API logic.
- Never log prompts, responses, headers, credentials, provider bodies, native request mappings, private reasoning, or provider-defined free-text values.

---

### Task 1: Admission and migration preflight

**Owner:** TBD (Controller)

**Files:**

- Read: WePrompt `docs/design/provider-reasoning-capability-matrix.md`
- Read: WePrompt `docs/prds/conversations/model-selector.md`
- Read: `Cargo.toml`
- Read: `Cargo.lock`
- Read: `crates/aionui-db/migrations/027_provider_model_settings.sql`

**Interfaces:** No code output. Produces recorded immutable AionCore/AionRS SHAs, migration availability, and Controller-approved cross-repository DTO signatures.

- [ ] **Step 1:** Verify `git rev-parse HEAD` in the isolated AionCore implementation checkout equals `81ef258913e6ac5076a86d4adcc7edcc0f8f21ef`; stop and replan if it does not.
- [ ] **Step 2:** Verify the WePrompt matrix and selector contract are read from `e5e9fb1365357a94e3da43949c3ac1187475b6cc`; stop if either differs.
- [ ] **Step 3:** List every migration path in all refreshed `origin/*` refs; require both `038_*` and `039_*` to be absent before Task 3 begins.
- [ ] **Step 4:** Record the reviewed AionRS commit and its mapping-free public DTO version; stop before Task 6 until the Controller approves it. Do not pin it in this task.
- [ ] **Step 5:** Record the exact AionCore-to-AionRS startup/mutation signatures carrying `{ backend, providerId, capabilityRevision, modelId }`; stop if the cross-repository contract remains undecided.

### Task 2: Canonical API contract and fail-closed parser

**Owner:** TBD (Controller)

**Files:**

- Create: `crates/aionui-api-types/src/provider_reasoning.rs`
- Create: `crates/aionui-api-types/src/provider_reasoning_test.rs`
- Modify: `crates/aionui-api-types/src/lib.rs`
- Modify: `crates/aionui-api-types/src/provider.rs`
- Create: `crates/aionui-api-types/tests/fixtures/reasoning/unsupported.json`
- Create: `crates/aionui-api-types/tests/fixtures/reasoning/fixed.json`
- Create: `crates/aionui-api-types/tests/fixtures/reasoning/enum.json`
- Create: `crates/aionui-api-types/tests/fixtures/reasoning/boolean.json`
- Create: `crates/aionui-api-types/tests/fixtures/reasoning/bounded-integer.json`
- Create: `crates/aionui-api-types/tests/fixtures/reasoning/dependent-multi-control.json`
- Create: `crates/aionui-api-types/tests/fixtures/reasoning/observed-dependent.json`
- Create: `crates/aionui-api-types/tests/fixtures/reasoning/unknown-version.json`

**Interfaces:** Mirror contract-v1 types exactly. Produce `parse_model_reasoning_profile(raw: &serde_json::Value) -> Result<ModelReasoningProfile, ReasoningProfileValidationError>`, `ModelReasoningProfile::validate()`, and `ObservedModelReasoningProfile::validate_for_scope(&ReasoningModelScope)`. Extend `ModelSettings` with `reasoning_profile: Option<ModelReasoningProfile>` without changing `image_input` or `openai_api_mode`.

- [ ] **Step 1 (RED):** Add `unsupported_fixture_roundtrips_exactly` in `crates/aionui-api-types/src/provider_reasoning_test.rs`; assert serialized JSON equals `crates/aionui-api-types/tests/fixtures/reasoning/unsupported.json`. It fails today because the module and DTOs do not exist.
- [ ] **Step 2 (RED):** Add `fixed_fixture_roundtrips_exactly` in `crates/aionui-api-types/src/provider_reasoning_test.rs`; assert serialized JSON equals `crates/aionui-api-types/tests/fixtures/reasoning/fixed.json` and controls are empty. It fails today because no fixed profile DTO exists.
- [ ] **Step 3 (RED):** Add `enum_fixture_preserves_opaque_values` in `crates/aionui-api-types/src/provider_reasoning_test.rs`; assert serialized JSON equals `crates/aionui-api-types/tests/fixtures/reasoning/enum.json` and choice order is unchanged. It fails today because no enum descriptor exists.
- [ ] **Step 4 (RED):** Add `boolean_fixture_preserves_provider_default` in `crates/aionui-api-types/src/provider_reasoning_test.rs`; assert serialized JSON equals `crates/aionui-api-types/tests/fixtures/reasoning/boolean.json`. It fails today because no tagged provider default exists.
- [ ] **Step 5 (RED):** Add `bounded_integer_fixture_preserves_bounds` in `crates/aionui-api-types/src/provider_reasoning_test.rs`; assert `(minimum, maximum, step) == (1024, 32768, 1024)`. It fails today because no integer descriptor exists.
- [ ] **Step 6 (RED):** Add `dependent_fixture_preserves_predicates` in `crates/aionui-api-types/src/provider_reasoning_test.rs`; assert serialized JSON equals `crates/aionui-api-types/tests/fixtures/reasoning/dependent-multi-control.json`. It fails today because dependencies are not modeled.
- [ ] **Step 7 (RED):** Add `observed_fixture_roundtrips_complete_envelope` in `crates/aionui-api-types/src/provider_reasoning_test.rs`; assert `scope`, `profile`, two `selections`, and `activeControlIds` equal `crates/aionui-api-types/tests/fixtures/reasoning/observed-dependent.json`. It fails today because no observed DTO exists.
- [ ] **Step 8 (RED):** Add `unknown_version_is_rejected_before_v1_narrowing` in `crates/aionui-api-types/src/provider_reasoning_test.rs`; assert `Err(UnsupportedContractVersion(2))`. It fails today because there is no raw-version gate.
- [ ] **Step 9 (RED):** Add `forbidden_mapping_key_is_rejected_recursively` in `crates/aionui-api-types/src/provider_reasoning_test.rs`; inject `nativeField` below a control and assert `Err(ForbiddenPublicKey("nativeField"))`. It fails today because unknown nested fields are not scanned.
- [ ] **Step 10 (RED):** Add `dependency_without_verified_resolved_default_is_invalid` in `crates/aionui-api-types/src/provider_reasoning_test.rs`; remove the controller's `resolvedDefault` and assert `Err(UnresolvedProviderDefaultDependency(_))`. It fails today because dependency validation does not exist.
- [ ] **Step 11 (RED):** Add `model_settings_preserves_existing_fields_with_reasoning_profile` in `crates/aionui-api-types/src/provider_reasoning_test.rs`; deserialize all three fields, reserialize, and assert none is dropped. It fails today because `ModelSettings` has no reasoning field.
- [ ] **Step 12:** Run `cargo test -p aionui-api-types provider_reasoning`; expected RED is unresolved module/type symbols.
- [ ] **Step 13:** Implement the closed contract-v1 DTOs in `crates/aionui-api-types/src/provider_reasoning.rs`.
- [ ] **Step 14:** Implement raw-version gating in `crates/aionui-api-types/src/provider_reasoning.rs`.
- [ ] **Step 15:** Implement recursive forbidden-key scanning in `crates/aionui-api-types/src/provider_reasoning.rs`.
- [ ] **Step 16:** Implement normative bounds/default/dependency validation in `crates/aionui-api-types/src/provider_reasoning.rs`.
- [ ] **Step 17:** Add `reasoning_profile` to `ModelSettings` in `crates/aionui-api-types/src/provider.rs` without changing existing fields.
- [ ] **Step 18:** Run `cargo test -p aionui-api-types provider_reasoning`; expect all eleven named tests to pass.
- [ ] **Step 19:** Commit only Task 2 files with `feat(provider): define reasoning profile contract`.

### Task 3: Migration 038 and provider-row revision storage

**Owner:** TBD (Controller)

**Files:**

- Create: `crates/aionui-db/migrations/038_provider_reasoning_capability_revision.sql`
- Create: `crates/aionui-db/tests/provider_reasoning_migrations.rs`
- Modify: `crates/aionui-db/src/models/provider.rs`
- Modify: `crates/aionui-db/src/repository/provider.rs`
- Modify: `crates/aionui-db/src/repository/sqlite_provider.rs`
- Modify: `crates/aionui-db/tests/provider_repository.rs`

**Interfaces:** Add non-null `capability_revision` to provider rows and repository create/update parameters. Existing rows receive a random opaque value during migration. Repository writes accept a caller-supplied new opaque revision inside the same transaction as provider/profile changes.

- [ ] **Step 1:** Immediately re-run the all-ref migration check from Task 1; stop if `038` or `039` is now occupied.
- [ ] **Step 2 (RED):** Add `migration_038_upgrades_schema_037_with_opaque_revision` in `crates/aionui-db/tests/provider_reasoning_migrations.rs`; start from schema 037 and assert every provider has a non-empty `capability_revision` not equal to any stored URL or API-key ciphertext. It fails today because migration 038 and the column do not exist.
- [ ] **Step 3 (RED):** Add `provider_repository_roundtrips_capability_revision` in `crates/aionui-db/tests/provider_repository.rs`; create and re-read a provider and assert exact opaque-token equality. It fails today because the model and repository omit the column.
- [ ] **Step 4 (RED):** Add `provider_repository_updates_revision_with_model_settings_atomically` in `crates/aionui-db/tests/provider_repository.rs`; force a failed profile update and assert neither `model_settings` nor `capability_revision` changes. It fails today because no revision participates in the transaction.
- [ ] **Step 5:** Run `cargo test -p aionui-db provider_reasoning`; expect missing migration/column failures from the three named tests.
- [ ] **Step 6:** Create `crates/aionui-db/migrations/038_provider_reasoning_capability_revision.sql`.
- [ ] **Step 7:** Add the revision field to `crates/aionui-db/src/models/provider.rs`.
- [ ] **Step 8:** Add revision parameters to `crates/aionui-db/src/repository/provider.rs`.
- [ ] **Step 9:** Persist/read the revision in `crates/aionui-db/src/repository/sqlite_provider.rs`.
- [ ] **Step 10:** Run `cargo test -p aionui-db provider_reasoning`; expect PASS.
- [ ] **Step 11:** Commit only Task 3 files with `feat(provider): store capability revision` and include the checked all-ref base in the commit body.

### Task 4: Capability-change classification and atomic rotation

**Owner:** TBD (Controller)

**Files:**

- Modify: `crates/aionui-api-types/src/provider.rs`
- Modify: `crates/aionui-system/src/provider.rs`
- Modify: `crates/aionui-system/tests/provider_routes.rs`
- Modify: `crates/aionui-app/tests/system_provider_e2e.rs`

**Interfaces:** Add `capability_revision: String` to `ProviderResponse`. `ProviderService` computes a `CapabilityChange` from effective endpoint/full-URL mode, platform/protocol and per-model protocol, secure credential identity, Bedrock configuration, model membership/enabled state, model settings/profile, and adapter evidence version. Rotation is serialized by a provider-scoped mutation lock.

- [ ] **Step 1 (RED):** Add `endpoint_change_rotates_capability_revision` in `crates/aionui-system/src/provider.rs`; assert old revision differs from returned revision. It fails today because responses and updates have no revision.
- [ ] **Step 2 (RED):** Add `credential_identity_change_rotates_without_exposing_secret` in `crates/aionui-system/src/provider.rs`; assert rotation occurs and the new token contains neither plaintext nor ciphertext substrings. It fails today because no opaque generator/classifier exists.
- [ ] **Step 3 (RED):** Add `model_profile_change_rotates_capability_revision` in `crates/aionui-system/src/provider.rs`; modify only `reasoning_profile.source.version` and assert rotation. It fails today because profile changes are not classified.
- [ ] **Step 4 (RED):** Add `display_name_change_does_not_rotate` in `crates/aionui-system/src/provider.rs`; update only display name and assert exact revision equality. It fails today because no rotation rules exist.
- [ ] **Step 5 (RED):** Add `health_observation_change_does_not_rotate` in `crates/aionui-system/src/provider.rs`; update health result/latency and assert exact revision equality. It fails today because observational changes are not classified.
- [ ] **Step 6 (RED):** Add `no_op_update_does_not_rotate` in `crates/aionui-system/src/provider.rs`; submit an equivalent provider update and assert exact revision equality. It fails today because no effective-value comparison exists.
- [ ] **Step 7 (RED):** Add `concurrent_provider_updates_serialize_revision_changes` in `crates/aionui-system/src/provider.rs`; issue two updates and assert each accepted write observes the immediately previous revision. It fails today because there is no provider-scoped lock.
- [ ] **Step 8 (RED):** Add `provider_response_includes_capability_revision` in `crates/aionui-system/tests/provider_routes.rs`; assert the response field equals the DB row. It fails today because the API DTO omits it.
- [ ] **Step 9:** Run `cargo test -p aionui-system provider`; expect the eight named assertions to fail.
- [ ] **Step 10:** Implement the effective-value `CapabilityChange` classifier in `crates/aionui-system/src/provider.rs`.
- [ ] **Step 11:** Implement cryptographically random opaque token generation in `crates/aionui-system/src/provider.rs`.
- [ ] **Step 12:** Add the provider-scoped mutation lock in `crates/aionui-system/src/provider.rs`.
- [ ] **Step 13:** Add the current-revision guard in `crates/aionui-system/src/provider.rs`.
- [ ] **Step 14:** Project `capability_revision` through `crates/aionui-api-types/src/provider.rs` and provider responses.
- [ ] **Step 15:** Emit one sanitized lifecycle log containing only provider ID, old/new opaque revisions, result category, and sanitized request ID.
- [ ] **Step 16:** Run `cargo test -p aionui-system provider` and `cargo test -p aionui-app system_provider`; expect PASS.
- [ ] **Step 17:** Commit only Task 4 files with `feat(provider): rotate capability revision`.

### Task 5: ACP profile normalization and observed mutation

**Owner:** TBD (Controller)

**Files:**

- Modify: `crates/aionui-ai-agent/src/types.rs`
- Modify: `crates/aionui-ai-agent/src/manager/acp/config_options.rs`
- Modify: `crates/aionui-ai-agent/src/manager/acp/session.rs`
- Modify: `crates/aionui-ai-agent/src/manager/acp/session_config_snapshot_tests.rs`
- Modify: `crates/aionui-ai-agent/src/manager/acp/session_tests.rs`
- Modify: `crates/aionui-ai-agent/src/agent_task.rs`
- Modify: `crates/aionui-app/tests/acp_config_options_e2e.rs`

**Interfaces:** Extend config-option responses with `observed_reasoning_profile: Option<ObservedModelReasoningProfile>`. Add `AgentTask::set_reasoning_selection(scope, control_id, value) -> Result<ObservedModelReasoningProfile, AgentError>`. Safely normalizable runtime options preserve runtime labels and opaque primitive values; unsupported ACP option kinds remain compatibility-only and non-writable.

- [ ] **Step 1 (RED):** Add `acp_select_option_normalizes_all_values_in_order` in `crates/aionui-ai-agent/src/manager/acp/session_config_snapshot_tests.rs`; assert three arbitrary runtime values and labels survive exactly. It fails today because ACP reasoning is exposed only as a select-oriented thought-level option, not a profile.
- [ ] **Step 2 (RED):** Add `acp_unsupported_option_kind_is_non_writable` in `crates/aionui-ai-agent/src/manager/acp/session_config_snapshot_tests.rs`; assert the feature profile is `unsupported` and no reasoning setter is returned. It fails today because no fail-closed profile boundary exists.
- [ ] **Step 3 (RED):** Add `acp_unknown_contract_version_is_hidden` in `crates/aionui-ai-agent/src/manager/acp/session_config_snapshot_tests.rs`; inject version 2 and assert no writable profile. It fails today because no version gate exists at this boundary.
- [ ] **Step 4 (RED):** Add `acp_stale_scope_rejects_before_set_config_option` in `crates/aionui-ai-agent/src/manager/acp/session_tests.rs`; assert `StaleScope` and zero transport calls. It fails today because config writes compare only option ID/value.
- [ ] **Step 5 (RED):** Add `acp_partial_acknowledgement_is_failure` in `crates/aionui-ai-agent/src/manager/acp/session_tests.rs`; return command acknowledgement without a complete post-write snapshot and assert a typed error. It fails today because confirmed setters accept acknowledgement without the canonical envelope.
- [ ] **Step 6 (RED):** Add `acp_success_returns_complete_observed_envelope` in `crates/aionui-ai-agent/src/manager/acp/session_tests.rs`; assert exact scope, profile, full selections, and authoritative active IDs. It fails today because current responses return config options only.
- [ ] **Step 7 (RED):** Add `acp_route_serializes_mapping_free_observation` in `crates/aionui-app/tests/acp_config_options_e2e.rs`; assert observed JSON contains no forbidden mapping key. It fails today because the route has no observed profile.
- [ ] **Step 8:** Run `cargo test -p aionui-ai-agent acp_reasoning`; expect the six agent assertions to fail.
- [ ] **Step 9:** Implement safe ACP profile normalization in `crates/aionui-ai-agent/src/manager/acp/config_options.rs`.
- [ ] **Step 10:** Add full-scope guards in `crates/aionui-ai-agent/src/manager/acp/session.rs`.
- [ ] **Step 11:** Apply mutations under the existing session snapshot/engine lock in `crates/aionui-ai-agent/src/manager/acp/session.rs`.
- [ ] **Step 12:** Rebuild the complete post-write observation in `crates/aionui-ai-agent/src/manager/acp/session.rs`.
- [ ] **Step 13:** Return a typed error for partial confirmation in `crates/aionui-ai-agent/src/agent_task.rs`.
- [ ] **Step 14:** Run `cargo test -p aionui-ai-agent acp_reasoning` and `cargo test -p aionui-app acp_config_options_e2e`; expect PASS.
- [ ] **Step 15:** Commit only Task 5 files with `feat(agent): observe acp reasoning controls`.

### Task 6: AionRS profile and observation bridge

**Owner:** TBD (Controller)

**Files:**

- Modify: `crates/aionui-ai-agent/src/factory/aionrs.rs`
- Modify: `crates/aionui-ai-agent/src/factory/aionrs_model_settings_test.rs`
- Modify: `crates/aionui-ai-agent/src/manager/aionrs/agent.rs`
- Modify: `crates/aionui-ai-agent/src/manager/aionrs/agent_test.rs`
- Modify: `crates/aionui-ai-agent/src/agent_task.rs`
- Modify: `crates/aionui-app/tests/acp_config_options_e2e.rs`

**Interfaces:** The factory passes the exact profile plus AionCore-owned full scope to AionRS. The manager consumes AionRS's mapping-free complete observed envelope and exposes the same `AgentTask::set_reasoning_selection` interface as ACP. No generic OpenAI fallback is allowed.

- [ ] **Step 1:** Reconfirm the Controller-approved AionRS immutable SHA and public DTO version from Task 1; stop if either is absent or changed.
- [ ] **Step 2 (RED):** Add `aionrs_factory_passes_exact_profile_and_revision` in `crates/aionui-ai-agent/src/factory/aionrs_model_settings_test.rs`; assert the startup config contains the exact provider ID, revision, model ID, and profile. It fails today because the factory passes model settings without the reasoning scope.
- [ ] **Step 3 (RED):** Add `aionrs_unknown_model_remains_unsupported` in `crates/aionui-ai-agent/src/factory/aionrs_model_settings_test.rs`; assert `openai/gpt-5` at an unproven gateway receives an unsupported profile and no selections. It fails today because generic compatibility can imply reasoning support.
- [ ] **Step 4 (RED):** Add `aionrs_stale_observation_is_rejected` in `crates/aionui-ai-agent/src/manager/aionrs/agent_test.rs`; return the old revision and assert `StaleScope`. It fails today because responses have no revision guard.
- [ ] **Step 5 (RED):** Add `aionrs_partial_observation_is_rejected` in `crates/aionui-ai-agent/src/manager/aionrs/agent_test.rs`; omit one selection and assert `IncompleteObservedEnvelope`. It fails today because current AionRS config results are scalar/options based.
- [ ] **Step 6 (RED):** Add `aionrs_complete_observation_roundtrips` in `crates/aionui-ai-agent/src/manager/aionrs/agent_test.rs`; assert exact equality with `crates/aionui-api-types/tests/fixtures/reasoning/observed-dependent.json` after normalization. It fails today because no canonical bridge exists.
- [ ] **Step 7:** Run `cargo test -p aionui-ai-agent aionrs_reasoning`; expect the five named assertions to fail.
- [ ] **Step 8:** Bridge exact profile/scope input in `crates/aionui-ai-agent/src/factory/aionrs.rs`; do not change dependency refs.
- [ ] **Step 9:** Validate the complete mapping-free observation in `crates/aionui-ai-agent/src/manager/aionrs/agent.rs`.
- [ ] **Step 10:** Expose the validated observation through `crates/aionui-ai-agent/src/agent_task.rs`.
- [ ] **Step 11:** Run `cargo test -p aionui-ai-agent aionrs_reasoning` and `cargo test -p aionui-app acp_config_options_e2e`; expect PASS.
- [ ] **Step 12:** Commit only Task 6 files with `feat(agent): bridge aionrs reasoning controls`.

### Task 7: Migration 039 and bounded scoped selection storage

**Owner:** TBD (Controller)

**Files:**

- Create: `crates/aionui-db/migrations/039_scoped_reasoning_selections.sql`
- Continue creation from Task 3: `crates/aionui-db/tests/provider_reasoning_migrations.rs`
- Modify: `crates/aionui-db/src/models/assistant.rs`
- Modify: `crates/aionui-db/src/models/conversation.rs`
- Modify: `crates/aionui-db/src/models/cron_job.rs`
- Modify: `crates/aionui-db/src/repository/assistant.rs`
- Modify: `crates/aionui-db/src/repository/conversation.rs`
- Modify: `crates/aionui-db/src/repository/cron.rs`
- Modify: `crates/aionui-db/src/repository/sqlite_assistant.rs`
- Modify: `crates/aionui-db/src/repository/sqlite_conversation.rs`
- Modify: `crates/aionui-db/src/repository/sqlite_cron.rs`
- Modify: `crates/aionui-db/tests/assistant_data_unification_schema.rs`
- Modify: `crates/aionui-db/tests/conversation_repository.rs`
- Modify: `crates/aionui-db/tests/cron_repository.rs`

**Interfaces:** Persist bounded complete `Vec<ScopedReasoningSelection>` sets containing `{ backend, provider_id, capability_revision, model_id, control_id }`. Assistant defaults/preferences, conversation snapshots, and scheduled-task configuration each replace a complete set; they never patch one unobserved value. Team warmup consumes assistant/conversation scoped sets rather than creating a fourth unscoped scalar store.

- [ ] **Step 1:** Immediately recheck all refreshed `origin/*` refs; require `039` to be unused and migration 038 to be the immutable predecessor.
- [ ] **Step 2 (RED):** Add `migration_037_to_038_to_039_preserves_legacy_scalars_without_scoping_them` in `crates/aionui-db/tests/provider_reasoning_migrations.rs`; assert migration-019 scalar columns remain readable while new scoped sets are empty. It fails today because migrations 038/039 do not exist.
- [ ] **Step 3 (RED):** Add `assistant_repository_replaces_complete_scoped_set` in `crates/aionui-db/tests/assistant_data_unification_schema.rs`; write two controls, replace with one complete set, and assert only the replacement remains. It fails today because assistant rows store only scalar thought levels.
- [ ] **Step 4 (RED):** Add `conversation_repository_rejects_mixed_scope_set` in `crates/aionui-db/tests/conversation_repository.rs`; write two revisions in one set and assert a validation error with no DB change. It fails today because scoped selection storage does not exist.
- [ ] **Step 5 (RED):** Add `cron_repository_roundtrips_scoped_set` in `crates/aionui-db/tests/cron_repository.rs`; assert exact full-scope/value equality after restart-style re-open. It fails today because cron config stores only string maps.
- [ ] **Step 6 (RED):** Add `bounded_set_rejects_more_than_eight_controls` in `crates/aionui-db/tests/provider_reasoning_migrations.rs`; assert an over-limit error and no partial write. It fails today because there is no bounded set validator.
- [ ] **Step 7:** Run `cargo test -p aionui-db provider_reasoning`; expect the four named storage assertions and upgrade assertion to fail.
- [ ] **Step 8:** Create `crates/aionui-db/migrations/039_scoped_reasoning_selections.sql`.
- [ ] **Step 9:** Add assistant scoped-set fields in `crates/aionui-db/src/models/assistant.rs`.
- [ ] **Step 10:** Add assistant complete-set methods in `crates/aionui-db/src/repository/assistant.rs`.
- [ ] **Step 11:** Implement assistant SQLite replacement writes in `crates/aionui-db/src/repository/sqlite_assistant.rs`.
- [ ] **Step 12:** Add conversation scoped-set fields in `crates/aionui-db/src/models/conversation.rs`.
- [ ] **Step 13:** Add conversation complete-set methods in `crates/aionui-db/src/repository/conversation.rs`.
- [ ] **Step 14:** Implement conversation SQLite replacement writes in `crates/aionui-db/src/repository/sqlite_conversation.rs`.
- [ ] **Step 15:** Add scheduled-task scoped-set fields in `crates/aionui-db/src/models/cron_job.rs`.
- [ ] **Step 16:** Add scheduled-task complete-set methods in `crates/aionui-db/src/repository/cron.rs`.
- [ ] **Step 17:** Implement scheduled-task SQLite replacement writes in `crates/aionui-db/src/repository/sqlite_cron.rs`.
- [ ] **Step 18:** Retain migration-019 scalar fields as read-only compatibility data in repository projections.
- [ ] **Step 19:** Run `cargo test -p aionui-db provider_reasoning`; expect PASS.
- [ ] **Step 20:** Commit only Task 7 files with `feat(conversation): store scoped reasoning selections` and include the checked all-ref base in the commit body.

### Task 8: Atomic invalidation and launch-surface restore

**Owner:** TBD (Controller)

**Files:**

- Modify: `crates/aionui-system/src/provider.rs`
- Modify: `crates/aionui-assistant/src/service.rs`
- Modify: `crates/aionui-api-types/src/assistant.rs`
- Modify: `crates/aionui-api-types/src/conversation.rs`
- Modify: `crates/aionui-api-types/src/cron.rs`
- Modify: `crates/aionui-conversation/src/service.rs`
- Modify: `crates/aionui-conversation/src/service_test.rs`
- Modify: `crates/aionui-cron/src/types.rs`
- Modify: `crates/aionui-cron/src/service.rs`
- Modify: `crates/aionui-cron/src/executor.rs`
- Modify: `crates/aionui-team/src/provisioning.rs`
- Modify: `crates/aionui-team/src/service.rs`
- Modify: `crates/aionui-app/tests/assistants_e2e.rs`
- Modify: `crates/aionui-app/tests/conversation_e2e.rs`
- Modify: `crates/aionui-app/tests/cron_e2e.rs`
- Modify: `crates/aionui-app/tests/team_e2e.rs`

**Interfaces:** Provider revision commit invalidates every old-revision set in the same transaction. Old runtimes become non-writable before commit, are stopped/refreshed after commit, and no new write is accepted until a complete new observation exists. Invalid restore resolves to provider default with bounded identifiers-only diagnostics.

- [ ] **Step 1 (RED):** Add `revision_rotation_clears_assistant_defaults_atomically` in `crates/aionui-app/tests/assistants_e2e.rs`; assert old-revision selections are absent immediately after provider update. It fails today because provider updates do not invalidate assistant state.
- [ ] **Step 2 (RED):** Add `same_ids_new_revision_clears_conversation_snapshot` in `crates/aionui-conversation/src/service_test.rs`; preserve IDs, rotate revision, and assert an empty/default selection set. It fails today because scope lacks revision.
- [ ] **Step 3 (RED):** Add `enum_to_boolean_profile_change_resets_selection` in `crates/aionui-conversation/src/service_test.rs`; assert the old enum value is never coerced to boolean. It fails today because scalar restoration can cross profile shapes.
- [ ] **Step 4 (RED):** Add `configurable_to_fixed_sends_no_selection` in `crates/aionui-conversation/src/service_test.rs`; assert zero setter calls after restore. It fails today because scalar thought level can still be applied.
- [ ] **Step 5 (RED):** Add `configurable_to_unsupported_sends_no_selection` in `crates/aionui-conversation/src/service_test.rs`; assert zero setter calls and feature-facing unsupported state. It fails today because unsupported profiles are not part of restore logic.
- [ ] **Step 6 (RED):** Add `restart_restores_only_exact_complete_scope` in `crates/aionui-app/tests/conversation_e2e.rs`; assert an exact-scope complete set restores and any one-field mismatch resets. It fails today because restart restoration uses scalar fields.
- [ ] **Step 7 (RED):** Add `schedule_execution_rejects_stale_revision` in `crates/aionui-app/tests/cron_e2e.rs`; assert no agent config mutation occurs. It fails today because schedule config is an unscoped string map.
- [ ] **Step 8 (RED):** Add `team_warmup_uses_member_conversation_scope` in `crates/aionui-app/tests/team_e2e.rs`; assert each member receives only its exact assistant/conversation scoped set. It fails today because warmup consumes scalar/default config options.
- [ ] **Step 9 (RED):** Add `post_commit_refresh_failure_stays_feature_closed` in `crates/aionui-system/src/provider.rs`; force refresh failure and assert subsequent reasoning writes are rejected until a complete observation arrives. It fails today because no revision lifecycle gate exists.
- [ ] **Step 10:** Run `cargo test -p aionui-system post_commit_refresh_failure_stays_feature_closed`; expect the named assertion to fail against the missing revision lifecycle gate.
- [ ] **Step 11:** Run `cargo test -p aionui-conversation reasoning`; expect the five named profile-change/restart assertions to fail against scalar restore.
- [ ] **Step 12:** Run `cargo test -p aionui-app reasoning`; expect the assistant, cron, and team assertions to fail against unscoped launch behavior.
- [ ] **Step 13:** Mark old-revision runtimes non-writable before provider commit in `crates/aionui-system/src/provider.rs`.
- [ ] **Step 14:** Delete old-revision persisted sets in the same provider transaction in `crates/aionui-system/src/provider.rs`.
- [ ] **Step 15:** Stop/refresh old runtimes after commit in `crates/aionui-system/src/provider.rs`.
- [ ] **Step 16:** Implement exact-scope assistant restore in `crates/aionui-assistant/src/service.rs`.
- [ ] **Step 17:** Implement exact-scope conversation restore in `crates/aionui-conversation/src/service.rs`.
- [ ] **Step 18:** Implement exact-scope scheduled-task restore in `crates/aionui-cron/src/service.rs`.
- [ ] **Step 19:** Reject stale scheduled-task execution in `crates/aionui-cron/src/executor.rs`.
- [ ] **Step 20:** Implement exact-scope team-member restore in `crates/aionui-team/src/provisioning.rs` and `crates/aionui-team/src/service.rs`.
- [ ] **Step 21:** Add bounded identifiers-only reset diagnostics in the service files listed by Steps 16-20.
- [ ] **Step 22:** Re-run the exact three Cargo commands from Steps 10-12; expect PASS.
- [ ] **Step 23:** Commit only Task 8 files with `feat(conversation): invalidate stale reasoning scopes`.

### Task 9: Repository gate and stop conditions

**Owner:** TBD (Controller)

**Files:** No file modifications.

- [ ] **Step 1:** Run `cargo fmt --all -- --check`; require exit code 0.
- [ ] **Step 2:** Run clippy with `-D warnings` for only the crates modified by Tasks 2-8; require exit code 0.
- [ ] **Step 3:** Run tests for every affected crate; require exit code 0 and retain the exact command/output in the review handoff.
- [ ] **Step 4:** Run `cargo test --workspace` only after every focused gate passes; require exit code 0 before claiming the workspace suite passed.
- [ ] **Step 5:** Re-run public serialization checks and recursively assert all forbidden mapping keys are absent.
- [ ] **Step 6:** Stop for occupied migrations, canonical fixture mismatch, target drift, mapping leakage, incomplete observed envelope, missing AionRS immutable contract, missing packaged-schema coordination, or reviewer BLOCK.
- [ ] **Step 7:** Do not release, tag, push, package, pin AionRS, or enable a provider/model without separate Controller authorization.

## Open questions that block implementation admission

1. What exact AionRS commit and transport DTO are approved for the AionCore bridge? The current plan deliberately does not pin one.
2. Which exact request/startup field carries AionCore-owned `capabilityRevision` into AionRS? The matrix defines ownership but not the wire location.
3. Are migration numbers `038` and `039` still free across freshly fetched origin refs at implementation time? Current planning verification used stored refs only and cannot reserve them.
4. What packaged-schema/release coordination proves migrations 038/039 are present before WePrompt exposes the feature? Packaging is outside this plan and remains a stop condition.
