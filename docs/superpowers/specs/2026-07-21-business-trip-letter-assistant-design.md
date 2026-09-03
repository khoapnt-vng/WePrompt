# Design Spec — "Business-trip Letter" Assistant for WePrompt

- **Date:** 2026-07-21
- **Status:** Approved design (v1), pending spec review → implementation plan
- **Author:** Andy (Trần Quang Minh) + Claude
- **Topic slug:** `business-trip-letter-assistant`
- **Location note:** This file lives under `docs/superpowers/` which is gitignored (`.gitignore:204`). It is a local working doc and is intentionally **not committed**.

---

## 1. Background & problem

An internal request (email "mẫu tham khảo AI làm thư cử công tác", 2026-07-21, from Mai Thụy Khương / Vy to Lê Thanh, CC Andy) asks whether AI can auto-generate the **"thư cử công tác"** — a VNG visa-support letter ("Letter Decision") sent to the **Consulate General of China in HCMC** to support an employee's business-trip visa.

Inputs referenced in the request (all attached to that email):
- **VNG Word template** (`Mẫu thư cử công tác VNG.docx`) — the letter to fill; fields highlighted with Vietnamese annotations.
- **Partner invitation letter** (`邀请函-单次-Phùng Ngọc Bảo Vy.pdf`) — Chinese single-entry invitation from Wuhan Guangyue Interactive Technology Co., Ltd., containing trip dates, inviter, and a table of traveler passport data + position.
- **Passport photo** of the traveler.

Vy's explicit questions:
1. Which VNG legal entity does the employee ("Starter") belong to? → drives the letter's company block.
2. Can AI read the trip date from the invitation directly, or must it be typed into an Excel? → **Yes, AI can read it directly** (the invitation is machine-readable text; no Excel needed).
3. Can AI read the passport + pull the job position from HR?

**Goal restated by the requester (Andy):** don't build a bespoke code feature — instead enable **Vy (a non-technical HR/C&B user) to solve this herself in WePrompt, efficiently**, and reusable across the HR team.

### Data discrepancies found during review (must be surfaced to a human, never auto-resolved)
- **Entity mismatch:** template letterhead says "VNG GROUP JSC" (Z06 Tan Thuan, tel …3962 3888); the invitation is addressed to "VNGGames Co., Ltd" (Saigon Paragon, tel …3926 3888). The letter's company block must match the entity that employs the traveler **and** that the invitation names.
- **Inviter email:** invitation PDF shows `fenglili@ghgame.cn` (partly under the seal); the email signature block shows `fenglili@ghgame.com.cn`.
- **Trip phases:** the VNG template *example* shows two visit phases (Nov + Dec 2025); this invitation has a **single** range (15–19 Aug 2026). The generator must adapt phase count to the invitation.
- **Fields present in no document:** traveler work email, phone; the entity letterhead block; the signatory; leave dates.

---

## 2. Goals / non-goals

### Goals
- Let Vy produce a correct, review-ready filled `.docx` letter from a small, low-effort set of uploads.
- Minimize manual typing and eliminate the repeated, error-prone re-entry of the company block.
- Keep a mandatory **human sign-off** step (consular/legal document).
- Package the workflow so it is **reusable and shareable** with the HR team, and can graduate to a team-wide official assistant later.

### Non-goals (YAGNI)
- No new bespoke in-app HR-letter screen/feature in v1.
- No building of an assistant export/share UI.
- No leave-system integration.
- No multi-consulate routing logic beyond a reference line (HCMC assumed).
- No auto-submission to any consulate/portal.
- The assistant never signs, finalizes, or asserts legal validity.

### Success criteria
- Vy selects the assistant, uploads 3 files, confirms entity + dates, and receives a filled `.docx` that matches the template with correct traveler + partner + trip data — validated end-to-end against the real sample files (Phùng Ngọc Bảo Vy) before handover.

---

## 3. Chosen approach

**Packaging: "A now → B later"** (user-approved).
- **v1 (A):** a shareable **skill** + a **local custom Assistant** in WePrompt, using only capabilities that exist today.
- **v2 (B):** graduate to an **official backend preset** (via the `package-assistant` workflow) and swap the Teams-screenshot step for the built-in `tse-datahub` HR MCP ("data integration").

**HR/non-document data strategy** (user-approved, then refined):
- **Baked reference** in the skill for stable data (VNG entities → letterhead + signatory; HCMC consulate line).
- **Teams profile screenshot**, read by the Kimi vision MCP, for the person-specific fields (work email, phone, job title) — "until we can have data integration."

---

## 4. Verified WePrompt building blocks (all exist today)

From source exploration of `packages/desktop` (thin client over the AionCore backend):
- **Assistant primitive** — preset system prompt (`AssistantRules.content`), pinned skills, fixed/auto model, permission mode, starter prompts; user-selectable from a pill bar on the new-chat screen; official assistants can be duplicated into editable copies. Types: `packages/desktop/src/common/types/agent/assistantTypes.ts`; CRUD `.../adapter/ipcBridge.ts:173-189`; UI `.../pages/settings/AssistantSettings/`, `.../pages/guid/components/AssistantSelectionArea.tsx`.
- **File attach** — PDF/PNG/JPG/DOCX upload to the conversation workspace as file paths (`ISendMessageParams = { content, files? }`, `ipcBridge.ts:1560-1563`; `renderer/services/FileService.ts`). Size cap is backend-enforced (HTTP 413 → `FILE_TOO_LARGE`).
- **Passport / PDF OCR** — built-in MCP `greennode-idp`, tool `greennode_idp_read_document` (`process/resources/builtinMcp/idpServer.ts:27-38`), explicitly supports "ID cards, **passports**, invoices, PDFs" via VNG Cloud IDP.
- **Image vision** — built-in MCP `aionui-image-analysis` → Moonshot **Kimi `kimi-k2.6`** (`process/resources/builtinMcp/visionServer.ts`, `common/chat/visionCore.ts:71`). Reads the Teams screenshot.
- **Office generation** — agent follows an `officecli-*` skill and shells out to the **`officecli`** binary (`process/services/office-artifact/officeCliRunner.ts`); output `.docx` written into the workspace, with in-app preview (`officecli watch`) and open-in-Word (`POST /api/shell/open-file`). **Binary is not bundled** — resolved via `OFFICECLI_PATH` / `~/.local/bin/officecli` / PATH; missing → `OFFICECLI_NOT_FOUND`.
- **Skills import/share** — `GET /api/skills`, `POST /api/skills/import`, Skills Market (`ipcBridge.ts:621-716`); UI `pages/settings/SkillsHubSettings.tsx`. A skill is a folder (`SKILL.md` + files); shareable by sending the folder + importing.
- **Models** — VNG GreenNode (`minimax/minimax-m2.5`, `openai/gpt-5`) + Moonshot Kimi seeded (`common/config/builtinSeed.ts`). Image/PDF understanding routes through the vision/IDP MCPs regardless of main model.
- **v2 lever** — built-in `tse-datahub` (HR headcount) MCP (`builtinSeed.ts:67-78`) for the future direct HR lookup.

**Known platform gap:** no one-click "export/share whole assistant." Team reuse in v1 = share the **skill** + clone the assistant.

---

## 5. Vy's experience (end to end)
1. New chat → pick the **Business-trip Letter** assistant from the pill bar.
2. Upload 3 files: **passport photo**, **invitation PDF**, **Teams profile screenshot**.
3. Assistant reads all three, cross-checks, and shows a **confirmation summary** (filled-field table) with uncertain items flagged.
4. Vy **confirms the VNG entity** (from the baked list) and **trip dates**; adds leave dates if the letter requires them.
5. Assistant fills the template via `officecli` → writes `Thu-cu-cong-tac-<GivenName>.docx` to the workspace; Vy previews in-app / opens in Word.
6. Vy reviews → routes to C&B for **wet signature**. (Assistant drafts; a person signs.)

---

## 6. Artifacts

### 6.1 Skill `business-trip-letter` (shareable/versionable unit)
```
business-trip-letter/
  SKILL.md                       # workflow instructions (see §7)
  template/
    Mau-thu-cu-cong-tac-VNG.docx # the VNG template (from Vy's email)
  reference/
    entities.json                # VNG entities → letterhead + signatory; HCMC consulate line
```
`entities.json` shape (illustrative):
```json
{
  "consulate": "CONSULATE GENERAL OF CHINA IN HO CHI MINH CITY",
  "entities": [
    {
      "id": "vnggames",
      "name": "VNGGames Co., Ltd",
      "head_office": "2nd Floor, Saigon Paragon Building, No. 3 Nguyen Luong Bang, Tan My Ward, Ho Chi Minh City, Vietnam",
      "tel": "(84.8) 3926 3888",
      "scope": "Online Game, Software etc.",
      "signatory": { "name": "NGUYỄN THỊ NGUYỆT MINH", "title": "Head of Compensation & Benefits" }
    }
  ]
}
```
> **Dependency:** the real entity list + letterhead + signatory must be collected once from HR/legal. Sample values above are placeholders drawn from the attachments and MUST be verified before use.

### 6.2 Assistant "Business-trip Letter"
- **Pinned skill:** `business-trip-letter`.
- **Pinned tools/MCPs:** `greennode-idp`, `aionui-image-analysis` (Kimi vision), `officecli` (via office skill dependency).
- **Model/runtime:** a capable fixed model (candidate: the Gemini office runtime used by the built-in office assistants, or `openai/gpt-5`); finalize in the plan.
- **Starter prompt (bilingual VN/EN):** e.g. *"Tải lên hộ chiếu, thư mời và ảnh chụp hồ sơ Teams để tạo thư cử công tác."*
- **Permission mode:** default; the officecli write + workspace file ops are the only side effects.

---

## 7. Extraction, normalization & validation rules (accuracy core)

### 7.1 Field → source mapping
| Template field | Source | Reader |
|---|---|---|
| Company name / head office / tel / scope | `entities.json` (Vy confirms entity) | reference |
| "at the invitation of …" (partner) | Invitation PDF | greennode-idp |
| Name | Passport (cross-check invitation) | greennode-idp |
| Position / job title | Teams screenshot (cross-check invitation) | Kimi vision |
| Nationality | Passport | greennode-idp |
| Date of birth | Passport (cross-check invitation) | greennode-idp |
| Passport No. | Passport (cross-check invitation) | greennode-idp |
| Date of issue / expiry | Passport (cross-check invitation) | greennode-idp |
| Work email / phone | Teams screenshot | Kimi vision |
| Trip dates (N phases) | Invitation PDF | greennode-idp |
| Purpose (inviter name-title) | Invitation PDF | greennode-idp |
| Meeting location / contact / partner email | Invitation PDF | greennode-idp |
| Signatory + letter date | `entities.json` + current date | reference |

### 7.2 Rules
- **Cross-validate** passport vs invitation on name / DoB / passport no. / issue / expiry → flag mismatches; do not silently pick one.
- **Normalize** dates → `DD Month YYYY` (template style); preserve Vietnamese diacritics; parse passport **MRZ** as robust fallback.
- **Entity**: propose from invitation addressee + Teams dept, Vy confirms from `entities.json`; letterhead pulled from reference (fixes the VNG GROUP JSC vs VNGGames Co., Ltd mismatch).
- **Trip phases**: adapt to the invitation (single range here; support N).
- **Never invent**: unfound fields shown as *"— needs confirmation"*. The assistant never claims the letter is final/valid.
- **Surface discrepancies** explicitly (inviter email `.cn` vs `.com.cn`; head-office tel digits) for human resolution.
- Always end with the **human review + sign-off** reminder.

---

## 8. Output
Filled `.docx` (same template, fields replaced) written to the conversation workspace → in-app Office preview + open-in-Word. Filename `Thu-cu-cong-tac-<GivenName>.docx`.

---

## 9. Prerequisites, risks, dependencies
- **Prereqs:** `officecli` binary installed (`OFFICECLI_PATH` / `~/.local/bin/officecli`); `greennode-idp` + Kimi vision MCPs enabled (IDP may require OAuth).
- **PII:** passport + Teams data flow through VNG-internal MCPs (GreenNode / Kimi) — reasonable, but confirm acceptable with security since passports are involved.
- **Dependency:** `entities.json` reference data collected + verified once.
- **Platform gap:** no one-click assistant share (v1 = skill import + clone).

---

## 10. Rollout & graduation
- **v1:** import skill + create assistant on Vy's WePrompt; validate against the real sample files; hand over with a short usage note.
- **Team:** share the skill folder; teammates import + clone the assistant (documented steps).
- **v2 / B:** package as an official backend preset (`package-assistant` workflow); swap Teams screenshot → `tse-datahub` HR MCP.

---

## 11. Open items / decisions log
- **Decided:** reusable assistant (not one-off prompt); baked reference + Teams-screenshot vision for person data; A-now-→-B-later packaging; human sign-off mandatory.
- **Open (resolve in plan):** exact model/runtime to pin; whether leave dates are required on the letter; real `entities.json` contents; whether phone/title should prefer Teams vs invitation when both present (proposal: Teams for contact fields, HR/Teams title with invitation cross-check).
