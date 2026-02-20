# STEP 2 Implementation Summary

## 1. Summary of Changed Files

### Backend (Pariskq-CRM-Backend)

| File | Change |
|------|--------|
| `src/services/parsingService.js` | Added "Issue type" to FIELD_LABELS; issue_type = extractField('Issue type') \|\| extractField('Item Name'); added parseEmailFromText(text). |
| `src/services/ticketService.js` | Added countStructuredComplaintFields(parsed), deriveReceivedDetails(parsed), mergeParsedIntoTicket(ticketRow, parsedReply). createTicket(parsed, rawEmail, options): status = options.requiredComplete ? 'OPEN' : 'NEEDS_REVIEW'; removed confidence_score guard; pass receivedDetails to sendMissingDetailsEmail. |
| `src/services/emailService.js` | sendMissingDetailsEmail: added receivedDetails param; body includes "Fields we received", "Fields we need", and "When replying, please include [Ticket ID: XXX] in the subject line." |
| `src/workers/autoTicketWorker.js` | Import countStructuredComplaintFields, mergeParsedIntoTicket, parseEmailFromText, updateTicketFields. After parse: if countStructuredComplaintFields(parsed) < 2 → IGNORED_INSUFFICIENT_DATA, continue. Removed AWAITING_CUSTOMER_INFO branch and sendMissingInfoEmail. Removed confidence < 80 → DRAFT branch. createTicket(..., { requiredComplete: validation.isComplete }). handleReplyFlow: parse reply with parseEmailFromText, merge with mergeParsedIntoTicket, updateTicketFields if non-empty, use mergedTicket for hasRequiredFieldsForOpen then updateTicketStatus(OPEN). |
| `src/repositories/ticketsRepo.js` | findTicketByTicketNumber select extended with complaint_id, category. Added updateTicketFields(ticketId, fields). |

### Frontend (field-ops-assist)

| File | Change |
|------|--------|
| `src/pages/ReviewQueue.tsx` | useTickets({ status: 'NEEDS_REVIEW' }) only; removed needsReview, status: 'OPEN', unassignedOnly. Updated title/description and Alert copy. |
| `src/pages/TicketDetail.tsx` | handleApprove: condition ticket.needs_review \|\| ticket.status === "NEEDS_REVIEW". "Approve & Open" button and "Needs Review" badge: same condition. |

### Unchanged (by design)

- requiredFieldValidator.js, confidenceService.js, emailClassificationService.js, ticketStateMachine.js, rawEmailsRepo.js, parsedEmailsRepo.js, commentService.js, customerClarificationService.js (no longer used in worker for incomplete path).
- Analytics, SLA Monitor, FE token flow, assignment flow, controllers, routes.

---

## 2. Exact Diff-Level Logic Changes

### parsingService.js

- **FIELD_LABELS:** Insert `'Issue type'` so extractField can match "Issue type" and "Item Name".
- **issue_type:** From `extractField('Item Name', text)` to `extractField('Issue type', text) || extractField('Item Name', text)`.
- **parseEmailFromText(text):** New export. Normalizes text, runs extractComplaintId, extractVehicle, extractField for category, issue_type (Issue type \|\| Item Name), location, remarks, reported_at. Returns same-shaped object (no parse_errors). Used for reply body only.

### ticketService.js

- **countStructuredComplaintFields(parsed):** Returns count of non-empty complaint_id, vehicle_number, category, issue_type, location (0–5).
- **deriveReceivedDetails(parsed):** Returns human-readable labels for those same fields when non-empty (for email "Fields we received").
- **createTicket(parsed, rawEmail, options = {}):** Removed guard on parsed.confidence_score. requiredComplete = options.requiredComplete === true. status = requiredComplete ? 'OPEN' : 'NEEDS_REVIEW'. insertTicket unchanged (still stores confidence_score, needs_review). When status === 'NEEDS_REVIEW', pass receivedDetails: deriveReceivedDetails(parsed) into sendMissingDetailsEmail.
- **mergeParsedIntoTicket(ticketRow, parsedReply):** Returns object of STRUCTURED_FIELDS where ticket value is empty and parsedReply value is non-empty (fill-only, no overwrite).

### emailService.js

- **sendMissingDetailsEmail({ toEmail, ticketNumber, missingDetails, receivedDetails }):** receivedDetails optional. Body: "Fields we received:" + receivedList (or "• None listed"); "Fields we need:" + missingList; new line: "When replying, please include [Ticket ID: ${ticketNumber}] in the subject line."

### autoTicketWorker.js

- **Imports:** Removed sendMissingInfoEmail. Added countStructuredComplaintFields, mergeParsedIntoTicket, parseEmailFromText, updateTicketFields.
- **After parseEmail(raw):** If countStructuredComplaintFields(parsed) < 2 → updateRawEmailStatus(raw.id, 'IGNORED_INSUFFICIENT_DATA'), continue.
- **Removed:** Block that set AWAITING_CUSTOMER_INFO and called sendMissingInfoEmail when !validation.isComplete.
- **Removed:** Block that set DRAFT when confidence < 80.
- **createTicket call:** Third argument { requiredComplete: validation.isComplete }.
- **handleReplyFlow:** After appending comment: if content, replyParsed = parseEmailFromText(content), merge = mergeParsedIntoTicket(ticket, replyParsed). If merge non-empty, updateTicketFields(ticket.id, merge); mergedTicket = { ...ticket, ...merge } (or keep ticket on update error). Audit insert unchanged. Transition to OPEN: if ticket.status === 'NEEDS_REVIEW' && hasRequiredFieldsForOpen(mergedTicket) → updateTicketStatus(ticket.id, 'OPEN'). Then updateRawEmailStatus PROCESSED_REPLY.

### ticketsRepo.js

- **findTicketByTicketNumber:** .select() extended to include complaint_id, category (in addition to id, status, vehicle_number, issue_type, location).
- **updateTicketFields(ticketId, fields):** New. supabase.from('tickets').update(fields).eq('id', ticketId). Returns { data, error }.

### ReviewQueue.tsx

- **useTickets:** From `{ needsReview: true, status: 'OPEN', unassignedOnly: true }` to `{ status: 'NEEDS_REVIEW' }`.
- **Copy:** Title/subtitle and Alert text updated to describe NEEDS_REVIEW queue and approve-or-wait-for-reply.

### TicketDetail.tsx

- **handleApprove:** Condition from `ticket.needs_review` to `ticket.needs_review || ticket.status === "NEEDS_REVIEW"`.
- **Needs Review badge and Approve & Open button:** Same condition so both OPEN+needs_review and NEEDS_REVIEW show the button.

---

## 3. Migration Required

- **None.** No new tables or columns. Existing raw_emails.processing_status and linked_ticket_id (and parsed_emails.ticket_created) are assumed present in production; if not, add per existing project conventions.
- **New raw_emails value:** processing_status can be `'IGNORED_INSUFFICIENT_DATA'`. Ensure any frontend or reports that enumerate statuses include this if needed.

---

## 4. Manual Test Checklist

### Backend

- [ ] **&lt; 2 structured fields:** Send email classified as COMPLAINT but with 0 or 1 of complaint_id, vehicle_number, category, issue_type, location. Expect raw_emails.processing_status = IGNORED_INSUFFICIENT_DATA, no ticket, no email to client.
- [ ] **≥ 2 structured, required incomplete:** Send COMPLAINT with e.g. complaint_id + vehicle_number only. Expect one ticket created, status = NEEDS_REVIEW; client receives confirmation + missing-details email with Ticket ID, "Fields we received", "Fields we need", and "When replying, please include [Ticket ID: XXX] in the subject line."
- [ ] **≥ 2 structured, required complete:** Send COMPLAINT with vehicle_number, issue_type, location (and optionally others). Expect ticket created, status = OPEN; client receives confirmation only (no missing-details email).
- [ ] **Reply with [Ticket ID: XXX] in subject:** Reply to missing-details email keeping subject tag. Expect: comment appended; reply body parsed; missing ticket fields merged (no overwrite); audit_logs row client_provided_additional_details; if merged ticket has vehicle_number, issue_type, location → status set to OPEN; raw_emails.processing_status = PROCESSED_REPLY.
- [ ] **Reply with no new fields:** Reply with subject tag but body that parses to no new structured data. Expect comment appended, no overwrite, audit written, PROCESSED_REPLY; status stays NEEDS_REVIEW if still incomplete.
- [ ] **Parser "Issue type":** Email body contains "Issue type: Brake failure". Expect issue_type extracted and stored (and same for "Item Name:").
- [ ] **Duplicate complaint_id:** Two COMPLAINT emails with same complaint_id and ≥2 structured fields. Expect first creates ticket; second adds comment, COMMENT_ADDED, no second ticket.
- [ ] **Worker crash-safety:** Force parse or merge error (e.g. invalid payload). Expect worker catch sets raw to ERROR, loop continues.

### Frontend

- [ ] **Review Queue:** Page shows only tickets with status NEEDS_REVIEW. Copy reflects NEEDS_REVIEW. No filter by unassigned only.
- [ ] **TicketDetail NEEDS_REVIEW:** Ticket with status NEEDS_REVIEW shows "Needs Review" badge and "Approve & Open". Click sets status to OPEN; Assign FE card appears.
- [ ] **TicketDetail OPEN + needs_review (legacy):** Ticket with status OPEN and needs_review true still shows Approve & Open (unchanged behavior).
- [ ] **Analytics:** Dashboard/analytics status counts include NEEDS_REVIEW; no regression for OPEN, RESOLVED, etc.
- [ ] **SLA Monitor:** NEEDS_REVIEW appears in status filter; no regression.
- [ ] **Assignment:** OPEN ticket can be assigned; NEEDS_REVIEW ticket does not show Assign until approved to OPEN (existing state machine).

### Integration

- [ ] **End-to-end incomplete:** Inbound email → ticket NEEDS_REVIEW → client gets email with reply instruction → client replies with tag and missing fields → ticket updated and moves to OPEN. TicketDetail shows merged fields after refetch.
