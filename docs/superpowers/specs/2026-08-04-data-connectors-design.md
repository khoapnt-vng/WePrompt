# Data Connectors — Design Spec

**Date:** 2026-08-04
**Status:** ⚠ **REVISED after S1/S2 spikes (2026-08-04)** — the auth architecture below was
rewritten; see "Spike findings" and "Revised architecture". Implementation plan not yet written.
**Priority:** Next — no sprint commitment
**Companion:** `2026-08-04-data-connectors-designer-brief.md` (UI design requested in parallel)

## Spike findings (2026-08-04) — read this first

Two spikes ran against the code and the pinned aioncore binary. Both passed, and both
**shrink** the feature substantially.

### S1 — Injection seam: FOUND, but not in the main process

- `conversation.create` is `httpPost('/api/conversations')` (`ipcBridge.ts:213`) — a **direct
  renderer→aioncore HTTP call**. There is **no main-process interception point** at
  conversation create.
- The real seam is in the renderer: `useGuidSend.ts:261-262` (aionrs) and `:313-316` (ACP)
  pass `extra.selected_mcp_server_ids` and `extra.selected_session_mcp_servers`.
- Exact precedent — the Knowledge Base: `projectKnowledgeService.getSessionMcpServer()`
  (`projectKnowledgeService.ts:921`) returns a full `ISessionMcpServer` **including secrets
  in `env`** (`embedApiKey`), main process → renderer → posted to aioncore; `withKbServer()`
  merges it at create time.
- **Consequence:** the original claim "tokens never leave the main process; materialize
  `{{token}}` in main at conversation create" is **not achievable**. Either secrets transit
  the renderer in memory (KB precedent), or WP holds no tokens at all (S2 — chosen).

### S2 — Headers supported, and aioncore already owns MCP OAuth

- Header support confirmed: `IMcpServerTransportSSE | HTTP | StreamableHTTP` all carry
  `headers?: Record<string, string>` (`storage.ts:627-643`), and
  `normalizeTransportForBackend` preserves headers when collapsing `streamable_http`→`http`
  (`renderer/hooks/mcp/catalog.ts:43`). stdio carries `env`.
- **aioncore already implements the full MCP OAuth flow**, exposed as
  `mcpService.checkOAuthStatus | loginMcpOAuth | logoutMcpOAuth | getAuthenticatedServers`
  (`ipcBridge.ts:1090-1093`), already consumed by an existing hook
  (`renderer/hooks/mcp/useMcpOAuth.ts`) wired into `McpManagement.tsx` and
  `ToolsModalContent.tsx`.
- Verified against the local binary (**aioncore 0.1.44**; package pin is **v0.1.50** — dev
  lags, so the capability exists on both sides of the skew): routes
  `/api/mcp/oauth/login`, `/check-status`, `/logout`, `/authenticated` all present.
  Embedded strings show a spec-compliant implementation — "Opening browser for OAuth
  authorization", "Discovered OAuth metadata via RFC 8414", "…via OIDC",
  `code_challenge` + `code_challenge_method` + `redirect_uri` + `state`, loopback
  `127.0.0.1:0` (ephemeral port), "no redirect received within **120s**",
  "OAuth token deleted / No OAuth token to delete (idempotent)".
- Token storage: aioncore's SQLite holds **`oauth_tokens`** and `mcp_servers` tables — i.e.
  **aioncore owns connector credentials**, not WePrompt.
- Constraint: OAuth applies to **URL transports only** (`getOAuthServerUrl` returns null for
  stdio), so M365 must be a remote MCP URL.

### What this deletes from the original design

`ConnectorAuthService.ts`, `oauthPkceFlow.ts`, Electron `safeStorage` credential storage,
refresh-token logic, and `{{token}}` launch-time materialization — **the entire proposed
main-process service**. The rejected "server-managed auth" approach is what the platform
already does; the feature converges to *curated catalog UI + aioncore's existing OAuth*.

### Two MCP stores exist (placement decision)

`ensureBackendMcpCatalog` (`catalog.ts:70`) merges **user servers from aioncore**
(`/api/mcp/servers`) with **builtin servers from local client settings** (`mcp.config`).
Connector rows must be **aioncore user-server rows** so OAuth-by-URL works, flagged
`builtin: true` — that flag already means "hide edit/delete in UI" (`storage.ts:663`),
which delivers the locked-row requirement with an existing mechanism.

## Summary

A curated **Data Connectors** settings surface lets users connect external data sources —
Microsoft 365 and FDL (VNG's Foundational Data Layer) — so the agent can query them live
in chat. Connectors are a friendly, branded layer over the existing MCP machinery: connect
once (OAuth in the system browser, tokens encrypted at rest), and every **new**
conversation gets the source's tools through the same MCP wiring, freezing, and aioncore
execution that exists today.

## Decisions (settled during brainstorming)

| Question | Decision |
| --- | --- |
| FDL | Foundational Data Layer — VNG internal data platform |
| Function | Live tools in chat (MCP tool calls); no KB ingestion in v1 |
| Server scope | UI only — MCP servers for both sources exist elsewhere; building servers is out of scope |
| Auth | ~~WP-managed OAuth~~ → **delegated to aioncore's existing MCP OAuth** (`loginMcpOAuth`); `token` type as per-connector fallback (FDL until its IdP is confirmed) — revised by S2 |
| Connection scope | Global per-user (Settings-level); applies to conversations created after connect |
| Approach | A — curated catalog over the existing MCP registry (chosen over raw-MCP presets and native connector clients) |

## Revised architecture & connect flow (post-spike)

```text
CATALOG      Bundled definitions (data, no secrets):
             { id: 'm365', name, icon, description,
               server: { transport: { type: 'http', url } },   // no {{token}} for OAuth
               auth: { type: 'mcp-oauth' }                     // aioncore drives it
                  or { type: 'header-token', headerName, label, helpUrl } }  // FDL fallback

CONNECT      mcp-oauth:  ensure the aioncore server row exists (mcpService.createServer,
             builtin:true) → mcpService.loginMcpOAuth({ server_url }) → aioncore opens the
             system browser, runs PKCE + loopback, stores the token in its oauth_tokens
             table → poll mcpService.checkOAuthStatus for the badge
             header-token: user pastes the key → stored in the server row's transport
             headers (same trust level as the KB's embedApiKey precedent — disclose in UI)

STATUS       Derived: server row present (listServers) + URL in getAuthenticatedServers
             = connected; row without auth = needs reconnect; no row = not connected

USE          The row is enabled, so existing conversation-create wiring picks it up via
             selected_mcp_server_ids — no new injection code, no token materialization

DISCONNECT   mcpService.logoutMcpOAuth (idempotent per binary strings) + deleteServer
```

WePrompt stores **no credentials** in this design. Its job is the catalog, the branded
cards, the status derivation, and calling four existing endpoints.

## Original architecture & connect flow (superseded — kept for rationale)

```text
CATALOG      Bundled connector definitions (data, not code):
             { id: 'm365', name, icon, description,
               server: { transport: 'http', url, headers: { Authorization: 'Bearer {{token}}' } }
                    or { transport: 'stdio', command, args, env: { FDL_TOKEN: '{{token}}' } },
               auth: { type: 'oauth-pkce', authorizationEndpoint, tokenEndpoint, clientId, scopes }
                    or { type: 'token', label, helpUrl } }

CONNECT      Settings → Data Connectors → card → [Connect]
             oauth-pkce: main process starts a single-use loopback listener on
             127.0.0.1:<random>, opens the system browser (shell.openExternal),
             exchanges code + PKCE verifier for tokens on callback
             token: inline form on the card

STORE        ConnectorAuthService (main process) encrypts tokens with Electron safeStorage
             → userData/connectors/<id>.cred  (never in MCP config, never in renderer state)

REGISTER     Managed MCP entry (managedBy: 'connector:<id>') added to the existing MCP
             store using the catalog's server template — {{token}} placeholder intact

LAUNCH       At conversation create (where the MCP set freezes today), WP materializes
             {{token}} from ConnectorAuthService — refreshing if needed — and passes the
             resolved server def to aioncore

USE          Agent calls connector tools like any MCP tool

STATUS       Derived, never stored: creds present + managed entry present = connected;
             either half missing = needs reconnect; Connect repairs both idempotently
```

**Trust boundaries:** credentials exist only in the main process, encrypted at rest; the
renderer receives status labels and account identity, never token material. Catalog
templates accept only `{{token}}` substitution — no user-supplied template strings.

**Frozen-set semantics:** connecting affects new conversations only (existing rule). The
UI teaches this once (see designer brief); disconnect removes tools from new conversations
immediately while running conversations decay as their materialized tokens expire.

## Components

### Shared (`common/`)

- `common/types/dataConnector.ts` — `ConnectorDefinition`, `ConnectorAuthSpec`,
  `ConnectorStatus` types.
- `common/config/connectorCatalog.ts` — the M365 and FDL entries. No secrets at all in the
  revised design (no client IDs — aioncore discovers metadata).
- `ipcBridge.ts` — **no new endpoints.** The revised flow uses existing `mcpService`
  bindings (`createServer`, `listServers`, `deleteServer`, `loginMcpOAuth`,
  `checkOAuthStatus`, `logoutMcpOAuth`, `getAuthenticatedServers`).

### Main process — **none required (revised)**

The whole proposed `process/services/data-connector/` directory is obsolete: aioncore owns
OAuth and token storage, and `mcpService.*` calls are renderer-invocable HTTP bindings.
This becomes a renderer-only feature plus catalog data. (If P1 forces a client-ID
passthrough, that work lands in the **aioncore fork**, not here.)

### Renderer

- **Data Connectors panel** nested under `pages/settings/ToolsSettings/` (the settings
  root is already over the 10-child limit; exact placement re-measured at plan time under
  the ratchet rule): `ConnectorsPanel`, `ConnectorCard`, `useDataConnectors` (SWR +
  status subscription).
- `McpServerItem` addition: `managedBy` entries render locked — "Managed by Data
  Connectors", edit/delete disabled, link to the panel.
- All strings under `settings.dataConnectors.*` i18n keys (VI + EN lengths per the i18n
  skill).

## Auth lifecycle & error handling

The OAuth flow treats every exit as defined behavior:

- Loopback binds 127.0.0.1 only; single-use handler; hard 5-minute timeout (user closing
  the browser times out to a clean "not connected"). `state` mismatch or second callback →
  reject without retry on that listener. Static "close this window" callback page.
- PKCE S256; no client secret; tokens never in logs or renderer state.
- `safeStorage.isEncryptionAvailable() === false` → refuse to store, clear card error.
  No plaintext fallback exists.

Token lifetime:

- `resolveToken` refreshes inside a 5-minute expiry margin. Refresh failure → status
  **needs reconnect** (card badge + event); credentials are never silently deleted.
- Materialization failure at conversation create **skips** the managed server for that
  conversation (absence beats opaque mid-chat tool errors) and surfaces on the card.
- Disconnect: delete local credentials, remove managed entry, best-effort revocation when
  the catalog names a revocation endpoint.

Reconciliation: status is derived (see flow diagram); hand-edited MCP config or a
corrupted cred file degrades to needs-reconnect, and Connect repairs both halves
idempotently.

## Testing (revised — renderer-focused)

- **Status derivation** (pure function, the real logic): server rows × authenticated URLs →
  `not connected | connected | needs reconnect`; URL normalization (trailing slash, case)
  when matching `getAuthenticatedServers` against catalog URLs.
- **Connect orchestration hook**: row-exists short-circuit, create→login ordering, login
  failure leaves no orphan row (or leaves a needs-reconnect row — pick one and assert it),
  double-click guard, 120s timeout surfaced as a distinct state.
- **Disconnect**: logout-then-delete ordering, idempotency when already logged out.
- **Card states**: the full matrix + header-token form + `builtin` locked row in
  `McpManagement`.
- **No new IPC fixtures needed** (no new endpoints).
- **Manual smoke** (gated on P1/P2): M365 connect → new chat → tools callable; FDL token
  path; disconnect affects new chats only.

## Prerequisites & capability spikes

1. ~~**S1 — MCP-def injection seam**~~ — **CLOSED 2026-08-04.** Seam is renderer-side at
   conversation create; no injection code needed at all in the revised design (connector
   rows ride the existing `selected_mcp_server_ids` path).
2. ~~**S2 — HTTP-header support**~~ — **CLOSED 2026-08-04.** Headers supported on all URL
   transports; aioncore additionally owns the entire OAuth flow and token storage.
3. **P1 — M365 client identity: RESOLVED 2026-08-04 (no fork needed, but it constrains
   server choice).** Researched answer:
   - **Microsoft Entra ID does not support DCR.** Verified empirically: its OIDC discovery
     document (`login.microsoftonline.com/common/v2.0/.well-known/openid-configuration`)
     contains **no `registration_endpoint`**. Microsoft has stated it is not on the roadmap.
     ⇒ Any MCP server that delegates OAuth **directly to Entra as the authorization server**
     (Microsoft's Entra-based / pre-authorized-client patterns, APIM- or FastMCP-fronted
     servers) **cannot** be authenticated by aioncore's `client_id`-less `login`.
   - **But an MCP server that fronts its own authorization server can.** The leading
     community server, `Softeria/ms-365-mcp-server`, in **HTTP mode acts as the AS itself**:
     it advertises OAuth capability, serves `/auth/*` (authorize, token, metadata), and
     **"Dynamic client registration is enabled by default in HTTP mode"** (disable via
     `--no-dynamic-registration`). It brokers to Entra behind the scenes with its own app
     registration. DCR + RFC 8414 metadata + PKCE is exactly the shape aioncore implements.
   - **Third path (bypasses aioncore OAuth entirely):** the same server in **stdio** mode
     uses **device-code flow with a built-in client ID** (no Azure registration required),
     storing tokens in the OS credential store via keytar. Since `getOAuthServerUrl` nulls
     stdio, aioncore's OAuth is not involved — the user authenticates by invoking the
     server's own `login` tool. Works, but the login moment happens in chat rather than on
     a Settings card.
   - **Decision required (see D1 below).** Verify at implementation: whether DCR still works
     when the server is configured with **VNG's own** Azure app
     (`MS365_MCP_CLIENT_ID`/`_SECRET`/`_TENANT_ID`) rather than the vendor default — IT will
     very likely require this, and Graph scopes need tenant admin consent either way.
4. **P2 — FDL auth: RESOLVED 2026-08-04 — DCR IS SUPPORTED.** VNG's internal MCP servers are
   published through **`aigw.vng.vn`, an Obot MCP Gateway** (confirmed by the resource
   metadata's `"resource_name": "Obot MCP Gateway"`), which is itself a spec-compliant
   OAuth 2.1 authorization server. Probed live:

   | Check | Result |
   | --- | --- |
   | AS metadata (RFC 8414) at `https://aigw.vng.vn/.well-known/oauth-authorization-server` | **200** |
   | `registration_endpoint` (RFC 7591 DCR) | **`https://aigw.vng.vn/oauth/register`** ✅ |
   | `code_challenge_methods_supported` | **`["S256","plain"]`** ✅ (aioncore uses S256) |
   | `token_endpoint_auth_methods_supported` | includes **`"none"`** ✅ (public client — no secret needed) |
   | `grant_types_supported` | `authorization_code`, `refresh_token`, token-exchange ✅ |
   | Unauthenticated MCP `initialize` | **401** with `WWW-Authenticate: Bearer … resource_metadata="…"` ✅ |
   | Protected-resource metadata (RFC 9728) | `authorization_servers: ["https://aigw.vng.vn"]`, `bearer_methods_supported: ["header"]` ✅ |

   ⇒ **`auth.type: 'mcp-oauth'` works for gateway-hosted connectors with aioncore as-is** —
   no `header-token` fallback, no fork work. DCR is a property of the **gateway**, so every
   `aigw.vng.vn/mcp-connect/<name>` server inherits it.

   Two open items: (a) confirm FDL's exact gateway connector name/URL — the probe used the
   already-configured `tse-datahub` connector (`aigw.vng.vn/mcp-connect/default-tse-datahub-mcp-…`),
   which is FDL-shaped but not confirmed to *be* FDL; (b) the gateway sits behind **Azure AD
   Application Proxy** (`x-ms-proxy-*` headers). The browser leg satisfies Entra SSO via the
   user's session, and the `.well-known` paths answered unauthenticated, but smoke-test that
   aioncore's **token exchange and MCP calls** pass the proxy with only a Bearer token.

### D1 — How M365 is hosted (likely collapsed by the P2 gateway finding)

**Check option E first.** Since `aigw.vng.vn` is an Obot MCP Gateway with DCR, PKCE, and
RFC 9728 discovery, **any M365/Graph MCP published through the same gateway inherits all of
it** and works with aioncore untouched — no Softeria hosting choice, no child-process
lifecycle, no Entra-DCR problem (the gateway is the AS and brokers downstream). That makes
**E. "publish/point at an M365 connector on the VNG gateway"** the preferred option, pending
confirmation that such a connector exists or can be requested from the gateway's owners.

**`outlook-advanced` probed 2026-08-04 — it ALSO supports DCR, independently.** It is a
direct Azure Container Apps URL (`send-email-mcp.…azurecontainerapps.io/mcp`), *not* behind
the gateway, but it fronts **its own** authorization server (self-issuer, exactly the
Softeria-HTTP-mode pattern):

| Check | Result |
| --- | --- |
| Unauthenticated MCP `initialize` | **401** + `www-authenticate: Bearer realm=…, resource_metadata=…` ✅ |
| Protected-resource metadata | `authorization_servers: [<itself>]`, bearer via header ✅ |
| `registration_endpoint` | **`…/oauth/register`** ✅ |
| `code_challenge_methods_supported` | **`["S256"]`** ✅ (S256-only — stricter than the gateway) |
| `token_endpoint_auth_methods_supported` | **`["none"]`** ✅ (public clients only) |
| Grants / scopes | `authorization_code`, `refresh_token` / `scopes_supported: ["mcp"]` ✅ |

⇒ **Both already-configured servers work with aioncore's existing OAuth untouched**, so D1's
hosting question is moot for anything already deployed: `mcp-oauth` is the only auth type v1
needs.

### ⚠ A minimal version of this feature ALREADY SHIPS

Both servers are **WePrompt builtins**, not user-added rows —
`BUILTIN_HTTP_MCP_SERVERS` in `packages/desktop/src/common/config/builtinSeed.ts:67`,
seeded by `process/utils/seedBuiltinProviders.ts:444`, added in commit **`f257a31c4`**
("feat(mcp): seed TSE Datahub and Outlook Advanced MCP servers by default", **khoapnt-vng**,
2026-07-09). The file's own comment states the design this spec re-derived:

> "Built-in HTTP MCP servers Forge ships enabled by default. Both endpoints are
> OAuth-protected (standard MCP authorization flow with discovery) — no credentials are baked
> in; each user signs in once via the Login button in Settings > Tools or the session MCP
> picker."

Consequences for scope:

- The connector **mechanism** (seed an OAuth-protected HTTP MCP + user clicks Login) is
  already implemented and shipping. This feature is therefore mostly **UX**: branded cards,
  derived status, discoverability, and a catalog format — not new plumbing.
- The v1 catalog can likely be a presentation layer over `BUILTIN_HTTP_MCP_SERVERS` (extended
  with icon/display metadata) rather than a parallel registry. **Re-scope the plan around
  this before writing tasks.**
- Descriptions already ship: `outlook-advanced` = "Outlook Advanced MCP for email, calendar
  and meeting rooms"; `tse-datahub` = "TSE Datahub MCP with HR headcount data".

### Connector identities — both confirmed (2026-08-04)

**`tse-datahub` IS FDL** (confirmed by the feature owner). So both connectors this feature set
out to add already ship as builtins, and both are DCR-capable:

| Connector | Ships as | Endpoint | Auth |
| --- | --- | --- | --- |
| **FDL** (Foundational Data Layer) | `tse-datahub` — "TSE Datahub MCP with HR headcount data" | `aigw.vng.vn/mcp-connect/default-tse-datahub-mcp-3fa296edm25h4` (Obot gateway) | `mcp-oauth`, DCR ✅ |
| **M365** | `outlook-advanced` — "email, calendar and meeting rooms" | `send-email-mcp.…azurecontainerapps.io/mcp` (self-fronting AS) | `mcp-oauth`, DCR ✅ |

⇒ **P1 and P2 are both fully resolved.** No fork work, no new auth type, no hosting decision:
`mcp-oauth` covers both, and the servers are already wired and enabled by default.

### This reframes the feature: the gap is naming and discoverability, not capability

The plumbing works today, but users meet these sources as raw MCP rows named `tse-datahub`
and `outlook-advanced` inside a power-user Tools screen. No non-technical user will recognise
"tse-datahub" as their company data platform, or know a Login button there is what unlocks it.
The connector catalog's real job is therefore **presentation and discoverability**:

- Map builtin server name → friendly identity: `tse-datahub` → **"FDL — Foundational Data
  Layer"**; `outlook-advanced` → **"Microsoft 365"**, each with icon, plain-language
  description of what the agent can do with it, and connect/status affordances.
- Surface the login moment where users will find it, instead of inside MCP management.
- Keep the raw rows working unchanged for power users (the `builtin` flag already hides
  edit/delete).

The catalog format should therefore key on the builtin server **name** rather than defining
new servers, and the implementation plan should be scoped as a UX layer over
`BUILTIN_HTTP_MCP_SERVERS`.

### Ownership of the endpoints (open)

The *catalog entries* are owned by the WePrompt project (commit above). Who **operates** the
two endpoints is not determinable from outside: `aigw.vng.vn` is corporate infrastructure
behind Azure AD App Proxy, while the Outlook endpoint is a public-internet Azure Container
Apps deployment under an auto-generated environment name (`thankfulhill-292d9583`) that
exposes no ownership metadata. **Ask khoapnt-vng**, who added both seeds — needed for the
catalog's support/escalation story, not for feasibility.

The original table stays below in case no gateway-hosted M365 connector is available:

The DCR finding turns "which M365 server" into an architecture decision, because only the
self-fronting-AS option fits the Settings-card UX:

| Option | Auth path | Cost / risk |
| --- | --- | --- |
| **A. Local HTTP server on 127.0.0.1** (`--http`), launched/managed by WP | aioncore OAuth works (DCR + PKCE against localhost) | WP must own a child-process lifecycle it does not have today; per-user process |
| **B. Centrally hosted HTTP server** for the org | aioncore OAuth works | Needs infra owner, deployment, and a security review of a shared M365 broker |
| **C. stdio + device code** (built-in or VNG client ID) | Server self-authenticates; aioncore OAuth unused | Simplest to ship (matches the KB's stdio precedent), but "Connect" happens as a chat tool call, so the card can only show status, not drive login |
| **D. Microsoft's Entra-based servers** | ❌ Blocked — no DCR, and `login` cannot pass a client ID | Would require an aioncore fork change (client-ID passthrough) |

Recommendation: **C for v1** (lowest risk, no infra, no process lifecycle, reuses the stdio
pattern the KB already ships), with the card showing "Sign in required — run the login tool"
and status derived from the server's own state; revisit **A** if the in-Settings login moment
proves important enough to justify process management. **D is off the table** unless we fund
fork work.
5. **P3 — Blocking-call UX detail:** binary strings indicate `login` waits for the redirect
   with a **120-second** cap ("no redirect received within 120s"). The card's waiting state
   must use 120s, not the 5 minutes in the superseded design; confirm whether the HTTP call
   blocks for that duration (strongly implied) so the UI can show progress and cancel.
6. **P4 — Version skew:** OAuth routes exist in dev's 0.1.44 and the v0.1.50 pin, so the
   capability is safe; still normalize responses at the IPC boundary per the standing
   skew rule (`snake_case` + possibly-absent fields).

## Out of scope (v1)

Per-conversation connector toggles; KB ingestion from connectors; multi-account per
connector; org-pushed catalog updates; connector health dashboards; building or hosting
the MCP servers themselves.
