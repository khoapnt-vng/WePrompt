# Design: One-click Google Drive connection for WePrompt

**Date:** 2026-07-21
**Status:** Draft for review
**Author:** minhtq1234 (with Claude)

## Problem

Connecting Google Drive as an MCP server in WP currently uses the "bring your
own Google Cloud project" model. Each end user must: create a GCP project,
enable the Drive API, create OAuth credentials, and complete consent — roughly
6–8 manual steps. The step that fails most often is "enable the Google Drive
API" (observed in testing: the built-in agent walks the user to Google Cloud
Console and the step errors out). This is too much friction for our users.

## Goal

A user connects Google Drive in **one click** ("Connect Google Drive" →
browser consent → done), with **no per-user Google Cloud setup**.

### Non-goals

- Replacing WP's generic user-added MCP mechanism (raw JSON config stays).
- Solving OAuth for MCP servers in general — this is Google Drive specifically.
- Server-side / hosted infrastructure (explicitly ruled out — local-first).

## Constraints (decided with the user)

- **User population:** mixed — VNG Google Workspace *and* external/consumer
  Google accounts. (Rules out an "Internal" OAuth app, which only covers the
  Workspace org.)
- **Access needed:** full Drive browse/read → Google **restricted** scope
  (`https://www.googleapis.com/auth/drive` / `drive.readonly`).
- **Deployment:** local-first, no hosted server.

### The compliance reality (drives the phasing)

A **restricted** scope + **external** users requires, from Google:
1. Restricted-scope app verification, **and**
2. An **annual third-party security assessment (CASA)** — real money
   (several thousand USD/yr) and weeks-to-months lead time.

This is triggered by *scope × external distribution*, **not** by client-vs-server,
so local-first does not avoid it. The only audit-free paths are narrowing to
`drive.file` or internal-only users — both excluded by the constraints above.
Therefore the audit is a real Phase-2 cost, and we phase around it.

## Decision: Phased Approach B (baked-in WP OAuth app, local-first)

### Phase 1 — Pilot (ship now, zero cost, zero infra)

Google allows an **unverified** app to use restricted scopes for a **small
pilot (~100 users)**; users click through an "unverified app" warning. That is
acceptable for trusted pilot testers (which is where WP is today).

- One **VNG-owned** Google Cloud OAuth app (Desktop-app client type + PKCE),
  Drive API enabled, full `drive` scope, consent screen in testing/unverified.
- OAuth client ID/secret **baked into WP at build time**, reusing the existing
  `FORGE_*` mechanism.
- User clicks **"Connect Google Drive"** in Tools/Capabilities → browser
  consent → tokens stored locally → the Drive MCP server is launched with the
  token. Zero per-user GCP setup.

### Phase 2 — GA (before broad external rollout)

Submit for restricted-scope verification + CASA audit to remove the warning and
the ~100-user cap. No code change — a compliance/ops gate.

### De-risk lever (built into the design, not a separate phase)

The capability supports a **`drive.file`** scope mode (files the user picks via
Google Picker or that WP creates). `drive.file` is **not** restricted → no
audit, no warning. If the CASA audit is delayed or rejected, external users can
still get one-click Drive on the narrower scope. Default is full `drive`; scope
is a single config value.

### Why this over the alternatives

- **Do the audit first:** blocks all value for weeks/months + spend. Bad for a
  team mid-test.
- **Hybrid (internal=full, external=`drive.file`):** avoids the audit entirely
  and is elegant, but external users lose full-Drive browse — contradicts the
  stated requirement. Kept documented as a Phase-2 pivot if audit cost is
  rejected.
- **Hosted server (Approach A):** best for a WebUI story, but needs infra
  (ruled out) and the *same* audit.

## Architecture

Components (each independently testable):

1. **Google Cloud OAuth app** — *one-time human setup, not code.* Owned by VNG.
   Desktop client + PKCE, Drive API enabled, consent screen configured, pilot
   test users added. Deliverable: a client ID + secret.

2. **Build-time credential injection** — add `FORGE_GOOGLE_OAUTH_CLIENT_ID` /
   `FORGE_GOOGLE_OAUTH_CLIENT_SECRET` to the `define` block in
   `packages/desktop/electron.vite.config.ts` (mirrors `FORGE_TAVILY_API_KEY`).
   CI injects them. Absent in dev → capability shows a "not configured" state.

3. **Google OAuth flow (main process)** — new module in
   `packages/desktop/src/process/services/` implementing the installed-app
   loopback + PKCE flow (`shell.openExternal` to Google's auth URL → local
   loopback listener catches the redirect → exchange code → access + refresh
   tokens). Handles token refresh. *Decision:* keep this in the Electron main
   process (not the aioncore backend) so it stays local-first and colocated
   with token storage. (Alternative: extend aioncore's existing
   `/api/mcp/oauth/*`; rejected to avoid coupling to the backend for a
   client-owned credential.)

4. **Token storage (encrypted, local)** — store access/refresh tokens per
   Google account via Electron **`safeStorage`** (OS-keychain-backed; not
   currently used in the repo — introduced here). Matches WP's "all data stored
   locally" promise. Tokens never leave the machine.

5. **Drive MCP server (stdio)** — a Drive MCP server launched by WP, fed the
   OAuth token (via credentials file or env). *Open decision — see below.*

6. **Capability framework extension** — extend
   `packages/desktop/src/common/config/builtinCapabilities.ts` to add an
   `oauth` credential kind (today only `apiKey` / `connectionString`). Add a
   `BUILTIN_GDRIVE` descriptor. The settings UI renders a **Connect / Disconnect**
   button (triggering the OAuth flow) instead of a text field for `oauth`-kind
   capabilities. Reuse `mergeCommodityMcpServerIds` so Drive auto-attaches to
   conversations once connected, like the other commodity servers.

## Data flow

**Connect:** user clicks Connect → main-process OAuth flow → browser consent →
tokens → `safeStorage` → capability marked connected → Drive MCP server
(re)launched with token.

**Use:** agent invokes a Drive tool → stdio Drive MCP server uses the token →
main process refreshes the token on expiry transparently.

**Disconnect:** revoke token with Google + clear `safeStorage` entry + stop the
server.

## Error handling

- **Token expired/refresh fails / revoked externally:** capability flips to
  "needs reconnect"; agent tool calls return a friendly "reconnect Google Drive"
  message rather than a raw 401.
- **Offline:** connect fails with a clear network message; existing tokens still
  attempt refresh with backoff.
- **Unverified-app warning (Phase 1):** documented for pilot users;
  in-app copy tells them to expect it and how to proceed.
- **Build without `FORGE_GOOGLE_OAUTH_*`:** capability shows "not available in
  this build" instead of a broken Connect button.

## Security & privacy

- Desktop OAuth client secret is a **public client** under Google's model; PKCE
  is mandatory and protects the flow. Baking the secret in is acceptable
  (same posture as the Tavily key) and standard for installed apps.
- Tokens encrypted at rest via `safeStorage`; never transmitted off-device.
- Scope is least-privilege-configurable (`drive` vs `drive.file`).

## Testing

- **Unit:** `builtinCapabilities` `oauth`-kind helpers (build/apply/read
  credential); token-store encrypt/decrypt round-trip; refresh-on-expiry logic
  (mock clock/token endpoint).
- **Manual/e2e:** full connect → invoke a Drive tool → disconnect, on both a
  Workspace and a consumer account; verify token survives app restart.

## Open decisions (need a call before implementation)

1. **Which Drive MCP server package?** Criteria: stdio; accepts an
   externally-supplied OAuth token/credentials file (so WP owns the OAuth flow,
   not the server); supports full `drive` scope; maintained. Candidates to
   evaluate: `@modelcontextprotocol/server-gdrive` (reference; read-only-leaning)
   vs a maintained community server. Fallback: fork/wrap a minimal server.
2. **`safeStorage` vs existing config storage** for tokens — recommend
   `safeStorage`; confirm it's acceptable to introduce.

## Rough effort

- Google Cloud app setup: S (human, ~1–2h).
- Build-time injection: S.
- OAuth flow + token store (`safeStorage`): M–L (the bulk).
- Capability framework `oauth` kind + UI: M.
- Drive MCP server selection/wiring: S–M (depends on package choice).

## Phasing summary

| Phase | Work | Gate |
|---|---|---|
| 1 — Pilot | All code above; unverified app; ~100 users | Ship now |
| 2 — GA | Restricted-scope verification + CASA audit | Before broad external rollout |
| Fallback | Flip scope to `drive.file` | If audit slips/rejected |
