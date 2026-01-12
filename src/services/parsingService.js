import { getEmailText } from '../utils/emailParser.js';

/**
 * Safely parses a raw email into a normalized structure.
 * This function:
 * - NEVER throws
 * - NEVER returns null
 * - ALWAYS returns the same object shape
 * - Documents failures via parse_errors instead of crashing
 */
export function parseEmail(raw) {
  const parse_errors = [];

  // --- Fixed return contract ---
  const result = {
    complaint_id: null,
    vehicle_number: null,
    issue_type: null,
    category: null,
    location: null,
    reported_at: null,
    remarks: null,
    attachments: [],
    parse_errors,
  };

  // --- Step 1: Extract readable text safely ---
  let text = '';

  try {
    const extracted = getEmailText(raw);
    if (typeof extracted === 'string' && extracted.trim().length > 0) {
      text = extracted;
    } else {
      parse_errors.push('Email body was empty or unreadable');
    }
  } catch {
    parse_errors.push('Failed to extract email body');
  }

  // --- Helper: regex extraction that never throws ---
  const extract = (label, regex) => {
    if (!text) return null;

    try {
      const match = text.match(regex);
      if (!match || !match[1]) return null;
      return String(match[1]).trim();
    } catch {
      parse_errors.push(`Failed while extracting ${label}`);
      return null;
    }
  };

  // --- Step 2: Field extraction (preserving original intent) ---

  const complaint_id = extract('complaint_id', /\b(CCM\w+)\b/i);
  if (complaint_id) {
    result.complaint_id = complaint_id;
  }

  const vehicle_number = extract(
    'vehicle_number',
    /\bVEHICLE\s*([A-Z0-9]+)\b/i
  );
  if (vehicle_number) {
    result.vehicle_number = vehicle_number;
  }

  const category = extract(
    'category',
    /Category\s*[:\-]?\s*(.+)/i
  );
  if (category) {
    result.category = category;
  }

  const issue_type = extract(
    'issue_type',
    /Item Name\s*[:\-]?\s*(.+)/i
  );
  if (issue_type) {
    result.issue_type = issue_type;
  }

  const location = extract(
    'location',
    /Location\s*[:\-]?\s*(.+)/i
  );
  if (location) {
    result.location = location;
  }

  const remarks = extract(
    'remarks',
    /Remarks\s*[:\-]?\s*(.+)/i
  );
  if (remarks) {
    result.remarks = remarks;
  }

  const reported_at = extract(
    'reported_at',
    /Reported At\s*[:\-]?\s*(.+)/i
  );
  if (reported_at) {
    result.reported_at = reported_at;
  }

  // --- Step 3: Record missing fields only if text existed ---
  if (text) {
    if (!result.complaint_id) parse_errors.push('complaint_id missing');
    if (!result.vehicle_number) parse_errors.push('vehicle_number missing');
    if (!result.issue_type) parse_errors.push('issue_type missing');
    if (!result.category) parse_errors.push('category missing');
    if (!result.location) parse_errors.push('location missing');
  }

  // Attachments intentionally left empty for now
  // (Postmark attachment handling will populate this later)

  return result;
}
