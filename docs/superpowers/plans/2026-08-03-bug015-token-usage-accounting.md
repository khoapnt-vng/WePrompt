# BUG-015 Token Usage Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show truthful current-conversation context occupancy and truthful Today/Week/Month token consumption for AionRS and ACP, including Kimi models with unknown context limits.

**Architecture:** Define separate common contracts for occupancy snapshots and per-turn consumption events. Runtime adapters normalize only source-appropriate events, a versioned local ledger deduplicates consumption by canonical event ID, and the UI renders quality (`authoritative`, `estimated`, or `unavailable`) rather than converting missing data to zero.

**Tech Stack:** strict TypeScript, React hooks, localStorage ledger, AionRS/ACP event adapters, Vitest 4, Arco UI, i18next.

## Global Constraints

- Current-conversation occupancy is a point-in-time snapshot; Today/Week/Month consumption is a sum of per-turn input/output events. Never add occupancy snapshots to the local ledger.
- Exact `0` is valid only when an authoritative event explicitly reports zero. No events means `unavailable`.
- Never invent a Kimi context limit. Use runtime/provider metadata when present; otherwise keep the limit/percentage unknown while still showing the accessible circle and consumption totals.
- Deduplicate consumption by stable `usageEventId` across tools, retries, stream replays, conversation switches, and app restarts.
- Read legacy `last_token_usage`, `last_context_limit`, and v1 ledger data as `estimated`; stop writing those fields after the new contract lands.
- If ACP does not expose canonical per-turn consumption, stop and open a backend/runtime contract dependency. Do not infer consumption from `acp_context_usage.used`.

---

### Task 1: Define occupancy and consumption contracts

**Files:**

- Create: `packages/desktop/src/common/types/platform/tokenUsage.ts`
- Create: `tests/unit/common-platform/tokenUsage.test.ts`
- Modify: `packages/desktop/src/common/config/storage.ts`

**Contract:**

```ts
export type UsageQuality = 'authoritative' | 'estimated' | 'unavailable';

export type ContextOccupancySnapshot = {
  quality: UsageQuality;
  usedTokens?: number;
  contextLimit?: number;
  capturedAt: number;
  source: 'aionrs_runtime' | 'acp_runtime' | 'conversation_estimator' | 'legacy';
};

export type TurnTokenConsumption = {
  usageEventId: string;
  conversationId: string;
  turnId: string;
  providerId?: string;
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
  occurredAt: number;
  quality: Exclude<UsageQuality, 'unavailable'>;
};
```

- [ ] Write failing parser/guard tests for authoritative zero, missing values, negative/NaN values, unknown limit, estimated occupancy, duplicate event ID, and partial input/output fields.
- [ ] Require both input and output counts for an authoritative consumption event. A source that explicitly defines a missing side as zero may normalize it to zero in its adapter; the common guard must not guess.
- [ ] Replace persisted `last_token_usage`/`last_context_limit` writes with `last_context_occupancy?: ContextOccupancySnapshot`; keep legacy fields optional for read migration only.
- [ ] Run `bunx vitest run tests/unit/common-platform/tokenUsage.test.ts`; expect failure before the types/guards exist and pass after implementation.
- [ ] Run `bun run test` and commit `feat(usage): define canonical token usage contract`.

### Task 2: Upgrade the local consumption ledger

**Files:**

- Modify: `packages/desktop/src/renderer/pages/conversation/utils/localTokenUsage.ts`
- Modify: `packages/desktop/src/renderer/hooks/useLocalTokenUsage.ts`
- Modify: `tests/unit/renderer/conversation/localTokenUsage.test.ts`
- Modify: `tests/unit/renderer/conversation/useLocalTokenUsage.dom.test.tsx`

**Ledger v2:**

```ts
type LocalTokenUsageLedger = {
  version: 2;
  events: Array<TurnTokenConsumption | LegacyEstimatedTokenConsumption>;
};

type UsageWindowTotal = { quality: UsageQuality; tokens?: number };
type LocalTokenUsageSummary = {
  today: UsageWindowTotal;
  weekToDate: UsageWindowTotal;
  monthToDate: UsageWindowTotal;
};
```

- [ ] Write failing tests for no events (`unavailable`), authoritative zero (`authoritative`, `tokens: 0`), exact sums, mixed authoritative/estimated events (`estimated`), duplicate IDs, time boundaries, retention, corrupt storage, storage failure, and cross-restart replay.
- [ ] Migrate eligible v1 rows into a private tagged legacy-estimated variant without inventing canonical conversation/turn IDs. Drop every known diagnostic `:estimate:` occupancy row and keep v1 intact.
- [ ] Keep the 40-day retention and Monday week boundary. Reject future, negative, malformed, or duplicate events.
- [ ] Keep legacy numeric APIs isolated until their consumers move. Add semantic canonical consumption APIs and compare value and quality for each window, including `undefined` tokens.
- [ ] Run:

```bash
bunx vitest run tests/unit/renderer/conversation/localTokenUsage.test.ts tests/unit/renderer/conversation/useLocalTokenUsage.dom.test.tsx
bun run test
```

- [ ] Commit `fix(usage): persist source-aware local consumption`.

### Task 3: Normalize AionRS usage without conflating it

**Files:**

- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/useAionrsMessage.ts`
- Modify: `tests/unit/renderer/useAionrsMessage.dom.test.ts`

- [ ] Runtime discovery stop rule: current AionRS/AionCore exposes neither a stable per-turn consumption delta nor a supported authoritative finish-occupancy event. Ignore finish input/output accounting and emit no AionRS ledger record.
- [ ] Write failing tests for diagnostic occupancy, lower occupancy after compaction, complete/partial/malformed finish usage as an accounting no-op, canonical/legacy restoration precedence, delayed hydration, conversation switch/unmount, and ordered persistence failure/recovery.
- [ ] Treat the existing diagnostic token estimate only as `ContextOccupancySnapshot { quality: 'estimated', source: 'conversation_estimator' }`; never record it in the ledger.
- [ ] Persist/restore `last_context_occupancy`, migrate legacy values as estimated only when the canonical field is absent, and stop writing `last_token_usage`.
- [ ] Protect UI hydration with conversation generation/live revision, and serialize durable occupancy PATCHes FIFO per conversation so lower post-compaction values remain last across failures and remounts.
- [ ] Run `bunx vitest run tests/unit/renderer/useAionrsMessage.dom.test.ts tests/unit/common-platform/tokenUsage.test.ts tests/unit/renderer/conversation/localTokenUsage.test.ts` followed by `bun run test`.
- [ ] Commit `fix(aionrs): separate context occupancy from turn usage`.

### Task 4: Normalize ACP occupancy and require per-turn consumption

**Files:**

- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts`
- Modify: `tests/unit/renderer/useAcpMessage.dom.test.ts`

- [ ] Write failing tests proving `acp_context_usage { used, size }` updates occupancy only and never changes Today/Week/Month.
- [ ] Define the accepted canonical ACP terminal usage payload with stable event/turn ID plus explicit input/output counts; add tests for replay, retries, authoritative zero, missing side, and malformed events.
- [ ] If the current ACP/AionCore protocol has no such event, stop this task after the occupancy-only regression test and file the precise backend contract dependency. Do not add a heuristic ledger record.
- [ ] When the canonical event exists, record one authoritative `TurnTokenConsumption` and deduplicate through ledger v2.
- [ ] Persist/restore ACP occupancy via `last_context_occupancy`; read old `last_token_usage`/`last_context_limit` as estimated once and stop writing them.
- [ ] Run `bunx vitest run tests/unit/renderer/useAcpMessage.dom.test.ts tests/unit/common-platform/tokenUsage.test.ts tests/unit/renderer/conversation/localTokenUsage.test.ts` followed by `bun run test`.
- [ ] Commit `fix(acp): record canonical turn usage` only when the runtime contract is real; otherwise attach the blocked dependency evidence without a speculative commit.

### Task 5: Render occupancy and consumption quality honestly

**Files:**

- Modify: `packages/desktop/src/renderer/components/agent/ContextUsageIndicator.tsx`
- Modify: `tests/unit/renderer/conversation/ContextUsageIndicator.dom.test.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`
- Modify: the ACP send-box component that passes `ContextUsageIndicator` props
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json`
- Regenerate: `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`

- [ ] Write failing UI tests for authoritative occupancy with known limit, estimated occupancy, unknown limit, unavailable occupancy, authoritative zero totals, no totals, mixed estimated totals, model switch, conversation switch, keyboard popover, and live-region threshold changes.
- [ ] Keep the context circle visible for unknown/unavailable occupancy. Show a determinate percentage only when both used tokens and a valid limit exist; otherwise render an accessible unknown-state ring.
- [ ] Label the upper section `Context window` and its quality. Label Today/Week/Month as `Token consumption`; render `Unavailable` for missing totals and `Estimated` for mixed/legacy totals.
- [ ] Never display `0` from a default object. Display `0` only for `{ quality: 'authoritative', tokens: 0 }`.
- [ ] Resolve limits from canonical runtime/provider metadata for Qwen/Kimi. If a Kimi model remains unmapped, show unknown rather than a guessed percentage.
- [ ] Add all copy in every locale, then run:

```bash
bunx vitest run tests/unit/renderer/conversation/ContextUsageIndicator.dom.test.tsx tests/unit/renderer/useAionrsMessage.dom.test.ts tests/unit/renderer/useAcpMessage.dom.test.ts tests/unit/renderer/conversation/localTokenUsage.test.ts tests/unit/renderer/conversation/useLocalTokenUsage.dom.test.tsx
bun run i18n:types
node scripts/check-i18n.js
just check
bun run test
bun run test:coverage
```

- [ ] Commit `fix(conversation): label token usage quality`.

## Final Acceptance

- The composer circle reports current-conversation occupancy only.
- Today/Week/Month report deduplicated per-turn consumption only.
- Missing data is unavailable; authoritative zero and estimates are visibly distinct.
- AionRS diagnostics never inflate consumption totals.
- ACP occupancy events never enter the ledger; ACP totals require a canonical terminal event.
- Qwen/Kimi, AionRS/ACP, known/unknown limits, restarts, switches, retries, and replay cases pass.
