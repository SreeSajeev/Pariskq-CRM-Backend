# Debug Analysis: Location Pollution & NEEDS_REVIEW

## STEP 1 – FIELD_LABELS

**Current FIELD_LABELS (parsingService.js lines 4–13):**

```js
const FIELD_LABELS = [
  'Category',
  'Issue type',
  'Item Name',
  'Location',
  'Remarks',
  'Reported At',
  'Incident Title',
  'Vehicle number'
];
```

1. **"Description" is NOT included** in FIELD_LABELS.
2. **extractField** only uses these labels in the regex lookahead. So "Description:" is **not** recognized as a boundary — it is treated as plain text.

---

## STEP 2 – Trace Location Extraction

1. **How extractField('Location') behaves (lines 36–47)**  
   - Builds: `Location\s*[:\-]?\s*(.*?)\s*(?=Category|Issue type|Item Name|Remarks|Reported At|Incident Title|Vehicle number|$)`.  
   - Captures everything after "Location:" until the **next** occurrence of any of those labels **or end of string**.

2. **Why "Description:" becomes part of Location**  
   - "Description" is not in the lookahead. So the regex does **not** stop at "Description:".  
   - The `(.*?)` keeps matching until it hits one of the known labels or `$`. In your email, after "Location: Pune Regional Office" there is only "Description:" and then the rest of the body — no "Category", "Remarks", etc. So the match runs to **end of string**, and Location captures:  
     `Pune Regional Office Description: The GPS tracker has stopped updating location since 10 AM. Please check urgently. Contact Number: 9876543210`.

3. **Why extractField stops only at next known label**  
   - The lookahead is explicitly `(?=${otherLabels}|$)`. Only those strings (and end of string) end the capture. Any other word (e.g. "Description") is just content.

4. **Why flattening worsens this (line 79)**  
   - `text = text.replace(/\s+/g, ' ').trim()` turns newlines into spaces. So you get one long line; there is no “next line” boundary. The only way to stop Location would be a **label** from FIELD_LABELS. With "Description" missing, nothing stops the capture before end of string.

---

## STEP 3 – Trace Remarks Extraction

1. **extractField('Remarks') runs** (line 87): `result.remarks = extractField('Remarks', text)`.
2. **It does NOT detect "Description:"** — it looks for the literal label "Remarks" (with optional `:` or `-`). The email has "Description:", not "Remarks:", so there is no match.
3. **So remarks is null** because the body never uses the word "Remarks"; it uses "Description" for the same purpose.

---

## STEP 4 – Why Ticket Is NEEDS_REVIEW

- **Parsed object (relevant):**  
  - complaint_id: from "TEST-NEW-001" — not CCM format, so null (no `CCM\d{4,15}`).  
  - vehicle_number: MH12AB1234 ✓ (Vehicle number or VEHICLE pattern).  
  - location: "Pune Regional Office Description: The GPS tracker h..." (polluted then sanitized).  
  - issue_type: null (no "Issue type:" or "Item Name:").  
  - category: null.  
  - remarks: null (no "Remarks:", only "Description:").

- **Validation (requiredFieldValidator):**  
  - vehicle_number ✓, location ✓.  
  - hasIssueInfo = safeGet(parsed, 'issue_type') || safeGet(parsed, 'remarks') → both null → false.  
  - missing.push('issue_type_or_remarks'), isComplete = false.

- **createTicket:** requiredComplete = validation.isComplete = false → **status = NEEDS_REVIEW**.

---

## STEP 5 – Minimal Safe Fix (see code change below)

1. **Treat "Description" as equivalent to "Remarks":**  
   Set `result.remarks = extractField('Remarks', text) || extractField('Description', text)` (and same in parseEmailFromText).

2. **Make extractField('Location') stop at "Description":**  
   Add `'Description'` to FIELD_LABELS. Then the Location regex’s lookahead includes "Description", so the capture stops at "Description:" and location stays "Pune Regional Office".

3. **Preserve all other behavior:**  
   No other labels or extraction order changed; only one new label and remarks fallback.
