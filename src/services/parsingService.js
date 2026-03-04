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
  /\bPhone\b/i,
  /\bMobile\b/i,
  /\bEngineer\b/i,
  /Reported By/i,
  /\bRemarks\b/i,
  /\bDescription\b/i,
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

/** Line starters that indicate start of signature / disclaimer / reply chain; stop collecting body. */
const BODY_STOP_PATTERNS = [
  /^\s*Thanks\s*&\s*Regards/i,
  /^\s*Thanks\s+and\s+Regards/i,
  /^\s*Best\s+Regards/i,
  /^\s*Regards\s*$/i,
  /^\s*--\s*$/,
  /^\s*Disclaimer\s*:/i,
  /^\s*On\s+Mon\s*,/i,
  /^\s*On\s+Tue\s*,/i,
  /^\s*On\s+Wed\s*,/i,
  /^\s*On\s+Thu\s*,/i,
  /^\s*On\s+Fri\s*,/i,
  /^\s*On\s+Sat\s*,/i,
  /^\s*On\s+Sun\s*,/i,
  /^\s*From\s*:/i,
  /^\s*Sent\s*:/i,
  /^\s*Subject\s*:/i,
  /^\s*Original\s+Message\s*$/i,
  /^\s*This\s+email\s+is\s+confidential/i,
];

/**
 * Clean email body: remove quoted reply lines, signatures, disclaimers, reply chains.
 * Stop at Thanks & Regards, Regards, --, Disclaimer, On Mon,, From:, Sent:, Subject:, etc.
 * Never throws; returns trimmed string (possibly empty).
 */
function cleanEmailBody(text) {
  if (text == null || typeof text !== 'string') return '';
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return '';
  const lines = normalized.split('\n');
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\s*>/.test(line) || trimmed === '') continue;
    let stop = false;
    for (const re of BODY_STOP_PATTERNS) {
      if (re.test(trimmed)) {
        stop = true;
        break;
      }
    }
    if (stop) break;
    kept.push(trimmed);
  }
  const result = kept.join(' ').replace(/\s+/g, ' ').trim();
  return result;
}

/** Find earliest signature start index in str (for inline fallback). */
function findSignatureStart(str) {
  if (!str || typeof str !== 'string') return 0;
  const patterns = [
    /\bThanks\s*&\s*Regards\b/i,
    /\bThanks\s+and\s+Regards\b/i,
    /\bBest\s+Regards\b/i,
    /\bRegards\b/i,
    /\s--\s/,
    /\bDisclaimer\s*:/i,
    /This email is confidential/i,
    /On\s+Mon\s*,/i,
    /On\s+Tue\s*,/i,
    /From\s*:/i,
    /Sent\s*:/i,
  ];
  let idx = str.length;
  for (const re of patterns) {
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

/** Indian vehicle registration pattern for fallback when extractField has no Vehicle number. */
const VEHICLE_FALLBACK_REGEX = /\b([A-Z]{2}\d{1,2}[A-Z]{0,2}\d{3,4})\b/;

const REMARKS_MAX_LEN = 800;

/**
 * Canonical normalization layer: clean location (split at boundaries), clean remarks
 * (original + overflow + cleaned body, no reply chains/signatures), vehicle number fallback.
 * Does not modify parseEmail, extractField, FIELD_LABELS, sanitizeParsedLocation, validation, ticketService, or schema.
 * Never throws; on any failure returns the original parsed object.
 */
export function normalizeParsedTicket(parsed, raw) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  try {
    const out = { ...parsed };

    let fullText = '';
    try {
      fullText = getEmailText(raw) || '';
    } catch {
      fullText = '';
    }
    const cleanedBody = fullText && typeof fullText === 'string' ? cleanEmailBody(fullText) : '';

    // 1) Location overflow: split at boundary, keep first segment as location, append overflow to remarks
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

    // 2) Append meaningful leftover from cleaned email body (no reply chains/signatures)
    if (cleanedBody) {
      let remainder = cleanedBody.replace(/\s+/g, ' ').trim();
      remainder = removeValue(remainder, parsed.complaint_id);
      remainder = removeValue(remainder, parsed.vehicle_number);
      remainder = removeValue(remainder, parsed.category);
      remainder = removeValue(remainder, parsed.issue_type);
      remainder = removeValue(remainder, parsed.location);
      remainder = removeValue(remainder, out.location);
      const beforeSig = remainder.slice(0, findSignatureStart(remainder)).trim();
      if (beforeSig.length > 0) {
        const soFar = out.remarks != null && String(out.remarks).trim() !== '' ? String(out.remarks).trim() : '';
        out.remarks = soFar ? `${soFar} ${beforeSig}` : beforeSig;
      }
    }

    // 3) Cap remarks at REMARKS_MAX_LEN
    if (out.remarks != null && typeof out.remarks === 'string' && out.remarks.length > REMARKS_MAX_LEN) {
      out.remarks = out.remarks.slice(0, REMARKS_MAX_LEN).trim();
    }

    // 4) Vehicle number fallback: if still missing, scan cleaned body with Indian reg pattern
    if (!out.vehicle_number || String(out.vehicle_number).trim() === '') {
      const scanText = cleanedBody || (fullText && typeof fullText === 'string' ? fullText.replace(/\s+/g, ' ').trim() : '');
      const match = scanText && scanText.match(VEHICLE_FALLBACK_REGEX);
      if (match) {
        out.vehicle_number = match[1].toUpperCase();
      }
    }

    return out;
  } catch {
    return parsed;
  }
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
