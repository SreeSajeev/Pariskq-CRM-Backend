// /services/parsingService.js
import { getEmailText } from '../utils/emailParser.js';

const FIELD_LABELS = [
  'Category',
  'Description',
  'Issue type',
  'Item Name',
  'Location',
  'Remarks',
  'Reported At',
  'Incident Title',
  'Vehicle number'
];

/**
 * Extract complaint ID (CCM format)
 */
function extractComplaintId(text) {
  const match = text.match(/\bCCM\d{4,15}\b/i);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Extract vehicle (Indian registration robust)
 */
function extractVehicle(text) {
  const match = text.match(
    /\bVEHICLE\s+([A-Z]{2,3}\d{1,2}[A-Z]{0,2}\d{3,4})\b/i
  );
  return match ? match[1].toUpperCase() : null;
}

/**
 * Order-independent label extraction
 */
function extractField(label, text) {
  const otherLabels = FIELD_LABELS
    .filter(l => l !== label)
    .join('|');

  const regex = new RegExp(
    `${label}\\s*[:\\-]?\\s*(.*?)\\s*(?=${otherLabels}|$)`,
    'i'
  );

  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

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

  let text;

  try {
    text = getEmailText(raw);
  } catch {
    parse_errors.push('Failed to extract email body');
    return result;
  }

  if (!text) {
    parse_errors.push('Email body empty');
    return result;
  }

  // Normalize aggressively for flattened emails
  text = text.replace(/\s+/g, ' ').trim();

  result.complaint_id = extractComplaintId(text);
  result.vehicle_number = extractVehicle(text) || extractField('Vehicle number', text);

  result.category = extractField('Category', text);
  result.issue_type = extractField('Issue type', text) || extractField('Item Name', text);
  result.location = extractField('Location', text);
  result.remarks = extractField('Remarks', text) || extractField('Description', text);
  result.reported_at = extractField('Reported At', text);

  if (!result.complaint_id) parse_errors.push('complaint_id missing');
  if (!result.vehicle_number) parse_errors.push('vehicle_number missing');
  if (!result.issue_type) parse_errors.push('issue_type missing');
  if (!result.category) parse_errors.push('category missing');
  if (!result.location) parse_errors.push('location missing');

  return result;
}

/** Max length for location before cap/sentence trim. */
const LOCATION_MAX_LEN = 120;

/** Trailing phrases that indicate disclaimer/footer; strip from end. */
const DISCLAIMER_STARTERS = [
  /^\s*confidentiality\s+notice\s*/i,
  /^\s*disclaimer\s*/i,
  /^\s*this\s+email\s+is\s+(confidential|private)/i,
  /^\s*please\s+consider\s+the\s+environment/i,
  /^\s*sent\s+from\s+my\s+/i,
];

/**
 * Post-process parsed result: cap location length, stop at sentence boundary,
 * remove long trailing disclaimers. Does not mutate input.
 * Call after parseEmail(), before validation and ticket creation.
 */
export function sanitizeParsedLocation(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  let loc = parsed.location;
  if (loc == null || typeof loc !== 'string') return { ...parsed };
  let s = loc.replace(/\s+/g, ' ').trim();
  if (s.length <= LOCATION_MAX_LEN) return { ...parsed, location: s || parsed.location };

  s = s.slice(0, LOCATION_MAX_LEN);
  const lastSentence = s.match(/\.[^\s]*$/);
  if (lastSentence) {
    const idx = s.lastIndexOf(lastSentence[0]);
    s = s.slice(0, idx + 1).trim();
  }
  for (const re of DISCLAIMER_STARTERS) {
    const idx = s.search(re);
    if (idx > 20) s = s.slice(0, idx).trim();
  }
  return { ...parsed, location: s || parsed.location };
}

/** Boundaries in location after which text is moved to remarks (canonical normalization). */
const LOCATION_BOUNDARY_PATTERNS = [
  /Submitted By/i,
  /Submit Date/i,
  /Submit Time/i,
  /Contact Numbers/i,
  /\bThanks\b/i,
  /\bRegards\b/i,
  /^\s*--\s*$/m,
  /\bDisclaimer\b/i,
  /This email is confidential/i,
  /On\s+.+wrote:/i,
  /From:\s*/i,
  /Sent:\s*/i,
];

/** Find index of first boundary match in str, or -1. */
function findFirstBoundaryIndex(str) {
  if (!str || typeof str !== 'string') return -1;
  let minIdx = -1;
  for (const re of LOCATION_BOUNDARY_PATTERNS) {
    const idx = str.search(re);
    if (idx !== -1 && (minIdx === -1 || idx < minIdx)) minIdx = idx;
  }
  return minIdx;
}

/** Signature starters: text after these is dropped when computing leftover. */
const SIGNATURE_STARTERS = [
  /\bThanks\b/i,
  /\bRegards\b/i,
  /^\s*--\s*$/m,
  /\bDisclaimer\b/i,
  /This email is confidential/i,
];

/** Find earliest signature start index in str, or str.length. */
function findSignatureStart(str) {
  if (!str || typeof str !== 'string') return 0;
  let idx = str.length;
  for (const re of SIGNATURE_STARTERS) {
    const i = str.search(re);
    if (i !== -1 && i < idx) idx = i;
  }
  return idx;
}

/** Safely remove a value from text (replace with space, then collapse). */
function removeValue(text, value) {
  if (text == null || typeof text !== 'string') return text || '';
  if (value == null || typeof value !== 'string' || value.trim() === '') return text;
  const v = value.trim();
  if (v.length === 0) return text;
  return text.split(v).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Canonical normalization layer: clean location (split at boundaries, keep first segment),
 * build canonical remarks (existing + overflow from location + meaningful leftover from email).
 * Does not modify parseEmail, extractField, FIELD_LABELS, validation, ticketService, or schema.
 * Call after parseEmail(raw), before sanitizeParsedLocation and validation.
 * Never throws; returns same-shaped object; never removes existing valid values.
 */
export function normalizeParsedTicket(parsed, raw) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const out = { ...parsed };

  let loc = parsed.location;
  if (loc != null && typeof loc === 'string') {
    const s = loc.replace(/\s+/g, ' ').trim();
    const boundaryIdx = findFirstBoundaryIndex(s);
    if (boundaryIdx > 0) {
      const cleanLocation = s.slice(0, boundaryIdx).trim();
      const overflow = s.slice(boundaryIdx).trim();
      out.location = cleanLocation || out.location;
      if (overflow) {
        const existingRemarks = out.remarks != null && String(out.remarks).trim() !== '' ? String(out.remarks).trim() : '';
        out.remarks = existingRemarks ? `${existingRemarks} ${overflow}` : overflow;
      }
    } else if (s !== loc) {
      out.location = s;
    }
  }

  let fullText = '';
  try {
    fullText = getEmailText(raw) || '';
  } catch {
    fullText = '';
  }
  if (fullText && typeof fullText === 'string') {
    fullText = fullText.replace(/\s+/g, ' ').trim();
    fullText = removeValue(fullText, parsed.complaint_id);
    fullText = removeValue(fullText, parsed.vehicle_number);
    fullText = removeValue(fullText, parsed.category);
    fullText = removeValue(fullText, parsed.issue_type);
    fullText = removeValue(fullText, parsed.location);
    fullText = removeValue(fullText, out.location);
    const beforeSig = fullText.slice(0, findSignatureStart(fullText)).trim();
    if (beforeSig.length > 0 && beforeSig.length <= 800) {
      const soFar = out.remarks != null && String(out.remarks).trim() !== '' ? String(out.remarks).trim() : '';
      out.remarks = soFar ? `${soFar} ${beforeSig}` : beforeSig;
    }
  }

  return out;
}

export function parseEmailFromText(text) {
  const result = {
    complaint_id: null,
    vehicle_number: null,
    issue_type: null,
    category: null,
    location: null,
    reported_at: null,
    remarks: null,
  };
  if (!text || typeof text !== 'string') return result;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return result;
  result.complaint_id = extractComplaintId(normalized);
  result.vehicle_number = extractVehicle(normalized) || extractField('Vehicle number', normalized);
  result.category = extractField('Category', normalized);
  result.issue_type = extractField('Issue type', normalized) || extractField('Item Name', normalized);
  result.location = extractField('Location', normalized);
  result.remarks = extractField('Remarks', normalized) || extractField('Description', normalized);
  result.reported_at = extractField('Reported At', normalized);
  return result;
}
