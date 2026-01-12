import { getEmailText } from '../utils/emailParser.js';
import { normalizeSubject } from '../utils/subjectNormalizer.js';

export function parseEmail(raw) {
  const parse_errors = [];

  // Safe defaults — NEVER return undefined or throw
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

  try {
    const text = getEmailText(raw);

    if (!text || typeof text !== 'string') {
      parse_errors.push('Email body could not be extracted or was empty');
      return result;
    }

    const safeExtract = (regex, fieldName) => {
      try {
        const match = text.match(regex);
        if (!match || !match[1]) {
          return null;
        }
        return match[1].trim();
      } catch (err) {
        parse_errors.push(`Failed to extract ${fieldName}`);
        return null;
      }
    };

    // === Existing extraction logic (unchanged in intent) ===

    result.complaint_id = safeExtract(/\b(CCM\w+)\b/i, 'complaint_id');

    result.vehicle_number = safeExtract(
      /\bVEHICLE\s*([A-Z0-9]+)\b/i,
      'vehicle_number'
    );

    result.category =
      safeExtract(/Category\s*[:\-]?\s*(.+)/i, 'category') || 'UNKNOWN';

    result.issue_type =
      safeExtract(/Item Name\s*[:\-]?\s*(.+)/i, 'issue_type') || 'GENERAL';

    result.location = safeExtract(
      /Location\s*[:\-]?\s*(.+)/i,
      'location'
    );

    result.remarks = safeExtract(
      /Remarks\s*[:\-]?\s*(.+)/i,
      'remarks'
    );

    // Optional / metadata-safe fields
    try {
      result.normalized_subject = normalizeSubject(raw?.subject || '');
    } catch (err) {
      parse_errors.push('Failed to normalize subject');
    }

  } catch (err) {
    // Absolute safety net — parseEmail must NEVER throw
    parse_errors.push('Unexpected parsing failure');
  }

  return result;
}

