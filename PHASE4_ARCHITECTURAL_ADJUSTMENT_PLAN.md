# PHASE 4 – Controlled Architectural Adjustment Plan

Minimal, additive improvements only. No webhook, raw_emails, worker flow, or schema destructive changes.

---

## OBJECTIVE 1 – Prevent Location Pollution

### What was done

A **post-processing step** runs after `parseEmail()`, before validation and ticket creation:

- **Caps location length** at 120 characters.
- **Stops at sentence boundary**: within that cap, trims to the last full sentence (`.` before end).
- **Strips trailing disclaimers**: removes text from the first occurrence of common disclaimer phrases (e.g. "Confidentiality notice", "Disclaimer", "This email is confidential", "Please consider the environment", "Sent from my") if that occurrence is after position 20.

### Exact injection point

**File:** `Pariskq-CRM-Backend/src/workers/autoTicketWorker.js`

- **Line ~15:** Import added: `sanitizeParsedLocation` from `parsingService.js`.
- **Lines ~153–155:** After `const parsed = parseEmail(raw);`, call `parsed = sanitizeParsedLocation(parsed);` so all downstream logic (structured count, validation, insertParsedEmail, createTicket) uses the sanitized `parsed`.

```js
// After: const parsed = parseEmail(raw);
let parsed = parseEmail(raw);
parsed = sanitizeParsedLocation(parsed);

if (countStructuredComplaintFields(parsed) < 2) {
```

### New helper (no change to extractField)

**File:** `Pariskq-CRM-Backend/src/services/parsingService.js`  
**Lines:** New export after `parseEmail` (before `parseEmailFromText`):

- `sanitizeParsedLocation(parsed)` – pure function, returns new object with `location` sanitized; does not mutate input or touch any regex/label logic.

### Risk assessment (Objective 1)

- **Risk:** Low. Only adds a step and a new pure helper; `parseEmail` and `extractField` unchanged.
- **Untouched:** Webhook, raw_emails storage, classification, `countStructuredComplaintFields`, validation, `createTicket`, all raw_email statuses.
- **Worker order:** Unchanged (classify → parse → **sanitize** → count check → validate → insert parsed → createTicket → status update).

---

## OBJECTIVE 2 – Make issue_type Non-Blocking

### Requirement

Ticket can be **OPEN** when:

- `vehicle_number` exists **and**
- `location` exists **and**
- some **issue_description or remarks** exist.

`issue_type` is **not** required.

### File changed

**File:** `Pariskq-CRM-Backend/src/services/requiredFieldValidator.js`

### Exact change (requiredFieldValidator)

- **Lines 16–18 (old):** Required checks were `vehicle_number`, `issue_type`, `location`.
- **Lines 16–20 (new):** Require `vehicle_number`, `location`, and at least one of `issue_type` or `remarks`. Missing key for the third condition: `issue_type_or_remarks`.

```js
if (!safeGet(parsedEmail, 'vehicle_number')) missing.push('vehicle_number');
if (!safeGet(parsedEmail, 'location')) missing.push('location');
const hasIssueInfo = safeGet(parsedEmail, 'issue_type') || safeGet(parsedEmail, 'remarks');
if (!hasIssueInfo) missing.push('issue_type_or_remarks');
```

- **Catch block:** `missingFields` fallback set to `['vehicle_number', 'location', 'issue_type_or_remarks']`.

### File changed (reply flow)

**File:** `Pariskq-CRM-Backend/src/services/ticketService.js`

- **Function:** `hasRequiredFieldsForOpen(ticket)` (lines 43–50).
- **Logic:** OPEN when `vehicle_number` **and** `location` **and** ( `issue_type` **or** `short_description` ) are present. This aligns with tickets that get `short_description` from creation (see Objective 3); reply merge does not add `short_description`, so existing tickets with only `short_description` and no `issue_type` still transition to OPEN after reply if they already have vehicle_number and location.

```js
export function hasRequiredFieldsForOpen(ticket) {
  if (!ticket || typeof ticket !== 'object') return false;
  const hasIssueInfo = safeHasValue(ticket.issue_type) || safeHasValue(ticket.short_description);
  return (
    safeHasValue(ticket.vehicle_number) &&
    safeHasValue(ticket.location) &&
    hasIssueInfo
  );
}
```

### Risk assessment (Objective 2)

- **Risk:** Low. Only validation and OPEN-eligibility rules change; no DB schema or worker flow change.
- **Untouched:** Parsing, confidence, insert, createTicket signature, raw_email statuses, reply flow structure.
- **Backward compatibility:** Emails that already have `issue_type` behave as before (OPEN when vehicle_number + location + issue_type). New case: OPEN when vehicle_number + location + remarks (and no issue_type).

---

## OBJECTIVE 3 – short_description (Non-Destructive)

### Design

- **Source:** If `parsed.remarks` exists (non-empty), use first 200 chars of trimmed remarks; else use first 200 chars of cleaned email text from `getEmailText(rawEmail)` (spaces normalized).
- **Storage:** New nullable column `tickets.short_description` (additive migration only).
- **Creation:** Set only in ticket creation layer (`createTicket`); no change to assignment or state machine.

### Backend changes

**File:** `Pariskq-CRM-Backend/src/services/ticketService.js`

- **Top:** Import `getEmailText` from `../utils/emailParser.js`; constant `SHORT_DESCRIPTION_MAX_LEN = 200`.
- **In `createTicket`:** Before `insertTicket`, compute:
  - `remarksTrimmed` = trimmed `parsed.remarks` or `''`.
  - `shortDescription` = if `remarksTrimmed` then first 200 chars, else first 200 chars of `getEmailText(rawEmail)` (cleaned); empty string becomes `null`.
- **insertTicket payload:** Spread `...(shortDescription ? { short_description: shortDescription } : {})` so column is only sent when present (safe when column exists).

**File:** `Pariskq-CRM-Backend/src/repositories/ticketsRepo.js`

- **`findTicketByTicketNumber`:** Add `short_description` to `.select(...)` so reply flow and any caller get it for `hasRequiredFieldsForOpen(mergedTicket)`.

### Additive migration

**File:** `field-ops-assist/supabase/migrations/20260228100000_add_tickets_short_description.sql`

```sql
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS short_description text;

COMMENT ON COLUMN public.tickets.short_description IS 'Brief issue summary: from remarks or first 200 chars of email body. Used for display and OPEN eligibility (with vehicle_number + location).';
```

- No columns removed or altered.

### Frontend use (safe fallback)

- **Type:** `field-ops-assist/src/lib/types.ts` – On `Ticket`, add optional `short_description?: string | null`.
- **Display rule:** If `short_description` exists, show it (truncated for table); else fallback to truncated `location`.
- **TicketsTable (full):** Location cell shows `(ticket.short_description || ticket.location || '—').slice(0, 80)` + ellipsis if longer.
- **TicketsTable (compact):** Subtitle shows `ticket.short_description` (first 60 chars) if present, else `ticket.issue_type || ticket.category || 'Unclassified'`.

Older tickets (no `short_description`) and manual creates without this field continue to use `location` / issue_type/category as before.

### Risk assessment (Objective 3)

- **Risk:** Low. Additive column and optional payload; creation and state machine unchanged.
- **Untouched:** Webhook, worker order, validation contract, raw_email statuses, reply merge fields (STRUCTURED_FIELDS unchanged).
- **Dependency:** Migration must be run before deploying backend that sends `short_description`, or insert may fail if DB does not have the column.

---

## OBJECTIVE 4 – System Stability

### Summary

| Area | Status |
|------|--------|
| Webhook logic | Unchanged |
| raw_emails storage | Unchanged |
| autoTicketWorker flow | Unchanged (one additive step: sanitize after parse) |
| ticketService / state machine | Unchanged (additive short_description; OPEN rule relaxed) |
| Parsing / extractField / regex | Unchanged |
| raw_email statuses | Unchanged (IGNORED_*, TICKET_CREATED, PROCESSED_REPLY, etc.) |
| Worker sequence | Same: fetch → reply check → classify → parse → **sanitize** → count &lt; 2 → validate → insert parsed → dedupe → createTicket → update status |

### Confirmation of no breaking changes

- **APIs:** No route or request/response shape changes.
- **DB:** Additive migration only; no drops or renames.
- **Existing tickets:** No backfill required; `short_description` is optional; frontend and `hasRequiredFieldsForOpen` handle absence.
- **Reply flow:** Still uses `mergeParsedIntoTicket` and `hasRequiredFieldsForOpen(mergedTicket)`; tickets with `short_description` from creation can transition to OPEN with vehicle_number + location + short_description even when `issue_type` is still missing.

---

## File and line reference

| Change | File | Location |
|--------|------|----------|
| sanitizeParsedLocation | Pariskq-CRM-Backend/src/services/parsingService.js | New export after parseEmail, ~lines 100–134 |
| Worker: import + sanitize call | Pariskq-CRM-Backend/src/workers/autoTicketWorker.js | Import ~line 15; after parseEmail ~lines 153–155 |
| requiredFieldValidator | Pariskq-CRM-Backend/src/services/requiredFieldValidator.js | Lines 16–20, catch ~26 |
| hasRequiredFieldsForOpen | Pariskq-CRM-Backend/src/services/ticketService.js | Lines 43–50 |
| getEmailText + short_description in createTicket | Pariskq-CRM-Backend/src/services/ticketService.js | Import + constant top; createTicket before insertTicket |
| findTicketByTicketNumber select | Pariskq-CRM-Backend/src/repositories/ticketsRepo.js | Select list ~line 27 |
| Migration | field-ops-assist/supabase/migrations/20260228100000_add_tickets_short_description.sql | New file |
| Ticket type | field-ops-assist/src/lib/types.ts | Ticket interface short_description |
| TicketsTable full + compact | field-ops-assist/src/components/tickets/TicketsTable.tsx | Location cell; compact subtitle |

---

End of Phase 4 plan. Run migration before deploying backend that sends `short_description`.
