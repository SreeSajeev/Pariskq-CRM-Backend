# Fix Summary: Reply Merge, Single Email, Badge, Review Queue

## Root cause – Issue 1 (vehicle_number not merging)

**Cause:** `parseEmailFromText()` and `parseEmail()` used only `extractVehicle(text)`, which matches the pattern `VEHICLE\s+([A-Z]...)`. Reply body was `"Vehicle number: TN09AB1234"`, so there is no literal `VEHICLE ` before the number. The parser never tried the label `"Vehicle number:"`.

**Change:** In `parsingService.js`:
- Added `'Vehicle number'` to `FIELD_LABELS`.
- Set `vehicle_number = extractVehicle(text) || extractField('Vehicle number', text)` in both `parseEmail` and `parseEmailFromText`.

Reply text like `"Vehicle number: TN09AB1234"` is now parsed and merged; `updateTicketFields` was already correct.

---

## Fixes applied

### Backend

| File | Change |
|------|--------|
| **parsingService.js** | `FIELD_LABELS` includes `'Vehicle number'`. `vehicle_number` = `extractVehicle(text) \|\| extractField('Vehicle number', text)` in `parseEmail` and `parseEmailFromText`. |
| **ticketService.js** | For `status === 'NEEDS_REVIEW'`: send only `sendMissingDetailsEmail` (no `sendTicketConfirmation`). For OPEN: send only `sendTicketConfirmation`. Pass `subject`, `complaintId`, `category`, `issueType`, `location` into `sendMissingDetailsEmail`. |
| **emailService.js** | `sendMissingDetailsEmail` accepts `subject`, `complaintId`, `category`, `issueType`, `location`. Body includes a "Reference (what we have so far)" block listing those that are present, then received/missing fields and reply instruction. |
| **autoTicketWorker.js** | Reply merge: use `result` from `updateTicketFields` and log `merge` on `result.error`. |

### Frontend

| File | Change |
|------|--------|
| **TicketDetail.tsx** | Removed the extra "Needs Review" badge (StatusBadge already shows status). Approve button and logic use only `ticket.status === "NEEDS_REVIEW"`. |
| **TicketsTable.tsx** | AlertTriangle icon uses `ticket.status === 'NEEDS_REVIEW'` instead of `ticket.needs_review`. |

### Review Queue (Issue 2)

`ReviewQueue.tsx` already uses `useTickets({ status: 'NEEDS_REVIEW' })`. `useTickets` applies `.eq("status", filters.status)` when `filters.status !== "all"`. No code change. If tickets still don’t appear, check Supabase RLS for `tickets` (e.g. policy allowing SELECT for the role used by the frontend).

---

## Verification checklist

1. **Reply merge:** Send reply with subject `[Ticket ID: PKQ-20260220-3494]` and body `Vehicle number: TN09AB1234`. After worker run: ticket `vehicle_number` = `TN09AB1234`; if `issue_type` and `location` were already set, status becomes OPEN.
2. **Single email (NEEDS_REVIEW):** Create incomplete complaint (e.g. 2 fields, missing required). Client receives one email: “Your ticket … has been created”, reference block, received/missing fields, reply instruction. No separate “Ticket Created” email.
3. **OPEN ticket:** Create complete complaint. Client receives only the usual confirmation email.
4. **TicketDetail:** NEEDS_REVIEW ticket shows one status badge (“Needs Review”) and one “Approve & Open” button. No second “Needs Review” badge.
5. **Review Queue:** With RLS allowing it, list shows all tickets where `status === 'NEEDS_REVIEW'`.
