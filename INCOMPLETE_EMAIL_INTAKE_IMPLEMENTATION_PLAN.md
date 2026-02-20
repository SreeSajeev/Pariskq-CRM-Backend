# Incomplete-Email Intake — Implementation Plan (STEP 1)

**Status:** Plan only. No code until approved.  
**Rule:** Infer only from current code; zero hallucination.

---

## 1. Current Codebase Summary (Verified)

### 1.1 Backend

| File | Observed behavior |
|------|-------------------|
| **autoTicketWorker.js** | Reply path first (subject tag → handleReplyFlow). Then classify → parse → validateRequiredFields. If !isComplete → AWAITING_CUSTOMER_INFO, sendMissingInfoEmail, **continue (no ticket)**. Then confidence, insertParsedEmail. If confidence < 80 → DRAFT, **continue**. complaint_id dedupe → comment or continue. createTicket only when complete + confidence ≥ 80. |
| **ticketService.js** | createTicket requires parsed.confidence_score. status = confidence >= 95 ? OPEN : NEEDS_REVIEW. deriveMissingDetails uses complaint_id, vehicle_number, category, issue_type, location. sendMissingDetailsEmail only when status === NEEDS_REVIEW. hasRequiredFieldsForOpen(ticket) checks vehicle_number, issue_type, location. |
| **emailService.js** | sendMissingDetailsEmail: subject "Re: [Ticket ID: XXX] Additional Details Required", body lists missing details; **no** "reply with [Ticket ID] in subject" line; **no** "fields received" section. |
| **parsingService.js** | parseEmail(raw) uses getEmailText(raw). issue_type = extractField('Item Name', text) only. Structured fields: complaint_id, vehicle_number, category, issue_type, location, reported_at, remarks. No "Issue type" label. No parseEmailFromText(text). |
| **confidenceService.js** | calculateConfidence(p): complaint_id +40, vehicle_number +30, category +15, issue_type +15. |
| **requiredFieldValidator.js** | Validates vehicle_number, issue_type, location. Returns { isComplete, missingFields }. |
| **ticketsRepo.js** | findTicketByTicketNumber selects id, status, vehicle_number, issue_type, location (no complaint_id, category). updateTicketStatus(ticketId, status). insertTicket(ticket). No updateTicketFields. |
| **rawEmailsRepo.js** | fetchPendingRawEmails: or(processing_status.is.null, processing_status.eq.PENDING). updateRawEmailStatus(id, status, extra). |
| **parsedEmailsRepo.js** | insertParsedEmail(data), markParsedAsTicketed(id). |
| **commentService.js** | addEmailComment(ticketId, text) inserts body, source 'EMAIL'. |
| **emailClassificationService.js** | COMPLAINT when (hasComplaintId \|\| hasVehicle \|\| detectedIssues.length) && humanLike. No use of parsed structured-field count. |
| **ticketStateMachine.js** | NEEDS_REVIEW → OPEN allowed. OPEN → ASSIGNED. No NEEDS_REVIEW → ASSIGNED. |
| **audit_logs** | Only write: in handleReplyFlow, insert entity_type ticket, action client_provided_additional_details, metadata { raw_email_id }. |

### 1.2 Frontend

| File | Observed behavior |
|------|-------------------|
| **ReviewQueue.tsx** | useTickets({ **needsReview: true, status: 'OPEN'**, unassignedOnly: true }). Copy: "Tickets with low confidence scores requiring manual review" and "Only showing **unassigned OPEN tickets** with needs_review = true." So Review Queue shows **OPEN + needs_review**, not status === NEEDS_REVIEW. |
| **TicketsTable.tsx** | Renders tickets; StatusBadge(status); shows priority, needs_review icon. No status filter inside table. |
| **TicketDetail.tsx** | handleApprove: if ticket.needs_review → updateStatus(OPEN). "Approve & Open" button when ticket.needs_review. Assign FE card when ticket.status === "OPEN". Details: complaint_id, vehicle_number, category, issue_type, location, opened_by_email. useTicket(ticketId) fetches full ticket; refetch will show merged fields. |
| **useTickets.tsx** | useTickets(filters): status, needsReview, confidenceRange, search, unassignedOnly. status filter: .eq("status", filters.status). needsReview: .eq("needs_review", filters.needsReview). |
| **TicketFiltersBar.tsx** | Status options include NEEDS_REVIEW. |
| **Analytics.tsx** | statusCounts from ticket.status; statusData for charts. Adding NEEDS_REVIEW tickets does not break; counts by status. |
| **SLAMonitor.tsx** | statusFilter; NEEDS_REVIEW in SelectItem; getSLAStatus treats NEEDS_REVIEW (or similar) for "paused". No change required if NEEDS_REVIEW remains a valid status. |

### 1.3 Schema Assumptions (from code)

- **raw_emails:** processing_status, linked_ticket_id (and possibly missing_fields in extra). Repo migrations in field-ops-assist may not show all; production may have them.
- **parsed_emails:** ticket_created (markParsedAsTicketed). Same note.
- **tickets:** status (includes NEEDS_REVIEW), vehicle_number, issue_type, location, complaint_id, category, needs_review, confidence_score, etc. No missing_fields column; derived from row.

---

## 2. Gap vs Final Product Rules

| Rule | Current | Gap |
|------|---------|-----|
| ≥2 structured fields to create ticket | No gate; creation blocked by required-fields + confidence | Add structured-field count; if < 2 → IGNORED_INSUFFICIENT_DATA; if ≥ 2 always create (no confidence gate for creation). |
| Required fields incomplete → status NEEDS_REVIEW | Only create when complete; then OPEN/NEEDS_REVIEW by confidence | When ≥2 structured but !validation.isComplete → create ticket, status = NEEDS_REVIEW. |
| Required complete → status OPEN | createTicket uses confidence >= 95 for OPEN | When validation.isComplete → status = OPEN (no confidence for OPEN when complete; or keep confidence for OPEN vs NEEDS_REVIEW when complete — rule says "If required fields complete: status = OPEN"). So when complete, always OPEN. |
| Confidence never blocks creation | confidence < 80 → DRAFT, no ticket | Remove this branch when we have ≥2 structured fields; always create ticket. |
| Missing-details email: Ticket ID, received + missing, reply instruction | Missing list only; no received; no "include [Ticket ID] in subject" | Add received fields section; add exact sentence "When replying, please include [Ticket ID: XXXXX] in the subject line." |
| Parser: "Issue type" and "Item Name" → issue_type | Only "Item Name" | Try "Issue type" first, fallback "Item Name". Reply parsing must reuse same logic (parseEmailFromText). |
| Reply: parse, merge (fill only), revalidate, OPEN if complete | Append comment only; hasRequiredFieldsForOpen on existing ticket only | Parse reply body; merge into ticket (only fill empty); revalidate; if complete set OPEN. |
| Review Queue = status === NEEDS_REVIEW | status OPEN + needs_review | Change Review Queue to filter status === 'NEEDS_REVIEW'. |
| Main dashboard = status !== NEEDS_REVIEW | Dashboard uses status: 'all'; TicketsList uses filters | No change if main list shows all; or explicitly exclude NEEDS_REVIEW for "main" view if required. Rule says "Main Dashboard: status !== NEEDS_REVIEW" — so main dashboard should exclude NEEDS_REVIEW (optional filter or default). |

---

## 3. Backend File-by-File Changes

### 3.1 parsingService.js

- **Add support for "Issue type" and "Item Name" for issue_type:**  
  After extracting location/remarks/reported_at, set:  
  `result.issue_type = extractField('Issue type', text) || extractField('Item Name', text);`  
  (Replace current single extractField('Item Name', text) for issue_type.)
- **Add parseEmailFromText(text):**  
  New exported function. Same structure as parseEmail result object. Use same extractors (extractComplaintId, extractVehicle, extractField) on the provided string. Normalize text (e.g. replace(/\s+/g, ' ').trim()). Do not use getEmailText. Used for reply body only. Return same shape as parseEmail (complaint_id, vehicle_number, category, issue_type, location, etc.).

### 3.2 New helper (ticketService.js or small util)

- **countStructuredComplaintFields(parsed):**  
  Input: parsed object. Count how many of { complaint_id, vehicle_number, category, issue_type, location } are non-null and non-empty string (trim). Return number 0–5. Used in worker.

### 3.3 autoTicketWorker.js

- **After parse, before validation:**  
  If countStructuredComplaintFields(parsed) < 2 → updateRawEmailStatus(raw.id, 'IGNORED_INSUFFICIENT_DATA'), continue. No ticket, no sendMissingInfoEmail.
- **Remove AWAITING_CUSTOMER_INFO path for complaint flow:**  
  When classification === COMPLAINT and count >= 2, do **not** branch on !validation.isComplete to set AWAITING_CUSTOMER_INFO. Instead: always insertParsedEmail, then either (complete path) or (incomplete path).
- **Confidence:**  
  Still call calculateConfidence(parsed) for insertParsedEmail and createTicket. Do **not** use confidence to block creation: **remove** the block "if (confidence < 80) { updateRawEmailStatus DRAFT; continue }". So after insertParsedEmail, proceed to complaint_id dedupe then createTicket.
- **When validation.isComplete:**  
  Existing flow: complaint_id dedupe, createTicket. createTicket will set status OPEN when complete (see ticketService).
- **When !validation.isComplete and count >= 2:**  
  Still insertParsedEmail (with confidence, needs_review). No DRAFT. complaint_id dedupe if applicable. Then createTicket(parsed, raw) — ticketService will set status = NEEDS_REVIEW and send missing-details email. Then updateRawEmailStatus TICKET_CREATED, markParsedAsTicketed.
- **Stop using sendMissingInfoEmail** for the incomplete-complaint case (we create ticket and use sendMissingDetailsEmail from ticketService). Keep sendMissingInfoEmail only if we ever need a "no ticket" path (e.g. < 2 structured); for < 2 we mark IGNORED_INSUFFICIENT_DATA and do not send email per rule.
- **Reply flow (handleReplyFlow):**  
  1) Extract new reply content (existing).  
  2) Append comment (existing).  
  3) Parse reply: replyParsed = parseEmailFromText(content) (if content).  
  4) Load full ticket row (all mergeable columns: complaint_id, vehicle_number, category, issue_type, location).  
  5) Compute merge object: for each field F in that set, if ticket[F] is empty and replyParsed[F] is non-empty, add to merge.  
  6) If merge non-empty: call updateTicketFields(ticket.id, merge).  
  7) Re-fetch ticket (or use merged state); if ticket.status === 'NEEDS_REVIEW' && hasRequiredFieldsForOpen(ticket) → updateTicketStatus(ticket.id, 'OPEN').  
  8) Audit log insert (existing).  
  9) updateRawEmailStatus PROCESSED_REPLY (existing).  
- **findTicketByTicketNumber:** Must return mergeable columns for reply flow. Either expand select in worker (two queries: one by ticket_number for id + status, then full row) or expand ticketsRepo.findTicketByTicketNumber to select id, status, complaint_id, vehicle_number, category, issue_type, location. Prefer single query in repo.

### 3.4 ticketService.js

- **createTicket status logic:**  
  - If !validation.isComplete (required fields missing): status = 'NEEDS_REVIEW'.  
  - If validation.isComplete: status = 'OPEN' (required rule: "If required fields complete: status = OPEN"). So **remove** confidence-based OPEN/NEEDS_REVIEW when complete; always OPEN when complete.  
  - So: status = validation.isComplete ? 'OPEN' : 'NEEDS_REVIEW'. createTicket must receive validation result (e.g. pass validation.isComplete or missingFields). Signature: add optional third param or add validation to parsed (e.g. parsed._requiredComplete) set by worker.
- **createTicket confidence:**  
  Keep accepting confidence_score for insert (informational). Do not use it for status when complete.
- **Missing-details email:**  
  Still send when status === NEEDS_REVIEW. Pass received fields (list of human-readable names of non-empty parsed fields) and missing details. emailService will add body text.

### 3.5 emailService.js

- **sendMissingDetailsEmail:**  
  - Add parameter: receivedDetails (array of strings, e.g. ["Complaint ID", "Vehicle number", ...] for fields that were received).  
  - Body: (1) Ticket ID, (2) "Fields we received:" + receivedDetails list, (3) "Fields we need:" + missingDetails list, (4) Exact line: "When replying, please include [Ticket ID: XXXXX] in the subject line."  
  - Subject unchanged: "Re: [Ticket ID: XXXXX] Additional Details Required".

### 3.6 ticketsRepo.js

- **findTicketByTicketNumber:**  
  Extend .select() to include complaint_id, category (in addition to id, status, vehicle_number, issue_type, location) so reply merge has full row.
- **updateTicketFields(ticketId, fields):**  
  New function. fields = plain object of column names to values (e.g. { vehicle_number: '...', location: '...' }). Only update provided keys. .update(fields).eq('id', ticketId). Return { data, error }. Do not clear other columns.

### 3.7 customerClarificationService.js

- No change. Worker will no longer call sendMissingInfoEmail for the "incomplete complaint" path (we create ticket and use sendMissingDetailsEmail). If < 2 structured fields we do not send email (IGNORED_INSUFFICIENT_DATA only).

### 3.8 requiredFieldValidator.js

- No change. Still vehicle_number, issue_type, location. Same semantics for "complete for OPEN".

### 3.9 commentService.js, emailClassificationService.js, confidenceService.js, ticketStateMachine.js, rawEmailsRepo.js, parsedEmailsRepo.js

- No change except worker’s use of them as above. audit_logs: keep single insert in handleReplyFlow; optionally add metadata.merged_fields for traceability (optional).

---

## 4. Frontend File-by-File Changes

### 4.1 ReviewQueue.tsx

- **Change filter to status === NEEDS_REVIEW:**  
  useTickets({ status: 'NEEDS_REVIEW', unassignedOnly: true }). Remove needsReview: true.
- **Copy:**  
  Update description to state that the queue shows tickets with status NEEDS_REVIEW (incomplete details awaiting client reply or staff approval). Remove "needs_review = true" and "OPEN" from alert text.

### 4.2 TicketDetail.tsx

- **Approve & Open visibility:**  
  Show "Approve & Open" when ticket.status === 'NEEDS_REVIEW' OR ticket.needs_review (backward compatibility). handleApprove already calls updateStatus(OPEN); ensure it works for status NEEDS_REVIEW (state machine allows NEEDS_REVIEW → OPEN).
- **Assign FE card:**  
  Keep: show only when ticket.status === "OPEN". So NEEDS_REVIEW tickets show Approve first; after transition to OPEN, Assign appears. No change if already correct.
- **Details:**  
  Ticket fields (complaint_id, vehicle_number, category, issue_type, location) are from useTicket; after reply merge, backend updates ticket row so refetch shows merged data. No frontend change for merge display.

### 4.3 TicketsList.tsx / Dashboard

- **Main dashboard:**  
  Rule: "Main Dashboard: status != NEEDS_REVIEW". If Dashboard or main ticket list should hide NEEDS_REVIEW by default, add default filter status !== 'NEEDS_REVIEW' or add a filter option. Current Dashboard uses useTickets({ status: 'all' }). Optional: useTickets({ status: 'all' }) and add a toggle or filter to "Exclude Review Queue" (exclude NEEDS_REVIEW). Minimal approach: no change so all tickets visible; Review Queue is a dedicated page for NEEDS_REVIEW. If product explicitly wants main list to exclude NEEDS_REVIEW, add filter in useTickets or in the default filters passed from TicketsList/Dashboard.

### 4.4 TicketsTable.tsx, TicketFiltersBar.tsx, StatusBadge.tsx, Analytics.tsx, SLAMonitor.tsx

- No change. NEEDS_REVIEW already in types and filters. Analytics and SLA use status; NEEDS_REVIEW will appear in counts and filters.

---

## 5. Schema Adjustments (Minimal)

- **raw_emails:** Ensure processing_status exists (used for IGNORED_INSUFFICIENT_DATA, PENDING, TICKET_CREATED, PROCESSED_REPLY, etc.). If not in DB, add migration. linked_ticket_id same.
- **tickets / parsed_emails:** No new columns. missing_fields derived from ticket row (vehicle_number, issue_type, location empty = missing for OPEN).

---

## 6. Edge Cases

- **Exactly 2 structured fields, both required missing:** Create ticket NEEDS_REVIEW; send missing-details email.
- **Parsed all null for structured fields but classification COMPLAINT:** countStructuredComplaintFields = 0 → IGNORED_INSUFFICIENT_DATA.
- **Reply parse returns nothing useful:** Merge object empty; ticket unchanged; comment still appended; re-check hasRequiredFieldsForOpen; no OPEN.
- **Reply contains value for already-filled field:** Merge excludes it; no overwrite.
- **Duplicate complaint_id with ≥2 structured fields:** Same as today: find existing ticket, add comment, COMMENT_ADDED, markParsedAsTicketed; do not create second ticket.
- **Same raw email processed twice (reply):** raw already PROCESSED_REPLY after first run; fetchPendingRawEmails excludes it. Idempotent.
- **createTicket throws (e.g. insert fails):** Worker catch sets raw to ERROR. Unchanged.

---

## 7. Idempotency

- **Reply:** One raw_email → one PROCESSED_REPLY; no second fetch. Merge and comment run once. No duplicate comment unless raw is re-marked PENDING (out of scope).
- **Ticket creation:** complaint_id dedupe prevents duplicate tickets for same complaint. No thread_id dedupe today; not in scope.

---

## 8. Failure Handling

- **Parser parseEmailFromText fails:** Return empty/minimal parsed object; merge empty; comment still appended; no crash.
- **updateTicketFields fails:** Log error; do not update raw to ERROR for reply (we already appended comment and audit); optionally leave ticket as-is and still set PROCESSED_REPLY to avoid retry loop, or set a distinct status (e.g. PROCESSED_REPLY_MERGE_FAILED) for visibility. Prefer: log, set PROCESSED_REPLY so worker does not retry indefinitely.
- **sendMissingDetailsEmail fails:** Existing .catch in createTicket; ticket already created. No change.

---

## 9. Migration Considerations

- **Existing AWAITING_CUSTOMER_INFO rows:** No automatic conversion. They remain without a ticket. New flow applies only to new emails. Optional: document or add UI to "Create ticket from email" for old rows.
- **Existing OPEN tickets with needs_review = true:** Continue to show in current Review Queue until we switch to status NEEDS_REVIEW. After frontend change, Review Queue shows only status === NEEDS_REVIEW; those OPEN+needs_review tickets remain on main list. No data migration.
- **Backend deploy order:** Deploy worker + ticketService + emailService + parsingService + ticketsRepo; then frontend Review Queue + TicketDetail. Backward compatible: old OPEN+needs_review still work; new incomplete emails get NEEDS_REVIEW and appear in new Review Queue.

---

## 10. Implementation Phases (for STEP 2)

**Phase A — Backend: gates and creation rules**

1. parsingService: add "Issue type" for issue_type; add parseEmailFromText(text).  
2. ticketService (or worker): add countStructuredComplaintFields(parsed).  
3. Worker: after parse, if count < 2 → IGNORED_INSUFFICIENT_DATA, continue.  
4. Worker: remove confidence < 80 → DRAFT branch.  
5. Worker: when COMPLAINT and count >= 2 and !validation.isComplete: insertParsedEmail, then createTicket (no AWAITING_CUSTOMER_INFO).  
6. ticketService: createTicket accepts validation (e.g. parsed._requiredComplete or extra arg). status = validation.isComplete ? 'OPEN' : 'NEEDS_REVIEW'.  
7. emailService: sendMissingDetailsEmail add receivedDetails param; body with received, missing, and "When replying, please include [Ticket ID: XXXXX] in the subject line."  
8. ticketService: pass received details and missing details to sendMissingDetailsEmail when NEEDS_REVIEW.

**Phase B — Backend: reply merge**

1. ticketsRepo: findTicketByTicketNumber select complaint_id, category; add updateTicketFields(ticketId, fields).  
2. ticketService: add mergeParsedIntoTicket(ticketRow, parsedReply) → partial object (fill-only).  
3. handleReplyFlow: parseEmailFromText(content), load full ticket, merge, updateTicketFields, re-check hasRequiredFieldsForOpen, updateTicketStatus(OPEN) if complete.

**Phase C — Frontend**

1. ReviewQueue: useTickets({ status: 'NEEDS_REVIEW', unassignedOnly: true }); update copy.  
2. TicketDetail: show Approve & Open when ticket.status === 'NEEDS_REVIEW' || ticket.needs_review.

**Phase D — Verification and docs**

1. Verify raw_emails processing_status (and linked_ticket_id) in production or add migration.  
2. Smoke: < 2 structured → IGNORED_INSUFFICIENT_DATA; ≥ 2 incomplete → ticket NEEDS_REVIEW + email; reply with missing fields → merge → OPEN.  
3. Document any env or schema assumptions.

---

## 11. Risk Summary

| Risk | Mitigation |
|------|------------|
| Review Queue empty after switch | Review Queue will show only NEEDS_REVIEW. New incomplete emails will populate it. Existing OPEN+needs_review stay on main list. |
| Parser "Issue type" vs "Item Name" order | Try "Issue type" first, then "Item Name"; same in parseEmailFromText. |
| Overwrite on merge | Merge only includes fields where ticket value is empty and reply value non-empty. |
| Analytics/SLA | NEEDS_REVIEW already in schema and filters; no breaking change. |

---

**End of STEP 1. Do not implement code until plan is approved.**
