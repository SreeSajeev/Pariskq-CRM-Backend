/**
 * Confidence score 0–100 aligned with required fields for OPEN.
 * Required for OPEN: vehicle_number, issue_type, location.
 * Score is 100 only when all three are present; otherwise NEEDS_REVIEW tickets show < 100%.
 */
function hasValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
}

export function calculateConfidence(p) {
  if (!p || typeof p !== 'object') return 0;
  // Required fields (same as validateRequiredFields): 33 + 34 + 33 = 100 when all present
  let score = 0;
  if (hasValue(p.vehicle_number)) score += 33;
  if (hasValue(p.issue_type)) score += 34;
  if (hasValue(p.location)) score += 33;
  // Optional: small bonus so parsing quality is visible; total still capped at 100
  if (hasValue(p.complaint_id)) score = Math.min(100, score + 5);
  if (hasValue(p.category) && p.category !== 'UNKNOWN') score = Math.min(100, score + 5);
  return Math.min(100, Math.round(score));
}
