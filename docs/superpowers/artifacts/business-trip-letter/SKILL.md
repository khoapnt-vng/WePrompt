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
