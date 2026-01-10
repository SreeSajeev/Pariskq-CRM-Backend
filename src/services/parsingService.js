import { getEmailText } from '../utils/emailParser.js';
import { normalizeSubject } from '../utils/subjectNormalizer.js';

export function parseEmail(raw) {
  const text = getEmailText(raw);
  const extract = (r) => text.match(r)?.[1]?.trim() || null;

  return {
    complaint_id: extract(/\b(CCM\w+)\b/i),
    vehicle_number: extract(/\bVEHICLE\s*([A-Z0-9]+)\b/i),
    category: extract(/Category\s*[:\-]?\s*(.+)/i) || 'UNKNOWN',
    issue_type: extract(/Item Name\s*[:\-]?\s*(.+)/i) || 'GENERAL',
    location: extract(/Location\s*[:\-]?\s*(.+)/i),
    remarks: extract(/Remarks\s*[:\-]?\s*(.+)/i),
    normalized_subject: normalizeSubject(raw.subject),
  };
}
