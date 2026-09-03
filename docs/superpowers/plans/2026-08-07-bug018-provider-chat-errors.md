# BUG-018 Provider Chat Error Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve correct retry and recovery semantics for the provider error codes already shipped through live chat, ACP send failure, and persisted history without claiming full BUG-018 closure.

**Architecture:** Put one exact public-code policy in the shared chat contract and reuse it from stream normalization, immediate ACP HTTP failures, and persisted-message reconstruction. Unknown future codes remain unclassified, arbitrary HTTP status/prose never becomes provider-owned, and the current UI needs only regression coverage because it already renders structured retryability and recovery actions.

**Tech Stack:** TypeScript strict mode, Electron renderer/common boundary, Vitest 4, React Testing Library.

## Global Constraints

- Execute only in the Controller-created `codex/bug018-provider-errors-ui-r-${S2_SHORT}` worktree at the recorded `S2_BASE`.
- Owned production paths are `chatLib.ts`, `AcpSendBox.tsx`, `buildSendFailureError.ts`, `errorDiagnostics.ts`, `useAcpInitialMessage.ts`, and `Messages/hooks.ts` only.
- Owned tests are `chatLib.test.ts`, `buildSendFailureError.test.ts`, `AcpSendBox.dom.test.tsx`, `useAcpInitialMessage.dom.test.tsx`, `errorDiagnostics.test.ts`, `normalizeDbMessage.test.ts`, and `MessageTipsFeedback.dom.test.tsx` only.
- Do not modify `providerApi.ts`, `storage.ts`, provider health, model eligibility, Model Settings, locale files, AionCore, AionRS, or bundled backend files.
- Do not add provider type, overload code, Retry-After, retry delay, automatic replay, recursive detail parsing, or free-form message inference.
- The immediate HTTP path may classify only an exact shipped top-level provider code. Arbitrary `429`/`5xx` remains unknown upstream.
- The current bounded `Provider response:` JSON suffix has no exact incident fixture in this repository, so parsing it is explicitly excluded from this wave.
- Preserve the stale `codex/bug018-provider-failure-contract@343b725c4` branch unchanged.
- Stop after 90 minutes if RED evidence or the exact shared policy cannot be established; after RED, stop after two additional implementation hours.
- Stop before push, merge request, merge, packaging, release, backend publication, or `TASKS.md` reconciliation.

### Worker bootstrap guard

Before reading or editing source, run:

```bash
BRANCH="$(git branch --show-current)"
RECORDED_BASE="$(git config --get "branch.$BRANCH.codexBase")"
PLAN_PATH="$(git config --get "branch.$BRANCH.codexPlanPath")"
PLAN_SHA="$(git config --get "branch.$BRANCH.codexPlanSha256")"
test -n "$RECORDED_BASE"
test "$(git rev-parse HEAD)" = "$RECORDED_BASE"
test -z "$(git status --porcelain)"
test "$PLAN_PATH" = "/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug018-provider-chat-errors.md"
test "$(shasum -a 256 "$PLAN_PATH" | awk '{print $1}')" = "$PLAN_SHA"
```

Expected: every check exits 0. This branch-scoped metadata is the durable Controller handoff; do not rely on shell variables from another task.

---

### Task 1: Add one exact shipped-code policy

**Files:**

- Modify: `packages/desktop/src/common/chat/chatLib.ts:132-181`
- Modify: `packages/desktop/src/common/chat/chatLib.ts:542-662`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/acp/errorDiagnostics.ts:7-61`
- Modify: `tests/unit/common/chatLib.test.ts:134-251`
- Modify: `tests/unit/common/chatLib.test.ts:410-489`
- Modify: `tests/unit/renderer/errorDiagnostics.test.ts:11-75`

**Interfaces:**

- Consumes: `code: unknown` plus untrusted free-form `message` and optional `detail`.
- Produces: `buildKnownProviderErrorInfo(input): AgentStreamErrorInfo | undefined`; `normalizeAgentStreamError` applies it to live stream errors.

- [ ] **Step 1: Add the public policy matrix test**

Import `buildKnownProviderErrorInfo`, then add this table:

```typescript
const providerPolicyCases = [
  ['USER_LLM_PROVIDER_AUTH_FAILED', false, 'check_provider_credentials'],
  ['USER_LLM_PROVIDER_AWS_SSO_EXPIRED', false, 'check_provider_credentials'],
  ['USER_LLM_PROVIDER_PERMISSION_DENIED', false, 'check_provider_credentials'],
  ['USER_LLM_PROVIDER_BILLING_REQUIRED', false, 'check_provider_billing'],
  ['USER_LLM_PROVIDER_CONFIG_ERROR', false, 'check_provider_base_url'],
  ['USER_LLM_PROVIDER_MODEL_NOT_FOUND', false, 'change_model'],
  ['USER_LLM_PROVIDER_UNSUPPORTED_MODEL', false, 'change_model'],
  ['USER_LLM_PROVIDER_ENDPOINT_NOT_FOUND', false, 'check_provider_base_url'],
  ['USER_LLM_PROVIDER_INVALID_REQUEST', false, undefined],
  ['USER_LLM_PROVIDER_INVALID_TOOL_SCHEMA', false, undefined],
  ['USER_LLM_PROVIDER_CONTEXT_TOO_LARGE', false, 'reduce_context'],
  ['USER_LLM_PROVIDER_RATE_LIMITED', true, 'retry'],
  ['USER_LLM_PROVIDER_TIMEOUT', true, 'retry'],
  ['USER_LLM_PROVIDER_NETWORK_ERROR', true, 'check_provider_base_url'],
  ['USER_LLM_PROVIDER_EMPTY_RESPONSE', true, 'retry'],
  ['USER_LLM_PROVIDER_GATEWAY_ERROR', true, 'retry'],
] as const;

it.each(providerPolicyCases)('applies the shipped policy for %s', (code, retryable, resolutionKind) => {
  const error = buildKnownProviderErrorInfo({ code, message: 'safe display message' });

  expect(error).toMatchObject({
    message: 'safe display message',
    code,
    ownership: 'user_llm_provider',
    retryable,
    feedback_recommended: false,
  });
  expect(error?.resolution?.kind).toBe(resolutionKind);
});
```

- [ ] **Step 2: Add unknown and ownership-safety tests**

```typescript
it('does not invent policy for an unknown future provider code', () => {
  expect(
    buildKnownProviderErrorInfo({
      code: 'USER_LLM_PROVIDER_FUTURE_CAPACITY',
      message: 'safe display message',
    })
  ).toBeUndefined();
});

it('rejects a recognized provider code with contradictory ownership', () => {
  expect(
    normalizeAgentStreamError({
      message: 'safe display message',
      code: 'USER_LLM_PROVIDER_RATE_LIMITED',
      ownership: 'aionui',
    })
  ).toBeUndefined();
});
```

- [ ] **Step 3: Add live-stream convergence tests**

```typescript
it('fills transient provider policy on a live stream error', () => {
  expect(
    normalizeAgentStreamError({
      message: 'Provider limited the request',
      code: 'USER_LLM_PROVIDER_RATE_LIMITED',
      ownership: 'user_llm_provider',
    })
  ).toMatchObject({
    code: 'USER_LLM_PROVIDER_RATE_LIMITED',
    ownership: 'user_llm_provider',
    retryable: true,
    feedback_recommended: false,
    resolution: { kind: 'retry' },
  });
});

it('keeps the code policy authoritative over a contradictory explicit resolution', () => {
  expect(
    normalizeAgentStreamError({
      message: 'Provider limited the request',
      code: 'USER_LLM_PROVIDER_RATE_LIMITED',
      ownership: 'user_llm_provider',
      retryable: false,
      resolution: { kind: 'check_provider_billing', target: 'provider_settings' },
    })
  ).toMatchObject({
    retryable: true,
    resolution: { kind: 'retry' },
  });
});

it('redacts top-level live provider message and detail', () => {
  const error = normalizeAgentStreamError({
    message: 'request failed api_key=TOP_LEVEL_LIVE_SECRET',
    detail: 'Bearer TOP_LEVEL_DETAIL_SECRET',
    code: 'USER_LLM_PROVIDER_RATE_LIMITED',
    ownership: 'user_llm_provider',
  });

  expect(JSON.stringify(error)).not.toContain('TOP_LEVEL_LIVE_SECRET');
  expect(JSON.stringify(error)).not.toContain('TOP_LEVEL_DETAIL_SECRET');
  expect(error?.message).toContain('[REDACTED]');
});

it('does not retain the unredacted live message in outer tip content', () => {
  const message = transformMessage({
    type: 'error',
    conversation_id: 'conversation-1',
    data: {
      message: 'request failed api_key=TOP_LEVEL_STREAM_SECRET',
      code: 'USER_LLM_PROVIDER_RATE_LIMITED',
      ownership: 'user_llm_provider',
    },
  } as IResponseMessage);

  expect(JSON.stringify(message)).not.toContain('TOP_LEVEL_STREAM_SECRET');
  expect(message?.type).toBe('tips');
});
```

- [ ] **Step 4: Run the new policy tests and verify RED**

Run:

```bash
bunx vitest run tests/unit/common/chatLib.test.ts -t "provider"
```

Expected: FAIL because `buildKnownProviderErrorInfo` does not exist and live normalization does not fill the shipped policy.

- [ ] **Step 5: Move the existing free-form redactor into the common chat seam**

Move `REDACTION_RULES` and `redactErrorText` from renderer-only `errorDiagnostics.ts` into `chatLib.ts` as the exported `redactAgentErrorText`. Keep the exact existing patterns and behavior. Change `errorDiagnostics.ts` to import and use that common export, and keep `redactErrorText` as an alias export so existing callers/tests remain compatible:

```typescript
import { redactAgentErrorText } from '@/common/chat/chatLib';

export const redactErrorText = redactAgentErrorText;
```

In `errorDiagnostics.test.ts`, import `redactAgentErrorText` and add a compatibility assertion with a provider-key sentinel proving the renderer alias and common export return the same redacted text. This prevents the two paths from drifting back into separate redaction policies.

Run:

```bash
bunx vitest run tests/unit/renderer/errorDiagnostics.test.ts
```

Expected: all existing redaction and telemetry-summary tests remain green.

- [ ] **Step 6: Add the policy and builder beside the existing normalizers**

Add:

```typescript
type ProviderErrorPolicy = {
  retryable: boolean;
  resolution?: AgentErrorResolution;
};

const PROVIDER_ERROR_POLICIES = {
  USER_LLM_PROVIDER_AUTH_FAILED: {
    retryable: false,
    resolution: { kind: 'check_provider_credentials', target: 'provider_settings' },
  },
  USER_LLM_PROVIDER_AWS_SSO_EXPIRED: {
    retryable: false,
    resolution: { kind: 'check_provider_credentials', target: 'provider_settings' },
  },
  USER_LLM_PROVIDER_PERMISSION_DENIED: {
    retryable: false,
    resolution: { kind: 'check_provider_credentials', target: 'provider_settings' },
  },
  USER_LLM_PROVIDER_BILLING_REQUIRED: {
    retryable: false,
    resolution: { kind: 'check_provider_billing', target: 'provider_settings' },
  },
  USER_LLM_PROVIDER_CONFIG_ERROR: {
    retryable: false,
    resolution: { kind: 'check_provider_base_url', target: 'provider_settings' },
  },
  USER_LLM_PROVIDER_MODEL_NOT_FOUND: {
    retryable: false,
    resolution: { kind: 'change_model', target: 'provider_settings' },
  },
  USER_LLM_PROVIDER_UNSUPPORTED_MODEL: {
    retryable: false,
    resolution: { kind: 'change_model', target: 'provider_settings' },
  },
  USER_LLM_PROVIDER_ENDPOINT_NOT_FOUND: {
    retryable: false,
    resolution: { kind: 'check_provider_base_url', target: 'provider_settings' },
  },
  USER_LLM_PROVIDER_INVALID_REQUEST: { retryable: false },
  USER_LLM_PROVIDER_INVALID_TOOL_SCHEMA: { retryable: false },
  USER_LLM_PROVIDER_CONTEXT_TOO_LARGE: {
    retryable: false,
    resolution: { kind: 'reduce_context' },
  },
  USER_LLM_PROVIDER_RATE_LIMITED: { retryable: true, resolution: { kind: 'retry' } },
  USER_LLM_PROVIDER_TIMEOUT: { retryable: true, resolution: { kind: 'retry' } },
  USER_LLM_PROVIDER_NETWORK_ERROR: {
    retryable: true,
    resolution: { kind: 'check_provider_base_url', target: 'provider_settings' },
  },
  USER_LLM_PROVIDER_EMPTY_RESPONSE: { retryable: true, resolution: { kind: 'retry' } },
  USER_LLM_PROVIDER_GATEWAY_ERROR: { retryable: true, resolution: { kind: 'retry' } },
} as const satisfies Record<string, ProviderErrorPolicy>;

type KnownProviderErrorCode = keyof typeof PROVIDER_ERROR_POLICIES;

const isKnownProviderErrorCode = (value: unknown): value is KnownProviderErrorCode =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER_ERROR_POLICIES, value);

export const buildKnownProviderErrorInfo = ({
  code,
  message,
  detail,
}: {
  code: unknown;
  message: string;
  detail?: string;
}): AgentStreamErrorInfo | undefined => {
  if (!isKnownProviderErrorCode(code)) return undefined;
  const policy: ProviderErrorPolicy = PROVIDER_ERROR_POLICIES[code];
  const safeMessage = redactAgentErrorText(message);
  const safeDetail = detail ? redactAgentErrorText(detail) : undefined;
  return {
    message: safeMessage,
    code,
    ownership: 'user_llm_provider',
    ...(safeDetail ? { detail: safeDetail } : {}),
    retryable: policy.retryable,
    feedback_recommended: false,
    ...(policy.resolution ? { resolution: policy.resolution } : {}),
  };
};
```

- [ ] **Step 7: Apply redaction and the authoritative policy inside `normalizeAgentStreamError`**

After parsing `code`, `ownership`, `detail`, and `resolution`, compute redacted values and call the provider policy without passing the caller's resolution:

```typescript
const safeMessage = redactAgentErrorText(value.message);
const safeDetail = detail ? redactAgentErrorText(detail) : undefined;
const providerError = buildKnownProviderErrorInfo({ code, message: safeMessage, detail: safeDetail });
if (providerError) {
  if (ownership !== undefined && ownership !== 'user_llm_provider') return undefined;
  return {
    ...providerError,
    ...(workspacePath ? { workspacePath } : {}),
  };
}
```

Use `safeMessage` and `safeDetail` in the existing generic normalization return as well, so top-level free-form text never bypasses the redactor. Preserve the already-supported `workspacePath` field, but do not copy `rawError` into newly classified provider errors. The table-defined resolution always wins for a known provider code.

In both `transformMessage` error branches, when `structuredError` exists, set the outer `content.content` to `structuredError.message` rather than the original free-form value. This prevents the same secret from surviving beside a redacted structured envelope. Non-error tips and errors without a recognized structured envelope retain their existing behavior.

- [ ] **Step 8: Run the shared policy and live-message matrix**

Run:

```bash
bunx vitest run tests/unit/common/chatLib.test.ts
```

Expected: all tests pass, including existing non-provider error normalization.

### Task 2: Reuse the exact policy for immediate ACP send failures

**Files:**

- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx:987-1064`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/acp/buildSendFailureError.ts:6-12`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/acp/buildSendFailureError.ts:35-121`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpInitialMessage.ts:164-216`
- Modify: `tests/unit/renderer/buildSendFailureError.test.ts:19-183`
- Modify: `tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx:1717-1782`
- Modify: `tests/unit/renderer/conversation/useAcpInitialMessage.dom.test.tsx:503-541`

**Interfaces:**

- Consumes: `BackendHttpError.code`, status, and the untrusted caller-supplied `parseError(...)` message.
- Produces: provider policy only for an exact shipped top-level code; generic statuses remain unknown upstream.

- [ ] **Step 1: Add direct-code and status-safety tests**

```typescript
it('classifies an exact top-level provider rate-limit code', () => {
  const result = buildSendFailureError(
    httpError(429, 'USER_LLM_PROVIDER_RATE_LIMITED', 'provider limited the request'),
    'The model provider could not complete the request.'
  );

  expect(result).toMatchObject({
    code: 'USER_LLM_PROVIDER_RATE_LIMITED',
    ownership: 'user_llm_provider',
    retryable: true,
    resolution: { kind: 'retry' },
  });
});

it('does not infer provider ownership from an arbitrary 429', () => {
  const result = buildSendFailureError(
    httpError(429, 'TOO_MANY_REQUESTS', 'gateway throttled the request'),
    'The upstream request failed.'
  );

  expect(result).toMatchObject({
    code: 'UNKNOWN_UPSTREAM_ERROR',
    ownership: 'unknown_upstream',
    retryable: true,
  });
});

it('does not inspect provider-shaped prose or nested detail', () => {
  const result = buildSendFailureError(
    httpError(429, 'TOO_MANY_REQUESTS', 'rate limited', {
      error: {
        message: 'sk-test-secret must stay private',
        code: 'USER_LLM_PROVIDER_RATE_LIMITED',
      },
    }),
    'The upstream request failed.'
  );

  expect(result.code).toBe('UNKNOWN_UPSTREAM_ERROR');
  expect(JSON.stringify(result)).not.toContain('sk-test-secret');
});

it('redacts the real top-level backend message before display or persistence', () => {
  const result = buildSendFailureError(
    httpError(429, 'USER_LLM_PROVIDER_RATE_LIMITED', 'api_key=TOP_LEVEL_HTTP_SECRET'),
    'request failed api_key=TOP_LEVEL_HTTP_SECRET'
  );

  expect(JSON.stringify(result)).not.toContain('TOP_LEVEL_HTTP_SECRET');
  expect(result.message).toContain('[REDACTED]');
});

it('keeps typed ACP disconnection ahead of a contradictory provider code', () => {
  const result = buildSendFailureError(
    httpError(502, 'USER_LLM_PROVIDER_RATE_LIMITED', 'ACP protocol is not connected.'),
    'ACP protocol is not connected.'
  );

  expect(result).toMatchObject({
    code: 'USER_AGENT_DISCONNECTED',
    ownership: 'user_agent',
  });
});
```

Add one rejection test to each send surface using a `BackendHttpError` whose exact code is `USER_LLM_PROVIDER_RATE_LIMITED` and whose top-level `error` is `request failed api_key=TOP_LEVEL_SEND_SECRET`. In the `AcpSendBox` test, also cover `USER_LLM_PROVIDER_AUTH_FAILED` with prose containing `authentication failed` plus the sentinel, proving the legacy prose-based ACP-auth branch cannot bypass the structured provider path. After the send fails, inspect the `tips` object passed to `addOrUpdateMessageMock` / `addOrUpdateMessage` and assert:

```typescript
expect(JSON.stringify(persistedTip)).not.toContain('TOP_LEVEL_SEND_SECRET');
expect(JSON.stringify(persistedTip)).toContain('[REDACTED]');
expect(persistedTip.content.error).toMatchObject({
  code: 'USER_LLM_PROVIDER_RATE_LIMITED',
  retryable: true,
});
```

These are persistence-boundary tests: both `content.content` and `content.error` must be safe before `addOrUpdateMessage(..., true)`.

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
bunx vitest run tests/unit/renderer/buildSendFailureError.test.ts -t "provider|arbitrary 429|nested detail|top-level backend|ACP disconnection"
bunx vitest run --project dom \
  tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx \
  tests/unit/renderer/conversation/useAcpInitialMessage.dom.test.tsx \
  -t "top-level provider secret"
```

Expected: direct provider code currently falls through to the internal bucket, arbitrary 429 is not normalized as unknown upstream, and the top-level secret remains visible.

- [ ] **Step 3: Redact the caller-supplied message once at function entry**

Import `redactAgentErrorText` from `chatLib`, compute `const safeMessage = redactAgentErrorText(message)`, and use `safeMessage` for every returned `message` and `detail` in this function. Existing ordinary copy remains byte-identical; secrets, email addresses, and user-path segments use the existing redaction contract.

- [ ] **Step 4: Classify exact provider codes after typed ACP disconnection and before generic upstream fallbacks**

Import `buildKnownProviderErrorInfo` from `chatLib`. Preserve the current workspace, transport, team, and `isAgentDisconnectedError(error)` branches first. Immediately after the disconnected-agent branch, add:

```typescript
if (isBackendHttpError(error)) {
  const providerError = buildKnownProviderErrorInfo({
    code: error.code,
    message: safeMessage,
    detail: safeMessage,
  });
  if (providerError) return providerError;
}
```

- [ ] **Step 5: Make status-only failures unknown**

Replace the existing `BAD_GATEWAY` branch with:

```typescript
if (isBackendHttpError(error) && (error.code === 'BAD_GATEWAY' || error.status === 429 || error.status >= 500)) {
  return {
    message: safeMessage,
    code: 'UNKNOWN_UPSTREAM_ERROR',
    ownership: 'unknown_upstream',
    detail: safeMessage,
    retryable: true,
    feedback_recommended: true,
  };
}
```

Do not read `error.details` or `error.body` in this new path.

- [ ] **Step 6: Run the complete immediate-failure matrix**

In both `AcpSendBox.tsx` and `useAcpInitialMessage.ts`, build the structured failure once after the busy-conflict early return:

```typescript
const sendFailure = buildSendFailureError(error, errorMessageText);
```

Use `errorMessageText` in `useAcpInitialMessage.ts` and the existing `errorMsg` name in `AcpSendBox.tsx`. Use `sendFailure.message` for the ordinary `markSendFailed` reason and for `content.content`, and store the same `sendFailure` object in `content.error`. In `AcpSendBox.tsx`, preserve the archived-conversation branch, but allow the legacy prose-based ACP-auth branch only when `sendFailure.ownership !== 'user_llm_provider'`; a known provider auth code must use the structured, redacted provider tip. In `useAcpInitialMessage.ts`, replace the inner catch's raw `console.error(..., error)` payload and raw `errorMessageText` detail with `buildRawErrorSummary(error)` and `sendFailure.message`. This ensures the persisted outer content and the touched diagnostic path cannot retain the unredacted `parseError(...)` value beside a safe structured envelope.

Run:

```bash
bunx vitest run tests/unit/renderer/buildSendFailureError.test.ts
bunx vitest run --project dom \
  tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx \
  tests/unit/renderer/conversation/useAcpInitialMessage.dom.test.tsx
```

Expected: all tests pass; ACP-disconnected, busy, workspace, transport, and redaction behavior remains unchanged.

### Task 3: Correct persisted provider semantics and visible tags

**Files:**

- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts:678-789`
- Modify: `tests/unit/renderer/normalizeDbMessage.test.ts:71-176`
- Modify: `tests/unit/feedback/MessageTipsFeedback.dom.test.tsx:69-106`
- Modify: `tests/unit/feedback/MessageTipsFeedback.dom.test.tsx:352-410`

**Interfaces:**

- Consumes: persisted `effectiveCode`, untrusted persisted message content, and the shared provider policy.
- Produces: table-defined semantics for known codes; unknown future provider prefixes receive no invented retryability or recovery action.

- [ ] **Step 1: Add persisted known/unknown regression tests**

```typescript
it('restores retry policy for a persisted provider rate-limit failure', () => {
  const normalized = normalizeDbMessage({
    id: 'provider-rate-limit',
    type: 'tips',
    conversation_id: 'conversation-1',
    position: 'center',
    status: 'error',
    content: JSON.stringify({
      content: 'The model provider could not complete the request.',
      type: 'error',
      source: 'send_failed',
      code: 'USER_LLM_PROVIDER_RATE_LIMITED',
    }),
  } as unknown as IMessageTips) as IMessageTips;

  expect(normalized.content.error).toMatchObject({
    code: 'USER_LLM_PROVIDER_RATE_LIMITED',
    ownership: 'user_llm_provider',
    retryable: true,
    resolution: { kind: 'retry' },
  });
});

it('prefers a recognized persisted domain code over BAD_GATEWAY', () => {
  const normalized = normalizeDbMessage({
    id: 'provider-domain-code',
    type: 'tips',
    conversation_id: 'conversation-1',
    position: 'center',
    status: 'error',
    content: JSON.stringify({
      content: 'The model provider could not complete the request.',
      type: 'error',
      source: 'send_failed',
      code: 'BAD_GATEWAY',
      structuredContent: { domainCode: 'USER_LLM_PROVIDER_BILLING_REQUIRED' },
    }),
  } as unknown as IMessageTips) as IMessageTips;

  expect(normalized.content.error).toMatchObject({
    code: 'USER_LLM_PROVIDER_BILLING_REQUIRED',
    retryable: false,
    resolution: { kind: 'check_provider_billing', target: 'provider_settings' },
  });
});

it('does not force unknown future provider codes to non-retryable', () => {
  const normalized = normalizeDbMessage({
    id: 'provider-future-code',
    type: 'tips',
    conversation_id: 'conversation-1',
    position: 'center',
    status: 'error',
    content: JSON.stringify({
      content: 'The model provider could not complete the request.',
      type: 'error',
      source: 'send_failed',
      code: 'USER_LLM_PROVIDER_FUTURE_CAPACITY',
    }),
  } as unknown as IMessageTips) as IMessageTips;

  expect(normalized.content.error).toMatchObject({
    code: 'USER_LLM_PROVIDER_FUTURE_CAPACITY',
    ownership: 'user_llm_provider',
  });
  expect(normalized.content.error?.retryable).toBeUndefined();
  expect(normalized.content.error?.resolution).toBeUndefined();
});

it('redacts a provider secret in the real persisted top-level content', () => {
  const normalized = normalizeDbMessage({
    id: 'provider-secret',
    type: 'tips',
    conversation_id: 'conversation-1',
    position: 'center',
    status: 'error',
    content: JSON.stringify({
      content: 'request failed api_key=TOP_LEVEL_PERSISTED_SECRET',
      type: 'error',
      source: 'send_failed',
      code: 'USER_LLM_PROVIDER_RATE_LIMITED',
    }),
  } as unknown as IMessageTips) as IMessageTips;

  expect(JSON.stringify(normalized.content)).not.toContain('TOP_LEVEL_PERSISTED_SECRET');
  expect(normalized.content.error?.message).toContain('[REDACTED]');
  expect(normalized.content.content).toBe(normalized.content.error?.message);
});
```

- [ ] **Step 2: Add the visible transient-tag regression**

Import `normalizeDbMessage` from `Messages/hooks.ts`, normalize a persisted record first, and then render the resulting message. Do not inject an already-correct `AgentStreamErrorInfo`, because that is green before this fix.

```typescript
it('shows Retryable rather than Needs configuration for a provider rate limit', () => {
  const persisted = normalizeDbMessage({
    id: 'provider-rate-limit-dom',
    type: 'tips',
    conversation_id: 'conversation-1',
    position: 'center',
    status: 'error',
    content: JSON.stringify({
      content: 'request failed api_key=TOP_LEVEL_DOM_SECRET',
      type: 'error',
      source: 'send_failed',
      code: 'USER_LLM_PROVIDER_RATE_LIMITED',
    }),
  } as unknown as IMessageTips) as IMessageTips;

  render(<MessageTips message={persisted} />);

  expect(screen.getByText('Retryable')).toBeInTheDocument();
  expect(screen.queryByText('Needs configuration')).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('TOP_LEVEL_DOM_SECRET');
});
```

- [ ] **Step 3: Run the persisted/UI regressions and verify RED**

Run:

```bash
bunx vitest run \
  tests/unit/renderer/normalizeDbMessage.test.ts \
  tests/unit/feedback/MessageTipsFeedback.dom.test.tsx \
  -t "provider"
```

Expected: persisted rate-limit/domain-code and normalized DOM tests fail because the current fallback forces every provider prefix to `retryable: false` and evaluates `BAD_GATEWAY` too early; the top-level persisted secret test also fails.

- [ ] **Step 4: Reuse the shared builder before generic persisted fallbacks**

Import `buildKnownProviderErrorInfo` and `redactAgentErrorText` into `Messages/hooks.ts`. At the start of `classifyPersistedSendFailure`, compute `safeMessage = redactAgentErrorText(message)` and use it for every returned `message` and `detail` in that classifier. Immediately after computing `effectiveCode`, add:

```typescript
const providerError = buildKnownProviderErrorInfo({
  code: effectiveCode,
  message: safeMessage,
  detail: safeMessage,
});
if (providerError) return providerError;
```

This must run before the persisted `BAD_GATEWAY` branch.

In `normalizeDbTipsMessage`, when an error `structuredError` exists, set the returned outer `content.content` to `structuredError.message`; otherwise keep `parsed.content`. This removes the unredacted duplicate from the normalized history object while preserving non-error and unstructured legacy behavior.

- [ ] **Step 5: Replace the provider-prefix blanket policy**

Replace the current `retryable: false` branch with:

```typescript
if (effectiveCode?.startsWith('USER_LLM_PROVIDER_')) {
  return {
    message: safeMessage,
    code: effectiveCode,
    ownership: 'user_llm_provider',
    detail: safeMessage,
  };
}
```

Do not add retryability, feedback recommendation, or resolution for an unknown future code.

- [ ] **Step 6: Run the complete focused chat-error matrix**

Run:

```bash
bunx vitest run \
  tests/unit/common/chatLib.test.ts \
  tests/unit/renderer/buildSendFailureError.test.ts \
  tests/unit/renderer/errorDiagnostics.test.ts \
  tests/unit/renderer/normalizeDbMessage.test.ts
bunx vitest run --project dom \
  tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx \
  tests/unit/renderer/conversation/useAcpInitialMessage.dom.test.tsx \
  tests/unit/feedback/MessageTipsFeedback.dom.test.tsx
```

Expected: all tests pass. No production change to `MessageTips.tsx` or any locale file is required.

### Task 4: Verify, commit, and hand off the partial closure

**Files:**

- Modify: the thirteen owned files listed above only.

**Interfaces:**

- Consumes: focused-green chat-error candidate.
- Produces: one local exact head labeled as a WePrompt chat compatibility slice, not full BUG-018 closure.

- [ ] **Step 1: Format and statically verify exact files**

Run:

```bash
bunx oxfmt --write \
  packages/desktop/src/common/chat/chatLib.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/buildSendFailureError.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/errorDiagnostics.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpInitialMessage.ts \
  packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts \
  tests/unit/common/chatLib.test.ts \
  tests/unit/renderer/buildSendFailureError.test.ts \
  tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx \
  tests/unit/renderer/conversation/useAcpInitialMessage.dom.test.tsx \
  tests/unit/renderer/errorDiagnostics.test.ts \
  tests/unit/renderer/normalizeDbMessage.test.ts \
  tests/unit/feedback/MessageTipsFeedback.dom.test.tsx
bunx oxfmt --check \
  packages/desktop/src/common/chat/chatLib.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/buildSendFailureError.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/errorDiagnostics.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpInitialMessage.ts \
  packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts \
  tests/unit/common/chatLib.test.ts \
  tests/unit/renderer/buildSendFailureError.test.ts \
  tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx \
  tests/unit/renderer/conversation/useAcpInitialMessage.dom.test.tsx \
  tests/unit/renderer/errorDiagnostics.test.ts \
  tests/unit/renderer/normalizeDbMessage.test.ts \
  tests/unit/feedback/MessageTipsFeedback.dom.test.tsx
bunx oxlint \
  packages/desktop/src/common/chat/chatLib.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/buildSendFailureError.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/errorDiagnostics.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpInitialMessage.ts \
  packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts \
  tests/unit/common/chatLib.test.ts \
  tests/unit/renderer/buildSendFailureError.test.ts \
  tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx \
  tests/unit/renderer/conversation/useAcpInitialMessage.dom.test.tsx \
  tests/unit/renderer/errorDiagnostics.test.ts \
  tests/unit/renderer/normalizeDbMessage.test.ts \
  tests/unit/feedback/MessageTipsFeedback.dom.test.tsx
bunx tsc --noEmit
bun run i18n:types
node scripts/check-i18n.js
git diff --check
```

Expected: all commands exit 0 and no unowned file is modified.

- [ ] **Step 2: Hand the focused/static-green candidate to the Controller**

Report branch, literal base, dirty paths, focused totals, static results, elapsed BUG-018 time, and the unimplemented AionCore/AionRS/Retry-After boundary. Wait for the serialized full-suite token.

- [ ] **Step 3: Run the full suite when authorized**

Run:

```bash
bun run test
```

Expected: exit 0. Record passed/skipped totals.

- [ ] **Step 4: Stage exactly thirteen files and commit**

Run:

```bash
git add \
  packages/desktop/src/common/chat/chatLib.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/buildSendFailureError.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/errorDiagnostics.ts \
  packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpInitialMessage.ts \
  packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts \
  tests/unit/common/chatLib.test.ts \
  tests/unit/renderer/buildSendFailureError.test.ts \
  tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx \
  tests/unit/renderer/conversation/useAcpInitialMessage.dom.test.tsx \
  tests/unit/renderer/errorDiagnostics.test.ts \
  tests/unit/renderer/normalizeDbMessage.test.ts \
  tests/unit/feedback/MessageTipsFeedback.dom.test.tsx
git diff --cached --check
git commit -m "fix(conversation): preserve provider error semantics"
```

Expected: one atomic commit and clean tracked status.

- [ ] **Step 5: Freeze the exact head and preserve the open boundary**

Run:

```bash
git status --short
git rev-parse HEAD
BRANCH="$(git branch --show-current)"
RECORDED_BASE="$(git config --get "branch.$BRANCH.codexBase")"
test -n "$RECORDED_BASE"
test "$(git merge-base "$RECORDED_BASE" HEAD)" = "$RECORDED_BASE"
git diff --name-status "$RECORDED_BASE"...HEAD
```

Expected: only the thirteen owned files differ from `RECORDED_BASE`. The handoff must say that provider overload identity, quota identity, Retry-After, provider health, model eligibility, and bundled-backend acceptance remain open under BUG-018.
