import { getEmailText } from '../utils/emailParser.js';

/**
 * Robust email parser
 * - HTML-safe
 * - Label-boundary aware
 * - Non-greedy extraction
 * - Backward compatible
 * - Never throws
 */
export function parseEmail(raw) {
  const parse_errors = [];

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

  let text = '';

  /* =====================================================
     STEP 1: Extract + Normalize Body
  ===================================================== */
  try {
    const extracted = getEmailText(raw);

    if (typeof extracted === 'string' && extracted.trim().length > 0) {
      text = extracted;

      // Normalize whitespace
      text = text.replace(/\r\n/g, ' ');
      text = text.replace(/\n/g, ' ');
      text = text.replace(/\t/g, ' ');

      // Remove residual HTML tags (safety)
      text = text.replace(/<[^>]*>/g, ' ');

      // Collapse multi-spaces
      text = text.replace(/\s+/g, ' ').trim();
    } else {
      parse_errors.push('Email body was empty or unreadable');
    }
  } catch {
    parse_errors.push('Failed to extract email body');
  }

  if (!text) {
    return result;
  }

  /* =====================================================
     STEP 2: Smart Label-Based Extraction
  ===================================================== */

  const labels = [
    'Category',
    'Item Name',
    'Incident Title',
    'Location',
    'Remarks',
    'Reported At',
  ];

  const buildRegex = (label) => {
    const nextLabels = labels
      .filter(l => l !== label)
      .join('|');

    return new RegExp(
      `${label}\\s*[:\\-]?\\s*(.*?)\\s*(?=${nextLabels}|$)`,
      'i'
    );
  };

  const safeExtract = (label) => {
    try {
      const regex = buildRegex(label);
      const match = text.match(regex);
      if (!match || !match[1]) return null;
      return match[1].trim();
    } catch {
      parse_errors.push(`Failed while extracting ${label}`);
      return null;
    }
  };

  /* =====================================================
     STEP 3: Field Extraction
  ===================================================== */

  const complaint_id = text.match(/\b(CCM\w+)\b/i);
  if (complaint_id) {
    result.complaint_id = complaint_id[1].trim();
  }

  const vehicle_number = text.match(/\bVEHICLE\s*([A-Z0-9]+)\b/i);
  if (vehicle_number) {
    result.vehicle_number = vehicle_number[1].trim();
  }

  result.category = safeExtract('Category');
  result.issue_type = safeExtract('Item Name');
  result.location = safeExtract('Location');
  result.remarks = safeExtract('Remarks');
  result.reported_at = safeExtract('Reported At');

  /* =====================================================
     STEP 4: Missing Field Tracking
  ===================================================== */

  if (!result.complaint_id) parse_errors.push('complaint_id missing');
  if (!result.vehicle_number) parse_errors.push('vehicle_number missing');
  if (!result.issue_type) parse_errors.push('issue_type missing');
  if (!result.category) parse_errors.push('category missing');
  if (!result.location) parse_errors.push('location missing');

  return result;
}
