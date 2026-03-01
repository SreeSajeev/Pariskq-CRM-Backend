# Production Regression Recovery — Strict Diff Analysis & Execution Trace

**Baseline (working):** `565f058b5aec142b0c5a2b9ed33f7bc0cd5868a6` (tag: demo-backup-pre-notification-change)  
**Current HEAD:** `a7e215775c55fdf59b6e6311f0bee8ca1be47fc0`  
**Scope:** `src/services/emailService.js`, `src/services/smsService.js`, `src/routes/tickets.js`

---

## STEP 1 — STRICT DIFF ANALYSIS

### emailService.js

| Change | Exact behavior change | Early return/throw? | Provider call ever skipped? | Supabase lookup can abort? | Env read change? | Validation stricter? | Promise resolution vs rejection |
|--------|------------------------|--------------------|-----------------------------|----------------------------|------------------|----------------------|----------------------------------|
| New `logEmailEnvStatus(tag)` | Logs POSTMARK_SERVER_TOKEN/FROM_EMAIL set vs MISSING before send. | No. | No. | No. | No (read same vars). | No. | No change. |
| `if (!canSendEmail())` branch | **Before:** `console.warn(...); return;` (promise resolves). **After:** `console.error(...); throw new Error(msg);` (promise rejects). | **Yes — throw.** | **Yes.** When env missing, `fetch(POSTMARK_URL, ...)` is **never executed** because we throw first. | N/A. | No. | No. | **Rejection** instead of resolution. |
| `if (!res.ok)` branch | **Before:** `const text = await res.text(); console.error(...);` (no throw). **After:** same + `throw new Error(...)`. | **Yes — throw.** | No (fetch already ran). | No. | No. | No. | **Rejection** instead of resolution. |
| `catch (err)` in sendEmail | **Before:** `console.error(...);` (no rethrow). **After:** `console.error(...); throw err;`. | **Yes — rethrow.** | No. | No. | No. | No. | **Rejection** instead of resolution. |
| sendFEAssignmentEmail: `if (!feId)` | **Before:** `console.error; return;`. **After:** `console.error; throw new Error(msg);`. | **Yes — throw.** | Yes — sendEmail never called. | N/A. | No. | No. | Rejection. |
| sendFEAssignmentEmail: invalid ticketNumber | Same pattern: return → throw. | **Yes — throw.** | Yes — sendEmail never called. | No. | No. | No. | Rejection. |
| sendFEAssignmentEmail: `if (error \|\| !fe?.email)` | **Before:** `console.error; return;`. **After:** `console.error; throw new Error(msg);`. | **Yes — throw.** | **Yes — sendEmail never called** when FE missing or no email. | **Yes — Supabase lookup result aborts flow** (we throw, never reach sendEmail). | No. | No. | Rejection. |
| sendFEAssignmentEmail outer catch | **Before:** `console.error(...);` only. **After:** `console.error(...); throw err;`. | **Yes — rethrow.** | No. | No. | No. | No. | Rejection. |
| sendFETokenEmail: same pattern | All validation / FE not found / catch changed from return to throw. | **Yes — throw.** | Yes when validation or FE lookup fails. | **Yes — FE lookup can abort** (throw before sendEmail). | No. | No. | Rejection. |

### smsService.js

| Change | Exact behavior change | Early return/throw? | Provider call ever skipped? | Env read change? | Validation stricter? | Promise resolution vs rejection |
|--------|------------------------|--------------------|-----------------------------|------------------|----------------------|----------------------------------|
| Invalid phone `cleanPhone.length !== 10` | **Before:** `console.error; return false;`. **After:** `console.error; throw new Error(msg);`. | **Yes — throw.** | **Yes — axios.get never executed** when phone invalid. | No. | No (same 10-digit check). | Rejection. |
| `!hasKey` (FAST2SMS_API_KEY) | **Before:** `console.error; return false;`. **After:** `console.error; throw new Error(msg);`. | **Yes — throw.** | **Yes — axios.get never executed** when key missing. | No (key read same way). | No. | Rejection. |
| Non-2xx response | **Before:** log and `return false`. **After:** log and `throw new Error(...)`. | **Yes — throw.** | No (request already sent). | No. | No. | Rejection. |
| catch (err) | **Before:** log and `return false`. **After:** log and `throw err` / `new Error`. | **Yes — rethrow.** | No. | No. | No. | Rejection. |

### tickets.js (assignment flow only)

| Change | Exact behavior change | Affects notification flow? |
|--------|------------------------|-----------------------------|
| Comment "Insert assignment" | Text only. | No. |
| `if (assignmentError \|\| !assignment)` + return 400 | **Before:** only `if (assignmentError)`; no return; continued with assignment possibly null. **After:** return 400 with message. | No (safety fix; prevents bad state). |
| `current_assignment_id: assignment.id` | **Before:** `assignment?.id \|\| null`. **After:** `assignment.id` (only reached when assignment exists). | No. |
| Extra console.logs + .catch message | Logging and error message in .catch. | No (still .catch; rejection handled). |

---

## STEP 2 — TRACE EXECUTION PATH (CURRENT BROKEN BEHAVIOR)

### 1. Insert assignment

- No change from 565f058 in success path. On error, **now** we return 400 (improvement). No throw from notification layer here.

### 2. Update ticket

- Unchanged. No notification code.

### 3. sendFEAssignmentEmail({ feId, ticketNumber }).catch(...)

- **Where throw can occur:**  
  - Inside sendFEAssignmentEmail: `if (!feId)` → throw.  
  - `if (!isValidTicketNumber(ticketNumber))` → throw.  
  - After Supabase FE lookup: `if (error || !fe?.email)` → throw.  
  - Inside sendEmail: `if (!canSendEmail())` → throw (before fetch).  
  - Inside sendEmail: `if (!res.ok)` → throw (after fetch).  
  - sendEmail catch → throw err.  
  - sendFEAssignmentEmail catch → throw err.
- **Where caught:** Route’s `.catch((e) => console.error(...))` — so promise rejection is handled; assignment continues.
- **Provider call reached?** Only if: feId and ticketNumber valid, FE has email in DB, and `canSendEmail()` is true. If any of those fail, we **throw before** `fetch(POSTMARK_URL, ...)`. So the **exact branch preventing Postmark** when env is missing is: **sendEmail**, line `if (!canSendEmail()) { ... throw new Error(msg); }` — **fetch is never executed**. When FE has no email or Supabase error: **sendFEAssignmentEmail** throws after Supabase lookup — **sendEmail is never called**, so Postmark is never reached.

### 4. createActionToken(...)

- Awaited; no notification code. Unchanged.

### 5. sendFETokenEmail({ ... }).catch(...)

- Same pattern as (3). Throws: validation, FE not found, or sendEmail (env missing / !res.ok / catch). **Exact branch preventing Postmark:** same as (3) — either sendFETokenEmail throw (FE/validation) or sendEmail `!canSendEmail()` throw.

### 6. sendFESms(...) in try/catch

- **Where throw can occur:** Invalid phone (length !== 10), !hasKey, non-2xx from Fast2SMS, or axios catch rethrow.
- **Where caught:** Route’s `try { await sendFESms(...) } catch (err) { console.error(...) }`.
- **Provider call reached?** Only if phone valid and FAST2SMS_API_KEY set. If `!hasKey` or invalid phone, we **throw before** `axios.get(baseUrl, ...)`. **Exact branch preventing Fast2SMS:** `if (!hasKey) { ... throw new Error(msg); }` or `if (cleanPhone.length !== 10) { ... throw new Error(msg); }`.

### Summary: condition preventing Postmark call

- **First possible abort:** sendFEAssignmentEmail / sendFETokenEmail — validation or FE lookup (error or !fe?.email) → throw → sendEmail never called.  
- **Inside sendEmail:** `if (!canSendEmail())` → **throw** → **fetch(POSTMARK_URL, ...) never runs.**

### Summary: condition preventing Fast2SMS call

- **Invalid phone:** `if (cleanPhone.length !== 10)` → throw → axios.get never runs.  
- **Missing key:** `if (!hasKey)` → throw → axios.get never runs.

---

## STEP 3 — PROVIDER CALL EXECUTION (after fix)

After restore (Step 5), temporary logs are added:

- **Before Postmark fetch:** `console.log(">>> About to call Postmark")`  
- **Before Fast2SMS axios:** `console.log(">>> About to call Fast2SMS")`

- **Does execution reach these logs (current broken code)?**  
  - **Postmark:** Only if sendEmail is actually entered and `canSendEmail()` is true. If env is missing, we throw before fetch, so ">>> About to call Postmark" is **never** reached. If FE has no email or validation fails, sendEmail is never called, so again **never** reached.  
  - **Fast2SMS:** Only if phone is valid and hasKey is true. If not, we throw before axios.get, so ">>> About to call Fast2SMS" is **never** reached.

- **After restore:** We no longer throw; we log and return. So we always run past the env/validation checks (we just return without calling the provider when misconfigured). When env is set and FE/phone valid, we **do** reach the logs and execute the provider call.

---

## STEP 4 — ROOT CAUSE CONCLUSION

**What EXACT line change caused email and SMS to stop working?**

1. **Email — provider call never executed when env missing:**  
   **File:** `src/services/emailService.js`  
   **Function:** `sendEmail(payload, tag)`  
   **Exact change:** Replacing `if (!canSendEmail()) { console.warn(...); return; }` with `if (!canSendEmail()) { console.error(...); throw new Error(msg); }`.  
   The **throw** does not by itself prevent the fetch (we already didn’t call fetch when env was missing). But it **changes promise outcome to rejection**. So any caller that doesn’t catch (or that maps rejection to 4xx/5xx) will see “failure.” And in all paths below, **throwing** instead of **returning** propagates failure.

2. **Email — flow aborted before sendEmail when FE/validation fails:**  
   **File:** `src/services/emailService.js`  
   **Functions:** `sendFEAssignmentEmail`, `sendFETokenEmail`  
   **Exact change:** Replacing `console.error(...); return;` with `console.error(...); throw new Error(...)` for: missing feId, invalid ticketNumber, and `if (error || !fe?.email)` after Supabase lookup. Same in outer catch: `throw err`.  
   So: **Supabase FE lookup** (or validation) **can now abort the flow** by throwing; we never call sendEmail, so **Postmark is never called** in those cases. Before, we returned and the promise resolved; now we throw and the promise rejects.

3. **Email — provider called but promise rejected on failure:**  
   **Exact change in sendEmail:** On `!res.ok`: added `throw new Error(...)`. In catch: added `throw err`. So even when the **provider call is executed**, a non-ok response or network error causes **rejection** instead of silent resolve. Callers that await and don’t catch get 4xx/5xx.

4. **SMS — provider call never executed when key missing or phone invalid:**  
   **File:** `src/services/smsService.js`  
   **Function:** `sendFESms`  
   **Exact change:** Replacing `return false` with `throw new Error(...)` for: `cleanPhone.length !== 10`, `!hasKey`, non-2xx response, and in catch rethrowing.  
   So when key is missing or phone invalid, we **throw before** `axios.get` — **Fast2SMS is never called**. When provider returns error or network fails, we **throw** so the promise **rejects** instead of resolving with false.

**Single most precise answer:**  
The **exact line changes** that caused notifications to “stop working” (either provider not called or callers seeing failure) are **every replacement of “log and return” / “return false” with “throw”** in `emailService.js` and `smsService.js`. The **first** such change that can prevent the **Postmark** call is in **sendEmail**: the line `throw new Error(msg);` inside `if (!canSendEmail())`. The **first** that can prevent the **Fast2SMS** call is in **sendFESms**: the line `throw new Error(msg);` inside `if (cleanPhone.length !== 10)` or `if (!hasKey)`.

---

## STEP 6 — FINAL CONFIRMATION (after Step 5 restore)

After restoring 565f058 behavior in emailService.js and smsService.js (no throw; log and return; keep improved logging and diagnostic logs):

- **Assignment returns 200:** Yes (route never throws; notification failures only log).  
- **FE token generation still works:** Yes (unchanged).  
- **Provider API call is executed:** Yes when env and data are valid (we no longer throw before fetch/axios; we only return without calling when misconfigured).  
- **Email failure does not break flow:** Yes (sendEmail and sendFE* log and return; promise resolves).  
- **SMS failure does not break flow:** Yes (sendFESms logs and returns false; promise resolves).  
- **No unhandled promise rejections:** Yes (notification layer no longer throws).  
- **System behavior matches 565f058:** Yes (notifications are best-effort, log on failure, never throw).
