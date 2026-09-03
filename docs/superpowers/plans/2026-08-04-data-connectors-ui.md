# Data Connectors UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users a branded "Data Connectors" panel in Settings → Tools that presents the already-shipping M365 and FDL MCP servers under human names, with connection status and a one-click Connect (OAuth) action.

**Architecture:** Pure UX layer over existing machinery. The two connectors already ship as builtin OAuth-protected HTTP MCP servers (`BUILTIN_HTTP_MCP_SERVERS` in `common/config/builtinSeed.ts:67`, seeded by `process/utils/seedBuiltinProviders.ts:443`), and aioncore already owns the whole OAuth flow (browser + PKCE + DCR + token storage) behind `mcpService.loginMcpOAuth` / `checkOAuthStatus`, already wrapped by `renderer/hooks/mcp/useMcpOAuth.ts`. This plan adds: a catalog mapping builtin server **name** → display identity, a pure status-derivation function, a hook composing the two existing hooks, and card/panel components. **No new IPC endpoints, no main-process code, no credential handling.**

**Tech Stack:** React + Arco Design, UnoCSS utility classes with semantic tokens, `@icon-park/react` icons, i18n via react-i18next, Vitest 4.

---

## Why this is only UX (read before starting)

Verified during the design spikes (see `docs/superpowers/specs/2026-08-04-data-connectors-design.md`):

- Both endpoints support **RFC 7591 Dynamic Client Registration** + PKCE S256 + public clients, so aioncore's `client_id`-less login works untouched. FDL rides VNG's Obot gateway (`aigw.vng.vn`); M365 fronts its own AS.
- `conversation.create` posts **directly** from renderer to aioncore, and builtin servers are `enabled: true`, so connectors already reach new conversations through the existing `selected_mcp_server_ids` path. **Do not add injection code.**
- Users' actual problem: these appear as raw rows named `tse-datahub` and `outlook-advanced` in a power-user screen. This plan fixes naming, status clarity, and placement.

**Design dependency:** Tasks 1–4 are presentation-independent (data + logic + hook) and safe to build before the designer's screens land. Tasks 5–6 are visual; if screens arrive first, follow them for layout/copy and keep the props contract from Task 5.

**Already satisfied — do not build:** the spec's "locked row in the raw MCP screen" requirement is met by existing `builtin` handling (`McpServerHeader.tsx:204` gates row actions behind `!server.builtin`), so both connector rows are already non-editable there. Task 7 only verifies it.

## Connector identities (confirmed with the feature owner)

| Catalog id | Builtin server name | Shows as | Covers |
| --- | --- | --- | --- |
| `fdl` | `tse-datahub` | FDL — Foundational Data Layer | company data platform (e.g. HR headcount) |
| `m365` | `outlook-advanced` | Microsoft 365 | email, calendar, meeting rooms |

## File structure

New directory `packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/` (ToolsSettings has 6 children → 7; the new dir holds 9, both within the ≤10 guideline — re-verify on your base branch):

| File | Responsibility |
| --- | --- |
| `catalog.ts` | Catalog data + types: maps builtin server name → display identity. No logic. |
| `catalog.test.ts` | Drift guard: every `serverName` exists in `BUILTIN_HTTP_MCP_SERVERS`. |
| `connectorStatus.ts` | **Pure** derivation: (catalog, servers, oauthStatus, loggingIn, loading) → `ConnectorView[]`. |
| `connectorStatus.test.ts` | Full state matrix. The bulk of the coverage. |
| `useDataConnectors.ts` | Composes `useMcpServers` + `useMcpOAuth` + derivation; exposes `connect`. |
| `ConnectorCard.tsx` | Presentational card for one connector. |
| `ConnectorCard.test.tsx` | Renders each state; asserts actions. |
| `ConnectorsPanel.tsx` | Section header + card grid. |
| `index.ts` | Public exports. |

Modified: `ToolsSettings/index.tsx` (render the panel), plus locale files.

---

### Task 0: Branch and green baseline

**Files:** none (setup)

- [ ] **Step 1: Create the branch from a fresh base**

```bash
git fetch origin && git checkout -b feat/data-connectors-ui origin/sprint1
bun install
```

- [ ] **Step 2: Confirm a green baseline and the directory counts**

```bash
bun run test 2>&1 | tail -5
echo "ToolsSettings: $(ls packages/desktop/src/renderer/pages/settings/ToolsSettings | wc -l)"
```

Expected: tests pass; ToolsSettings shows 6 entries. A red gate in a fresh tree usually means stale `node_modules` — re-run `bun install` before believing failures.

- [ ] **Step 3: Confirm the builtin seed names still match this plan**

```bash
grep -n "name:" packages/desktop/src/common/config/builtinSeed.ts | sed -n '1,12p'
```

Expected: `tse-datahub` and `outlook-advanced` appear inside `BUILTIN_HTTP_MCP_SERVERS`. If either was renamed, update Task 1's catalog accordingly — Task 1's test will catch a mismatch anyway.

---

### Task 1: Connector catalog

**Files:**
- Create: `packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/catalog.ts`
- Create: `packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_HTTP_MCP_SERVERS } from '@/common/config/builtinSeed';
import { CONNECTOR_CATALOG } from './catalog';

describe('CONNECTOR_CATALOG', () => {
  it('covers both shipped connectors', () => {
    expect(CONNECTOR_CATALOG.map((c) => c.id).toSorted()).toEqual(['fdl', 'm365']);
  });

  // Drift guard: renaming a seed in builtinSeed.ts would silently orphan a card.
  it('every serverName matches a builtin seed', () => {
    const seeded = BUILTIN_HTTP_MCP_SERVERS.map((s) => s.name);
    for (const connector of CONNECTOR_CATALOG) {
      expect(seeded).toContain(connector.serverName);
    }
  });

  it('uses unique ids and serverNames', () => {
    expect(new Set(CONNECTOR_CATALOG.map((c) => c.id)).size).toBe(CONNECTOR_CATALOG.length);
    expect(new Set(CONNECTOR_CATALOG.map((c) => c.serverName)).size).toBe(CONNECTOR_CATALOG.length);
  });

  it('pairs each id with the expected server name', () => {
    expect(CONNECTOR_CATALOG.find((c) => c.id === 'fdl')?.serverName).toBe('tse-datahub');
    expect(CONNECTOR_CATALOG.find((c) => c.id === 'm365')?.serverName).toBe('outlook-advanced');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/catalog.test.ts`

Expected: FAIL — cannot resolve `./catalog`.

- [ ] **Step 3: Implement the catalog**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Presentation metadata for the data-source connectors WePrompt ships.
 *
 * These do NOT define servers — the servers are builtin MCP rows seeded from
 * `BUILTIN_HTTP_MCP_SERVERS` (common/config/builtinSeed.ts) and authenticated by
 * aioncore's MCP OAuth. This catalog only maps a builtin server *name* to the
 * human identity shown on the card, so users see "Microsoft 365" instead of
 * "outlook-advanced". Display copy itself lives in i18n under
 * `settings.connectors.catalog.<id>`.
 */

/** Icon identity resolved to an @icon-park component in ConnectorCard. */
export type ConnectorIconKey = 'mail' | 'database';

export type ConnectorDefinition = {
  /** Stable catalog id; also the i18n key segment. */
  id: string;
  /** Builtin MCP server name this card presents. */
  serverName: string;
  iconKey: ConnectorIconKey;
};

export const CONNECTOR_CATALOG: readonly ConnectorDefinition[] = [
  { id: 'fdl', serverName: 'tse-datahub', iconKey: 'database' },
  { id: 'm365', serverName: 'outlook-advanced', iconKey: 'mail' },
];

```

- [ ] **Step 4: Run to verify it passes**

Run: `bunx vitest run packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/catalog.test.ts`

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/catalog.ts packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/catalog.test.ts
git commit -m "feat(connectors): catalog mapping builtin MCP servers to display identities"
```

---

### Task 2: Pure status derivation

**Files:**
- Create: `packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/connectorStatus.ts`
- Create: `packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/connectorStatus.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';
import type { McpOAuthStatus } from '@/renderer/hooks/mcp/useMcpOAuth';
import type { ConnectorDefinition } from './catalog';
import { deriveConnectors } from './connectorStatus';

const CATALOG: ConnectorDefinition[] = [
  { id: 'fdl', serverName: 'tse-datahub', iconKey: 'database' },
  { id: 'm365', serverName: 'outlook-advanced', iconKey: 'mail' },
];

const server = (name: string, overrides: Partial<IMcpServer> = {}): IMcpServer =>
  ({
    id: `id-${name}`,
    name,
    enabled: true,
    builtin: true,
    transport: { type: 'http', url: `https://example.test/${name}` },
    original_json: '{}',
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }) as IMcpServer;

const oauth = (overrides: Partial<McpOAuthStatus> = {}): McpOAuthStatus => ({
  isAuthenticated: false,
  needsLogin: false,
  isChecking: false,
  ...overrides,
});

describe('deriveConnectors', () => {
  it('reports checking for every connector while servers are still loading', () => {
    const views = deriveConnectors(CATALOG, [], {}, {}, true);
    expect(views.map((v) => v.state)).toEqual(['checking', 'checking']);
  });

  it('reports unavailable when no builtin row exists', () => {
    const views = deriveConnectors(CATALOG, [], {}, {}, false);
    expect(views.every((v) => v.state === 'unavailable')).toBe(true);
    expect(views[0].serverId).toBeNull();
  });

  it('reports connected when the row is authenticated', () => {
    const views = deriveConnectors(
      CATALOG,
      [server('tse-datahub')],
      { 'id-tse-datahub': oauth({ isAuthenticated: true }) },
      {},
      false
    );
    const fdl = views.find((v) => v.id === 'fdl')!;
    expect(fdl.state).toBe('connected');
    expect(fdl.serverId).toBe('id-tse-datahub');
  });

  it('reports needs_login when the row exists but is not authenticated', () => {
    const views = deriveConnectors(CATALOG, [server('tse-datahub')], {}, {}, false);
    expect(views.find((v) => v.id === 'fdl')!.state).toBe('needs_login');
  });

  it('reports checking while an oauth status probe is in flight', () => {
    const views = deriveConnectors(
      CATALOG,
      [server('tse-datahub')],
      { 'id-tse-datahub': oauth({ isChecking: true }) },
      {},
      false
    );
    expect(views.find((v) => v.id === 'fdl')!.state).toBe('checking');
  });

  it('reports disabled for a toggled-off row even when authenticated', () => {
    const views = deriveConnectors(
      CATALOG,
      [server('tse-datahub', { enabled: false })],
      { 'id-tse-datahub': oauth({ isAuthenticated: true }) },
      {},
      false
    );
    expect(views.find((v) => v.id === 'fdl')!.state).toBe('disabled');
  });

  it('marks busy while a login is in flight and surfaces probe errors', () => {
    const views = deriveConnectors(
      CATALOG,
      [server('tse-datahub')],
      { 'id-tse-datahub': oauth({ error: 'network down' }) },
      { 'id-tse-datahub': true },
      false
    );
    const fdl = views.find((v) => v.id === 'fdl')!;
    expect(fdl.busy).toBe(true);
    expect(fdl.error).toBe('network down');
  });

  it('preserves catalog order and ignores unrelated servers', () => {
    const views = deriveConnectors(CATALOG, [server('aionui-web-search')], {}, {}, false);
    expect(views.map((v) => v.id)).toEqual(['fdl', 'm365']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/connectorStatus.test.ts`

Expected: FAIL — cannot resolve `./connectorStatus`.

- [ ] **Step 3: Implement the derivation**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IMcpServer } from '@/common/config/storage';
import type { McpOAuthStatus } from '@/renderer/hooks/mcp/useMcpOAuth';
import type { ConnectorDefinition, ConnectorIconKey } from './catalog';

export type ConnectorState = 'checking' | 'unavailable' | 'disabled' | 'connected' | 'needs_login';

export type ConnectorView = {
  id: string;
  iconKey: ConnectorIconKey;
  serverName: string;
  /** Resolved builtin row id, or null when the row is missing. */
  serverId: string | null;
  state: ConnectorState;
  /** A login round-trip is in flight (aioncore waits up to 120s for the browser). */
  busy: boolean;
  /** Last status-probe error, surfaced as a hint rather than a state. */
  error?: string;
};

/**
 * Derives one view per catalog entry. Pure — all inputs come from
 * `useMcpServers` and `useMcpOAuth`, so every state is unit-testable.
 *
 * State precedence is deliberate: a row that is missing or disabled can never
 * read as "connected" even if a stale token exists for its URL, because a
 * disabled row is not attached to new conversations.
 */
export function deriveConnectors(
  catalog: readonly ConnectorDefinition[],
  servers: IMcpServer[],
  oauthStatus: Record<string, McpOAuthStatus>,
  loggingIn: Record<string, boolean>,
  serversLoading: boolean
): ConnectorView[] {
  return catalog.map((connector) => {
    const server = servers.find((candidate) => candidate.name === connector.serverName);
    const status = server ? oauthStatus[server.id] : undefined;
    const base = {
      id: connector.id,
      iconKey: connector.iconKey,
      serverName: connector.serverName,
      serverId: server?.id ?? null,
      busy: server ? Boolean(loggingIn[server.id]) : false,
      error: status?.error,
    };

    if (serversLoading) return { ...base, state: 'checking' as const };
    if (!server) return { ...base, state: 'unavailable' as const };
    if (!server.enabled) return { ...base, state: 'disabled' as const };
    if (status?.isChecking) return { ...base, state: 'checking' as const };
    if (status?.isAuthenticated) return { ...base, state: 'connected' as const };
    return { ...base, state: 'needs_login' as const };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bunx vitest run packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/connectorStatus.test.ts`

Expected: 8 passed.

- [ ] **Step 5: Verify `McpOAuthStatus` is exported as a type**

Run: `grep -n "export interface McpOAuthStatus" packages/desktop/src/renderer/hooks/mcp/useMcpOAuth.ts`

Expected: a match at line 5. If it is not exported, add `export` to the interface in that file and include it in this commit.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/connectorStatus.ts packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/connectorStatus.test.ts
git commit -m "feat(connectors): pure status derivation for connector cards"
```

---

### Task 3: i18n keys

**Files:**
- Modify: the `settings` locale module for every language in `packages/desktop/src/common/config/i18n-config.json`

- [ ] **Step 1: Find the locale files and the settings module layout**

```bash
cat packages/desktop/src/common/config/i18n-config.json
ls locales/
```

Follow the `i18n` skill (`.claude/skills/i18n/SKILL.md`) for module placement and the translation workflow. Add English first, then the other languages per that skill's documented flow.

- [ ] **Step 2: Add the keys (en-US shown; mirror into every language)**

Under `settings.connectors`:

```json
{
  "title": "Data connectors",
  "description": "Connect company data sources so the assistant can use them in new chats.",
  "newChatsHint": "Connecting applies to new chats. Chats already open keep their current tools.",
  "action": {
    "connect": "Connect",
    "reconnect": "Reconnect"
  },
  "state": {
    "connected": "Connected",
    "needsLogin": "Not connected",
    "checking": "Checking…",
    "disabled": "Turned off",
    "unavailable": "Unavailable"
  },
  "hint": {
    "disabled": "This source is turned off in MCP servers below.",
    "unavailable": "This source is not installed on this device.",
    "signingIn": "Waiting for sign-in in your browser…"
  },
  "loginSuccess": "{{name}} connected",
  "loginFailed": "Could not connect {{name}}: {{error}}",
  "catalog": {
    "fdl": {
      "name": "FDL — Foundational Data Layer",
      "description": "Query company datasets, such as HR headcount."
    },
    "m365": {
      "name": "Microsoft 365",
      "description": "Search and act on your email, calendar, and meeting rooms."
    }
  }
}
```

- [ ] **Step 3: Regenerate types and validate**

```bash
bun run i18n:types
node scripts/check-i18n.js
```

Expected: both succeed with no missing-key or extra-key errors.

- [ ] **Step 4: Commit**

```bash
git add locales/ packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts
git commit -m "feat(i18n): data connector panel strings"
```

---

### Task 4: `useDataConnectors` hook

**Files:**
- Create: `packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/useDataConnectors.ts`
- Create: `packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/useDataConnectors.test.ts`

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';

const servers: IMcpServer[] = [
  {
    id: 'id-tse-datahub',
    name: 'tse-datahub',
    enabled: true,
    builtin: true,
    transport: { type: 'http', url: 'https://example.test/fdl' },
    original_json: '{}',
    created_at: 0,
    updated_at: 0,
  } as IMcpServer,
];

const login = vi.fn().mockResolvedValue({ success: true });
const checkMultipleServers = vi.fn().mockResolvedValue(undefined);
const checkOAuthStatus = vi.fn().mockResolvedValue(undefined);

vi.mock('@/renderer/hooks/mcp', () => ({
  useMcpServers: () => ({ mcpServers: servers, isMcpServersLoading: false }),
  useMcpOAuth: () => ({
    oauthStatus: {},
    loggingIn: {},
    login,
    checkMultipleServers,
    checkOAuthStatus,
  }),
}));

const { useDataConnectors } = await import('./useDataConnectors');

beforeEach(() => {
  login.mockClear();
  checkMultipleServers.mockClear();
  checkOAuthStatus.mockClear();
});

describe('useDataConnectors', () => {
  it('returns one view per catalog entry and probes status for resolved rows only', async () => {
    const { result } = renderHook(() => useDataConnectors());
    expect(result.current.connectors.map((c) => c.id)).toEqual(['fdl', 'm365']);
    await waitFor(() => expect(checkMultipleServers).toHaveBeenCalledTimes(1));
    expect(checkMultipleServers.mock.calls[0][0].map((s: IMcpServer) => s.name)).toEqual(['tse-datahub']);
  });

  it('connect() logs in the matching server and re-probes its status', async () => {
    const { result } = renderHook(() => useDataConnectors());
    await act(async () => {
      await result.current.connect('fdl');
    });
    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0][0].name).toBe('tse-datahub');
    expect(checkOAuthStatus).toHaveBeenCalled();
  });

  it('connect() on an unavailable connector does nothing', async () => {
    const { result } = renderHook(() => useDataConnectors());
    await act(async () => {
      await result.current.connect('m365');
    });
    expect(login).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/useDataConnectors.test.ts`

Expected: FAIL — cannot resolve `./useDataConnectors`.

- [ ] **Step 3: Implement the hook**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMcpOAuth, useMcpServers } from '@/renderer/hooks/mcp';
import { CONNECTOR_CATALOG } from './catalog';
import { deriveConnectors, type ConnectorView } from './connectorStatus';

export type UseDataConnectors = {
  connectors: ConnectorView[];
  /** Starts aioncore's OAuth flow (opens the system browser). No-op when unavailable. */
  connect: (connectorId: string) => Promise<{ success: boolean; error?: string } | null>;
};

/**
 * Presents the builtin connector servers as branded cards. Owns no auth state:
 * aioncore performs the OAuth flow and stores the tokens; `useMcpOAuth` only
 * reports status.
 */
export function useDataConnectors(): UseDataConnectors {
  const { mcpServers, isMcpServersLoading } = useMcpServers();
  const { oauthStatus, loggingIn, login, checkMultipleServers, checkOAuthStatus } = useMcpOAuth();

  const connectorServers = useMemo(
    () => mcpServers.filter((server) => CONNECTOR_CATALOG.some((entry) => entry.serverName === server.name)),
    [mcpServers]
  );

  // Probe once per resolved row set. A ref keeps StrictMode's double-invoke and
  // unrelated re-renders from re-probing (each probe is a network round-trip).
  const probedKeyRef = useRef<string>('');
  useEffect(() => {
    const key = connectorServers
      .map((server) => server.id)
      .toSorted()
      .join(',');
    if (!key || key === probedKeyRef.current) return;
    probedKeyRef.current = key;
    void checkMultipleServers(connectorServers);
  }, [connectorServers, checkMultipleServers]);

  const connectors = useMemo(
    () => deriveConnectors(CONNECTOR_CATALOG, mcpServers, oauthStatus, loggingIn, isMcpServersLoading),
    [mcpServers, oauthStatus, loggingIn, isMcpServersLoading]
  );

  const connect = useCallback(
    async (connectorId: string) => {
      const entry = CONNECTOR_CATALOG.find((candidate) => candidate.id === connectorId);
      const server = entry ? connectorServers.find((candidate) => candidate.name === entry.serverName) : undefined;
      if (!server) return null;
      const result = await login(server);
      // Re-derive from the authoritative source rather than trusting the login
      // result, so a partial/expired grant still shows as not connected.
      await checkOAuthStatus(server);
      return result;
    },
    [connectorServers, login, checkOAuthStatus]
  );

  return { connectors, connect };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bunx vitest run packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/useDataConnectors.test.ts`

Expected: 3 passed.

- [ ] **Step 5: Confirm the hooks barrel exports what this imports**

Run: `grep -n "useMcpServers\|useMcpOAuth" packages/desktop/src/renderer/hooks/mcp/index.ts`

Expected: both are re-exported. If not, import them from their own modules instead and update the test's `vi.mock` path to match.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/useDataConnectors.ts packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/useDataConnectors.test.ts
git commit -m "feat(connectors): hook composing MCP server list and OAuth status"
```

---

### Task 5: `ConnectorCard`

**Files:**
- Create: `packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/ConnectorCard.tsx`
- Create: `packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/ConnectorCard.test.tsx`

- [ ] **Step 1: Verify the icon component names exist**

```bash
grep -rn "export.*\bMail\b\|export.*\bDatabase\b" node_modules/@icon-park/react/es/all.d.ts | head -5
```

Expected: both `Mail` and `Database` are exported. If a name differs, pick an existing export and use it in Step 3 — the `iconKey` indirection means only this file changes.

- [ ] **Step 2: Write the failing test**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorView } from './connectorStatus';
import ConnectorCard from './ConnectorCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const view = (overrides: Partial<ConnectorView> = {}): ConnectorView => ({
  id: 'fdl',
  iconKey: 'database',
  serverName: 'tse-datahub',
  serverId: 'id-1',
  state: 'needs_login',
  busy: false,
  ...overrides,
});

describe('ConnectorCard', () => {
  it('shows the localized name, description and a Connect action when not connected', () => {
    render(<ConnectorCard connector={view()} onConnect={vi.fn()} />);
    expect(screen.getByText('settings.connectors.catalog.fdl.name')).toBeTruthy();
    expect(screen.getByText('settings.connectors.catalog.fdl.description')).toBeTruthy();
    expect(screen.getByText('settings.connectors.action.connect')).toBeTruthy();
  });

  it('never shows the raw MCP server name', () => {
    render(<ConnectorCard connector={view()} onConnect={vi.fn()} />);
    expect(screen.queryByText('tse-datahub')).toBeNull();
  });

  it('shows connected state and a Reconnect action', () => {
    render(<ConnectorCard connector={view({ state: 'connected' })} onConnect={vi.fn()} />);
    expect(screen.getByText('settings.connectors.state.connected')).toBeTruthy();
    expect(screen.getByText('settings.connectors.action.reconnect')).toBeTruthy();
  });

  it('shows a hint and no action when unavailable', () => {
    render(<ConnectorCard connector={view({ state: 'unavailable', serverId: null })} onConnect={vi.fn()} />);
    expect(screen.getByText('settings.connectors.hint.unavailable')).toBeTruthy();
    expect(screen.queryByText('settings.connectors.action.connect')).toBeNull();
  });

  it('shows a hint and no action when disabled', () => {
    render(<ConnectorCard connector={view({ state: 'disabled' })} onConnect={vi.fn()} />);
    expect(screen.getByText('settings.connectors.hint.disabled')).toBeTruthy();
    expect(screen.queryByText('settings.connectors.action.connect')).toBeNull();
  });

  it('shows the signing-in hint while busy', () => {
    render(<ConnectorCard connector={view({ busy: true })} onConnect={vi.fn()} />);
    expect(screen.getByText('settings.connectors.hint.signingIn')).toBeTruthy();
  });

  it('calls onConnect with the connector id', async () => {
    const onConnect = vi.fn();
    render(<ConnectorCard connector={view()} onConnect={onConnect} />);
    screen.getByText('settings.connectors.action.connect').click();
    expect(onConnect).toHaveBeenCalledWith('fdl');
  });
});
```

- [ ] **Step 3: Run to verify it fails, then implement the card**

Run: `bunx vitest run packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/ConnectorCard.test.tsx` → FAIL (module not found).

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button, Tag } from '@arco-design/web-react';
import { Database, Mail } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectorIconKey } from './catalog';
import type { ConnectorView } from './connectorStatus';

const K = 'settings.connectors';

/**
 * Rendered inline rather than through a component map: icon-park's prop types
 * make a `Record<key, ComponentType<…>>` map fragile to assign to, and a switch
 * keeps the icon set explicit.
 */
const renderIcon = (iconKey: ConnectorIconKey): React.ReactNode =>
  iconKey === 'mail' ? <Mail theme='outline' size={22} /> : <Database theme='outline' size={22} />;

/** States where connecting is possible; others are informational only. */
const ACTIONABLE: ReadonlySet<ConnectorView['state']> = new Set(['needs_login', 'connected']);

const ConnectorCard: React.FC<{ connector: ConnectorView; onConnect: (connectorId: string) => void }> = ({
  connector,
  onConnect,
}) => {
  const { t } = useTranslation();
  const { id, iconKey, state, busy, error } = connector;

  return (
    <div
      data-testid={`connector-card-${id}`}
      className='flex flex-col gap-12px rounded-8px border border-solid border-base p-16px'
    >
      <div className='flex items-start gap-12px'>
        {renderIcon(iconKey)}
        <div className='flex flex-col gap-4px'>
          <span className='text-14px font-semibold'>{t(`${K}.catalog.${id}.name`)}</span>
          <span className='text-12px text-t-secondary'>{t(`${K}.catalog.${id}.description`)}</span>
        </div>
      </div>

      <div className='flex items-center gap-8px'>
        <Tag size='small' color={state === 'connected' ? 'green' : undefined}>
          {t(`${K}.state.${state === 'needs_login' ? 'needsLogin' : state}`)}
        </Tag>
        {busy && <span className='text-12px text-t-secondary'>{t(`${K}.hint.signingIn`)}</span>}
      </div>

      {state === 'unavailable' && <span className='text-12px text-t-secondary'>{t(`${K}.hint.unavailable`)}</span>}
      {state === 'disabled' && <span className='text-12px text-t-secondary'>{t(`${K}.hint.disabled`)}</span>}
      {error && <span className='text-12px text-t-secondary'>{error}</span>}

      {ACTIONABLE.has(state) && (
        <div>
          <Button
            type={state === 'connected' ? 'default' : 'primary'}
            size='small'
            loading={busy}
            onClick={() => onConnect(id)}
          >
            {t(`${K}.action.${state === 'connected' ? 'reconnect' : 'connect'}`)}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ConnectorCard;
```

Utility classes must resolve to real semantic tokens — verify `border-base`, `text-t-secondary` exist in `uno.config.ts` and substitute the project's actual token names if they differ. Never hardcode colour values.

- [ ] **Step 4: Run to verify it passes**

Run: `bunx vitest run packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/ConnectorCard.test.tsx`

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/ConnectorCard.tsx packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/ConnectorCard.test.tsx
git commit -m "feat(connectors): connector card component"
```

---

### Task 6: Panel and Settings wiring

**Files:**
- Create: `packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/ConnectorsPanel.tsx`
- Create: `packages/desktop/src/renderer/pages/settings/ToolsSettings/connectors/index.ts`
- Modify: `packages/desktop/src/renderer/pages/settings/ToolsSettings/index.tsx`

- [ ] **Step 1: Implement the panel**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { Message } from '@arco-design/web-react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ConnectorCard from './ConnectorCard';
import { useDataConnectors } from './useDataConnectors';

const K = 'settings.connectors';

/**
 * Branded presentation of the builtin data-source MCP servers. Sits above raw
 * MCP management: the same servers remain visible there for power users.
 */
const ConnectorsPanel: React.FC = () => {
  const { t } = useTranslation();
  const { connectors, connect } = useDataConnectors();

  const handleConnect = useCallback(
    async (connectorId: string) => {
      const name = t(`${K}.catalog.${connectorId}.name`);
      const result = await connect(connectorId);
      if (!result) return;
      if (result.success) Message.success(t(`${K}.loginSuccess`, { name }));
      else Message.error(t(`${K}.loginFailed`, { name, error: result.error ?? '' }));
    },
    [connect, t]
  );

  return (
    <div data-testid='connectors-panel' className='flex flex-col gap-12px'>
      <div className='flex flex-col gap-4px'>
        <span className='text-15px font-semibold'>{t(`${K}.title`)}</span>
        <span className='text-12px text-t-secondary'>{t(`${K}.description`)}</span>
        <span className='text-12px text-t-secondary'>{t(`${K}.newChatsHint`)}</span>
      </div>
      <div className='grid grid-cols-1 gap-12px md:grid-cols-2'>
        {connectors.map((connector) => (
          <ConnectorCard key={connector.id} connector={connector} onConnect={handleConnect} />
        ))}
      </div>
    </div>
  );
};

export default ConnectorsPanel;
```

- [ ] **Step 2: Add the barrel**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
export { default as ConnectorsPanel } from './ConnectorsPanel';
export { CONNECTOR_CATALOG } from './catalog';
export type { ConnectorDefinition, ConnectorIconKey } from './catalog';
export { deriveConnectors } from './connectorStatus';
export type { ConnectorState, ConnectorView } from './connectorStatus';
export { useDataConnectors } from './useDataConnectors';
```

- [ ] **Step 3: Render it in ToolsSettings above raw MCP management**

In `ToolsSettings/index.tsx`, add the import and place the panel between the header and `<ToolsModalContent />`:

```tsx
import { ConnectorsPanel } from './connectors';
```

```tsx
        <SettingsPageHeader
          data-testid='tools-header'
          title={t('settings.tools', { defaultValue: 'Tools' })}
          description={t('settings.toolsDescription', {
            defaultValue: 'Configure MCP servers and built-in tools such as image generation.',
          })}
        />
        <ConnectorsPanel />
        <ToolsModalContent />
```

Placement above MCP management answers the designer brief's Q1 with the default; if the returned screens specify a tab instead, move the render site and keep every component unchanged.

- [ ] **Step 4: Typecheck and run the settings tests**

```bash
bunx tsc --noEmit
bunx vitest run packages/desktop/src/renderer/pages/settings/
```

Expected: no type errors; existing settings tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/settings/ToolsSettings/
git commit -m "feat(connectors): data connectors panel in Tools settings"
```

---

### Task 7: Full gates and manual smoke

- [ ] **Step 1: Run every gate**

```bash
bun run lint:fix && bun run format
bunx tsc --noEmit
bun run test
bun run i18n:types && node scripts/check-i18n.js
```

Expected: all green. Lint *warnings* are pre-existing and do not indicate failure — judge by exit code. Load-sensitive vitest timeouts under concurrent sessions are artifacts; re-run before believing them.

- [ ] **Step 2: Manual smoke against the real endpoints**

Launch dev and open Settings → Tools. Verify:

1. Two cards render with human names ("FDL — Foundational Data Layer", "Microsoft 365"); the strings `tse-datahub` / `outlook-advanced` appear nowhere on them.
2. Status starts as *Checking…* then resolves to *Not connected* (assuming no prior grant).
3. Click **Connect** on FDL → the system browser opens VNG's sign-in → after completing it the card flips to *Connected*. FDL's gateway is VPN-gated; connect while on VPN.
4. Cancel a browser sign-in → the card returns to *Not connected* and a failure message shows (aioncore caps the wait at ~120s, so allow for that).
5. Toggle the `tse-datahub` server off in MCP servers below → its card shows *Turned off* with the hint, and no Connect button.
6. Start a **new** chat and confirm the connector's tools are available; an already-open chat is unchanged (frozen MCP set — expected).
7. In MCP servers below, confirm both connector rows still render **without** edit/delete actions (existing `builtin` gating at `McpServerHeader.tsx:204`) — i.e. the two surfaces cannot fight over the same row.

- [ ] **Step 3: Record the smoke result and stop**

```bash
git status  # everything committed
```

Do **not** push — pushing is `just push`, and only when explicitly asked.

---

## Deferred / out of scope

- **Disconnect from the card.** `useMcpOAuth.logout` exists, but "disconnect" semantics (old chats keep working until tokens age out) need the designer's confirm-dialog copy. Add after screens land.
- **Account identity on the card** ("connected as user@vng.com.vn"). No current endpoint returns the authenticated principal; would need an aioncore addition.
- **Connector-specific tool lists.** Requires a completed login to enumerate; revisit once the M365 endpoint's real tool surface is confirmed.
- **Third-party/user-added connectors**, KB ingestion, per-chat toggles, org-pushed catalogs.

## Follow-ups tracked elsewhere (not blockers)

- Ask **khoapnt-vng** who operates the two endpoints, for the card's support/escalation story.
- Confirm the M365 endpoint's actual tool surface matches the "email, calendar, meeting rooms" description before shipping that copy publicly.
