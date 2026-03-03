# PRE-COMMIT PRODUCTION SAFETY AUDIT

**Scope:** Additive changes (short_description, sanitizeParsedLocation, requiredFieldValidator, hasRequiredFieldsForOpen, frontend short_description).  
**Stance:** Verification only. No new features, no refactors.

---

## PHASE 1 – DATABASE SAFETY CHECK

### 1.1 Confirm: short_description nullable and insert behavior

| Check | Result | Evidence |
|-------|--------|----------|
| **NOT NULL on short_description** | **CONFIRMED – no NOT NULL** | Migration: `ADD COLUMN IF NOT EXISTS short_description text` — no `NOT NULL`; column is nullable. |
| **insertTicket() if short_description undefined** | **SAFE** | `ticketService.js`: payload uses `...(shortDescription ? { short_description: shortDescription } : {})`. When `shortDescription` is falsy, key is omitted. `insertTicket(ticket)` passes object as-is. Supabase insert with no `short_description` key: column receives NULL (default). No undefined key is sent. |
| **Supabase “ignore missing column”** | **Only when key is omitted** | If code sends `short_description` and the column does **not** exist, PostgREST/Supabase returns error (e.g. `column "short_description" of relation "tickets" does not exist`). So: **backend must not send a non-existent column**. With current code we only add the key when truthy; we never “ignore” a missing column — we avoid sending it when column might not exist by **deploying migration first**. |

### 1.2 Simulate: Backend deploy BEFORE migration

| Scenario | What happens | Worker crash? | raw_email status | Retry infinite? |
|----------|--------------|---------------|------------------|------------------|
| **New complaint (body yields short_description)** | `createTicket` → `insertTicket` with `short_description` in payload → DB error (column does not exist) → `insertTicket` throws → worker `catch` runs. | **No** — per-raw try/catch (lines 199–204). | **ERROR** with `processing_error: err.message`. | **No** — `fetchPendingRawEmails` uses `.or('processing_status.is.null', 'processing_status.eq.PENDING')`; ERROR rows are not refetched. |
| **New complaint (empty body, short_description omitted)** | Insert succeeds (no short_description key). | No. | TICKET_CREATED. | N/A. |
| **Reply (subject has [Ticket ID: …])** | `findTicketByTicketNumber` does `.select('..., short_description')` → if column missing, Supabase returns error → function returns `null` → ticket not found → email treated as **new complaint**, not reply. | No. | Depends on downstream (e.g. COMPLAINT path → parse → may create ticket or IGNORED_*). | No. |

**Exact error when insert includes non-existent column:**  
PostgREST/Supabase: `insert failed: column "short_description" of relation "tickets" does not exist` (or equivalent).

**Conclusion:** Deploying backend before migration can cause: (1) insert failures and ERROR status for new complaints when body is non-empty, (2) reply path broken (replies mis-treated as new emails). Worker does not crash and does not retry ERROR rows infinitely.

### 1.3 Migration file

- **File:** `field-ops-assist/supabase/migrations/20260228100000_add_tickets_short_description.sql`
- **Content:** `ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS short_description text;` + COMMENT.
- **Additive only:** Yes — no DROP, no RENAME, no ALTER of existing columns.
- **Destructive changes:** None.
- **Renamed columns:** None.

---

## PHASE 2 – WORKER STABILITY CHECK

### 2.1 sanitizeParsedLocation throws

| Question | Answer |
|----------|--------|
| **Wrapped in try/catch?** | Yes. Entire per-raw loop body is inside `try { ... } catch (err) { ... }` (lines 117–204). |
| **Entire worker crash?** | No. Only that raw email’s iteration fails; next raw is processed. |
| **processing_status remain PENDING?** | No. Catch calls `updateRawEmailStatus(raw.id, 'ERROR', { processing_error: err.message })` — status becomes **ERROR**. |
| **Retry repeatedly?** | No. ERROR rows are not in the pending set (only null/PENDING are fetched). |

### 2.2 Worker loop order and logic

- **Order:** Fetch pending → for each raw: reply check → classification → parse → **sanitizeParsedLocation** → countStructuredComplaintFields < 2 → validate → insertParsedEmail → (dedupe) → createTicket → update status. **Unchanged** except one additive step after parse.
- **Logic reordering:** None.
- **countStructuredComplaintFields:** Still called with same `parsed` (now sanitized); function and STRUCTURED_FIELDS unchanged — behavior unchanged.

---

## PHASE 3 – VALIDATION LOGIC SAFETY

### 3.1 requiredFieldValidator and callers

- **Single caller:** `autoTicketWorker.js` line 151: `const validation = validateRequiredFields(parsed);` then line 194: `{ requiredComplete: validation.isComplete }`. Only **isComplete** is used; **missingFields** is not read anywhere in the worker or ticketService.
- **sendMissingDetailsEmail:** Receives `missingDetails` from **deriveMissingDetails(parsed)** (ticketService), not from `validation.missingFields`. So email content is unchanged; no dependency on new field name.
- **Unexpected field names:** Validator can now return `'issue_type_or_remarks'` in missingFields. No code iterates missingFields or switches on its values; only isComplete is used. So no breakage.
- **Undefined access:** Validator returns `{ isComplete, missingFields }`; catch returns same shape. No undefined access.

### 3.2 Backend usage of missingFields / issue_type

- **missingFields:** Only in requiredFieldValidator (return value) and customerClarificationService (sendMissingInfoEmail — different flow, not used by autoTicketWorker). Worker does not use missingFields.
- **issue_type “expected” elsewhere:**  
  - **PATCH /tickets/:id/review-complete:** Requires `category`, `issue_type`, `location` in body for staff “complete review”. Intentional for that API; not the same as email OPEN-eligibility.  
  - **deriveMissingDetails / deriveReceivedDetails:** Still mention “Issue type” as label; used only for email text. No assumption that issue_type is mandatory for OPEN.  
  - **confidenceService:** Still scores issue_type; no change to OPEN rule there.  
  - **mergeParsedIntoTicket / STRUCTURED_FIELDS:** issue_type remains a mergeable field; no mandatory assumption.

### 3.3 No other component assumes issue_type is mandatory

- OPEN vs NEEDS_REVIEW is decided only by `validation.isComplete` (which now allows issue_type OR remarks) and by `hasRequiredFieldsForOpen` (which now allows issue_type OR short_description). No other code path forces issue_type to be present for OPEN.

---

## PHASE 4 – TICKET CREATION SAFETY

### 4.1 createTicket() and insert payload

- **Payload shape:** Same keys as before plus optional `short_description`. All existing columns (ticket_number, status, complaint_id, vehicle_number, category, issue_type, location, opened_by_email, opened_at, confidence_score, needs_review, source, client_slug) unchanged. No fields removed or overwritten by mistake.
- **short_description:** Added only when truthy: `...(shortDescription ? { short_description: shortDescription } : {})`. Optional.
- **insertTicket:** Forwards the object to Supabase; no schema validation in repo. If column exists, insert succeeds; if column does not exist and key is present, DB error (see Phase 1).

### 4.2 hasRequiredFieldsForOpen

- **New ticket:** createTicket runs after validation; ticket row is created with short_description when body/remarks provide it. hasRequiredFieldsForOpen is not used for the newly created row in the same request; it’s used later for reply flow.
- **Reply merge:** handleReplyFlow loads ticket via findTicketByTicketNumber (now includes short_description), merges reply into ticket fields, then `hasRequiredFieldsForOpen(mergedTicket)`. mergedTicket has ticket’s short_description (and possibly new issue_type/location from merge). So OPEN transition works when vehicle_number + location + (issue_type or short_description) are present.
- **Manual updates:** If staff or API updates a ticket (e.g. PATCH review-complete), hasRequiredFieldsForOpen is not in that path. For any other path that checks OPEN eligibility using this function, ticket may have short_description from creation — behavior is correct.

---

## PHASE 5 – FRONTEND SAFETY

### 5.1 Type and runtime

- **Ticket type:** `short_description?: string | null` — optional. No required type errors.
- **Runtime access:** TicketsTable uses `ticket.short_description` with fallbacks: compact view `ticket.short_description ? ... : ticket.issue_type || ticket.category || 'Unclassified'`; full table `(ticket.short_description || ticket.location || '—').slice(0, 80)`. Optional chaining / fallbacks prevent undefined access.
- **Fallback to location:** Full table Location cell explicitly uses `ticket.short_description || ticket.location || '—'`. Safe when short_description is null/undefined.

### 5.2 Layout and null safety

- **Overflow:** `.slice(0, 80)` and `.slice(0, 60)` limit length; compact row has `truncate` class. No unbounded expansion.
- **short_description null:** All usages are in expressions with `||` fallbacks; no direct property access without fallback. No UI crash.

---

## PHASE 6 – DEPLOYMENT ORDER CHECK

### Exact safe deployment order

1. **Run migration** (add `short_description` to `tickets`):  
   Apply `20260228100000_add_tickets_short_description.sql` against the target DB (e.g. `supabase db push` or your migration runner).

2. **Deploy backend** (worker, ticketService, ticketsRepo, parsingService, requiredFieldValidator).

3. **Deploy frontend** (TicketsTable, Ticket type).

4. **Smoke-check:** Trigger one email-to-ticket (or reply), confirm ticket created and reply flow works; check logs for no insert/select errors.

### What breaks if order is wrong

- **Backend before migration:**  
  - New complaints with non-empty body → insert fails (column missing) → raw_email set to ERROR.  
  - Reply path → findTicketByTicketNumber select fails (column missing) → ticket = null → reply treated as new email (wrong flow, possible duplicate or wrong status).  
- **Frontend before backend:**  
  - Frontend only displays; it uses select("*") and optional short_description. Old backend does not set short_description; column may be NULL. Frontend falls back to location/issue_type. No crash. Deploying frontend first is acceptable but not required.

### Logs and quick detection

- **Insert failure:** Worker log: `Worker failed raw_email <id> ... column "short_description" of relation "tickets" does not exist` (or similar). Raw email status = ERROR, processing_error set.
- **Select failure (reply):** Supabase/PostgREST error in response; findTicketByTicketNumber returns null; reply not matched to ticket.
- **Quick check:** After deploy, inspect latest raw_emails: no new ERROR for recent PENDING; or run one test email and confirm ticket created and status TICKET_CREATED.

---

## PHASE 7 – ROLLBACK PLAN

### 1. Revert backend safely

- Redeploy previous backend version (no short_description in insert, no short_description in findTicketByTicketNumber select, previous requiredFieldValidator and hasRequiredFieldsForOpen).
- Worker will resume processing PENDING/ERROR rows (if you re-mark ERROR as PENDING — see below). New tickets will no longer set short_description; existing rows keep the column.

### 2. Revert migration (optional)

- Only if you need to remove the column (e.g. to match old schema exactly). Additive column does not break old code; reverting migration is optional and higher risk (drops data in that column).
- If reverting: run the undo SQL below only after backend no longer references short_description.

### 3. Restore worker processing

- Rows left in ERROR by failed deploy: they are not refetched. To retry them, either:
  - Manually set processing_status back to 'PENDING' for those raw_email ids (and optionally clear processing_error), then run worker; or
  - Leave as ERROR and accept that those emails were not processed (no infinite retry).

### 4. SQL to undo migration (if needed)

```sql
-- Only after backend is reverted and no longer uses short_description.
ALTER TABLE public.tickets DROP COLUMN IF EXISTS short_description;
```

- **Risk:** Drops the column and any data in it. Use only when backend and frontend no longer depend on it.

---

## OUTPUT SUMMARY

### 1. All possible breakpoints

| # | Breakpoint | Condition | Mitigation |
|---|------------|-----------|------------|
| 1 | Insert fails (column missing) | Backend deployed before migration; body non-empty so short_description sent | Deploy migration first. |
| 2 | Reply path fails (select column missing) | Backend before migration; findTicketByTicketNumber selects short_description | Deploy migration first. |
| 3 | sanitizeParsedLocation throws | Malformed parsed or edge case in regex/string ops | Already in try/catch; raw → ERROR, no crash. |
| 4 | getEmailText throws in createTicket | Raw payload malformed | Not in worker try/catch; would throw from createTicket → worker catch sets ERROR. No crash. |
| 5 | Frontend receives ticket without short_description | Old tickets or DB without column | Optional type and fallbacks; no crash. |

### 2. Safety level

- **Overall risk: LOW**, provided **migration is applied before backend**.
- **If backend is deployed before migration:** **MEDIUM** — new complaints can ERROR; reply path mis-routes; no worker crash or infinite retry.

### 3. Exact deployment order

1. Run migration (add short_description column).  
2. Deploy backend.  
3. Deploy frontend.  
4. Smoke-check (one email/reply + logs).

### 4. Exact rollback steps

1. Revert backend to previous version (redeploy).  
2. Optionally retry ERROR raw_emails by setting processing_status = 'PENDING' (and clear processing_error) for affected ids.  
3. Revert frontend if desired (optional; old frontend works with null short_description).  
4. To remove column: run `ALTER TABLE public.tickets DROP COLUMN IF EXISTS short_description;` only after backend/frontend no longer use it.

### 5. Hidden race conditions

- **None identified.** Worker processes one raw email per iteration; no shared in-memory state that could race. Migration is a single DDL; backend either sees the column or not. No partial-state deploy between “migration started” and “migration committed” is assumed; run migration to completion before deploying backend.

---

**Audit complete.** System is **safe to commit and deploy** when migration is applied before backend deploy. Worker is resilient (try/catch, no infinite retry); validation and OPEN logic are backward compatible; frontend is defensive. Critical dependency: **migration before backend.**
