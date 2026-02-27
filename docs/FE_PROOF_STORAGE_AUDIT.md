# FE Proof Storage — Audit Report

## 1. Where proof is currently stored

| Flow | Entry point | Storage location | Format |
|------|-------------|------------------|--------|
| **RESOLUTION** | Frontend → `POST /fe/proof` (JSON body) | `ticket_comments.attachments` (JSONB) | `{ image_base64, remarks, action_type }` — base64 string stored directly in DB |
| **ON_SITE** | Frontend → Supabase client (no backend) | `ticket_comments.attachments` (JSONB) | Same: `{ image_base64, remarks, action_type }` — base64 in DB |

- **Route:** `Pariskq-CRM-Backend/src/app.js` → `POST /fe/proof` → `src/controllers/proofController.js` (`uploadFeProof`).
- **RESOLUTION:** Backend receives `req.body` with `token`, `attachments` (object with `image_base64`), `outcome`, `failure_reason`. Backend inserts into `ticket_comments` with `attachments` as-is (base64 inside).
- **ON_SITE:** Frontend never calls `/fe/proof`. It inserts directly into `ticket_comments` via Supabase client from `field-ops-assist/src/pages/FEActionPage.tsx` (lines 141–152). Backend is not involved.

## 2. Persistence

- **Persistent:** Yes. Both flows write to Supabase `ticket_comments`. Data survives server restart.
- **Not in memory only:** Data is in Postgres (Supabase), not only in app memory.

## 3. Lost on server restart?

- **No.** Proof is stored in the database (`ticket_comments.attachments`). Restart does not clear it.

## 4. Only base64 in DB?

- **Yes.** Image is stored only as a base64 string inside `ticket_comments.attachments` (JSONB). No separate file or blob column; no Supabase Storage used today.

## 5. Supabase Storage currently used?

- **No.** There are no references to `supabase.storage` or Storage buckets in the proof flow. No multer/file upload; all proof is JSON body with base64.

## 6. Risks with current setup

- **Large rows:** Base64 inflates size (~33% vs binary). Large or many images can make `ticket_comments` heavy and slow.
- **No redundancy:** Only one copy (DB). Corruption or loss of DB row means loss of proof.
- **ON_SITE bypasses backend:** Backup or validation that lives only in the backend (e.g. Storage backup) cannot see ON_SITE proofs unless the frontend is changed to use `/fe/proof` for ON_SITE as well.

## 7. Relevant files

| Purpose | File |
|--------|------|
| FE proof HTTP handler | `Pariskq-CRM-Backend/src/controllers/proofController.js` |
| App route | `Pariskq-CRM-Backend/src/app.js` (POST /fe/proof) |
| Frontend RESOLUTION submit | `field-ops-assist/src/pages/FEActionPage.tsx` (POST /fe/proof with JSON) |
| Frontend ON_SITE submit | `field-ops-assist/src/pages/FEActionPage.tsx` (direct Supabase insert) |
| Display proof (base64) | `field-ops-assist/src/pages/TicketDetail.tsx` (e.g. `a?.image_base64`) |

## 8. Safe backup scope

- Backup can be added **only where the backend receives the image**: i.e. **RESOLUTION** in `proofController.js`.
- **ON_SITE** proof never hits the backend, so backend Storage backup cannot be added for ON_SITE without changing the frontend to send ON_SITE proofs through `/fe/proof`.
