# BUG-018 Structured Provider Failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve overload, quota/rate-limit, authentication/setup, connectivity, and general provider failures from AionCore through health checks, App Operations, and conversation UI.

**Architecture:** Define one strict common failure envelope. Structured provider type has highest precedence; HTTP status is a fallback only when the envelope is absent. Consumers map the canonical category to their own typed states and localized copy without parsing human-readable messages.

**Tech Stack:** strict TypeScript, Zod-style runtime guards, Electron HTTP bridge, App Operations broker, React, Vitest 4, i18next.

## Global Constraints

- Stop and open an AionCore contract dependency if the backend does not emit a stable structured failure field. Do not replace that field with message substring matching.
- Precedence is `structured provider type → transport/connectivity evidence → HTTP fallback → provider_failure`.
- A bare HTTP 429 maps to `quota_or_rate_limit`; a structured `engine_overloaded_error` remains `temporary_overload` even when its HTTP status is 429.
- Respect `Retry-After` only for transient categories, cap automated delay at 30 seconds, and permit at most one bounded retry in the App Operations path.
- Never log response bodies, human-readable provider messages, prompts, credentials, headers, or raw request IDs. Audit only category, status, duration, retry decision, and a sanitized bounded request ID.
- Keep BUG-017 local SQLite/data-access failures out of this provider taxonomy.

---

### Task 1: Define and parse the canonical envelope

**Files:**

- Create: `packages/desktop/src/common/types/provider/providerFailure.ts`
- Create: `tests/unit/providers/providerFailure.test.ts`
- Modify: `packages/desktop/src/common/types/provider/providerApi.ts`
- Modify: `packages/desktop/src/common/adapter/httpBridge.ts`
- Modify: `tests/unit/common-adapter/httpBridge.test.ts`

**Contract:**

```ts
export type ProviderFailureCategory =
  | 'temporary_overload'
  | 'quota_or_rate_limit'
  | 'auth_or_setup'
  | 'connectivity'
  | 'provider_failure';

export type ProviderFailureEnvelope = {
  category: ProviderFailureCategory;
  provider_code?: string;
  http_status?: number;
  retry_after_ms?: number;
  request_id?: string;
};

export const parseProviderFailureEnvelope: (value: unknown) => ProviderFailureEnvelope | undefined;
export const parseRetryAfter: (value: string | null, now?: number) => number | undefined;
```

- [ ] Write failing table tests for Moonshot `engine_overloaded_error` with 429, explicit quota/rate-limit codes, 401/403 setup failures, DNS/timeout connectivity, structured/unstructured 5xx, unknown codes, malformed fields, and a malicious request ID.
- [ ] Test `Retry-After` seconds and HTTP-date formats, past dates, invalid values, negative values, and the 30-second cap.
- [ ] Implement an allowlisted structured-code map. Preserve a bounded provider code and request ID only when they match safe character/length constraints.
- [ ] Extend `ProviderHealthCheckResponse` with `failure?: ProviderFailureEnvelope`; retain legacy `error_kind`, `http_status`, and `message` as read compatibility during rollout, but consumers must prefer `failure` and must not persist raw `message`.
- [ ] Update `httpBridge` to extract the structured response field without logging its body. Transport exceptions may supply `connectivity`; HTTP-only failures use the fallback map.
- [ ] Run:

```bash
bunx vitest run tests/unit/providers/providerFailure.test.ts tests/unit/common-adapter/httpBridge.test.ts
bun run test
```

- [ ] Commit `feat(provider): define structured failure envelope`.

### Task 2: Preserve configured-but-inference-unavailable health

**Files:**

- Modify: `packages/desktop/src/common/config/storage.ts`
- Modify: `packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx`
- Modify: `tests/unit/settings/SettingsModal/ModelModalContent.dom.test.tsx`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/settings.json`
- Regenerate: `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`

**Persisted health shape:**

```ts
type ProviderModelHealth = {
  status: 'unknown' | 'healthy' | 'inference_unavailable' | 'setup_required';
  last_check?: number;
  latency?: number;
  failure?: ProviderFailureEnvelope;
};
```

- [ ] Write failing tests for a configured provider with successful model listing plus failed inference, invalid credentials, connectivity failure, temporary overload, quota, healthy recovery, and restoration after reopening Settings.
- [ ] Migrate legacy persisted `unhealthy` records on read: authentication/configuration kinds become `setup_required`; other failures become `inference_unavailable`; absent evidence remains `unknown`.
- [ ] Store the canonical envelope and safe timestamp/latency only. Stop writing raw error strings into `model_health.error`.
- [ ] Render localized `Configured · inference unavailable` for a valid setup whose probe fails; reserve setup-required copy for authentication/configuration failures.
- [ ] Add distinct localized explanations/actions for overload, quota/rate limit, connectivity, setup, and generic provider failure in every locale.
- [ ] Run:

```bash
bunx vitest run tests/unit/settings/SettingsModal/ModelModalContent.dom.test.tsx tests/unit/providers/providerFailure.test.ts
bun run i18n:types
node scripts/check-i18n.js
bun run test
```

- [ ] Commit `fix(provider): preserve health failure state`.

### Task 3: Consume the envelope in App Operations

**Files:**

- Modify: `packages/desktop/src/common/types/appOperations.ts`
- Modify: `packages/desktop/src/process/services/appOperations/types.ts`
- Modify: `packages/desktop/src/process/services/appOperations/broker.ts`
- Modify: `tests/unit/process/appOperations/broker.test.ts`
- Modify: `tests/unit/process/appOperations/contextCompactTask.test.ts`

**Mapping:**

| Provider category | App Operations result | Retry |
| --- | --- | --- |
| temporary_overload | `provider_overloaded` | One bounded retry, honoring capped `retry_after_ms` |
| quota_or_rate_limit | `provider_rate_limited` | No automatic retry unless explicitly marked transient and delay is bounded |
| auth_or_setup | `provider_auth_failed` | Never |
| connectivity | `provider_connectivity_failed` | One bounded transient retry |
| provider_failure | `provider_request_failed` | Existing conservative policy |

- [ ] Add `provider_overloaded` and `provider_connectivity_failed` to `AppOperationErrorCode`; carry optional `failure` metadata without raw message/body.
- [ ] Write failing tests proving structured overload beats HTTP 429, unstructured 429 falls back to rate-limit, Retry-After is capped, auth never retries, and a second transient failure stops.
- [ ] Replace status-only mapping in `broker.ts` with the shared parser/mapping. Delete no string classifier until every call site has a typed replacement; do not call it from the new path.
- [ ] Update audit tests to assert only category/status/sanitized request ID and retry metadata are emitted. Include secret/prompt/body sentinels and prove none appear in audits.
- [ ] Run:

```bash
bunx vitest run tests/unit/process/appOperations/broker.test.ts tests/unit/process/appOperations/contextCompactTask.test.ts tests/unit/providers/providerFailure.test.ts
bun run test
```

- [ ] Commit `fix(app-operations): respect structured provider failures`.

### Task 4: Map categories to localized conversation failures

**Files:**

- Modify: `packages/desktop/src/common/chat/chatLib.ts`
- Modify: `packages/desktop/src/renderer/utils/model/errorDetection.ts`
- Modify: `tests/unit/common/chatLib.test.ts`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json`
- Regenerate: `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`

- [ ] Write failing tests for structured/unstructured 429, Moonshot overload, GreenNode probe limiting, authentication/setup, DNS/connectivity, and generic 5xx.
- [ ] Add distinct typed user-facing codes for overload, quota/rate limit, setup/auth, connectivity, and generic provider failure. Map structured categories before legacy status fallback.
- [ ] Remove quota/rate-limit message scanning from the canonical path. Keep any legacy text detector isolated for old unstructured records only, with tests proving it cannot override a structured category.
- [ ] Add localized title/body/action copy in all locales. Do not interpolate provider messages; only safe provider/model display names may be shown.
- [ ] Run:

```bash
bunx vitest run tests/unit/common/chatLib.test.ts tests/unit/providers/providerFailure.test.ts
bun run i18n:types
node scripts/check-i18n.js
just check
bun run test
bun run test:coverage
```

- [ ] Commit `fix(conversation): localize provider failure categories`.

## Final Acceptance

- Moonshot overload is never mislabeled as account quota solely because the HTTP status is 429.
- A configured GreenNode provider may show `Configured · inference unavailable` without looking unconfigured.
- Structured provider type wins in health, App Operations, and conversation UI.
- Retry-After handling is bounded and category-aware.
- Audits contain no provider body/message, prompt, secret, credential, header, or raw identifier.
- Legacy unstructured responses retain conservative status fallback without overriding structured evidence.

