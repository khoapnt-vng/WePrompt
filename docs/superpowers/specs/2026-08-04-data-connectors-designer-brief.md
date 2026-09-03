# Designer Brief — Data Connectors (WePrompt)

**Date:** 2026-08-04 · **Feature owner:** Minh (minhtq4) · **Target:** desktop app (Electron), Arco Design + existing WePrompt settings patterns
**Status:** design requested — engineering spec drafted in parallel; nothing is built yet

## What this feature is

WePrompt users will connect external data sources — **Microsoft 365** (mail, files, SharePoint, Teams) and **FDL** (VNG's Foundational Data Layer) — so the AI can query them live during chats. Connecting happens once, in Settings; afterwards every **new** conversation can use the source's tools automatically.

Think Claude.ai's "Connectors" page: branded cards, one-click connect, clear status — not a developer configuration screen. The developer screen (raw "MCP servers" management) already exists next door and stays; this is the friendly layer for everyone else.

## What already exists (added 2026-08-04, post-research)

Both connectors already work under the hood — they ship enabled by default and authenticate
via a standard OAuth "Login" flow that opens the user's browser. **The problem is purely that
users can't find or recognise them.** Today they appear as raw technical rows in the
power-user Settings → Tools screen:

| Users should see | Ships today as | Covers |
| --- | --- | --- |
| **FDL — Foundational Data Layer** | `tse-datahub` · "TSE Datahub MCP with HR headcount data" | company data platform (e.g. HR headcount) |
| **Microsoft 365** | `outlook-advanced` · "Outlook Advanced MCP for email, calendar and meeting rooms" | email, calendar, meeting rooms |

So this design work is mainly **naming, branding, and putting the sign-in moment somewhere
people will find it** — not new capability. Please treat the friendly names above as
placeholders to improve on, and assume the raw technical names must never appear on the cards.

## Users & context

- Non-technical staff (HR, ops, analysts) who will never touch the raw MCP screen. They know "connect my Microsoft account" from other apps.
- Power users who already use the MCP screen and must not be confused by two surfaces managing the same thing.
- Vietnamese and English UI (all copy goes through i18n; design for both lengths — VI runs long).

## Surfaces to design

1. **Data Connectors panel** — lives inside Settings → Tools, alongside "MCP Servers". A catalog of connector cards (2 today: M365, FDL — design for N; assume a dozen within a year). Each card: provider icon, name, one-line description, status, primary action.
2. **Connect flows**
   - **OAuth (M365):** click Connect → system browser opens Microsoft sign-in → user returns to the app. Design the in-app waiting state ("waiting for browser…", cancellable, 5-minute timeout), the success state, and the timeout/cancel state. Note: Microsoft has brand rules for sign-in affordances — please check them for the button treatment.
   - **Token (FDL fallback):** an inline form on the card (token field + help link), submit → connected. May be replaced by OAuth later; design both without assuming which FDL ships with.
3. **Card states** (the core of this work): `not connected` → `connecting` → `connected` (show account identity, e.g. user@vng.com.vn) → `needs reconnect` (token expired/revoked; single repair action) → back. Plus `disconnect` (confirm step — copy must explain that existing chats keep working until their access ages out, new chats lose the source immediately).
4. **Locked row in the raw MCP screen** — connector-managed entries appear there read-only with a "Managed by Data Connectors" label and a link back to the panel. Small, but it's the seam between the two surfaces.
5. **Error states**: browser didn't open; sign-in timed out; secure storage unavailable on this machine (hard block with explanation); connection works but a new chat couldn't use it (rare — surfaced on the card as needs-reconnect).

## Key behavioral rule to convey in the UI

Tools attach when a conversation is **created**. Connecting a source does not change chats already open. The card (or a first-connect success moment) should teach this in one line — same pattern as the Knowledge Base "stale chat" hint that already shipped.

## Constraints

- Arco Design components only; colors/typography via the app's semantic tokens (no hardcoded values). Light + dark themes.
- Reuse existing settings layout rhythm (section headers, card grids in Assistant/Skills settings are precedents).
- Provider icons: M365 official mark (per Microsoft brand guidelines), FDL mark from the internal brand team — flag if you need us to chase assets.
- Desktop window sizes; the settings pane can be narrow — cards must stack.

## Out of scope (don't design)

Per-chat source toggles, sync/ingestion progress, multi-account per connector, an admin/org catalog editor, connector health dashboards.

## Deliverables & timing

- Screens: connectors panel (empty + populated), each card state, OAuth waiting/success/timeout, token form, disconnect confirm, locked MCP row.
- Redlines/tokens per the usual handoff; copy suggestions welcome but final strings go through i18n review.
- This is **Next**-priority work: no sprint deadline yet — but the engineering plan lands right after these screens, so earlier unblocks sequencing.

## Questions for you

1. Panel placement: tab beside "MCP Servers" vs a section above it on the same page — your call, argue it.
2. Where should the "new chats only" teaching moment live — card microcopy, success toast, or first-run callout?
3. Any concerns designing the two auth patterns (browser round-trip vs inline token) as one coherent card system?
