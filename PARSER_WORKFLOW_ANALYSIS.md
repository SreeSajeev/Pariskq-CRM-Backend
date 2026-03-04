# Email Parsing System — Full Workflow Analysis

**Read-only reverse-engineering.** No code was modified.

---

## Step 1 — Parsing Entry Points

### Where inbound emails are first processed

| Entry point | File | Location |
|-------------|------|----------|
| **Postmark inbound webhook** | `Pariskq-CRM-Backend/src/app.js` | `app.post("/postmark-webhook", ...)` at **lines 272–315** |

### Flow from webhook

1. **POST /postmark-webhook** receives `req.body` as the Postmark inbound payload.
2. **Validation:** Requires `email.MessageID`; returns 400 if missing.
3. **Extraction:**  
   - `fromEmail` = `email.FromFull?.Email || email.From`  
   - `toEmail` = `email.ToFull?.Email || email.To`  
   - `subject` = `email.Subject`  
   - `received_at` = `email.ReceivedAt || new Date().toISOString()`  
   - `payload` = full `email` object (stored as-is).
4. **Insert:** One row into Supabase table **`raw_emails`** with:
   - `message_id`, `thread_id`, `from_email`, `to_email`, `subject`, `received_at`, `payload`, `processing_status: "PENDING"`, `created_at`.
5. **Response:** 200 "Email received" (or 500 on insert failure).

**Worker trigger:** The webhook does **not** call the parser or worker. The **auto ticket worker** runs on a loop (startup + interval, see `app.js` `startWorkerLoop`). It **polls** `raw_emails` for rows with `processing_status` null or `PENDING` and processes them.

---

## Step 2 — Parsing Pipeline (Full Execution Path)

### Call chain

```
Webhook:  POST /postmark-webhook  (app.js)
            → supabase.from('raw_emails').insert(...)
            → Email stored; no parsing here.

Worker:   runAutoTicketWorker()  (autoTicketWorker.js)
            → fetchPendingRawEmails()  [rawEmailsRepo.js]
            → for each raw:
                 → classifyEmail(raw)  [emailClassificationService.js]
                 → if not COMPLAINT → updateRawEmailStatus(IGNORED_*) ; continue
                 → parseEmail(raw)  [parsingService.js]
                 → normalizeParsedTicket(parsed, raw)  [parsingService.js]
                 → sanitizeParsedLocation(parsed)  [parsingService.js]
                 → countStructuredComplaintFields(parsed)  [ticketService.js]
                 → if < 2 → updateRawEmailStatus(IGNORED_INSUFFICIENT_DATA) ; continue
                 → validateRequiredFields(parsed)  [requiredFieldValidator.js]
                 → calculateConfidence(parsed)  [confidenceService.js]
                 → insertParsedEmail(...)  [parsedEmailsRepo.js]  → parsed_emails
                 → findTicketByComplaintId(parsed.complaint_id)  [ticketsRepo.js]
                 → if existing → addEmailComment, updateRawEmailStatus(COMMENT_ADDED) ; continue
                 → createTicket(parsed, raw, { requiredComplete })  [ticketService.js]
                    → insertTicket(...)  [ticketsRepo.js]  → tickets
                    → createSlaRow(...)  [slaService.js]
                    → sendMissingDetailsEmail or sendTicketConfirmation  [emailService.js]
                 → updateRawEmailStatus(TICKET_CREATED)
                 → markParsedAsTicketed(parsedRow.id)
```

### Reply flow (separate path)

- If subject contains `[Ticket ID: <number>]`, worker uses **handleReplyFlow** instead of creating a new ticket:
  - **extractNewReplyContent(raw)** uses `getEmailText(raw)` and strips lines starting with `On `, `From:`, `Sent:` and lines starting with `>`.
  - **parseEmailFromText(content)** parses reply body only (no `normalizeParsedTicket` or `sanitizeParsedLocation`).
  - **mergeParsedIntoTicket(ticket, replyParsed)** fills only empty structured fields.
  - **updateTicketFields** / **updateTicketStatus(OPEN)** if needed.

### Functions involved (in order)

| Order | Function | File |
|-------|----------|------|
| 1 | Webhook handler | app.js |
| 2 | runAutoTicketWorker | autoTicketWorker.js |
| 3 | fetchPendingRawEmails | rawEmailsRepo.js |
| 4 | extractTicketNumberFromSubject | autoTicketWorker.js |
| 5 | findTicketByTicketNumber | ticketsRepo.js |
| 6 | handleReplyFlow (reply path) | autoTicketWorker.js |
| 7 | extractNewReplyContent, getEmailText | autoTicketWorker.js, emailParser.js |
| 8 | parseEmailFromText | parsingService.js |
| 9 | mergeParsedIntoTicket, updateTicketFields, hasRequiredFieldsForOpen, updateTicketStatus | ticketService.js, ticketsRepo.js |
| 10 | classifyEmail | emailClassificationService.js |
| 11 | parseEmail | parsingService.js |
| 12 | getEmailText | emailParser.js |
| 13 | normalizeParsedTicket | parsingService.js |
| 14 | sanitizeParsedLocation | parsingService.js |
| 15 | countStructuredComplaintFields | ticketService.js |
| 16 | validateRequiredFields | requiredFieldValidator.js |
| 17 | calculateConfidence | confidenceService.js |
| 18 | insertParsedEmail | parsedEmailsRepo.js |
| 19 | findTicketByComplaintId | ticketsRepo.js |
| 20 | addEmailComment (if existing ticket) | commentService.js |
| 21 | createTicket | ticketService.js |
| 22 | getEmailText (for short_description fallback) | ticketService.js |
| 23 | insertTicket | ticketsRepo.js |
| 24 | createSlaRow | slaService.js |
| 25 | sendMissingDetailsEmail / sendTicketConfirmation | emailService.js |

---

## Step 3 — Field Extraction

### Where extraction happens

- **parseEmail(raw)** and **parseEmailFromText(text)** in `parsingService.js`.
- **normalizeParsedTicket(parsed, raw)** adds fallbacks for **complaint_id** and **vehicle_number** only; other fields are not re-extracted.

### Field-by-field

| Field | How it is extracted | Regex / logic | Fallback |
|-------|---------------------|---------------|----------|
| **complaint_id** | In **parseEmail**: `extractComplaintId(text)` only. In **normalizeParsedTicket**: if still empty, `extractField('Complaint ID', text) \|\| extractField('Record ID', text) \|\| extractField('Incident Number', text)`. | **extractComplaintId:** `/\bCCM\d{4,15}\b/i` → first match, uppercased. **extractField:** label-based regex (see below). | Normalization layer adds label aliases (Complaint ID, Record ID, Incident Number). |
| **vehicle_number** | `extractVehicle(text) \|\| extractField('Vehicle number', text)`. In **normalizeParsedTicket**: if still empty, scan with Indian reg pattern. | **extractVehicle:** `/\bVEHICLE\s+([A-Z]{2,3}\d{1,2}[A-Z]{0,2}\d{3,4})\b/i`. **extractField:** label-based. | **VEHICLE_FALLBACK_REGEX:** `/\b([A-Z]{2}\d{1,2}[A-Z]{0,2}\d{3,4})\b/` on cleaned body. |
| **category** | `extractField('Category', text)`. | Label-based only. | None. |
| **issue_type** | `extractField('Issue type', text) \|\| extractField('Item Name', text)`. | Label-based only. | None. |
| **location** | `extractField('Location', text)`. Then **normalizeParsedTicket** may split at LOCATION_BOUNDARY_PATTERNS and move overflow to remarks. **sanitizeParsedLocation** caps length and trims disclaimers. | Label-based; then boundary split (Submitted By, Submit Date, etc.). | None. |
| **remarks** | `extractField('Remarks', text) \|\| extractField('Description', text)`. Then **normalizeParsedTicket** may append location overflow and (if parser left remarks empty) cleaned-body remainder after stripping label lines. | Label-based. | Remainder from cleaned body only when parser did not find Remarks/Description. |
| **reported_at** | `extractField('Reported At', text)`. | Label-based only. | None. |
| **contact_number** | **Not extracted.** No reference in parsingService, ticketService, or schema for contact_number. | — | — |

### extractField(label, text) — label detection

- **FILE:** `parsingService.js` (lines 37–49).
- **Logic:** Builds a regex from **FIELD_LABELS** (all labels except the requested one). Pattern:  
  `${label}\\s*[:\\-]?\\s*(.*?)\\s*(?=${otherLabels}|$)`  
  (case-insensitive). Captures content **after** the label until the **next** known label or end of string.
- **FIELD_LABELS:** Category, Description, Issue type, Item Name, Location, Remarks, Reported At, Incident Title, Vehicle number.
- **Implication:** Only these labels are boundaries. "Complaint ID" is not in FIELD_LABELS, so when used in normalizeParsedTicket the regex uses all FIELD_LABELS as lookahead; it still works for "Complaint ID: VALUE".

### getEmailText(raw)

- **FILE:** `utils/emailParser.js` (lines 78–110).
- **Input:** Object with `raw.payload` (Postmark payload) and `raw.subject`.
- **Behavior:** Reads `payload.TextBody` or `payload.textBody`, `payload.HtmlBody` or `payload.htmlBody`; decodes base64 if needed; converts HTML to text; returns `normalize([subject, textBody, htmlText].filter(Boolean).join('\n'))`.
- **No** reply-chain or signature removal here; that is done later in **cleanEmailBody** (used only inside **normalizeParsedTicket**).

---

## Step 4 — Known Bugs and Exact Causes

| Bug | Cause (exact code / behavior) |
|-----|--------------------------------|
| **1. Complaint ID sometimes not extracted** | **parseEmail** only sets `complaint_id` from **extractComplaintId(text)**, which matches **only** `\bCCM\d{4,15}\b`. Non-CCM IDs (e.g. "TEST-NEW-001", "Complaint ID: TEST-NEW-001") are ignored. **normalizeParsedTicket** now adds a fallback via `extractField('Complaint ID', ...)` etc., so if that fallback runs and the label is present, it is fixed; if the fallback fails (e.g. label spelled differently or on next line), it can still be null. |
| **2. Location includes "Submitted By Arjun Mehta"** | **extractField('Location', text)** captures everything from "Location" until the **next** occurrence of any **FIELD_LABELS** term. "Submitted By", "Submit Date", etc. are **not** in FIELD_LABELS, so they are captured as part of location. **normalizeParsedTicket** then splits location at **LOCATION_BOUNDARY_PATTERNS** (which include Submitted By, Submit Date, etc.) and moves the rest to remarks. So after normalization, location should be cleaned **if** the boundary is found; if the pattern fails (e.g. different wording), overflow can remain in location. **sanitizeParsedLocation** only caps length and trims disclaimer starters; it does not remove "Submitted By" text. |
| **3. Remarks sometimes contain labels** | When **parsed.remarks** was **empty** (parser did not find Remarks/Description), **normalizeParsedTicket** appends "remainder" from the cleaned body. That remainder was (in the past) not stripped of lines starting with "Complaint ID", "Vehicle Number", "Location", etc. The current code uses **stripLabelLinesFromRemainder** and only appends remainder when **!hadRemarksFromParser**. So if the parser **did** set remarks from Description, remainder is no longer appended. If a bug persists, it could be: (a) remainder path still used when it shouldn’t be, or (b) label-line stripping missing some variants. |
| **4. Description not populating remarks** | **parseEmail** sets `result.remarks = extractField('Remarks', text) \|\| extractField('Description', text)`. So "Description:" is already a supported label. If it fails, causes can be: (1) Text is normalized to one line (`text.replace(/\s+/g, ' ').trim()`), so "Description:\nThe GPS tracker..." becomes "Description: The GPS tracker..."; the regex should still match. (2) Another label in FIELD_LABELS appears before "Description" and consumes the content. (3) HTML/encoding in body so "Description" is not literally present. |
| **5. Vehicle numbers not detected in free-text** | **parseEmail** uses **extractVehicle(text)** (pattern `VEHICLE\s+...`) and **extractField('Vehicle number', text)**. If the email says only "The number is GA07T2690" with no "Vehicle number:" or "VEHICLE " prefix, both fail. **normalizeParsedTicket** adds a **vehicle number fallback** using `VEHICLE_FALLBACK_REGEX` on the cleaned body, so a standalone Indian-style plate can be picked up. If still missing, the pattern may not match (e.g. different format) or cleaned body may be empty. |

---

## Step 5 — Fragile Parts

| Area | Why it’s fragile |
|------|-------------------|
| **Parsing entire email without cleaning (in parseEmail)** | **parseEmail** runs **getEmailText(raw)** which returns subject + full body (no reply/signature stripping). So **extractField** runs on the **whole** body including quoted replies and signatures. The next-label boundary can be a long way away, or the capture can include junk. |
| **Reply chain / quoted content** | **cleanEmailBody** (used only in **normalizeParsedTicket**) drops lines starting with `>` and stops at "On Mon,", "From:", etc. **parseEmail** does **not** use cleanEmailBody; it uses raw **getEmailText(raw)**. So the **first** extraction (parseEmail) sees the full thread. Reply flow uses **extractNewReplyContent** which stops at "On ", "From:", "Sent:" and skips `>` lines—so reply path is cleaner. |
| **extractField boundary set** | **FIELD_LABELS** is fixed. Any label not in the list (e.g. "Complaint ID", "Contact Number") is not a boundary for other fields, so long runs of text can be attributed to the previous label. |
| **Location overflow logic** | **findFirstBoundaryIndex** uses a list of patterns; the **first** match wins. If location is "Office A Contact Numbers 123" the split happens at "Contact Numbers", leaving "Office A". If the wording is "Contact: 123" or "Ph: 123", no match and no split. |
| **Remainder appending** | Remainder is appended only when `!hadRemarksFromParser`. So when the parser **did** get Remarks/Description, remainder (and its label stripping) is skipped. Logic is correct; fragility is in **stripLabelLinesFromRemainder** (must cover all label variants) and **findSignatureStart** (must catch all signature styles). |
| **Vehicle fallback regex** | `[A-Z]{2}\d{1,2}[A-Z]{0,2}\d{3,4}` matches standard Indian plates; odd formats (e.g. with spaces or different lengths) may not match. |
| **Order of operations** | Normalization runs **after** parseEmail. So complaint_id/vehicle fallbacks and location split depend on **normalizedFullText** / **cleanedBody**. If getEmailText or cleanEmailBody fails or returns empty, fallbacks do nothing. |

---

## Step 6 — Email Cleaning

### Function responsible

- **cleanEmailBody(text)** in `parsingService.js` (lines 197–216). **Not exported**; used only inside **normalizeParsedTicket**.

### Current behavior

- **Input:** Full email text (e.g. from getEmailText).
- **Line handling:**  
  - Skips lines where the **line** starts with `>` (quoted reply).  
  - Stops collecting at the **first line** that matches **BODY_STOP_PATTERNS** (Thanks & Regards, Regards, Best Regards, `--`, Disclaimer:, On Mon, … On Sun,, From:, Sent:, Subject:, Original Message, This email is confidential).
- **Output:** Kept lines joined with spaces, then trimmed.

### Effectiveness

- **Good:** Removes quoted `>` lines and stops at common signature/reply headers when they appear as **whole-line** (or line-start) patterns.
- **Gaps:** (1) **parseEmail** does **not** use cleanEmailBody; it uses raw getEmailText, so extraction runs on uncleaned text. (2) Inline signatures (e.g. "Call me. Thanks & Regards John" on one line) are not split; the whole line is dropped when "Thanks" is hit. (3) Variations like "Regards," with a comma or different spacing may not match. (4) cleanEmailBody is only used when building the **remainder** for remarks and for vehicle fallback; the **initial** parse still sees the full body.

---

## Step 7 — Worker Behavior

### Where ticket creation happens

- **autoTicketWorker.js** (lines 189–196): `createTicket({ ...parsed, confidence_score, needs_review }, raw, { requiredComplete: validation.isComplete })`.

### Where validation occurs

- **validateRequiredFields(parsed)** in `requiredFieldValidator.js` (before insert and before createTicket).  
- **countStructuredComplaintFields(parsed) >= 2** in `ticketService.js` (worker requires at least 2 structured fields or skips with IGNORED_INSUFFICIENT_DATA).

### Missing-field handling

- **requiredFieldValidator** returns `{ isComplete, missingFields }`. Only **isComplete** is used by the worker; it is passed as **requiredComplete** to **createTicket**.
- **createTicket** sets **status** = `requiredComplete ? 'OPEN' : 'NEEDS_REVIEW'`. If **isComplete** is false, ticket is created as NEEDS_REVIEW and **sendMissingDetailsEmail** is called (with missing/received details from **deriveMissingDetails** / **deriveReceivedDetails** in ticketService).

### Required fields for ticket creation

- **Validation (requiredFieldValidator):**  
  - **vehicle_number** must be non-empty.  
  - **location** must be non-empty.  
  - **issue_type** OR **remarks** must be non-empty (at least one).  
- **Worker gate:** At least **2** of the five structured fields (complaint_id, vehicle_number, category, issue_type, location) must be non-empty; otherwise email is IGNORED_INSUFFICIENT_DATA and no ticket is created.
- **createTicket** does not re-validate; it uses whatever parsed object it receives and maps it to DB columns (complaint_id, vehicle_number, category, issue_type, location, etc.). **short_description** is derived from remarks or getEmailText(raw).

---

## Step 8 — Output Structure

### Structure returned by the parser (after parseEmail + normalizeParsedTicket + sanitizeParsedLocation)

```js
{
  complaint_id,       // string | null
  vehicle_number,     // string | null
  category,           // string | null
  issue_type,         // string | null
  location,           // string | null
  reported_at,        // string | null
  remarks,            // string | null
  parse_errors,       // string[] (only from parseEmail)
  attachments         // [] (only from parseEmail; not populated)
}
```

- **parseEmailFromText** returns the same shape **except** no `parse_errors` or `attachments`.
- **contact_number** is **not** in the parser output or in the ticket insert payload. It is not extracted anywhere.

### Additional fields used by the worker / ticket creation

- **confidence_score**, **needs_review**: Added by the worker (from **calculateConfidence**), then passed to **insertParsedEmail** and **createTicket**.
- **short_description**: Not in parsed object; computed inside **createTicket** from `parsed.remarks` or getEmailText(raw), then stored in **tickets** table.

---

## Step 9 — Safety Constraints (Must Not Break)

| Component | Location | Constraint |
|-----------|----------|------------|
| **Database schema** | Supabase migrations, tickets/parsed_emails/raw_emails | Parser output and insert payloads must match existing columns. No new required columns without migration. |
| **ticketService.createTicket** | ticketService.js | Expects parsed fields (complaint_id, vehicle_number, category, issue_type, location, remarks) and raw email. short_description derived from remarks or getEmailText(raw). Do not change signature or required fields. |
| **Worker pipeline** | autoTicketWorker.js | Order must remain: parseEmail → normalizeParsedTicket → sanitizeParsedLocation. Then validation, confidence, insertParsedEmail, createTicket, updateRawEmailStatus. |
| **API routes** | app.js, routes/ | No change to route paths or contract of /postmark-webhook, /tickets, etc. |
| **Email sending** | emailService.js | Sends using parsed fields and ticket metadata; no change to which fields are read. |
| **requiredFieldValidator** | requiredFieldValidator.js | Required: vehicle_number, location, and (issue_type or remarks). Parser must continue to populate these when possible. |
| **countStructuredComplaintFields** | ticketService.js | Counts complaint_id, vehicle_number, category, issue_type, location. Worker requires >= 2 for ticket creation. |

---

## Step 10 — Final Output Summary

### 1. Complete parser workflow

- **Ingestion:** POST /postmark-webhook → insert into **raw_emails** (PENDING).
- **Processing:** Worker fetches PENDING raw_emails → classify → if COMPLAINT: **parseEmail** → **normalizeParsedTicket** → **sanitizeParsedLocation** → validate → confidence → insert **parsed_emails** → optional comment on existing ticket by complaint_id → else **createTicket** → insert **tickets** → createSlaRow → send email → update raw_emails status.

### 2. File locations

| Purpose | File |
|---------|------|
| Webhook | `Pariskq-CRM-Backend/src/app.js` (postmark-webhook) |
| Worker | `Pariskq-CRM-Backend/src/workers/autoTicketWorker.js` |
| Parse + normalize + sanitize | `Pariskq-CRM-Backend/src/services/parsingService.js` |
| Email text extraction | `Pariskq-CRM-Backend/src/utils/emailParser.js` |
| Validation | `Pariskq-CRM-Backend/src/services/requiredFieldValidator.js` |
| Ticket creation | `Pariskq-CRM-Backend/src/services/ticketService.js` |
| Classification | `Pariskq-CRM-Backend/src/services/emailClassificationService.js` |
| Confidence | `Pariskq-CRM-Backend/src/services/confidenceService.js` |
| Repos | `rawEmailsRepo.js`, `parsedEmailsRepo.js`, `ticketsRepo.js` |

### 3. Extraction methods

- **complaint_id:** CCM regex in parseEmail; in normalizeParsedTicket, extractField('Complaint ID'|'Record ID'|'Incident Number') if still empty.
- **vehicle_number:** extractVehicle (VEHICLE + plate) or extractField('Vehicle number'); in normalizeParsedTicket, Indian plate regex on cleaned body if still empty.
- **category, issue_type, location, remarks, reported_at:** extractField with label-based regex (content between this label and next FIELD_LABELS or end). remarks = Remarks || Description.
- **contact_number:** Not extracted.

### 4. Known bugs and causes

- Complaint ID null when not CCM and label fallback not used or failing.
- Location includes overflow when boundary patterns don’t match or run after a very long capture.
- Remarks contain labels when remainder was appended without stripping or when parser had no Remarks/Description and stripping missed variants.
- Description not populating remarks when extractField('Description') fails (boundary/format/encoding).
- Vehicle missing in free text when neither "Vehicle number:" nor "VEHICLE " present and fallback regex doesn’t match.

### 5. Recommended improvements (no code changes in this step)

- Use cleaned body (e.g. cleanEmailBody) for **initial** extraction in parseEmail, or ensure normalizeParsedTicket always runs and carries the main load.
- Add **contact_number** to extraction and schema if product needs it.
- Consider adding "Complaint ID" (and similar) to **FIELD_LABELS** so extractField boundaries are consistent.
- Broaden **BODY_STOP_PATTERNS** / **findSignatureStart** for more signature and reply-chain variants.
- Add tests for: CCM-only complaint_id, non-CCM complaint_id, location with Submitted By, remarks with/without Description, vehicle in free text only.
