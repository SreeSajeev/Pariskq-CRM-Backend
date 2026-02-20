# Incomplete-Email Intake Redesign — Architectural Analysis & Implementation Plan

**Role:** Senior Staff Engineer. **Scope:** Production SaaS. **Rule:** Infer only from existing code; no hallucination.

---

## 1. Detailed Architectural Analysis of the Current System

### 1.1 Data Flow (from code)

1. **Webhook** (app.js) inserts into `raw_emails` with `processing_status: "PENDING"`.
2. **Worker** fetches rows where `processing_status` is null or PENDING (`rawEmailsRepo.fetchPendingRawEmails`).
3. For each raw email:
   - Skip if `processing_status === 'PROCESSED_REPLY'`.
   - **Reply path:** If subject matches `[Ticket ID: XXX]`, lookup ticket by ticket_number; if found → `handleReplyFlow` (append comment, audit log, possibly NEEDS_REVIEW→OPEN, set raw to PROCESSED_REPLY) and **continue** (no ticket creation).
   - **Classification:** `classifyEmail(raw)` → `{ type, confidence, reasons }`. Types: COMPLAINT | PROMOTIONAL | AUTO_REPLY | UNKNOWN.
   - If `type !== 'COMPLAINT'` → set raw to IGNORED_* and **continue** (no ticket).
   - **Parse:** `parseEmail(raw)` → object with complaint_id, vehicle_number, category, issue_type, location, reported_at, remarks, parse_errors (parsingService uses getEmailText and label-based extraction; issue_type comes from label "Item Name").
   - **Required fields:** `validateRequiredFields(parsed)` checks only **vehicle_number, issue_type, location**. Returns `{ isComplete, missingFields }` (array of field names as strings, e.g. 'vehicle_number').
   - If `!validation.isComplete` → set raw to **AWAITING_CUSTOMER_INFO** with `missing_fields: validation.missingFields`, call **sendMissingInfoEmail** (customerClarificationService), **continue**. **No ticket is created; no ticket_number exists.**
   - **Confidence:** `calculateConfidence(parsed)` (complaint_id +40, vehicle_number +30, category +15, issue_type +15).
   - **Persist parsed:** `insertParsedEmail({ raw_email_id, ...parsed, confidence_score, needs_review: confidence < 95, ticket_created: false })`. Returns parsedRow.
   - If confidence < 80 → set raw to **DRAFT**, **continue** (no ticket).
   - **Dedupe:** If `parsed.complaint_id` present, `findTicketByComplaintId(parsed.complaint_id)`. If existing → addEmailComment, set raw to COMMENT_ADDED, markParsedAsTicketed, **continue**.
   - **Create ticket:** `createTicket({ ...parsed, confidence_score, needs_review }, raw)`. Then set raw to TICKET_CREATED, markParsedAsTicketed.

### 1.2 ticketService.createTicket (observed behavior)

- **Guards:** parsed not null, rawEmail object, parsed.confidence_score present, sender email resolvable (from_email | payload.FromFull.Email | payload.From).
- **Status:** `parsed.confidence_score >= 95` → OPEN, else NEEDS_REVIEW.
- **Insert:** tickets row with ticket_number, status, complaint_id, vehicle_number, category, issue_type, location, opened_by_email, opened_at, confidence_score, needs_review, source: 'EMAIL'.
- **Emails:** Always sends **sendTicketConfirmation** (subject "Complaint Received - [Ticket ID: XXX]"). If status === NEEDS_REVIEW, also **sendMissingDetailsEmail** (subject "Re: [Ticket ID: XXX] Additional Details Required", body lists missing details from deriveMissingDetails(parsed) — complaint_id, vehicle_number, category, issue_type, location).
- **Return:** { ticketNumber, status }. Does not persist missing_fields on the ticket.

### 1.3 requiredFieldValidator

- **Input:** parsed email object.
- **Required fields (exactly three):** vehicle_number, issue_type, location. Same semantics as ticketService.hasRequiredFieldsForOpen(ticket).
- **Output:** { isComplete: boolean, missingFields: string[] }. Never throws.

### 1.4 emailClassificationService

- **COMPLAINT** when: (hasComplaintId OR hasVehicle OR detectedIssues.length > 0) AND humanLike (wordCount >= 3, link count < wordCount/2). hasComplaintId = CCM regex; hasVehicle = VEHICLE regex; issue keywords: error, problem, not working, failed, etc.
- **No** notion of "at least one structured field" from the **parser**; classification uses raw text patterns, not parsed result.

### 1.5 Repositories

- **rawEmailsRepo:** fetchPendingRawEmails (or null/PENDING), updateRawEmailStatus(id, status, extra). `extra` is spread into update (e.g. missing_fields, linked_ticket_id, processing_error). Code assumes raw_emails has **processing_status** and accepts **linked_ticket_id** and **missing_fields** in extra; these columns are **not** in the initial migration in the repo (20260109071722). Production schema may differ.
- **parsedEmailsRepo:** insertParsedEmail(data), markParsedAsTicketed(id) (sets ticket_created: true on parsed_emails). Worker assumes parsed_emails has **ticket_created**; initial migration does not show this column — possible later migration or manual alter.
- **ticketsRepo:** findTicketByComplaintId, findTicketByTicketNumber (returns id, status, vehicle_number, issue_type, location), updateTicketStatus(ticketId, status), insertTicket(ticket).

### 1.6 emailService

- **sendTicketConfirmation:** subject "Complaint Received - [Ticket ID: XXX]", non-blocking, fails safely.
- **sendMissingDetailsEmail:** subject "Re: [Ticket ID: XXX] Additional Details Required", body lists missing details; used only when a ticket already exists (NEEDS_REVIEW from createTicket). Does **not** include "reply with [Ticket ID: XXX] in subject" in body (current text says "reply to this email" only).
- **customerClarificationService.sendMissingInfoEmail:** used when **no ticket** exists (AWAITING_CUSTOMER_INFO). Subject "Re: {originalSubject}"; no ticket number. Sends only if globalThis.sendEmail is set (not used by worker’s Postmark path), so in practice may not send.

### 1.7 Reply flow (current)

- Match by subject tag → findTicketByTicketNumber.
- extractNewReplyContent (strip quotes, stop at On/From:/Sent:).
- Append as comment (source EMAIL); audit_logs insert (entity_type ticket, action client_provided_additional_details, metadata raw_email_id).
- If ticket.status === NEEDS_REVIEW and hasRequiredFieldsForOpen(ticket) → updateTicketStatus(OPEN). **No merge of reply content into ticket fields**; hasRequiredFieldsForOpen uses **existing** ticket columns (vehicle_number, issue_type, location) only.
- raw_emails set to PROCESSED_REPLY, linked_ticket_id.

### 1.8 ticketStateMachine

- NEEDS_REVIEW → OPEN allowed. OPEN → ASSIGNED. No NEEDS_REVIEW → ASSIGNED. Other transitions as in ALLOWED_TRANSITIONS.

### 1.9 audit_logs usage (backend)

- Single use: in handleReplyFlow, insert { entity_type: 'ticket', entity_id: ticket.id, action: 'client_provided_additional_details', metadata: { raw_email_id } }. No other backend writes to audit_logs in the analyzed code.

### 1.10 Schema assumptions (from repo + code)

| Table        | Columns used by code beyond initial migration |
|-------------|-------------------------------------------------|
| raw_emails  | processing_status, linked_ticket_id, missing_fields (in updateRawEmailStatus extra). Initial migration has: id, message_id, thread_id, from_email, to_email, subject, received_at, payload, ticket_created, created_at. |
| parsed_emails | ticket_created (markParsedAsTicketed). Initial migration has: id, raw_email_id, complaint_id, vehicle_number, category, issue_type, location, reported_at, remarks, confidence_score, needs_review, created_at. |
| tickets     | status includes NEEDS_REVIEW; insertTicket uses ticket_number, status, complaint_id, vehicle_number, category, issue_type, location, opened_by_email, opened_at, confidence_score, needs_review, source. Types show priority. |

**Uncertainty:** Whether production has migrations that add processing_status, linked_ticket_id, missing_fields to raw_emails and ticket_created to parsed_emails. Plan should either assume they exist or add minimal migrations.

---

## 2. Gap Analysis vs Required Behavior

| Requirement | Current behavior | Gap |
|-------------|------------------|-----|
| Only COMPLAINT + at least one valid structured field → create ticket | COMPLAINT + **all** required fields (vehicle_number, issue_type, location) → create; else AWAITING_CUSTOMER_INFO, **no ticket** | Incomplete complaints do not get a ticket. Need: gate "at least one structured field" and **always create ticket** for complaints with partial data (status NEEDS_REVIEW). |
| Zero structured data → no ticket | Classification can be COMPLAINT from text patterns; if required fields missing, no ticket. Parser can return all nulls; still classified COMPLAINT if keywords + humanLike | Need explicit gate: if parsed has **no** structured fields (e.g. all complaint_id, vehicle_number, category, issue_type, location null/empty), do **not** create ticket (e.g. ignore or separate status). |
| Partial data → create ticket, status NEEDS_REVIEW | Only when required fields **complete** do we create; then status OPEN or NEEDS_REVIEW by confidence only | Must create ticket for any COMPLAINT with ≥1 structured field; set status = NEEDS_REVIEW for incomplete; store parsed fields; persist or derive missing_fields. |
| Email to client: Ticket ID, received + missing fields, "Reply with [Ticket ID: XXX] in subject" | sendMissingDetailsEmail has ticket ID and missing list; no explicit "include [Ticket ID: XXX] in subject" in body. sendMissingInfoEmail (no ticket) has no ticket ID | Need single path: always send from emailService with subject containing [Ticket ID: XXX], body: received fields, missing fields, and explicit instruction to reply with tag in subject. |
| Reply: parse reply, merge into ticket (fill only missing), re-validate, NEEDS_REVIEW→OPEN if complete | Reply flow appends comment only; does **not** parse reply body or merge into ticket columns; OPEN only if hasRequiredFieldsForOpen(ticket) on **existing** ticket | Need: parse reply content, extract fields, **merge** into ticket (update only null/empty columns), re-run required-field check, then NEEDS_REVIEW→OPEN if complete. |
| Idempotency: same raw not merge twice | PROCESSED_REPLY skips; reply path sets PROCESSED_REPLY | Keep; add: ensure merge/comment is idempotent (e.g. don’t re-append same content). |
| No duplicate tickets for same thread | Dedupe by complaint_id only | Thread dedupe not present (no thread_id-based dedupe). May need thread_id / message_id consideration if required. |
| Reply must not create new ticket | Reply path runs first; matched by subject tag → handleReplyFlow only | Already correct. |

---

## 3. Critical Design Questions — Answers

### 3.1 Where should missing_fields be stored?

- **Option A — On ticket (e.g. JSONB missing_fields):** Query-friendly for "review queue with missing X"; no need to recompute; survives reply merge (update when fields filled). **Tradeoff:** Schema change; must keep in sync on merge.
- **Option B — Derived dynamically:** Compute from ticket columns (vehicle_number, issue_type, location, etc. null/empty). No schema change; single source of truth. **Tradeoff:** Same list as hasRequiredFieldsForOpen + optional fields; if we add optional "missing" (e.g. complaint_id, category), derivation must match.
- **Recommendation:** **Derived dynamically** from ticket row for "required" (vehicle_number, issue_type, location). Optionally add a small **JSONB metadata column** on tickets (e.g. `email_metadata`) for "received vs missing at creation" for audit/display only; minimal and optional. For Phase 1, **derive only** to avoid schema change; add column only if product needs stored snapshot.

### 3.2 Ensure: zero structured data → no ticket; at least one meaningful field → ticket

- **Structured fields** (from parser): complaint_id, vehicle_number, category, issue_type, location (and optionally reported_at, remarks). Define **hasAnyStructuredComplaintField(parsed)** = at least one of these non-empty.
- **Gate before create:** If classification === COMPLAINT and **!hasAnyStructuredComplaintField(parsed)** → do not create ticket (treat as UNKNOWN or new status e.g. IGNORED_NO_STRUCTURED_DATA); set raw status and continue.
- **Gate for create:** If classification === COMPLAINT and hasAnyStructuredComplaintField(parsed) → proceed to create ticket (with status NEEDS_REVIEW if !validation.isComplete, else OPEN/NEEDS_REVIEW by confidence as today).

### 3.3 Reply parsing and merge

- **Parse reply:** Run parseEmail on the **reply body only** (e.g. extractNewReplyContent then parse that text, or a variant that accepts text). Obtain partial parsed object.
- **Merge rule:** For each field F in (complaint_id, vehicle_number, category, issue_type, location): if **ticket[F] is currently null/empty** and **parsedReply[F] is non-empty**, set ticket[F] = parsedReply[F]. Do not overwrite non-empty ticket fields.
- **Re-validate:** After merge, run validateRequiredFields on the **ticket row** (or a map of ticket columns). If complete, transition NEEDS_REVIEW → OPEN.
- **Confidence:** Recalculate confidence on merged ticket fields if desired for analytics; do not change lifecycle rules (OPEN only when required fields complete).

### 3.4 Prevent overwriting existing data

- Merge step: update ticket only for columns where current value is null or empty string; set from reply only when reply has a value. Use a single update with explicit columns and values built from merge result.

### 3.5 Impact on components

- **ticketService.createTicket:** (1) May be called with incomplete parsed (missing required fields). (2) Always set status = NEEDS_REVIEW when !validation.isComplete (override confidence-based OPEN). (3) Send one "missing details" email with ticket ID, received fields, missing fields, and "Reply with [Ticket ID: XXX] in subject." (4) No change to confidence-based OPEN when validation is complete (confidence >= 95 → OPEN remains).
- **autoTicketWorker:** (1) After classification and parse, add hasAnyStructuredComplaintField(parsed) check; if COMPLAINT but no structured field → ignore (no ticket). (2) If COMPLAINT and has structured field and !validation.isComplete → **create ticket** (NEEDS_REVIEW), send missing-details email, set raw to TICKET_CREATED, markParsedAsTicketed; do **not** use AWAITING_CUSTOMER_INFO for that case. (3) Keep AWAITING_CUSTOMER_INFO only for non-COMPLAINT or for COMPLAINT with zero structured data if we use that path. (4) Reply flow: after append comment, parse reply content, merge into ticket, re-validate, then NEEDS_REVIEW→OPEN if complete.
- **requiredFieldValidator:** Keep as-is (vehicle_number, issue_type, location). Use same for "complete for OPEN" and for deriving missing list when displaying.
- **emailService:** (1) Single "missing details" email used for NEEDS_REVIEW (with ticket): ensure body includes received fields, missing fields, and explicit instruction: "When replying, please include [Ticket ID: XXXXX] in the subject line." (2) Remove or repurpose customerClarificationService.sendMissingInfoEmail for "no ticket" path if that path is eliminated (incomplete complaints get ticket).
- **audit_logs:** Keep existing insert on reply (client_provided_additional_details). Optionally add metadata.reply_merged_fields or similar for traceability.

### 3.6 Recalculate confidence after merge?

- **Recommendation:** Yes, for analytics and display only. After merge, compute confidence from merged ticket row; optionally update tickets.confidence_score. Do **not** use updated confidence to change status (OPEN only from required-fields completeness).

### 3.7 Schema changes (minimal)

- **Required:** None for "derive missing_fields" approach. tickets and raw_emails already have the columns used.
- **Optional:** tickets: add `email_metadata JSONB` or `missing_fields_snapshot JSONB` for storing snapshot at creation; only if product needs it. raw_emails: code already assumes processing_status, linked_ticket_id (and possibly missing_fields); add migration if not present in production.

### 3.8 Migration strategy for existing AWAITING_CUSTOMER_INFO

- **Option A:** Leave as-is. New flow only applies to new emails; existing AWAITING_CUSTOMER_INFO rows stay without a ticket.
- **Option B:** One-time job: for each raw_email with AWAITING_CUSTOMER_INFO, create a ticket (NEEDS_REVIEW), link raw_emails, send missing-details email. High touch and risk of duplicate emails.
- **Recommendation:** Do **not** convert existing AWAITING_CUSTOMER_INFO automatically. Document that "review queue" and "reply with ticket ID" apply only to emails processed after the change. Optionally provide a manual "Create ticket from this email" in UI for old rows.

---

## 4. Implementation Plan (File-by-File, Logical Flow)

### 4.1 Helpers / shared logic

- **New (e.g. in ticketService or a small helper):** `hasAnyStructuredComplaintField(parsed)` — true if at least one of complaint_id, vehicle_number, category, issue_type, location is non-empty (same empty check as validator).
- **New:** `mergeParsedIntoTicket(ticketRow, parsedReply)` — returns object of { field: value } for fields that are empty on ticket and non-empty in parsedReply; do not include fields that would overwrite.
- **ticketService:** Add `updateTicketFields(ticketId, partialFields)` in repo or service that updates only provided columns (for merge).

### 4.2 Worker flow (logical)

1. Fetch pending raw emails (unchanged).
2. Skip PROCESSED_REPLY (unchanged).
3. **Reply path (unchanged):** subject tag → find ticket → handleReplyFlow. **Extend handleReplyFlow:** after adding comment, (a) get reply text via extractNewReplyContent(raw), (b) parse reply text (e.g. parseEmail with a wrapper that accepts text or a minimal parse-from-text), (c) load full ticket row (all mergeable columns), (d) compute merge object via mergeParsedIntoTicket(ticket, parsedReply), (e) if merge object non-empty, updateTicketFields(ticket.id, merge), (f) reload ticket or re-fetch, (g) if status === NEEDS_REVIEW and hasRequiredFieldsForOpen(ticket), updateTicketStatus(OPEN). Audit log already present.
4. **Classification:** Unchanged. If not COMPLAINT → ignore.
5. **Parse:** parseEmail(raw). Unchanged.
6. **Zero structured data gate:** If hasAnyStructuredComplaintField(parsed) === false → set raw to e.g. IGNORED_NO_STRUCTURED_DATA (or keep AWAITING_CUSTOMER_INFO but do not create ticket), optionally send a generic "we couldn't identify a complaint" email, continue.
7. **Required fields:** validateRequiredFields(parsed). If **isComplete** → keep current path: confidence, insert parsed, confidence < 80 → DRAFT, complaint_id dedupe, createTicket (OPEN or NEEDS_REVIEW by confidence).
8. **If !isComplete (incomplete but has structured data):** Do **not** set AWAITING_CUSTOMER_INFO. Do: insertParsedEmail (same as now), then **createTicket** with status **NEEDS_REVIEW** (force), then send **sendMissingDetailsEmail** (with ticket number, received fields, missing fields, and "reply with [Ticket ID: XXX] in subject"), set raw to TICKET_CREATED, markParsedAsTicketed.
9. Dedupe by complaint_id unchanged. createTicket signature unchanged; internally ticketService uses validation result to force NEEDS_REVIEW when incomplete.

### 4.3 ticketService.createTicket changes

- **Input:** Allow parsed with missing required fields (validation.isComplete false). Require hasAnyStructuredComplaintField(parsed) to be enforced in worker before call.
- **Status rule:** If validation.isComplete === false → status = NEEDS_REVIEW regardless of confidence. If validation.isComplete === true → current rule (confidence >= 95 → OPEN, else NEEDS_REVIEW).
- **Insert:** Same columns; nullable fields can be null.
- **Email:** Always confirmation. If status === NEEDS_REVIEW, send sendMissingDetailsEmail with: ticket ID, list of received fields (from parsed), list of missing fields (from validation.missingFields or deriveMissingDetails), and body line: "When replying, please include [Ticket ID: XXXXX] in the subject line."

### 4.4 emailService.sendMissingDetailsEmail changes

- **Body:** Add received fields section (e.g. "We received: Complaint ID, Vehicle number, …" for non-empty parsed fields). Already has missing list. Add sentence: "When replying, please include [Ticket ID: XXXXX] in the subject line."
- **Subject:** Already uses [Ticket ID: XXX]. No change.

### 4.5 customerClarificationService / sendMissingInfoEmail

- Used only when **no ticket** is created. After redesign, that path is only for "COMPLAINT but zero structured data" (or non-COMPLAINT). Either remove use from worker for the "incomplete complaint" path or keep for zero-structured case only. Do not use for incomplete-with-ticket path.

### 4.6 Parsing reply body

- **Option A:** parseEmail expects raw (with payload). Build a minimal "synthetic raw" from reply text so that getEmailText returns that text, then parseEmail(syntheticRaw). 
- **Option B:** Add parseEmailFromText(text) in parsingService that reuses the same extraction logic (extractComplaintId, extractVehicle, extractField) on the given string. Prefer Option B to avoid fake payloads.

### 4.7 ticketsRepo

- Add **updateTicketFields(ticketId, fields)** — updates only provided keys (e.g. vehicle_number, issue_type, location, complaint_id, category) so merge does not overwrite others. Use .update(fields).eq('id', ticketId).

### 4.8 Idempotency

- Reply: raw already marked PROCESSED_REPLY after first run; worker skips. No duplicate merge. Comment append: same raw processed once. If same reply body processed twice (e.g. status reset), we’d append comment twice — acceptable or add idempotency key (e.g. raw_email_id in comment metadata) and skip if comment with that raw_email_id exists. Latter is an enhancement; not required for minimal plan.

### 4.9 Edge cases

- **Parser returns all nulls but classification is COMPLAINT:** hasAnyStructuredComplaintField false → no ticket; mark ignored or low priority.
- **Reply parse returns nothing useful:** Merge object empty; ticket unchanged; still append comment; re-check hasRequiredFieldsForOpen (unchanged); no OPEN.
- **Reply contains same field as ticket (already filled):** Merge does not overwrite; no change.
- **Duplicate by complaint_id:** Unchanged; existing ticket gets comment, no new ticket.
- **Confidence < 80 with incomplete:** Current code sets DRAFT and does not create ticket. New behavior: if has structured field and incomplete → create ticket NEEDS_REVIEW (do not use confidence < 80 to skip creation when we now create for incomplete). So: move "confidence < 80 → DRAFT" to apply only when validation.isComplete === true; when incomplete we always create ticket and send email.

### 4.10 Failure modes

- createTicket throws: worker catch sets raw to ERROR. Unchanged.
- sendMissingDetailsEmail fails: .catch in createTicket; ticket already created. Unchanged.
- Merge update fails: log, leave ticket as-is; audit still written; raw still PROCESSED_REPLY to avoid retry loop.
- parseEmailFromText fails: return empty parsed; merge empty; comment still appended.

---

## 5. Risk Analysis

| Risk | Mitigation |
|------|------------|
| Production schema missing processing_status / linked_ticket_id | Add migration or verify; document assumption. |
| Parser "Item Name" vs "issue_type" mismatch | requiredFieldValidator and parser both use issue_type; ensure parseEmailFromText uses same extractField('Item Name', text) for issue_type. |
| Mail loop: client replies, we send another "missing details" | Send missing-details email only on **ticket creation**, not on reply. Reply flow only appends and merges; no automatic re-send. |
| Overwriting ticket data via merge | Merge only fills null/empty; never overwrite non-empty. |
| Analytics/SLA on NEEDS_REVIEW | Review queue = status NEEDS_REVIEW; existing dashboards that filter by status continue to work. SLA: clarify whether NEEDS_REVIEW starts SLA or not; current state machine allows NEEDS_REVIEW→OPEN; no change to state machine. |
| Backward compatibility | Existing tickets unchanged. New flow only for new emails. AWAITING_CUSTOMER_INFO rows not auto-converted. |

---

## 6. Implementation Phases

**Phase 1 — Gate and create for incomplete (no reply merge yet)**  
1. Add hasAnyStructuredComplaintField(parsed).  
2. Worker: if COMPLAINT and !hasAnyStructuredComplaintField → set raw status (e.g. IGNORED_NO_STRUCTURED_DATA), continue.  
3. Worker: if COMPLAINT and hasAnyStructuredComplaintField and !validation.isComplete → do not set AWAITING_CUSTOMER_INFO; insertParsedEmail; createTicket with forced NEEDS_REVIEW; send sendMissingDetailsEmail (with instruction "reply with [Ticket ID: XXX] in subject"); set raw TICKET_CREATED; markParsedAsTicketed.  
4. ticketService.createTicket: accept incomplete parsed; set status = NEEDS_REVIEW when required fields incomplete; send missing-details email with received + missing + reply instruction.  
5. emailService.sendMissingDetailsEmail: add received fields and "When replying, please include [Ticket ID: XXXXX] in the subject line."  
6. Worker: confidence < 80 → DRAFT only when validation.isComplete; when !isComplete, create ticket (step 3).  
7. Stop calling sendMissingInfoEmail for the incomplete-complaint path (use sendMissingDetailsEmail with ticket only).

**Phase 2 — Reply merge**  
1. parsingService: add parseEmailFromText(text) reusing existing extractors.  
2. ticketService (or repo): add mergeParsedIntoTicket(ticket, parsedReply), updateTicketFields(ticketId, fields).  
3. ticketsRepo: add updateTicketFields(ticketId, fields).  
4. handleReplyFlow: after comment append, parse reply with parseEmailFromText(extractNewReplyContent(raw)), load full ticket, compute merge, updateTicketFields if non-empty, re-fetch ticket, if NEEDS_REVIEW and hasRequiredFieldsForOpen → updateTicketStatus(OPEN).  
5. Optional: recalculate confidence after merge and update tickets.confidence_score.

**Phase 3 — Cleanup and hardening**  
1. customerClarificationService: use only for zero-structured-data case or remove from worker.  
2. Idempotency: optional check to avoid duplicate comment for same raw_email_id.  
3. Schema: add migration for raw_emails (processing_status, linked_ticket_id) and parsed_emails (ticket_created) if missing in production.  
4. Tests: incomplete email creates ticket NEEDS_REVIEW; reply with missing fields merges and moves to OPEN; zero structured data does not create ticket.

---

## 7. Summary

- **Current:** Only fully valid (required fields + confidence) emails create tickets; incomplete complaints get AWAITING_CUSTOMER_INFO and no ticket, so no ticket ID for reply or review queue.  
- **Target:** Complaints with at least one structured field always get a ticket (NEEDS_REVIEW if incomplete); client gets one email with ticket ID and clear reply instruction; reply flow merges parsed reply into ticket (fill-only), re-validates, and moves NEEDS_REVIEW→OPEN when complete.  
- **Missing_fields:** Derived from ticket row (vehicle_number, issue_type, location) for minimal change; optional JSONB snapshot later if needed.  
- **Schema:** No mandatory new columns for Phase 1–2; verify/add processing_status, linked_ticket_id, ticket_created if absent.  
- **Risks:** Schema drift, parser/reply parsing consistency, mail loops (mitigated by sending missing-details only on creation). Phases 1 then 2 keep changes incremental and testable.
