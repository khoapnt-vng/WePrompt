# Business-trip Letter Assistant — Implementation Plan (v1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a reusable WePrompt Assistant ("Thư cử công tác / Business-trip Letter") that turns three uploads — passport photo, partner invitation PDF, Teams profile screenshot — into a filled, review-ready VNG visa-support `.docx`, using only capabilities WePrompt already ships.

**Architecture:** A shareable **skill folder** (`SKILL.md` + the VNG template + an `entities.json` reference) is imported via Skills Hub and pinned to a custom **Assistant** that also pins the `greennode-idp` (passport/PDF OCR), `aionui-image-analysis` (Kimi vision, for the Teams screenshot), and `officecli` (docx fill) tools. The assistant reads the three files, cross-validates, asks the user to confirm entity + dates, fills the template, and writes the output to the conversation workspace for human sign-off. **No app source code changes in v1.**

**Tech Stack:** WePrompt (AionUi fork) Assistant + Skills systems; built-in MCPs `greennode-idp` and `aionui-image-analysis`; the external `officecli` binary + office-docx skill; VNG GreenNode / Gemini runtime models.

**Spec:** [2026-07-21-business-trip-letter-assistant-design.md](../specs/2026-07-21-business-trip-letter-assistant-design.md)

---

## Execution status (2026-07-21)
- ✅ Task 0 Step 1 — `officecli` binary present (`~/.local/bin/officecli`).
- ✅ Task 1 — skill folder scaffolded, template copied + verified.
- ✅ Task 2 — `entities.json` written + valid (starter values, `verified:false`).
- ✅ Task 3 — `SKILL.md` written + verified.
- ✅ Task 6 — `USAGE.md` written; folder complete (4 files).
- ⬜ Task 0 Steps 2–4 — **in-app:** enable `greennode-idp` + Kimi vision MCPs; confirm model + office-docx skill.
- ⬜ Task 4 — **in-app:** import skill + create/configure the Assistant.
- ⬜ Task 5 — **in-app:** end-to-end dry-run against the sample files.

---

## Nature of this plan (read before starting)

This is a **configuration + content-authoring** plan, not a code plan:
- Deliverables: (1) a skill folder, (2) an in-app Assistant config, (3) a validated dry-run, (4) a usage/sharing note.
- "Verification" = functional acceptance checks (build errors, tool output, field-by-field check of the generated `.docx`), not unit tests. No `bun run test` applies because no app runtime code changes.
- No git commits in v1: the skill folder lives under gitignored `docs/superpowers/artifacts/`, the assistant lives in app/backend storage, and `AGENTS.md` forbids committing `docs/superpowers/`. If execution ever edits a tracked repo file, commit that file then (Conventional Commits, no AI signature).

---

## File / artifact structure

```
docs/superpowers/artifacts/business-trip-letter/   # local, gitignored working copy of the skill
  SKILL.md                                          # the workflow the agent follows (Task 3)
  template/
    Mau-thu-cu-cong-tac-VNG.docx                    # the VNG template (Task 1)
  reference/
    entities.json                                   # VNG entities + signatory + consulate (Task 2)
  USAGE.md                                           # bilingual usage + team-sharing note (Task 6)
```
- **Skill folder is the shareable/versionable unit.** For team reuse, distribute this folder; teammates import it via Skills Hub and clone the assistant.
- **Assistant config** is created through the WePrompt UI (Task 4); it is not a file in this repo.
- On graduation to v2/B, this folder moves into the AionCore backend as an official preset (out of scope here).

Sample files for the validation dry-run (already extracted this session):
- Passport: `<scratchpad>/eml_parts/image007.jpg`
- Invitation PDF: `<scratchpad>/eml_parts/邀请函-单次-Phùng Ngọc Bảo Vy.pdf`
- Template source: `<scratchpad>/eml_parts/Mẫu thư cử công tác VNG.docx`
- Teams screenshot: **not in the samples** — Task 5 uses a stand-in (see there).

Where `<scratchpad>` = `/private/tmp/claude-501/-Users-lap16603-Projects-WePrompt/9ce8d96f-0b65-4d1d-9d47-c14608724ccf/scratchpad`.

---

## Task 0: Verify prerequisites

**Files:** none (environment checks).

- [ ] **Step 1: Confirm the `officecli` binary is installed**

Run:
```bash
(command -v officecli || ls -l "$HOME/.local/bin/officecli" || echo "OFFICECLI_PATH=$OFFICECLI_PATH") 2>&1
```
Expected: a path to an executable. If none, install it / set `OFFICECLI_PATH` before continuing — the assistant cannot produce a `.docx` without it (`officeCliRunner.ts:151-154` → `OFFICECLI_NOT_FOUND`).

- [ ] **Step 2: Confirm the OCR + vision MCPs are enabled in WePrompt**

In the app: **Settings → Tools**. Confirm `greennode-idp` and `aionui-image-analysis` are present and enabled. `greennode-idp` may require an OAuth/login step — complete it. If either is missing, it is a built-in seed (`builtinSeed.ts`) — enable/seed it before continuing.
Expected: both tools listed and enabled.

- [ ] **Step 3: Confirm a capable model/runtime is available**

In **Settings → Providers / Models**, confirm at least one of: the Gemini office runtime, `openai/gpt-5`, or the seeded VNG GreenNode models. This is the model the assistant will pin in Task 4.
Expected: at least one capable model selectable.

- [ ] **Step 4: Confirm the office-docx skill is available**

Confirm an `officecli-docx` (a.k.a. word/docx-creator) skill or official office assistant is present (Skills Hub or the "Official" assistants tab). The business-trip skill depends on it to write the `.docx`.
Expected: office-docx capability present. If absent, it ships from the backend — enable it before Task 4.

---

## Task 1: Scaffold the skill folder and place the template

**Files:**
- Create: `docs/superpowers/artifacts/business-trip-letter/template/` (dir)
- Create: `docs/superpowers/artifacts/business-trip-letter/reference/` (dir)
- Copy: template `.docx` into `template/`

- [ ] **Step 1: Create the folder structure**

Run:
```bash
cd /Users/lap16603/Projects/WePrompt
mkdir -p docs/superpowers/artifacts/business-trip-letter/template \
         docs/superpowers/artifacts/business-trip-letter/reference
```
Expected: no output, exit 0.

- [ ] **Step 2: Copy the VNG template in (ASCII filename for portability)**

Run:
```bash
cp "/private/tmp/claude-501/-Users-lap16603-Projects-WePrompt/9ce8d96f-0b65-4d1d-9d47-c14608724ccf/scratchpad/eml_parts/Mẫu thư cử công tác VNG.docx" \
   "docs/superpowers/artifacts/business-trip-letter/template/Mau-thu-cu-cong-tac-VNG.docx"
```
Expected: file copied.

- [ ] **Step 3: Verify the template is intact**

Run:
```bash
cd /Users/lap16603/Projects/WePrompt
python3 -c "import zipfile; z=zipfile.ZipFile('docs/superpowers/artifacts/business-trip-letter/template/Mau-thu-cu-cong-tac-VNG.docx'); print('OK' if 'word/document.xml' in z.namelist() else 'BAD')"
```
Expected: `OK`.

---

## Task 2: Author and verify `entities.json`

**Files:**
- Create: `docs/superpowers/artifacts/business-trip-letter/reference/entities.json`

> **Dependency:** the *real* entity letterheads + signatory must come from HR/legal. The content below is a **starter** derived from the sample attachments; each value must be verified before Vy uses the assistant for a real letter. The plan proceeds with the starter so the dry-run (Task 5) can validate the mechanics.

- [ ] **Step 1: Write the starter reference file**

Create `docs/superpowers/artifacts/business-trip-letter/reference/entities.json`:
```json
{
  "consulate": "CONSULATE GENERAL OF CHINA IN HO CHI MINH CITY",
  "letter_city": "Ho Chi Minh city",
  "expense_clause": "During the business trip in China, all expenses shall be paid by {ENTITY_NAME}.",
  "commit_clause": "We hereby commit that this invitation letter is true, is sent by Chinese partners, if there is any fraud, we are fully responsible to the Law.",
  "entities": [
    {
      "id": "vnggames",
      "name": "VNGGames Co., Ltd",
      "head_office": "2nd Floor, Saigon Paragon Building, No. 3 Nguyen Luong Bang, Tan My Ward, Ho Chi Minh City, Vietnam",
      "tel": "(84.8) 3926 3888",
      "scope": "Online Game, Software etc.",
      "signatory": { "name": "NGUYỄN THỊ NGUYỆT MINH", "title": "Head of Compensation & Benefits" },
      "verified": false
    },
    {
      "id": "vng-group",
      "name": "VNG GROUP JSC",
      "head_office": "Z06, Street No.13, Tan Thuan Ward, HCMC",
      "tel": "(+84) 028 3962 3888",
      "scope": "Online Game, Software etc.",
      "signatory": { "name": "NGUYỄN THỊ NGUYỆT MINH", "title": "Head of Compensation & Benefits" },
      "verified": false
    }
  ]
}
```

- [ ] **Step 2: Validate JSON**

Run:
```bash
cd /Users/lap16603/Projects/WePrompt
python3 -c "import json; d=json.load(open('docs/superpowers/artifacts/business-trip-letter/reference/entities.json')); print('entities:', [e['id'] for e in d['entities']])"
```
Expected: `entities: ['vnggames', 'vng-group']`.

- [ ] **Step 3: Flag verification owner**

Note in the handover (Task 6 USAGE.md) that every entity has `"verified": false` until HR/legal confirms head office, tel, scope, and signatory. The assistant must warn when it uses an unverified entity.

---

## Task 3: Write `SKILL.md` (the workflow)

**Files:**
- Create: `docs/superpowers/artifacts/business-trip-letter/SKILL.md`

- [ ] **Step 1: Write the skill file (complete content, no placeholders)**

Create `docs/superpowers/artifacts/business-trip-letter/SKILL.md`:
````markdown
---
name: business-trip-letter
description: Generate a VNG visa-support letter ("thư cử công tác" / Letter Decision to the Consulate General of China in HCMC) from an employee passport photo, the partner's invitation letter (PDF), and a Teams profile screenshot. Use when an HR/C&B user needs to draft a business-trip visa-support letter for a trip to China.
---

# Business-trip Letter (Thư cử công tác)

You help an HR/C&B user DRAFT a VNG visa-support letter for an employee's business trip to China. You draft only — a human reviews and signs. Never claim the letter is final, valid, submitted, or legally binding.

## Inputs (the user uploads up to 3 files)
1. Passport photo of the traveler (image).
2. Partner invitation letter (PDF, usually Chinese).
3. Teams profile screenshot of the traveler (image) — source for work email, phone, and job title.

If a file is missing, ask for it before proceeding; if the user cannot provide the Teams screenshot, ask them to type work email, phone, and job title instead.

## Bundled resources
- `reference/entities.json` — VNG legal entities (letterhead block + signatory) and the consulate line. NEVER invent letterhead or signatory details; use this file. If the chosen entity has `"verified": false`, warn the user that its details are unverified.
- `template/Mau-thu-cu-cong-tac-VNG.docx` — the letter to fill. Preserve its structure, headings, and English wording; only replace field values.

## Workflow
1. Read the **passport** with the `greennode-idp` tool `greennode_idp_read_document`. Extract: surname + given names (preserve Vietnamese diacritics exactly), nationality, date of birth, passport number, date of issue, date of expiry. If the photo is unclear, parse the MRZ (bottom two lines) as fallback.
2. Read the **invitation PDF** with `greennode_idp_read_document`. Extract: trip date range(s); inviter name + title; partner company name + address; partner contact phone + email; and the traveler data stated in the invitation table (name, DoB, passport no., issue, expiry, position).
3. Read the **Teams screenshot** with the image-analysis (Kimi vision) tool. Extract: work email, phone, job title, department (if shown).
4. **Cross-validate** passport vs invitation on name, DoB, passport no., issue, expiry. If any differ, FLAG the discrepancy and show BOTH values — do not silently choose one.
5. **Choose the entity**: propose the VNG entity from the invitation's addressee ("至: …") and the Teams department, then ask the user to confirm which entity in `entities.json` applies. Pull head office, tel, scope, and signatory from that entry.
6. **Normalize**: dates as "DD Month YYYY" (e.g., 15 August 2026); keep Vietnamese diacritics; format phone with country code.
7. **Show a confirmation summary**: a table of every letter field → value → source, with any unfound field marked "— needs confirmation" and any discrepancy flagged. Explicitly ask the user to confirm: (a) the entity, (b) the trip dates, and (c) whether leave dates must appear on the letter (if yes, ask for them).
8. After the user confirms, **fill the template** using the officecli-docx workflow: set each field value, adapting the number of visit phases to the invitation (one date range → one visit line; N ranges → N lines). Write the output to the conversation workspace as `Thu-cu-cong-tac-<GivenName>.docx`.
9. **Hand off**: tell the user the draft is ready to open in Word, restate the flagged items to double-check, and remind them it must be reviewed and signed by C&B before any use or submission.

## Field → source mapping
| Letter field | Source |
| --- | --- |
| Company name / head office / tel / scope | entities.json (user-confirmed entity) |
| "at the invitation of …" (partner) | invitation PDF |
| Name | passport (cross-check invitation) |
| Position / job title | Teams screenshot (cross-check invitation) |
| Nationality | passport |
| Date of birth | passport (cross-check invitation) |
| Passport No. | passport (cross-check invitation) |
| Date of issue / expiry | passport (cross-check invitation) |
| Email / Phone (traveler) | Teams screenshot |
| Trip dates (N phases) | invitation PDF |
| Purpose (inviter name + title) | invitation PDF |
| Meeting location / contact / partner email | invitation PDF |
| Signatory + letter date | entities.json + today's date |

## Rules
- Never invent data. Unknown → "— needs confirmation".
- Always surface known-risky items: inviter email spelling (e.g. `.cn` vs `.com.cn`), telephone digits, and the entity choice.
- Never assert legal validity or that the letter has been sent/submitted.
- Keep all files inside the conversation workspace.
````

- [ ] **Step 2: Verify the frontmatter parses and the file is well-formed**

Run:
```bash
cd /Users/lap16603/Projects/WePrompt
python3 - <<'PY'
p='docs/superpowers/artifacts/business-trip-letter/SKILL.md'
t=open(p,encoding='utf-8').read()
assert t.startswith('---'), 'missing frontmatter'
fm=t.split('---',2)[1]
assert 'name: business-trip-letter' in fm, 'name missing'
assert 'description:' in fm, 'description missing'
for tok in ['greennode_idp_read_document','entities.json','Mau-thu-cu-cong-tac-VNG.docx','officecli']:
    assert tok in t, f'missing {tok}'
print('SKILL.md OK')
PY
```
Expected: `SKILL.md OK`.

---

## Task 4: Create and configure the Assistant in WePrompt

**Files:** none in repo (in-app configuration).

- [ ] **Step 1: Import the skill**

App: **Settings → Skills → Import** → point at `docs/superpowers/artifacts/business-trip-letter/`.
Expected: `business-trip-letter` appears in the skills list (source: custom).

- [ ] **Step 2: Create the assistant**

App: open **Assistants** from the **main left sidebar** (👻 ghost icon, tooltip "Assistants" — Assistants were moved OUT of Settings in this build, route `/assistants`) → **Create** (or Duplicate an office assistant to inherit officecli wiring, then edit).
- Name: `Thư cử công tác / Business-trip Letter`
- Avatar: any HR/letter icon.
Expected: a new editable (custom) assistant.

- [ ] **Step 3: Set the rules / system prompt**

In the assistant's **Rules** section, set the content to point at the skill:
```
You are the Business-trip Letter assistant. Follow the `business-trip-letter` skill exactly.
The user uploads a passport photo, the partner invitation PDF, and a Teams profile screenshot.
Draft only — a human reviews and signs. Never claim the letter is final or submitted.
```
Expected: rules saved (written via `/api/skills/assistant-rule/write`).

- [ ] **Step 4: Pin skills, tools, and model (fixed defaults)**

In **Defaults / Skills / MCP**:
- Enable skills: `business-trip-letter` and the office `officecli-docx` skill.
- Enable MCP tools: `greennode-idp`, `aionui-image-analysis`.
- Set default model = fixed, to the capable model confirmed in Task 0 Step 3.
Expected: all pinned; model shows as fixed.

- [ ] **Step 5: Add a bilingual starter prompt**

In **Prompts**, add:
```
Tải lên hộ chiếu, thư mời (PDF) và ảnh chụp hồ sơ Teams của nhân viên để tạo bản nháp thư cử công tác. / Upload the passport, the invitation PDF, and a Teams profile screenshot to draft the business-trip letter.
```
Expected: starter prompt appears when the assistant is selected.

- [ ] **Step 6: Verify the assistant is selectable**

Start a **New chat**. Confirm the assistant appears in the pill bar and its starter prompt shows.
Expected: assistant selectable; starter prompt visible.

---

## Task 5: End-to-end validation against the real sample files

**Files:** none (functional dry-run). Uses the sample passport + invitation; a **stand-in Teams screenshot** since the samples have none.

- [ ] **Step 1: Prepare a stand-in Teams screenshot**

Create a simple screenshot/image of a mock Teams profile for the traveler showing: Job title `Data Analysis Specialist`, Email `<test.email>@vng.com.vn`, Phone `<test phone>`. (Or, at Step 3, decline the screenshot and type these three values when the assistant asks.)
Expected: one image file available to upload, OR the decision to type the 3 fields.

- [ ] **Step 2: Run the assistant with the three inputs**

New chat → select the assistant → upload:
- Passport: `<scratchpad>/eml_parts/image007.jpg`
- Invitation: `<scratchpad>/eml_parts/邀请函-单次-Phùng Ngọc Bảo Vy.pdf`
- Teams: the stand-in from Step 1 (or type the 3 fields).
Send the starter prompt.
Expected: the assistant calls `greennode-idp` twice and the vision tool once, then shows a confirmation summary table.

- [ ] **Step 3: Confirm the confirmation summary is correct**

Check the summary table against these expected extracted values (acceptance criteria):
| Field | Expected |
| --- | --- |
| Name | Phùng Ngọc Bảo Vy |
| Nationality | Vietnamese |
| Date of birth | 14 February 2000 |
| Passport No. | E01132537 |
| Date of issue | 01 December 2023 |
| Date of expiry | 01 December 2033 |
| Trip dates | single visit: 15 August 2026 → 19 August 2026 |
| Purpose | Business Meeting with Feng Lili, Business Manager |
| Meeting location | Room 502, Building 5B, Chenyu Valley Phase II, Gaoxin 2nd Road, East Lake High-tech Development Zone, Wuhan City, Hubei Province, China |
| Contact | +86 13260531812 |
| Partner email | FLAGGED: `fenglili@ghgame.cn` (PDF) vs `fenglili@ghgame.com.cn` (email signature) |
| Position | Data Analysis Specialist |
| Passport vs invitation cross-check | all match (no discrepancy) |

Expected: values match; the partner-email discrepancy is flagged; nothing is invented. If passport OCR misreads diacritics or the passport number, note it — the invitation cross-check should catch it.

- [ ] **Step 4: Confirm entity + dates, then generate**

When prompted, confirm entity = `VNGGames Co., Ltd` (matches the invitation addressee) and dates = 15–19 August 2026. Let it generate.
Expected: a `Thu-cu-cong-tac-Vy.docx` (or similar) written to the workspace; in-app Office preview renders it.

- [ ] **Step 5: Field-by-field check of the generated .docx**

Open the output (in-app preview or **open in Word**). Verify:
- Company block = VNGGames Co., Ltd + its head office/tel/scope from `entities.json` (NOT "VNG GROUP JSC").
- Person block filled per Step 3's table; diacritics preserved.
- Exactly **one** visit line (single-entry invitation), dated 15–19 November-was-example → **15–19 August 2026**.
- Purpose / location / contact / partner email from the invitation.
- Signatory = Nguyễn Thị Nguyệt Minh, Head of Compensation & Benefits; letter city = Ho Chi Minh city; letter date = today.
- Template wording/headings unchanged.

Expected: all correct. **If `officecli` cannot fill the labelled template fields in place**, record the failure mode — the fallback is to have the office skill regenerate the letter body from the template text with values inserted; decide during execution and note it in USAGE.md.

- [ ] **Step 6: Record the result**

Note pass/fail and any misreads in Task 6's USAGE.md ("Known limitations"). Do not hand over to Vy until Step 5 passes.

---

## Task 6: Write the usage + team-sharing note

**Files:**
- Create: `docs/superpowers/artifacts/business-trip-letter/USAGE.md`

- [ ] **Step 1: Write USAGE.md (bilingual)**

Create `docs/superpowers/artifacts/business-trip-letter/USAGE.md`:
````markdown
# Business-trip Letter assistant — usage / hướng dẫn

## For the user (Vy) / Dành cho người dùng
1. New chat → chọn assistant **"Thư cử công tác / Business-trip Letter"**.
2. Tải lên 3 tệp: (a) ảnh hộ chiếu, (b) thư mời PDF, (c) ảnh chụp hồ sơ Teams của nhân viên.
3. Kiểm tra bảng tóm tắt, xác nhận **công ty (entity)** và **ngày công tác**; nhập ngày nghỉ phép nếu cần.
4. Mở tệp `.docx` được tạo, kiểm tra các mục được đánh dấu, rồi chuyển C&B ký. / Open the generated `.docx`, check flagged items, then route to C&B for signature.

> The assistant DRAFTS only. A human must review and sign. / Assistant chỉ tạo bản nháp; người phải kiểm tra và ký.

## Data to verify (owner: HR/legal) / Dữ liệu cần xác minh
- `reference/entities.json`: every entity has `"verified": false` until head office, tel, scope, and signatory are confirmed. Set `"verified": true` once checked.

## Share with a teammate / Chia sẻ cho đồng nghiệp
1. Send them the whole `business-trip-letter/` folder.
2. They: **Settings → Skills Hub → Import** → select the folder.
3. They: **Settings → Assistants → Create** (or duplicate an office assistant) and repeat Task 4 (rules, pin skill + `greennode-idp` + `aionui-image-analysis` + officecli-docx, fixed model, starter prompt).
   (There is no one-click "share assistant" yet — this is the v1 path.)

## Known limitations
- Requires the `officecli` binary + `greennode-idp` + Kimi vision MCPs enabled.
- Passport OCR from a phone photo can misread; the invitation cross-check catches most errors — always review.
- <record dry-run result + officecli fill mode from Task 5 here>
````

- [ ] **Step 2: Verify the folder is complete**

Run:
```bash
cd /Users/lap16603/Projects/WePrompt
find docs/superpowers/artifacts/business-trip-letter -type f | sort
```
Expected:
```
docs/superpowers/artifacts/business-trip-letter/SKILL.md
docs/superpowers/artifacts/business-trip-letter/USAGE.md
docs/superpowers/artifacts/business-trip-letter/reference/entities.json
docs/superpowers/artifacts/business-trip-letter/template/Mau-thu-cu-cong-tac-VNG.docx
```

---

## Future (v2 / B) — out of scope for this plan
- Package the skill as an **official backend preset** via the `package-assistant` workflow so it appears in everyone's "Official" pill bar (no per-user import/clone).
- Replace the Teams-screenshot step with the built-in **`tse-datahub` HR MCP** for direct lookup of title/email/phone/entity ("data integration").
- Consider building a one-click assistant export/share in WePrompt (the current platform gap).

---

## Self-Review

**1. Spec coverage** (each spec section → task):
- §3 approach (skill + local assistant) → Tasks 1–4. ✅
- §3 HR data (baked reference + Teams vision) → Task 2 (`entities.json`) + Task 3 (SKILL.md steps 3,5) + Task 5. ✅
- §4 building blocks (IDP, vision, officecli, assistant, skills import) → Task 0 (verify) + Task 4 (pin). ✅
- §5 UX flow → encoded in SKILL.md (Task 3) + validated in Task 5. ✅
- §6 artifacts (skill folder + assistant) → Tasks 1,2,3 + Task 4. ✅
- §7 extraction/validation rules (cross-validate, normalize, entity, never-invent, flag discrepancies) → SKILL.md Workflow + Rules (Task 3); checked in Task 5 Step 3. ✅
- §8 output (.docx to workspace, filename) → SKILL.md step 8 + Task 5 Steps 4–5. ✅
- §9 prereqs/PII/deps → Task 0 + Task 2 dependency + USAGE.md. ✅
- §10 rollout/team share → Task 5 (validate) + Task 6 (share steps); v2 in Future section. ✅
- §11 open items → surfaced: model/runtime (Task 0/4), leave dates (SKILL.md step 7 + Task 5 Step 4), real entities (Task 2 dependency), Teams-vs-invitation precedence (SKILL.md mapping: Teams for contact, cross-check title). ✅

**2. Placeholder scan:** No "TBD/TODO". The `<test.email>` / `<test phone>` in Task 5 are deliberate dry-run stand-ins; the `<record ...>` in USAGE.md is a fill-during-execution result field, not a design gap. `entities.json` starter values are explicitly marked `"verified": false`.

**3. Type/name consistency:** Skill name `business-trip-letter`, tool id `greennode_idp_read_document`, MCP ids `greennode-idp` / `aionui-image-analysis`, template filename `Mau-thu-cu-cong-tac-VNG.docx`, reference `entities.json`, output `Thu-cu-cong-tac-<GivenName>.docx` — used consistently across Tasks 1–6.

No gaps found.
