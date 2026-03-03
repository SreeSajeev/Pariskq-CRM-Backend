// Pure validator for required fields
// - Must be pure, deterministic, never throw, not mutate input

export function validateRequiredFields(parsedEmail) {
  try {
    const missing = [];

    const safeGet = (obj, key) => {
      if (!obj) return null;
      const v = obj[key];
      if (v === undefined || v === null) return null;
      if (typeof v === 'string' && v.trim() === '') return null;
      return v;
    };

    if (!safeGet(parsedEmail, 'vehicle_number')) missing.push('vehicle_number');
    if (!safeGet(parsedEmail, 'location')) missing.push('location');
    const hasIssueInfo = safeGet(parsedEmail, 'issue_type') || safeGet(parsedEmail, 'remarks');
    if (!hasIssueInfo) missing.push('issue_type_or_remarks');

    return {
      isComplete: missing.length === 0,
      missingFields: missing,
    };
  } catch (e) {
    // Never throw — on unexpected error, report all fields missing conservatively
    return { isComplete: false, missingFields: ['vehicle_number', 'location', 'issue_type_or_remarks'] };
  }
}
