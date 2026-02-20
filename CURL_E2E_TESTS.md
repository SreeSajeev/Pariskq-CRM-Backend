# Curl commands for E2E testing (incomplete-email intake)

Base URL: `http://localhost:3000` (or set `BASE=http://localhost:3000`).

Worker runs on startup and every 60s; trigger a run or wait up to 60s after each webhook POST to see the effect.

---

## 1. &lt; 2 structured fields → IGNORED_INSUFFICIENT_DATA (no ticket)

Classification can be COMPLAINT (keywords) but parser finds 0–1 structured fields. Expect: `raw_emails.processing_status = IGNORED_INSUFFICIENT_DATA`, no ticket.

```bash
curl -s -X POST http://localhost:3000/postmark-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "MessageID": "e2e-insufficient-'$(date +%s)'",
    "From": "pariskqiot@gmail.com",
    "FromFull": { "Email": "pariskqiot@gmail.com" },
    "To": "support@pariskq.in",
    "Subject": "Brake problem",
    "TextBody": "I have a brake failure and need help. Please look into this issue.",
    "Date": "2025-02-19T10:00:00Z"
  }'
```

Expect: `Email received`. Then (after worker run): no new ticket; in DB `raw_emails.processing_status = 'IGNORED_INSUFFICIENT_DATA'` for that message_id.

---

## 2. ≥2 structured fields, required incomplete → ticket NEEDS_REVIEW

Two structured fields (e.g. complaint_id + vehicle_number), missing vehicle_number/issue_type/location for “complete”. Expect: one ticket, `status = NEEDS_REVIEW`; client gets confirmation + missing-details email.

```bash
curl -s -X POST http://localhost:3000/postmark-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "MessageID": "e2e-needs-review-'$(date +%s)'",
    "From": "pariskqiot@gmail.com",
    "FromFull": { "Email": "pariskqiot@gmail.com" },
    "To": "support@pariskq.in",
    "Subject": "Complaint CCM5002",
    "TextBody": "Complaint ID: CCM5002\nVehicle number: TN09AB1234\nCategory: Mechanical\n\nBrake failure. Need inspection.",
    "Date": "2025-02-19T10:00:00Z"
  }'
```

Expect: `Email received`. After worker: one ticket with `status = NEEDS_REVIEW'`, `ticket_number` like `TKT-*`. Note the `ticket_number` (from DB or logs) for the reply test below.

---

## 3. ≥2 structured fields, required complete → ticket OPEN

All three required fields present (vehicle_number, issue_type, location). Expect: one ticket, `status = OPEN`.

```bash
curl -s -X POST http://localhost:3000/postmark-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "MessageID": "e2e-open-'$(date +%s)'",
    "From": "pariskqiot@gmail.com",
    "FromFull": { "Email": "pariskqiot@gmail.com" },
    "To": "support@pariskq.in",
    "Subject": "Complaint CCM5003",
    "TextBody": "Complaint ID: CCM5003\nVehicle number: TN09AB5678\nCategory: Mechanical\nItem Name: Brake failure\nLocation: Chennai\n\nNeed inspection.",
    "Date": "2025-02-19T10:00:00Z"
  }'
```

Expect: `Email received`. After worker: one ticket with `status = 'OPEN'`. (Parser maps “Item Name” to issue_type; “Issue type:” also works.)

---

## 4. Same with "Issue type:" label (parser)

Checks that both “Issue type:” and “Item Name:” map to issue_type.

```bash
curl -s -X POST http://localhost:3000/postmark-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "MessageID": "e2e-issue-type-'$(date +%s)'",
    "From": "pariskqiot@gmail.com",
    "FromFull": { "Email": "pariskqiot@gmail.com" },
    "To": "support@pariskq.in",
    "Subject": "Fault report",
    "TextBody": "Complaint ID: CCM5004\nVehicle number: TN10CD9999\nIssue type: Brake failure\nLocation: Bangalore\n\nPlease assist.",
    "Date": "2025-02-19T10:00:00Z"
  }'
```

Expect: ticket created, `status = OPEN`, `issue_type` populated from “Issue type:”.

---

## 5. Reply with [Ticket ID: XXXXX] → merge and possibly OPEN

Replace `TKT-XXXXX` with a real `ticket_number` from a NEEDS_REVIEW ticket (e.g. from test 2). Reply body should supply missing required fields (e.g. issue_type and location if ticket had only complaint_id + vehicle_number). Expect: comment added; reply parsed; ticket fields merged (fill-only); if after merge vehicle_number, issue_type, location are all set, ticket moves to OPEN; `raw_emails.processing_status = PROCESSED_REPLY`.

```bash
# Replace TKT-XXXXX with actual ticket_number from a NEEDS_REVIEW ticket
TICKET_NUM="TKT-XXXXX"

curl -s -X POST http://localhost:3000/postmark-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "MessageID": "e2e-reply-'$(date +%s)'",
    "From": "pariskqiot@gmail.com",
    "FromFull": { "Email": "pariskqiot@gmail.com" },
    "To": "support@pariskq.in",
    "Subject": "Re: Complaint Received - [Ticket ID: '"$TICKET_NUM"']",
    "TextBody": "Issue type: Brake failure\nLocation: Chennai\n\nPlease process.",
    "Date": "2025-02-19T11:00:00Z"
  }'
```

Expect: `Email received`. After worker: that raw_email marked PROCESSED_REPLY; ticket has new comment; ticket fields updated only where previously empty; if complete, `status` updated to OPEN; one new `audit_logs` row with action `client_provided_additional_details`.

---

## 6. Health check (no worker trigger)

```bash
curl -s http://localhost:3000/health
```

Expect: `{"status":"ok"}`.

---

## Quick sequence (manual ticket number)

```bash
# 1. Create NEEDS_REVIEW ticket
curl -s -X POST http://localhost:3000/postmark-webhook \
  -H "Content-Type: application/json" \
  -d '{"MessageID":"e2e-seq-'$(date +%s)'","From":"pariskqiot@gmail.com","FromFull":{"Email":"pariskqiot@gmail.com"},"To":"support@pariskq.in","Subject":"CCM5005","TextBody":"Complaint ID: CCM5005\nVehicle number: TN01XX0001\n\nNeed help.","Date":"2025-02-19T10:00:00Z"}'

# 2. Wait for worker (or trigger if you have an endpoint), then read ticket_number from DB, e.g.:
#    SELECT ticket_number FROM tickets WHERE complaint_id = 'CCM5005' ORDER BY created_at DESC LIMIT 1;

# 3. Reply (set TICKET_NUM from step 2)
# TICKET_NUM="TKT-00042"   # example
# curl -s -X POST http://localhost:3000/postmark-webhook \
#   -H "Content-Type: application/json" \
#   -d '{"MessageID":"e2e-reply-'$(date +%s)'","From":"pariskqiot@gmail.com","FromFull":{"Email":"pariskqiot@gmail.com"},"To":"support@pariskq.in","Subject":"Re: [Ticket ID: '"$TICKET_NUM"']","TextBody":"Issue type: Brake failure\nLocation: Chennai","Date":"2025-02-19T11:00:00Z"}'
```

---

## Verification queries (Supabase or SQL)

After each test, you can verify:

```sql
-- Latest raw_emails
SELECT id, message_id, processing_status, linked_ticket_id, created_at
FROM raw_emails
ORDER BY created_at DESC
LIMIT 5;

-- Latest tickets
SELECT id, ticket_number, status, complaint_id, vehicle_number, issue_type, location, created_at
FROM tickets
ORDER BY created_at DESC
LIMIT 5;

-- Latest audit_logs for reply flow
SELECT id, entity_type, entity_id, action, metadata, created_at
FROM audit_logs
WHERE action = 'client_provided_additional_details'
ORDER BY created_at DESC
LIMIT 5;
```
