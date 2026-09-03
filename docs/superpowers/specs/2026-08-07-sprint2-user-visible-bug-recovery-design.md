# Sprint 2 User-Visible Bug Recovery Wave — Design

**Date:** 2026-08-07  
**Status:** Approved design; implementation plan pending  
**Scope:** BUG-019, BUG-016, BUG-032, and a bounded BUG-018 compatibility slice  
**Delivery boundary:** Local review-ready branches only

## 1. Decision

Defer EPIC-002 as **foundation partial** and use the next autonomous development window to recover user-visible Sprint 2 progress.

Start two independent, low-risk fixes in parallel:

1. BUG-019 — open Project Home after project creation.
2. BUG-016 — keep subjectless thinking activity visible without exposing raw reasoning.

Prepare BUG-032 as a dependent copy-only fix: make the Creative Studio Write-assistant description match its actual one-shot storyboard capability in all 12 locales, but do not edit those files until the active Creative Studio owner declares an immutable accepted/frozen head or integrates its branch.

Use the remaining capacity for one bounded WePrompt chat-error slice of BUG-018. This slice corrects the semantics of provider failures already expressible by the shipped public contract. It excludes provider-health persistence and model eligibility, and it must not be reported as full BUG-018 closure. Full closure requires an additive AionRS/AionCore provider-error contract and a newly accepted bundled backend.

No push, merge request, merge, packaging, release, feature activation, or EPIC-002 work is authorized by this design.

## 2. Why This Shape

The previous EPIC-002 workstream repeatedly stopped on foundational storage invariants. Continuing to make small changes around that boundary would risk more time without a shippable user outcome.

The selected recovery wave has a different risk profile:

- BUG-019 is a narrow renderer navigation defect with an existing correct route builder.
- BUG-016 has a confirmed renderer-only drop condition and an existing localized fallback vocabulary.
- BUG-032 changes copy only, but its 12 locale files and Studio i18n test overlap an active Creative Studio branch. Sequencing it behind an immutable owner head avoids concurrent edits and later reconciliation churn.
- BUG-018 is real but crosses WePrompt, AionCore, and AionRS. It is therefore isolated behind a time and ownership boundary instead of being allowed to block the other three bugs.

This arrangement produces three independently useful candidates even if BUG-018 reaches a cross-repository stop condition.

## 3. Goals

- Produce review-ready local fixes for BUG-019 and BUG-016, plus BUG-032 after its ownership dependency clears.
- Preserve one atomic branch and commit chain per bug.
- Verify changed behavior with focused RED-to-GREEN tests and the repository-required gates.
- Obtain independent exact-head review for each candidate.
- Correct WePrompt chat retry/recovery semantics for the provider error codes already present in the shipped public contract.
- Preserve a precise handoff for the remaining AionRS/AionCore portion of BUG-018.
- Update the Sprint 2 TODO once, after exact candidate heads and verdicts are known.
- Continue unaffected lanes when one lane encounters a blocker.

## 4. Non-Goals

- Resuming or redesigning EPIC-002.
- Completing AionRS/AionCore provider classification or publishing a new backend bundle during this recovery wave.
- Adding automatic provider-request replay.
- Changing Creative Studio behavior, provider selection, model labels, or charge disclosure.
- Exposing raw thinking content or weakening existing narration filtering.
- Changing explicit Project **New chat** behavior.
- Packaging, signing, notarization, installer acceptance, or release work.
- Pushing branches or changing remote state.
- Cleaning unrelated worktrees, branches, or untracked files.

## 5. Execution Model

### 5.1 Controller and workers

Use one Controller and up to three concurrent Workers.

| Session               | Role                                    | Owned scope                                                                                             |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `S2-R1-CONTROLLER`    | Controller                              | Base verification, ownership checks, serialized broad gates, review dispatch, final TODO reconciliation |
| `S2-R1-BUG019-WORKER` | Worker                                  | Project-creation navigation and its focused test                                                        |
| `S2-R1-BUG016-WORKER` | Worker                                  | Thinking-summary fallback and its focused test                                                          |
| `S2-R1-BUG032-WORKER` | Dependent Worker                        | Creative Studio description copy after the Creative Studio owner freezes or integrates an exact head    |
| `S2-R1-BUG018-WP`     | Worker after a slot frees               | WePrompt chat-error normalization slice only                                                            |
| `S2-R1-REVIEWER`      | Read-only Reviewer, reused sequentially | Literal-base/literal-head review; never edits the candidate                                             |

Session status is reported separately from the session name. The status vocabulary is `ACTIVE`, `WAITING_DEPENDENCY`, `READY_FOR_INTEGRATION`, `PAUSED`, and `DONE`. Review verdict is a separate `ACCEPT` or `BLOCK` field and never appears in the session title.

### 5.2 Branch isolation

At execution time, fetch and record the latest accepted `origin/sprint2` commit. Create an isolated worktree and a new recovery branch for every bug. Include the short base commit in recovery branch names when an older branch already exists.

The Controller persists the literal base, absolute local plan path, and plan SHA-256 in branch-scoped Git configuration for every worker branch. A worker must recover and verify those values at the start of its first turn and again when freezing its candidate. Shell variables from a Controller command are never treated as cross-session state. Because `docs/superpowers/` is intentionally ignored, workers read the Controller-supplied absolute plan path and verify its recorded checksum rather than expecting the plan to appear in a fresh worktree.

Expected branch forms:

- `codex/bug019-project-home-r-${S2_SHORT}`
- `codex/bug016-thinking-fallback-r-${S2_SHORT}`
- `codex/bug032-studio-copy-r-${DONOR_SHORT}`
- `codex/bug018-provider-errors-ui-r-${S2_SHORT}`

Preserve these existing branches unchanged:

- `codex/bug016-thinking-fallback@5bc32216d`
- `codex/bug018-provider-failure-contract@343b725c4`
- `codex/epic002-template-creation-r-02ee3f8d6@a1754a13e`

At design capture, the old BUG-016 branch is 268 commits behind the reviewed Sprint tip and carries unnecessary locale additions. It is evidence, not the implementation base. Reimplement the minimal current-tip fix instead of rebasing or amending that branch.

### 5.3 Concurrency

- BUG-019 and BUG-016 may be developed concurrently.
- While those workers run, the Controller narrows BUG-018's chat-only contract and verifies its source/test seams.
- BUG-032 must remain `WAITING_DEPENDENCY` while the active Creative Studio branch owns the same 12 locale files and `studioI18n.test.ts`.
- After the Creative Studio owner declares an immutable accepted/frozen head, either that owner applies the copy-only correction on its branch or BUG-032 starts from that exact head. It must not independently edit the overlapping files before then.
- Repository-wide test suites must not run concurrently across worktrees.
- BUG-018 begins after one Worker slot becomes available.
- Review may overlap another lane's focused development, but an exact-head verdict is invalidated by any later source change.
- A blocker in one bug pauses only that branch.

### 5.4 Autonomous-window time box

The planned autonomous window is four to six hours of elapsed work, with development parallelized and broad gates serialized.

- Begin BUG-019 and BUG-016 immediately after base and ownership checks.
- In parallel, resolve the BUG-032 ownership dependency and finish BUG-018's exact chat-only contract inspection.
- Move a freed Worker slot to BUG-018 after one primary candidate reaches its focused/static handoff.
- Start BUG-032 only after the Creative Studio head is frozen or integrated and the Controller confirms a safe exact base.
- Limit BUG-018 contract confirmation and RED-matrix creation to 90 minutes.
- After the contract is confirmed, allow up to two additional hours for the WePrompt compatibility implementation and focused verification.
- If BUG-018 exceeds that boundary, touches more than the narrowed compatible seams, or requires AionCore/bundle mutation, preserve the RED evidence and produce a blocker handoff. Do not consume the rest of the window attempting backend closure.
- Do not time-box away verification for the three primary bugs; a nearly complete gate or review may finish before the wave stops.

## 6. Bug Contracts

### 6.1 BUG-019 — Project creation opens Project Home

#### Current defect

`ProjectCreateModal` successfully creates the project and returns it to `GroupedHistory`. The parent refreshes and closes correctly, but the completion callback invokes `navigateToProjectChat(...)`, which opens `/guid`.

#### Required behavior

- After creation succeeds, refresh the project list.
- Close the create modal.
- Navigate to the encoded Project Home route produced by `buildProjectHomePath(project.id)`.
- Preserve explicit project **New chat** actions on `/guid` with their existing project context.

#### Expected scope

- `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx`
- `tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx`

No IPC, persistence, route registration, or locale change is required.

#### Acceptance evidence

- A creation-completion test fails against the current callback and passes after the change.
- The existing explicit **New chat** regression still proves `/guid` navigation.
- Encoded project IDs continue to use the existing route builder.

### 6.2 BUG-016 — Subjectless thinking remains visible safely

#### Current defect

`MessageList` groups left-side thinking records into `work_summary`. `MessageToolGroupSummary` currently creates a thinking row only when `getSafeProviderNarration(subject)` returns safe text. A record with content but no acceptable subject therefore disappears when the group contains no other rows or tools.

#### Required behavior

- Treat provider narration input as untrusted.
- Always produce a thinking-summary row.
- Use the filtered subject when it is safe.
- Otherwise use an existing localized fallback:
  - running: `conversation.thinking.label`
  - completed: `conversation.thinking.complete`
- Preserve running/completed state.
- Mark fallback rows as fallbacks so disclosure behavior remains consistent.
- Mark every thinking row, including a safe-subject row, as excluded from `buildTurnWorkRecap` input.
- Preserve the existing recap rules for failed, single-tool, and multi-tool turns; thinking visibility must not change tool completion semantics.
- Never render `message.content.content` as the fallback.
- Never weaken the command/path narration filter.

#### Expected scope

- `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx`
- `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx`

No new locale key, persistence change, or `MessageList` change is required.

#### Acceptance evidence

- Active subjectless thinking shows the localized running fallback without raw content.
- Completed subjectless thinking remains reachable through the existing disclosure and shows the completed fallback.
- Unsafe command/path subjects fall back safely instead of disappearing.
- Safe subject behavior remains unchanged.
- A failed tool turn remains failed when thinking is present; thinking must not make the close appear partial.
- One successful tool keeps its existing trivial-close behavior when thinking is present.
- Multiple successful tools keep their existing completed recap when thinking is present.
- Safe-subject thinking is also excluded from recap counts and close semantics.
- Raw thinking content is absent from visible text, accessible names/descriptions, and tooltip surfaces.

### 6.3 BUG-032 — Truthful Write-assistant copy

#### Current defect

The Write assistant says it can develop story structure, shot ideas, and prompts. Its only current action is the one-shot **Draft storyboard** command.

#### Required behavior

- The description states only that the assistant drafts a storyboard from the brief.
- Update `conversation.creativeStudio.phase.write.assistantDescription` in all 12 configured locales.
- Leave the provider name, model name, status, action label, and charge disclosure unchanged.
- Do not mention future scene assistance before it exists.

Approved English meaning:

> Draft a storyboard from your brief.

Translations must preserve that narrow meaning rather than transliterating the old promise.

#### Expected scope

- `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json` for all 12 supported locales
- `tests/unit/pages/studio/studioI18n.test.ts`

`AssistantDock.tsx` should not need a behavior change because it already renders the correct key.

#### Ownership dependency

The live `creative-suite-sprint2` worktree currently modifies all 12 conversation locale files and `studioI18n.test.ts`. BUG-032 must therefore remain `WAITING_DEPENDENCY` until one of these two safe paths is available:

1. The Creative Studio owner applies this exact copy-only correction on its own accepted branch; or
2. The owner declares an immutable accepted/frozen head, and BUG-032 starts as a dependent child branch from that literal head.

The Controller must record the donor head and confirm that no later Creative Studio source change occurred before accepting BUG-032. A current-tip `origin/sprint2` branch is not sufficient while the overlapping Creative Studio work remains unintegrated.

The Creative Studio donor currently lives in a separate clone. Safe path 2 therefore requires a local, no-remote-mutation fetch from that clone, proof that the imported object is the exact declared commit, and proof that the current Sprint recovery base is its ancestor before a dependent worktree is created. Immediately before the broad gate, the Controller must recheck the external owner worktree's literal head and clean state; any advance or dirty state returns BUG-032 to `WAITING_DEPENDENCY`.

#### Acceptance evidence

- The old English promise is absent.
- All configured locales contain a non-empty, locale-specific sentence for the key.
- The Studio i18n contract, i18n type generation, and i18n validation pass.
- Existing AssistantDock tests continue to prove that provider/model labels and charge disclosure render unchanged.

Do not independently edit or reconcile these overlapping paths while the Creative Studio owner is active.

### 6.4 BUG-018 — WePrompt provider-error compatibility slice

#### Full defect

The shipped provider-error path loses information in more than one repository:

- AionRS/AionCore can collapse overload, quota, and HTTP 429 into rate limiting and discard retry guidance.
- WePrompt's immediate ACP failure path ignores accepted structured details.
- WePrompt's persistence fallback marks every legacy `USER_LLM_PROVIDER_*` error non-retryable.
- The generic non-retryable UI label says **Needs configuration**, even for transient errors.
- Provider health persistence drops structured classification fields, and downstream model eligibility can treat transient health failures as unavailable/setup-required.

#### Recovery-wave boundary

This wave owns one vertical slice only: **conversation chat-error normalization**.

The WePrompt slice may:

- centralize the retryability and recovery semantics of the 16 provider codes already shipped by AionCore v0.1.56;
- apply that same allowlist to immediate send failures and reloaded persisted messages when those paths contain a supported public provider code;
- stop converting every persisted `USER_LLM_PROVIDER_*` error to `retryable: false`;
- prevent the five transient provider codes from displaying the generic **Needs configuration** label; and
- preserve a valid current `AgentStreamErrorInfo` supplied by the stream path; the immediate HTTP path may use only an exact top-level shipped provider code in this wave.

The slice must not:

- infer overload from free-form text;
- expose raw provider response bodies;
- add or consume retry-delay guidance, because the shipped public envelope has no retry field;
- introduce automatic replay;
- make an old AionCore payload appear more precise than it is;
- parse the bounded provider-response JSON suffix without an exact captured incident fixture;
- change provider-health persistence, model eligibility, Model Settings, provider storage, or provider capability contracts;
- add a new overload/capacity code before AionCore publishes one;
- mark BUG-018 complete.

#### Shipped envelope and provider-code policy

The accepted current envelope is `AgentStreamErrorInfo`: required `message`; optional `code`, `ownership`, `detail`, `workspacePath`, `retryable`, `feedback_recommended`, and recognized `resolution { kind, target }`. No retry-delay field exists in this compatibility slice.

Only these shipped provider codes receive provider semantics:

| Semantics                   | Public codes                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transient; retryable        | `USER_LLM_PROVIDER_RATE_LIMITED`, `USER_LLM_PROVIDER_TIMEOUT`, `USER_LLM_PROVIDER_NETWORK_ERROR`, `USER_LLM_PROVIDER_EMPTY_RESPONSE`, `USER_LLM_PROVIDER_GATEWAY_ERROR`                                                                                                                                                                                                                                                      |
| User/config action required | `USER_LLM_PROVIDER_AUTH_FAILED`, `USER_LLM_PROVIDER_AWS_SSO_EXPIRED`, `USER_LLM_PROVIDER_PERMISSION_DENIED`, `USER_LLM_PROVIDER_BILLING_REQUIRED`, `USER_LLM_PROVIDER_CONFIG_ERROR`, `USER_LLM_PROVIDER_MODEL_NOT_FOUND`, `USER_LLM_PROVIDER_UNSUPPORTED_MODEL`, `USER_LLM_PROVIDER_ENDPOINT_NOT_FOUND`, `USER_LLM_PROVIDER_INVALID_REQUEST`, `USER_LLM_PROVIDER_INVALID_TOOL_SCHEMA`, `USER_LLM_PROVIDER_CONTEXT_TOO_LARGE` |

The central policy returns `ownership: user_llm_provider`, the table-defined retryability, `feedback_recommended: false`, and the table-defined existing resolution where the code supports an unambiguous action. It never derives meaning from message text. For a known code, the policy table is authoritative: an incoming resolution cannot replace the code's recovery action. Malformed or unknown values are discarded by the existing normalizer.

Every free-form top-level `message` and `detail` that enters this new classification path is untrusted. Reuse one common redactor before the value is rendered or persisted, including immediate `parseError(...)` output and reloaded history. Tests place a secret sentinel in the real top-level message for live, immediate, persisted, and DOM paths; hiding only nested response bodies is insufficient evidence.

#### Provider-neutral precedence

1. Recognized structured provider public code from the stream envelope, after ownership validation.
2. On the immediate path, existing typed workspace/team/ACP-disconnected classifications.
3. Exact shipped provider code from the remaining immediate HTTP envelope or persisted record.
4. Other typed transport failures.
5. Unknown status-only failures remain unknown; they do not become provider setup or rate-limit failures.

The immediate HTTP path must not infer provider ownership from an arbitrary `429`, `5xx`, response body, or prose. A structured recognized public code wins over status. The current AionCore detail may contain a bounded JSON provider signal, but no exact sanitized incident fixture exists in this repository; parsing that suffix is therefore a separate evidence-gated follow-up, not part of this wave.

#### Expected WePrompt seams

- `packages/desktop/src/common/chat/chatLib.ts`
- `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx`
- `packages/desktop/src/renderer/pages/conversation/platforms/acp/buildSendFailureError.ts`
- `packages/desktop/src/renderer/pages/conversation/platforms/acp/errorDiagnostics.ts`
- `packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpInitialMessage.ts`
- `packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts`
- `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageTips.tsx`
- `tests/unit/common/chatLib.test.ts`
- `tests/unit/renderer/buildSendFailureError.test.ts`
- `tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx`
- `tests/unit/renderer/conversation/useAcpInitialMessage.dom.test.tsx`
- `tests/unit/renderer/errorDiagnostics.test.ts`
- `tests/unit/renderer/normalizeDbMessage.test.ts`
- `tests/unit/feedback/MessageTipsFeedback.dom.test.tsx`

Prefer existing files and existing localized provider-code titles/bodies. If correcting the generic tag requires edits to the same conversation locale files owned by Creative Studio, sequence that edit behind the same immutable-head dependency as BUG-032. Do not create a new module until the architecture check proves that the policy cannot live coherently in an existing seam. If the slice cannot remain additive, chat-only, and provider-neutral, stop with a handoff rather than broadening it.

#### Acceptance evidence for the compatibility slice

- A recognized, contract-valid structured provider code takes precedence over HTTP status.
- An arbitrary status-only `429` or `5xx` remains unknown upstream and does not acquire provider semantics.
- Persisted rate-limit, timeout, network, empty-response, gateway, and configuration records recover their table-defined retry and recovery semantics.
- The five transient provider codes do not display **Needs configuration**.
- Malformed structured details are ignored safely; unsupported codes remain unknown rather than being treated as provider setup failures.
- Live, immediate HTTP, and reloaded forms converge when supplied the same supported envelope.
- Raw provider bodies and secrets are not rendered or persisted through the new path.
- Provider-health persistence, model eligibility, and settings behavior are unchanged by this slice.

#### Full BUG-018 closure gate

BUG-018 remains open until a separate AionRS/AionCore slice:

- adds provider overload/capacity to the public error and health contracts;
- preserves bounded retry guidance;
- parses recognized provider identity before HTTP status;
- updates ACP structured-data extraction;
- passes backend serialization/classification tests;
- is published into a new accepted AionCore bundle; and
- passes cross-repository live and persistence acceptance in WePrompt.

## 7. Verification and Review

Every bug follows this sequence:

1. Verify exact branch, persisted literal base, plan checksum, worktree cleanliness, and complete path ownership. Ownership checks include committed, staged, unstaged, and untracked intersections and distinguish preserved immutable donors from active owners.
2. Add focused RED coverage for the observed defect.
3. Implement only the minimum behavior needed for GREEN.
4. Run the directly affected tests.
5. Run TypeScript, changed-file formatting, changed-file lint, and `git diff --check`.
6. Run `bun run i18n:types` and `node scripts/check-i18n.js` for any renderer locale/i18n change.
7. Serialize the required repository-wide suite so two worktrees never compete for it.
8. Stage exact paths and create an atomic Conventional Commit.
9. Obtain a fresh independent review against literal base and head commits.
10. If review blocks, correct only the finding, rerun the applicable gates, create a narrow follow-up commit, and re-review the new exact head.

No timeout may be increased, assertion weakened, or failing test skipped merely to make a gate pass.

## 8. Stop Conditions

Pause only the affected lane when:

- the remote Sprint tip changes a path owned by that lane after review begins;
- the proposed fix requires another bug's or epic's owned seam;
- focused RED evidence cannot reproduce the reported behavior;
- a baseline failure cannot be separated from the candidate change;
- a renderer change would expose raw reasoning, provider bodies, secrets, or paths;
- a locale change cannot be validated across all configured languages;
- BUG-018 requires an AionCore schema or bundle change beyond its compatibility boundary;
- an exact-head reviewer returns `BLOCK` and the correction would expand scope;
- disk, dependency, sandbox, or host constraints prevent trustworthy verification.

Record the exact branch, base, head, last green commands, changed paths, blocker, and resume condition. Continue unaffected lanes.

## 9. TODO Reconciliation

After all lanes stop or reach accepted local heads, update the Sprint 2 TODO once from the Controller context:

- Record EPIC-002 as **Deferred — Foundation Partial** with preserved accepted and blocked heads.
- Keep every bug unchecked until its accepted head is integrated into `origin/sprint2`.
- For local candidates, record **implementation accepted locally; integration pending**, with the exact branch and head.
- For BUG-018, distinguish the WePrompt compatibility slice from full cross-repository closure.
- Do not reopen BUG-003 or conflate this work with packaging acceptance.

## 10. Completion State

The autonomous wave is complete when:

- BUG-019, BUG-016, and BUG-032 each have either an independently accepted local head or a complete blocker handoff;
- BUG-018 has either an accepted WePrompt compatibility head or a bounded contract/blocker handoff;
- no broad test jobs remain active;
- all worktrees preserve unrelated state;
- the TODO has been reconciled once with exact evidence; and
- no remote or release action has occurred.

The Controller then reports the ready branches, exact commits, verification totals, review verdicts, blockers, and the next admissible integration step.
