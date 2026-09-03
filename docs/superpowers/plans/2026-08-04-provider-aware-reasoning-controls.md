# Provider- and Model-Aware Reasoning Controls Epic Delivery Plan

> **Plan level:** This is a cross-repository epic delivery plan. Its checkboxes are reviewable milestones and acceptance criteria, not agent-executable implementation steps.
>
> **Execution gate:** Before implementation begins in each repository, create and review a repository-specific implementation plan containing exact interfaces, test code, 2–5 minute actions, expected fail/pass results, implementation snippets, and narrow commit boundaries. Do not execute this epic directly with `executing-plans` or `subagent-driven-development`.

**Goal:** Let any current or future model expose its verified native reasoning controls through one provider-neutral contract, without renderer special cases, invented cross-provider scales, or unsupported parameters.

**Architecture:** AionCore owns a versioned, immutable `ModelReasoningProfile`; configurable profiles contain one or more typed control descriptors, while fixed and unsupported profiles contain none. Conversation-scoped values live separately in an `ObservedModelReasoningProfile`. ACP adapters normalize runtime-advertised options, AionRS and future direct-provider adapters translate verified model metadata to native request fields, and all adapters return the same observed envelope after mutation. WePrompt renders that schema through the existing selectors and contains no provider/model branches; adding a model is an adapter-data and conformance-test change.

**Tech Stack:** Rust 2024 (`aionrs`, AionCore, Serde, SQLx), strict TypeScript, React, Arco Design, i18next, Vitest 4, Cargo tests, packaged AionCore binaries.

## Global Constraints

- The scope is every model reachable through ACP, AionRS, or a future runtime adapter. Kimi is one initial fixture, not the issue definition, contract owner, or UI branch.
- Preserve provider-native semantics. Control IDs, values, ranges, labels, and defaults are opaque. Kimi `max`, OpenAI `high`, and Sol `ultra` must never be ranked or declared equivalent.
- A configurable model exposes one or more controls. Contract v1 supports `enum`, `boolean`, and bounded `integer` inputs plus dependencies, which covers effort, thinking mode, enablement, and token budget without reducing them to one dropdown.
- Unknown means non-writable. OpenAI API compatibility, a `reasoning` badge, or a model-name substring is not sufficient evidence that a parameter is supported.
- Writable capability precedence is: observed runtime profile → exact verified adapter profile → unsupported. Static renderer inference never grants write capability.
- Every set operation must return the complete observed envelope containing the immutable profile, full scoped selection set, active control IDs, requested control value, and any dependency-driven changes. A command acknowledgement, HTTP 200, or unchanged selection set is not success.
- A selection is scoped to `{ backend, providerId, capabilityRevision, modelId, controlId }`. `capabilityRevision` is an opaque token that changes when capability-relevant provider configuration or adapter evidence changes; it contains no credential or URL. On a scope/revision change, refresh both the profile and selection set, then retain values only when every control and dependency remains valid.
- `provider_default` is an app/backend sentinel, never a provider payload value. The backend maps it to omission, reports it as the observed selection, and describes the provider's documented default in UI copy.
- Fixed reasoning is informational and read-only. Unsupported profile/control versions and input kinds are hidden and cannot be submitted.
- Do not log prompts, responses, API keys, headers, private reasoning, or provider bodies. Diagnostics may contain provider ID, model ID, control kind, requested value, result category, and a sanitized request ID.
- BUG-016 owns display of thinking already emitted by Kimi. BUG-018 owns provider error classification. This epic neither reopens nor absorbs either bug.
- Use fresh worktrees. Do not implement on `/Users/lap16603/Projects/WePrompt` (dirty and behind upstream) or the current `/Users/lap16603/Projects/aionrs` feature branch. Do not push without explicit user authorization.

## Provider-Neutral v1 Contract

```typescript
export type CapabilitySource = {
  kind: 'runtime' | 'adapter';
  id: string;
  version: string;
  verifiedAt?: string;
};

export type ReasoningControlValue = string | boolean | number;

export type ReasoningSelectionValue =
  | { kind: 'provider_default' }
  | { kind: 'explicit'; value: ReasoningControlValue };

export type ReasoningControlDescriptor = {
  id: string;
  semantic: 'effort' | 'mode' | 'enabled' | 'budget' | 'provider_defined';
  input: 'enum' | 'boolean' | 'integer';
  label: string;
  description?: string;
  defaultValue: ReasoningSelectionValue;
  resolvedDefault?: ReasoningControlValue;
  choices?: Array<{ value: ReasoningControlValue; label: string; description?: string }>;
  minimum?: number;
  maximum?: number;
  step?: number;
  unit?: string;
  visibleWhen?: Array<{ controlId: string; equals: ReasoningControlValue }>;
};

export type ModelReasoningProfile =
  | { contractVersion: 1; state: 'unsupported'; controls: []; source: CapabilitySource }
  | { contractVersion: 1; state: 'fixed'; controls: []; summary: string; source: CapabilitySource }
  | {
      contractVersion: 1;
      state: 'configurable';
      controls: [ReasoningControlDescriptor, ...ReasoningControlDescriptor[]];
      source: CapabilitySource;
    };

export type ReasoningModelScope = {
  backend: string;
  providerId: string;
  capabilityRevision: string;
  modelId: string;
};

export type ReasoningSelection = {
  scope: ReasoningModelScope & { controlId: string };
  value: ReasoningSelectionValue;
};

export type ObservedModelReasoningProfile = {
  scope: ReasoningModelScope;
  profile: ModelReasoningProfile;
  selections: ReasoningSelection[];
  activeControlIds: string[];
};
```

`choices` is required only for `enum`; numeric bounds and `step` are required only for `integer`. `provider_default` is a tagged selection state, not a magic enum string, so it cannot collide with a real provider value. `resolvedDefault` is evidence used only for dependency evaluation and explanatory UI; it is never submitted and never changes the observed selection away from `provider_default`.

Dependency evaluation is normative: multiple `visibleWhen` predicates use logical AND; an explicit selection evaluates to its primitive value; `provider_default` evaluates to the controller descriptor's verified `resolvedDefault`. If a controller can be `provider_default` and is referenced by a dependency, `resolvedDefault` is required and must validate against that controller's schema. Missing or invalid evidence makes the dependent control non-writable and the profile invalid for adapter enablement. The backend returns authoritative `activeControlIds`; pre-chat computes the same initial set from defaults and fails closed on uncertainty.

A model may expose more than one descriptor. Provider metadata persists `ModelReasoningProfile` only; conversation/session state persists scoped selections only. Provider wire mappings are adapter-private and are never accepted from or serialized to the renderer.

## Initial Conformance Fixtures

| Fixture | Contract behavior it proves |
| --- | --- |
| ACP runtime enum with arbitrary values such as `minimal`, `xhigh`, or `ultra` | Values and labels pass through without a static renderer list |
| AionRS effort model such as Kimi K3 | Enum effort and default omission |
| AionRS thinking model such as Kimi K2.6 | Mode/toggle translation |
| Fixed-thinking model such as Kimi K2.7 Code | Read-only state and parameter omission |
| Verified model exposing enablement plus token budget | Multiple dependent controls and bounded integer input |
| Unknown OpenAI-compatible/GreenNode model | Unsupported until exact adapter evidence exists |

These are conformance fixtures, not the supported-model allowlist. Every newly verified model runs the same suite and requires no renderer changes.

Initial evidence sources for the Kimi fixture:

- [Kimi thinking models](https://platform.kimi.ai/docs/guide/use-thinking-models)
- [Kimi reasoning effort](https://platform.kimi.ai/docs/guide/use-reasoning-effort)
- [Kimi model catalog](https://platform.kimi.ai/docs/models)

Exact current model IDs, controls, defaults, and availability must be rechecked when Milestone 0 starts. Equivalent authoritative evidence is required for every other adapter/model family before enablement.

## Delivery Units and Merge Order

1. **Contract freeze and execution plans:** complete Milestone 0, then create separately reviewed AionRS, AionCore, and WePrompt implementation plans before touching each repository.
2. **AionRS adapter contract:** private request mappings, public versioned descriptors, strict projection/mutation, and adapter conformance fixtures.
3. **AionCore canonical runtime contract:** ACP/AionRS normalization, observed envelopes, scoped persistence, migration sequence, and reusable conformance harness.
4. **WePrompt schema renderer:** adaptive controls, safe pre-chat behavior, i18n, persistence guards, and packaged-contract feature gate.

Each unit is independently reviewed and merged. WePrompt UI enablement remains off until the required AionCore binary is packaged and reports the expected runtime contract.

---

### Milestone 0: Establish clean bases and freeze capability evidence

**Files:**

- Create: `docs/design/provider-reasoning-capability-matrix.md`
- Modify: `docs/prds/conversations/model-selector.md`

- [ ] Preflight access to every upstream before creating worktrees. The WePrompt `origin` is the corporate GitLab remote; if it is unreachable without VPN, stop with an explicit network/VPN blocker rather than using the stale local checkout as a base.
- [ ] Create fresh worktrees from current upstreams:

```bash
git -C /Users/lap16603/Projects/aionrs fetch origin
git -C /Users/lap16603/Projects/aionrs worktree add /Users/lap16603/Projects/aionrs-reasoning-controls -b codex/provider-reasoning-controls origin/main
git -C /Users/lap16603/Projects/AionCore fetch origin
git -C /Users/lap16603/Projects/AionCore worktree add /Users/lap16603/Projects/AionCore-reasoning-controls -b codex/provider-reasoning-controls origin/main
git -C /Users/lap16603/Projects/WePrompt fetch origin
git -C /Users/lap16603/Projects/WePrompt worktree add /Users/lap16603/Projects/WePrompt-reasoning-controls -b codex/provider-reasoning-controls origin/sprint2
```

- [ ] Record the exact three base SHAs. At review time they were AionRS `origin/main` `1b22409`, AionCore `origin/main` `928f91c8`, and WePrompt `origin/sprint2` `343b725c4`; recalculate if upstream moved.
- [ ] Run untouched baselines in all three worktrees. If a baseline fails, record the exact existing failure and stop rather than repairing unrelated work.
- [ ] Inventory every currently enabled provider/runtime family. In the capability matrix, record each verified model's documentation URL/date, descriptor list, dependencies, exact values/ranges, documented defaults, native wire fields, omission behavior, response evidence, adapter version, and probe status.
- [ ] Define the adapter onboarding checklist: authoritative evidence, exact model identity, normalized profile fixture, native payload fixture, unsupported/default omission fixture, observed-roundtrip fixture, scope-switch fixture, and credentialed smoke.
- [ ] Run bounded probes for at least one runtime-advertised ACP model, one enum-effort model, one mode/toggle model, one fixed model, and one multi-control budget model when approved credentials are available. Use prompts with no private data and retain no response body.
- [ ] Use Moonshot/Kimi as one reference adapter and record its K3, K2.6, and K2.7 Code behavior. Do not put Kimi identifiers or values into shared UI/control derivation.
- [ ] Probe GreenNode only if an approved credential and endpoint are available. If acceptance and effective behavior cannot both be demonstrated, record `unsupported/unknown` and keep the control hidden.
- [ ] Update the model-selector PRD with the versioned profile, multiple typed controls, dependencies, `provider_default` semantics, scope-change behavior, fixed-state presentation, unsupported future versions, and the no-universal-scale rule.
- [ ] After the contract and matrix are reviewed, create separate agent-executable plans for AionRS, AionCore, and WePrompt. Each plan must define exact interfaces, focused failing tests with expected output, minimal implementation steps, full verification, and narrow commits; a later milestone cannot start in that repository until its plan is approved.
- [ ] Commit the tracked WePrompt docs as `docs(models): define provider reasoning capability contract`.

### Milestone 1: Add a provider-neutral profile to the AionRS adapter runtime

**Files (AionRS):**

- Modify: `crates/aion-config/src/compat.rs`
- Modify: `crates/aion-config/src/compat_test.rs`
- Modify: `crates/aion-protocol/src/events.rs`
- Modify: `crates/aion-agent/src/output/protocol_sink.rs`
- Modify: the existing protocol event/sink tests that assert serialized capabilities

**Contract:**

```rust
pub const MODEL_REASONING_CONTRACT_VERSION: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "input", rename_all = "snake_case")]
pub enum ReasoningControlSchema {
    Enum { choices: Vec<ReasoningChoice> },
    Boolean,
    Integer {
        minimum: i64,
        maximum: i64,
        step: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        unit: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReasoningControlSemantic {
    Effort,
    Mode,
    Enabled,
    Budget,
    ProviderDefined,
}

// Public protocol DTO. It contains no provider request mapping.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningControlDescriptor {
    pub id: String,
    pub semantic: ReasoningControlSemantic,
    #[serde(flatten)]
    pub schema: ReasoningControlSchema,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub default_value: ReasoningSelectionValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_default: Option<ReasoningControlValue>,
    pub visible_when: Vec<ReasoningDependency>,
}

// Adapter-private rule. Never place this type in protocol capabilities.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct AdapterReasoningControlRule {
    pub descriptor: ReasoningControlDescriptor,
    pub request_mapping: ReasoningRequestMapping,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub(crate) enum AdapterModelReasoningProfileState {
    Unsupported,
    Fixed { summary: String },
    Configurable { controls: Vec<AdapterReasoningControlRule> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct AdapterModelReasoningRule {
    pub model: String,
    pub profile: AdapterModelReasoningProfileState,
    pub source: CapabilitySource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ModelReasoningProfileState {
    Unsupported { controls: Vec<ReasoningControlDescriptor> },
    Fixed { controls: Vec<ReasoningControlDescriptor>, summary: String },
    Configurable { controls: Vec<ReasoningControlDescriptor> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionedModelReasoningProfile {
    pub contract_version: u16,
    #[serde(flatten)]
    pub profile: ModelReasoningProfileState,
    pub source: CapabilitySource,
}
```

- [ ] Define `ReasoningControlValue::{String, Boolean, Integer}` with untagged primitive Serde representation, separately from `ReasoningSelectionValue::{ProviderDefault, Explicit}` with `{ kind, value? }` tagged representation, so the sentinel cannot be confused with a provider string value. Define `ReasoningDependency.equals` as a primitive value with camel-case wire fields, use logical AND for multiple dependencies, and keep the closed `ReasoningRequestMapping` variants adapter-private: effort, thinking type, thinking budget, and omission. Do not accept arbitrary JSON paths from config or UI.
- [ ] Keep internal adapter profiles/rules separate from public DTOs. `ProtocolSink` explicitly projects each `AdapterReasoningControlRule.descriptor` into `VersionedModelReasoningProfile`; neither `request_mapping` nor any native field/path can cross the protocol boundary. Do not rely only on `#[serde(skip)]`, because compatibility configuration still needs its own trustworthy parsing/round-trip behavior.
- [ ] Source AionRS/direct-adapter `label`, optional `description`, and `resolved_default` from verified adapter metadata. ACP later preserves runtime-provided labels/descriptions. Shared application copy remains i18n-owned; the renderer never synthesizes or rewrites provider control labels.
- [ ] Write failing tests for exact model matching, case normalization, provider-prefixed IDs, duplicate profiles/control IDs, enum/boolean/integer schemas, bounded numeric ranges, bounded non-empty labels/descriptions, invalid defaults, missing/invalid `resolved_default`, AND dependency evaluation, circular/missing dependencies, multiple controls, fixed state, and an unknown model resolving to `Unsupported`.
- [ ] Add a bounded `model_reasoning` rule list to `ReasoningCompat`. Exact normalized ID matching is required; do not reuse the current substring matcher used for max-token rules.
- [ ] Validate profiles during config resolution: unsupported/fixed public profiles have an empty `controls` array; configurable profiles have one to eight controls, at most sixteen enum choices per control, bounded strings, positive integer steps, defaults and resolved defaults inside the schema, and an acyclic dependency graph. If a controller can be `provider_default` and another control depends on it, require evidenced `resolved_default`; reject malformed or ambiguous profiles rather than silently selecting a partial profile.
- [ ] Add adapter-internal `ProviderCompat::reasoning_rule_for_model(model)` for engine projection plus public `ProviderCompat::reasoning_profile_for_model(model)` that strips mappings into the versioned DTO. Keep existing provider-wide `supports_*` accessors only for backward compatibility; AionCore and protocol events use only the public model-scoped profile.
- [ ] Add `VersionedModelReasoningProfile` to protocol capabilities with serialized `contractVersion: 1` while preserving old boolean fields during one compatibility release. `CapabilitySource.version` remains evidence provenance and cannot substitute for the contract version.
- [ ] Add exact JSON tests for both `Ready` and `ConfigChanged`: the public profile contains `contractVersion`, labels/defaults/dependencies/source, and contains neither `request_mapping` nor any native request field/path.
- [ ] Verify that generic `openai_defaults()` no longer causes the new descriptor to advertise low/medium/high for an unknown OpenAI-compatible model.
- [ ] Run:

```bash
cargo test -p aion-config
cargo test -p aion-protocol
cargo test -p aion-agent protocol_sink
cargo fmt --check
```

- [ ] Commit in AionRS as `feat(config): add model-scoped reasoning capabilities`.

### Milestone 2: Make AionRS mutation, projection, and restore strict

**Files (AionRS):**

- Modify: `crates/aion-agent/src/engine.rs`
- Modify: `crates/aion-agent/src/engine_test.rs`
- Modify: `crates/aion-agent/src/session.rs`
- Modify: `crates/aion-agent/src/session_test.rs`
- Modify: `crates/aion-providers/src/projector.rs`
- Modify: the existing projector request-body tests under `crates/aion-providers/src/`

- [ ] Replace human-readable “ignored” mutation results with a typed result that distinguishes `Observed`, `Unsupported`, `UnknownControl`, `InvalidValue`, `DependencyViolation`, and `ScopeChanged`.
- [ ] Add `reasoning_profile()`, `reasoning_selections()`, `active_control_ids()`, and typed `set_reasoning_control(control_id, value)` methods on `AgentEngine`. The setter validates the exact immutable model profile and returns the complete observed envelope.
- [ ] Implement `provider_default` per control. Reset only that control's override, omit its native field, evaluate dependent predicates using verified `resolved_default`, then recompute authoritative active control IDs and reset newly inactive controls to their defaults.
- [ ] Project enum, boolean, and integer values through the closed adapter mapping. Validate all active control combinations before serializing a provider request.
- [ ] For `Fixed` and `Unsupported`, reject mutations and omit every reasoning field not required by the provider's fixed native behavior.
- [ ] When the engine model changes, resolve the new profile before the next request. Retain selections only when control ID, schema, value, and dependencies remain valid; otherwise reset them and emit a sanitized scope-change event.
- [ ] Add optional, backward-compatible session fields for a map of reasoning selections scoped by provider/model/profile revision/control. Restore only values still advertised by the resumed model profile.
- [ ] Add generic projector tests for arbitrary enum values, boolean, integer budget, dependency AND behavior, explicit/default dependency evaluation, dependent enablement+budget, active-control resets, fixed/default/unsupported omission, invalid combinations, profile revisions, model switches, and resume. Add Kimi payload cases only inside the AionRS adapter fixture.
- [ ] Run:

```bash
cargo test -p aion-agent
cargo test -p aion-providers
cargo fmt --check
cargo clippy -p aion-agent -p aion-providers --all-targets -- -D warnings
```

- [ ] Commit in AionRS as `feat(agent): enforce native reasoning selections`.

### Milestone 3: Define and persist the canonical reasoning profile in AionCore

**Files (AionCore):**

- Create: `crates/aionui-db/migrations/021_model_reasoning_profiles.sql`
- Modify: `crates/aionui-api-types/src/provider.rs`
- Modify: `crates/aionui-db/src/models/provider.rs`
- Modify: `crates/aionui-db/src/repository/provider.rs`
- Modify: `crates/aionui-db/src/repository/sqlite_provider.rs`
- Modify: `crates/aionui-system/src/provider.rs`
- Modify: provider repository/service tests in those modules

`021` is the verified next number at review time. If upstream adds a migration after `020` before implementation starts, rebase first and reserve the next two unused versions for Milestones 3 and 5. Once a migration has merged or run anywhere, never edit or renumber it.

- [ ] Write failing serialization and CRUD round-trip tests for unsupported, fixed, one enum, one boolean, one bounded integer, multiple dependent controls, resolved-default and AND semantics, invalid defaults/ranges/dependencies, unknown contract versions/input kinds/semantics, and model removal. Use provider-neutral fixtures; add Kimi only as one adapter-data case.
- [ ] Add typed `ModelSettings`, versioned `ModelReasoningProfile`, `ReasoningControlDescriptor`, closed `ReasoningControlSemantic`, `ReasoningControlValue`, `ReasoningDependency`, and `CapabilitySource` API shapes matching the contract above. Preserve the frontend's existing `image_input` and `openai_api_mode` fields; do not round-trip them through untyped JSON that drops unknown data.
- [ ] Add nullable `model_settings TEXT` to providers. Store immutable capability profiles and sources only—never conversation selections or current values. Missing data stays `None` and is backward-compatible with existing rows.
- [ ] Enforce profile limits: at most one entry per configured model, one to eight controls for a configurable profile, sixteen enum choices per control, bounded labels/descriptions/units, valid integer bounds/steps, valid defaults/resolved defaults, unique control IDs, AND dependency semantics, and an acyclic dependency graph.
- [ ] Require an evidence source/version for every writable profile. Provider wire mappings remain inside trusted adapters; provider CRUD and renderer payloads must never supply or receive an arbitrary request field/path. Add serialization tests asserting `request_mapping` and native field/path data are absent.
- [ ] Make create, update, list, and get preserve `model_settings`. Removing a model removes its orphaned settings in the same update. Capability-affecting updates—including endpoint, platform/protocol, credential identity, Bedrock configuration, full-URL mode, or model metadata—rotate an opaque `capabilityRevision`, invalidate cached profiles/selections, and expose no raw configuration in that token.
- [ ] Add migration tests from the current pre-feature schema and coordinate this migration with BUG-013's packaged schema-compatibility gate.
- [ ] Run:

```bash
cargo test -p aionui-db provider
cargo test -p aionui-system provider
cargo test -p aionui-api-types provider
cargo fmt --check
```

- [ ] Commit in AionCore as `feat(provider): persist model reasoning metadata`.

### Milestone 4: Normalize ACP and AionRS through observed reasoning profiles

**Files (AionCore):**

- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Modify: `crates/aionui-ai-agent/src/types.rs`
- Modify: `crates/aionui-ai-agent/src/factory/aionrs.rs`
- Modify: `crates/aionui-ai-agent/src/manager/aionrs/agent.rs`
- Modify: `crates/aionui-ai-agent/src/manager/acp/config_options.rs`
- Modify: `crates/aionui-ai-agent/src/manager/acp/agent.rs`
- Modify: `crates/aionui-ai-agent/src/manager/acp/session_tests.rs`
- Modify: `crates/aionui-ai-agent/src/agent_task.rs`
- Modify: `crates/aionui-ai-agent/tests/agent_types_integration.rs`
- Modify: `crates/aionui-app/tests/acp_config_options_e2e.rs`

- [ ] Pin the reviewed AionRS commit/tag containing Milestones 1–2 and prove the lockfile resolves that exact revision.
- [ ] Extend config-option responses with an optional `observed_reasoning_profile` containing the versioned immutable profile, capability revision, complete scoped selections, and authoritative active control IDs. During one compatibility release, retain existing raw `config_options`; the observed envelope is the canonical renderer contract.
- [ ] Preserve and validate `contractVersion: 1` independently from evidence/source versions. Unknown or malformed versions are non-writable and pass through only as bounded diagnostics, never as a partially narrowed v1 profile.
- [ ] ACP normalization must collect every runtime-advertised reasoning-related option, not the first `thought_level` match. Preserve opaque option IDs/values/labels and normalize select, boolean, and bounded numeric options when the runtime supplies sufficient constraints.
- [ ] If an ACP runtime supplies an unsupported type or lacks safe numeric bounds, omit that control from the writable profile and retain the raw option for diagnostics/compatibility only.
- [ ] Extend `AionrsCompatOverrides`/`AionrsResolvedConfig` with the exact selected model profile and scoped initial selection map. Resolve it from verified adapter metadata for that provider/model; never apply a generic OpenAI-compatible fallback.
- [ ] Apply the resolved AionRS profile to `Config.compat`. Keep AionRS `mode` behavior unchanged and synthesize one config option per configurable reasoning descriptor.
- [ ] Return `Unsupported` or `Fixed` profiles without writable reasoning options. Fixed summary comes from verified adapter metadata, not renderer inference.
- [ ] Under the engine mutex, apply a control mutation, then rebuild the complete observed envelope. Return `ConfigOptionConfirmation::Observed` only when the returned selection set and active control IDs contain the requested result and all dependency-driven changes under the same contract version, capability revision, profile, and scope.
- [ ] Add one reusable adapter conformance harness. Run it against ACP pass-through and AionRS fixtures for enum, boolean, integer, resolved defaults, dependency AND behavior, multiple dependent controls, fixed, unsupported, provider-default omission, invalid values, public-payload mapping absence, and observed roundtrip.
- [ ] Reject unavailable control IDs, invalid values/combinations, stale scope, and fixed/unsupported mutation with typed bad-request codes that BUG-018 can classify; never return provider bodies.
- [ ] Replace the current AionRS “thought_level unavailable” test with an unsupported-profile case and separate generic configurable-profile cases. Add endpoint coverage proving command acknowledgement cannot mutate the canonical profile.
- [ ] Run:

```bash
cargo test -p aionui-ai-agent
cargo test -p aionui-app acp_config_options_e2e
cargo fmt --check
cargo clippy -p aionui-ai-agent -p aionui-app --all-targets -- -D warnings
```

- [ ] Commit in AionCore as `feat(agent): expose observed reasoning controls`.

### Milestone 5: Scope creation defaults, preferences, and model changes in AionCore

**Files (AionCore):**

- Modify: `crates/aionui-api-types/src/agent_build_extra.rs`
- Modify: `crates/aionui-api-types/src/conversation.rs`
- Modify: `crates/aionui-api-types/src/assistant.rs`
- Create: `crates/aionui-db/migrations/022_scoped_reasoning_selections.sql`
- Modify: `crates/aionui-db/src/models/assistant.rs`
- Modify: `crates/aionui-db/src/repository/sqlite_assistant.rs`
- Modify: `crates/aionui-conversation/src/service.rs`
- Modify: `crates/aionui-conversation/src/service_ops.rs`
- Modify: `crates/aionui-conversation/src/service_test.rs`
- Modify: relevant team and scheduled-task config-option tests under `crates/aionui-team/` and `crates/aionui-app/`

**Scope shape:**

```rust
pub struct ReasoningSelectionScope {
    pub backend: String,
    pub provider_id: String,
    pub capability_revision: String,
    pub model_id: String,
    pub control_id: String,
}

pub struct ScopedReasoningSelection {
    pub scope: ReasoningSelectionScope,
    pub value: ReasoningSelectionValue,
}
```

- [ ] Create `022` for assistant defaults, assistant preferences, and conversation snapshot selections; do not modify Milestone 3's `021`. If upstream consumes either number, rebase and use the two reserved next versions. Keep the scalar columns introduced by `019_assistant_thought_level_defaults.sql` readable for one compatibility release.
- [ ] Replace single thought-level persistence with a bounded selection set of `{ scope, value }` entries for conversation overrides, assistant defaults, and last-used preferences. Each scope includes `capability_revision`.
- [ ] Revalidate legacy and new values only after the selected runtime/profile advertises a matching control. Ignore an unscoped scalar rather than applying it to an arbitrary provider/model.
- [ ] Persist assistant reasoning defaults only when every selection validates against the exact configurable provider/model profile. A fixed model stores no writable selection; its read-only state is derived from the profile. Changing the assistant model resets an incompatible selection set to provider defaults.
- [ ] At conversation creation, carry the scoped selection set into the runtime build contract. Each adapter applies values only after resolving the exact profile; invalid entries reset to provider defaults with bounded diagnostics rather than failing the conversation.
- [ ] On any active model or capability-relevant provider update, invalidate/stop the old runtime, persist the new model/provider revision, create/ensure the new runtime, and return the complete new observed envelope before accepting another reasoning write. A changed endpoint/configuration with the same provider/model IDs must still invalidate prior selections.
- [ ] For ACP model changes, require either a real model config option whose observed response includes refreshed reasoning options or an explicit post-legacy-model refresh. Never retain the pre-switch option catalog by assumption.
- [ ] Persist only complete observed selection sets. Restore/restart must revalidate contract version, capability revision, control IDs, schemas, values, active controls, and dependencies against current profile metadata before use.
- [ ] Add an upgrade test that applies immutable `021` and then `022`, plus provider-neutral tests for enum → boolean, multi-control → fixed, configurable → unsupported, changed enum choices/ranges, same IDs with changed endpoint/configuration, switch back, restart, stale assistant defaults, team warmup, and scheduled-task execution. Run the same cases with at least one ACP and one AionRS fixture.
- [ ] Run full AionCore verification:

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

- [ ] Commit in AionCore as `feat(conversation): scope reasoning selections by model`.

### Milestone 6: Add WePrompt contracts and generic adapter metadata migrations

**Files (WePrompt):**

- Modify: `packages/desktop/src/common/config/storage.ts`
- Create: `packages/desktop/src/common/types/provider/modelReasoning.ts`
- Create: `packages/desktop/src/common/types/provider/modelReasoningSchema.ts`
- Modify: `packages/desktop/src/common/types/provider/providerApi.ts`
- Modify: `packages/desktop/src/common/types/platform/acpTypes.ts`
- Modify: `packages/desktop/src/common/types/agent/assistantTypes.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Modify: `packages/desktop/src/common/config/builtinSeed.ts`
- Modify: `packages/desktop/src/common/config/configKeys.ts`
- Modify: `packages/desktop/src/process/utils/seedBuiltinProviders.ts`
- Modify: `packages/desktop/src/process/utils/seedBuiltinProviders.test.ts`
- Create: `tests/unit/providers/modelReasoning.test.ts`
- Create: `tests/unit/providers/tsconfig.modelReasoning.json`
- Modify: focused native payload/schema tests if the native bridge mirrors provider or conversation payloads

- [ ] Mirror AionCore's exact immutable profile, control, selection-value, observed-envelope, source, and scope types in the focused common type module. Do not create a renderer-only vocabulary or provider-specific union variants.
- [ ] Add `parseModelReasoningProfile(raw: unknown)` and `parseObservedModelReasoningProfile(raw: unknown)` in `modelReasoningSchema.ts`. Validate raw JSON—including `contractVersion === 1`—before narrowing to the v1 TypeScript union; unknown, missing, or malformed versions/semantics/input kinds return a typed unsupported result and never become writable through a cast.
- [ ] Add `reasoning_selections` to the desktop conversation-creation contract while retaining `thought_level` as read compatibility. Each entry includes full scope and one typed value.
- [ ] Implement one non-destructive metadata migration helper usable by any bundled provider. It merges only verified missing model profiles and preserves credentials, URLs, enabled flags, user-added models, recorded removals, and unrelated settings.
- [ ] Use that helper for the first approved adapter data, including Moonshot/Kimi only after Milestone 0 confirms exact IDs. Kimi model additions are rollout data, not shared contract logic.
- [ ] Send/preserve generic `model_settings` through provider CRUD. Add read-after-write tests for enum, boolean, integer, dependent controls, fixed, and unsupported profiles.
- [ ] Add strict guards for unknown contract versions/input kinds/semantics, malformed controls, invalid ranges/defaults/resolved defaults/dependencies, duplicate IDs, unknown capability revisions/scopes, leaked mapping/native-field keys, and unsupported/fixed profiles presented as writable.
- [ ] Add a dedicated test TypeScript project extending the root config and including `modelReasoning.test.ts`. The contract fixtures must both execute in Vitest and compile against the real source types; root `tsc --noEmit` alone does not include `tests/unit/**`.
- [ ] Run:

```bash
bunx tsc --noEmit -p tests/unit/providers/tsconfig.modelReasoning.json
bunx vitest run packages/desktop/src/process/utils/seedBuiltinProviders.test.ts tests/unit/providers
bun run test
```

- [ ] Commit in WePrompt as `feat(models): add scoped reasoning capability data`.

### Milestone 7: Generalize the existing runtime config-option seam

**Files (WePrompt):**

- Modify: `packages/desktop/src/renderer/hooks/agent/useAcpConfigOptions.ts`
- Modify: `packages/desktop/src/renderer/hooks/agent/useAcpModelInfo.ts`
- Modify: `packages/desktop/src/renderer/utils/model/agentRuntimeCatalog.ts`
- Modify: `tests/unit/acpConfigOptions.test.ts`
- Modify: `tests/unit/renderer/useAcpModelInfo.dom.test.ts`
- Modify: relevant runtime-catalog tests under `tests/unit/renderer/`

- [ ] Write failing tests for unsupported, fixed, arbitrary enum values, boolean, bounded integer, multiple dependent controls, provider default, malformed controls, unknown contract/input versions, stale observed snapshots, and refreshed profiles after a model change.
- [ ] Replace select-only thought derivation with a normalized immutable `reasoningProfile`, scoped `reasoningSelections[]`, and ordered derived `reasoningControls[]`. Preserve each backend option ID, input kind, default selection, observed selection, exact choices or bounds, labels, descriptions, dependency rules, and source/version without writing current state into the profile.
- [ ] Continue treating runtime-advertised ACP options as authoritative. Do not overwrite agent-provided labels or remap their values to the AionRS vocabulary.
- [ ] Collect and expose all compatible ACP reasoning options. Do not stop after the first effort/thought option, and do not infer controls from provider or model names.
- [ ] Keep the observed-write rule: UI state changes only when the returned complete envelope's selection set contains the requested control value and every dependency-driven update.
- [ ] Make model selection and profile refresh atomic from the caller's perspective. A real model config-option response replaces the complete observed envelope; the legacy model path explicitly reloads before rendering or accepting reasoning input.
- [ ] Add a generation plus `{ backend, providerId, capabilityRevision, modelId }` guard so a slow response for the previous scope or provider configuration cannot replace the new model's profile.
- [ ] Hide unknown contract/input versions and unsafe numeric controls rather than degrading them into a writable select.
- [ ] Run focused tests followed by `bun run test`.
- [ ] Commit in WePrompt as `refactor(agent): normalize runtime reasoning options`.

### Milestone 8: Render adaptive controls in active conversations

**Files (WePrompt):**

- Create: `packages/desktop/src/renderer/components/agent/ReasoningControls.tsx`
- Modify: `packages/desktop/src/renderer/components/agent/AcpModelSelector.tsx`
- Modify: `packages/desktop/src/renderer/components/agent/runtimeSelectorOptions.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection.ts`
- Modify: `packages/desktop/src/renderer/pages/conversation/components/ChatConversation.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx`
- Modify: `tests/unit/renderer/AcpModelSelector.dom.test.tsx`
- Modify: `tests/unit/renderer/AionrsModelSelector.dom.test.tsx`
- Modify: `tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx`
- Modify: focused AionRS conversation/send-box DOM tests

- [ ] Render the provider-neutral profile without provider/model conditionals: `enum` as provider-native choices, `boolean` as an accessible switch or On/Off choices, and `integer` as a bounded Arco numeric control using the advertised step and unit.
- [ ] Render every descriptor whose ID appears in the observed envelope's authoritative `activeControlIds`, in stable profile order. For pre-chat only, derive the initial active set with the normative AND/resolved-default rules and hide dependents fail-closed if evidence is missing.
- [ ] Render `fixed` as a disabled informational summary and `unsupported` as no reasoning row. Unknown contract/input versions are hidden and cannot invoke a setter.
- [ ] Use Arco components and `@icon-park/react`; add no raw interactive HTML.
- [ ] Use adapter-provided labels and descriptions. Show `Provider default` per control, including its verified model-specific description when supplied, without converting it into an explicit provider payload.
- [ ] Disable the affected controls while model selection, profile refresh, or config mutation is pending. A model change disables the whole reasoning section until the replacement profile is observed.
- [ ] On any provider/model selection, update the conversation, ensure the replacement runtime, replace the complete observed envelope, then update the visible selector. On failure, keep the previous model/envelope and show localized actionable feedback.
- [ ] Ensure desktop, mobile, ACP, and AionRS selectors use the same profile renderer and set handler; backend-specific components only acquire and submit profiles, never redefine control semantics.
- [ ] Put the schema-only renderer in `ReasoningControls.tsx` and keep acquisition/submission in the backend selectors. The target directory currently has eight direct children, so this addition keeps it within the ten-child architecture limit and avoids a one-file directory.
- [ ] Extend the existing selector DOM suites with direct `ReasoningControls` coverage for keyboard, focus, selected state, screen-reader labels, multi-control ordering, dependency AND/default behavior, numeric boundaries, pending, failure, fixed, hidden, unknown version, and stale responses. Do not add another direct child under the already oversized `tests/unit/renderer/` directory.
- [ ] Run focused DOM tests followed by `bun run test`.
- [ ] Commit in WePrompt as `feat(conversation): show model-native reasoning controls`.

### Milestone 9: Scope pre-chat selection, assistant defaults, projects, teams, and schedules

**Files (WePrompt):**

- Modify: `packages/desktop/src/renderer/pages/guid/hooks/useGuidAssistantSelection.ts`
- Modify: `packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts`
- Modify: `packages/desktop/src/renderer/pages/guid/GuidPage.tsx`
- Modify: `packages/desktop/src/renderer/pages/guid/components/GuidActionRow.tsx`
- Modify: `packages/desktop/src/renderer/pages/guid/components/GuidModelSelector.tsx`
- Modify: `packages/desktop/src/renderer/pages/project/components/ProjectNewChatComposer.tsx`
- Modify: `packages/desktop/src/renderer/pages/guid/utils/assistantDefaults.ts`
- Modify: `packages/desktop/src/renderer/hooks/assistant/useAssistantEditor.ts`
- Modify: `packages/desktop/src/renderer/pages/settings/AssistantSettings/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/settings/AssistantSettings/types.ts`
- Modify: `packages/desktop/src/renderer/pages/settings/AssistantSettings/AssistantEditorSections.tsx`
- Modify: `packages/desktop/src/renderer/pages/settings/AssistantSettings/editor/DefaultsSection.tsx`
- Modify: `packages/desktop/src/renderer/pages/team/TeamPage.tsx`
- Modify: `packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/TaskDetailPage.tsx`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/agent.json`
- Regenerate: `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`
- Modify: `tests/unit/renderer/hooks/guidModelSelector.dom.test.tsx`
- Modify: `tests/unit/renderer/GuidActionRow.dom.test.tsx`
- Modify: `tests/unit/renderer/useGuidSend.dom.test.ts`
- Modify: `tests/unit/renderer/assistantDefaults.test.ts`
- Modify: `tests/unit/assistants/AssistantEditorSections.dom.test.tsx`
- Modify: `tests/unit/assistants/useAssistantEditor.dom.test.ts`
- Modify: `tests/unit/settings/AssistantSettings.dom.test.tsx`
- Modify: `tests/unit/settings/DefaultsSectionSearch.dom.test.tsx`
- Modify: `tests/unit/renderer/cron/resolveCronAgentConfig.test.ts`
- Modify: `tests/unit/renderer/team/TeamPageCronJobManager.dom.test.tsx`
- Modify: `tests/unit/team-config-options.test.ts`

- [ ] Key pre-chat reasoning state by assistant plus `{ backend, providerId, capabilityRevision, modelId, controlId }`, not assistant alone. Store a bounded selection set so models with multiple controls do not collapse into one scalar.
- [ ] Stop hiding controls based on backend identity. Use the selected model's canonical profile and default selections for pre-chat display; the complete runtime-observed envelope becomes authoritative after conversation creation.
- [ ] Send `reasoning_selections` only after every scope, value, numeric bound, and dependency validates against the selected profile. Unsupported/fixed models send no writable override, and `provider_default` is represented as omission by the backend adapter.
- [ ] Make assistant reasoning defaults a model-scoped selection set. If the assistant model is Auto, reasoning must also be Auto unless the runtime later advertises and restores a compatible observed set.
- [ ] Use the same behavior in normal New Chat and Project New Chat. Team and scheduled-task forms must reject stored control IDs, values, revisions, or combinations absent from the selected runtime/model's current profile. A capability-relevant provider update invalidates pre-chat, assistant, team, and schedule selections even when provider/model IDs do not change.
- [ ] Add provider-neutral localized strings for Reasoning, Provider default, On, Off, fixed-state summary, token-budget unit, invalid/unsupported value, refresh failure, and stale selection in all configured locales. Provider-specific control labels remain adapter data.
- [ ] Add provider-neutral tests for arbitrary enum choices, boolean, integer budget, multiple dependent controls, fixed, unsupported, unknown version hidden, capability-revision/scope/model resets, same IDs with changed endpoint/configuration, assistant model changes, restore/restart, team warmup, and schedule edit/run. Run the same contract fixtures through at least one ACP and one AionRS adapter; keep Kimi as one AionRS data case.
- [ ] Run:

```bash
bunx vitest run tests/unit/renderer/hooks/guidModelSelector.dom.test.tsx tests/unit/renderer/GuidActionRow.dom.test.tsx tests/unit/renderer/useGuidSend.dom.test.ts tests/unit/renderer/assistantDefaults.test.ts tests/unit/assistants/AssistantEditorSections.dom.test.tsx tests/unit/assistants/useAssistantEditor.dom.test.ts tests/unit/settings/AssistantSettings.dom.test.tsx tests/unit/settings/DefaultsSectionSearch.dom.test.tsx tests/unit/renderer/cron/resolveCronAgentConfig.test.ts tests/unit/renderer/team/TeamPageCronJobManager.dom.test.tsx tests/unit/team-config-options.test.ts
bun run i18n:types
node scripts/check-i18n.js
bun run test
```

- [ ] Commit in WePrompt as `feat(models): scope reasoning controls across launch surfaces`.

### Release Gate 10: Gate the packaged release and run end-to-end acceptance

**Files:**

- Modify (AionCore): workspace version and release notes required by its release workflow
- Modify (WePrompt): `package.json`
- Modify (WePrompt): `scripts/prepareAioncore.js`
- Modify (WePrompt): `scripts/resolveAioncoreVersion.js`
- Modify: existing backend manifest/version and packaging verification tests

- [ ] Tag/release AionRS only after Milestones 1–2 pass full workspace tests; update AionCore to the immutable tag/commit.
- [ ] Tag/release AionCore only after Milestones 3–5 pass full workspace tests and both immutable migrations are included. Do not bypass BUG-013's schema-floor acceptance.
- [ ] Bump WePrompt's `aioncoreVersion` to that release and prepare binaries through the repository script. Never hand-copy a developer binary into the package.
- [ ] Add a CI, packaging, and after-pack fail-closed check that compares requested `aioncoreVersion`, bundled manifest version, executable `--version`, and required model-reasoning contract version. Any mismatch fails the build/release before delivery.
- [ ] Keep runtime negotiation feature-closed rather than application-closed. In development or with a system-PATH backend, a missing, older, malformed, or unknown reasoning contract resolves to `unsupported`, hides reasoning controls, and does not prevent WePrompt or AionCore from starting. Do not add a hard contract check to `binaryResolver.ts`; modify it only if later implementation needs nonfatal binary-origin diagnostics.
- [ ] Run the adapter conformance harness for every enabled provider/runtime family before credentialed smoke testing. An adapter that cannot prove exact profile-to-payload and observed-roundtrip behavior remains `unsupported` even if the model is generally described as reasoning-capable.
- [ ] Run credentialed packaged-app smokes across the supported contract shapes:
  - an ACP runtime-advertised enum with arbitrary values;
  - a direct-provider enum effort control, with default omission and one explicit value;
  - a boolean or mode control in both states;
  - a bounded integer budget, including a model with dependent enablement plus budget controls;
  - a fixed-reasoning model with no writable field;
  - an unknown/custom model with no control and no reasoning field;
  - model switches, app restart, conversation resume, assistant default, Project New Chat, team, and scheduled-task paths.
- [ ] Include Kimi K3, K2.6, and K2.7 Code as the first concrete AionRS conformance set, not as the release boundary. Add equivalent credentialed cases for each other adapter enabled in the release.
- [ ] Inspect sanitized provider request metadata or a test proxy to prove exact field presence/absence. Do not capture prompts, completions, keys, or private reasoning.
- [ ] Run final gates:

```bash
# AionRS
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# AionCore
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# WePrompt
bun run lint
bun run format:check
bunx tsc --noEmit
bunx tsc --noEmit -p tests/unit/providers/tsconfig.modelReasoning.json
bun run i18n:types
node scripts/check-i18n.js
bun run test
bun run test:coverage
```

- [ ] Run installed-app smokes on macOS ARM, macOS Intel, and Windows. Record adapter/source version, provider/model, profile state, control ID/kind/value, backend version, result, and sanitized evidence in the release checklist.
- [ ] Commit WePrompt release wiring as `build(backend): require model reasoning contract`.

## Final Acceptance

- Every current or future model enters through the same versioned profile; enabling a model requires adapter metadata/evidence and conformance tests, never shared-renderer code or a provider/model conditional.
- The selector exposes all and only the active provider/model's native controls, exact enum values, boolean semantics, numeric bounds, dependencies, defaults, and adapter-provided labels.
- Public profiles contain an explicit supported contract version and no request mapping, native field/path, credential, endpoint, or other adapter-private detail; raw unknown versions are rejected before TypeScript narrowing.
- Dependency predicates use logical AND. `provider_default` dependencies use a verified primitive `resolvedDefault`, while the observed selection remains `provider_default`; missing or invalid evidence makes the dependent control non-writable.
- Unsupported, fixed, malformed, and unknown-version profiles never receive a writable control or unsupported payload field.
- `provider_default` is evaluated per control, omits the corresponding provider field, and remains part of the complete observed app selection set.
- Provider/model/capability-revision changes cannot leak a stale control, value, catalog, assistant default, team setting, or scheduled-task setting; multiple-control dependencies remain valid after provider edits, switch, restart, and resume.
- ACP behavior stays fully runtime-advertised. AionRS and future direct-provider behavior stays exact-model and adapter-verified; neither is overridden by a static renderer map.
- Every successful write returns the complete observed envelope. Rejected, ignored, or partially applied parameters leave prior UI state intact and surface a localized error.
- The reusable conformance suite passes for every enabled adapter and all supported v1 shapes, and its TypeScript fixtures pass the dedicated compile project as well as Vitest. Kimi K3, K2.6, and K2.7 Code pass as initial AionRS fixtures; they do not define the feature boundary.
- AionCore upgrades apply the immutable provider-profile migration and then the immutable scoped-selection migration; no released/applied migration is edited in place.
- CI/packaging fails closed unless source tag, packaged manifest, executable version, and required capability-contract version match. Development runtime negotiation fails feature-closed: an absent, older, malformed, or future contract hides reasoning controls without blocking application startup.
- No logs or test artifacts contain prompts, completions, credentials, headers, provider bodies, or private reasoning.
