// /services/parsingService.js
import { getEmailText, decodeIfBase64 } from '../utils/emailParser.js';

const FIELD_LABELS = [
  'Category',
  'Description',
  'Issue type',
  'Item Name',
  'Location',
  'Remarks',
  'Reported At',
  'Incident Title',
  'Vehicle number',
  'Complaint ID',
  'Record ID',
  'Incident Number',
];

/** Indian vehicle number (e.g. TS09UD4043, MH12AB1234, GA07T2690) */
const VEHICLE_REGEX = /\b([A-Z]{2}\d{1,2}[A-Z]{1,2}\d{3,4})\b/;
/** 10-digit contact number */
const CONTACT_NUMBER_REGEX = /\b(\d{10})\b/;

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
 * Fallback: extract first Indian-style vehicle from text (no "VEHICLE" prefix).
 */
function extractVehicleFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(VEHICLE_REGEX);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extract first 10-digit contact number from text.
 */
function extractContactNumber(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(CONTACT_NUMBER_REGEX);
  return match ? match[1] : null;
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

/**
 * Strip HTML tags from a string.
 */
function stripHtml(html) {
  if (html == null || typeof html !== 'string') return '';
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract structured key-value pairs from HTML table (e.g. <td>Record ID</td><td>CCM0028060828</td>).
 * Maps to parser fields: complaint_id, category, issue_type, remarks, location, contact_number, reported_at.
 * Also extracts vehicle_number from remarks using Indian plate regex.
 */
function extractStructuredHTMLFields(raw) {
  const out = {
    complaint_id: null,
    vehicle_number: null,
    category: null,
    issue_type: null,
    location: null,
    remarks: null,
    reported_at: null,
    contact_number: null,
  };

  let payload = raw?.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return out;
    }
  }
  let html = payload?.HtmlBody || payload?.htmlBody || '';
  if (typeof html !== 'string') html = '';
  const rawHtml = decodeIfBase64(html).trim();
  if (!rawHtml) return out;

  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const cells = [];
  let m;
  while ((m = tdRegex.exec(rawHtml)) !== null) {
    cells.push(stripHtml(m[1]).trim());
  }

  const labelToValue = {};
  for (let i = 0; i + 1 < cells.length; i += 2) {
    const label = cells[i];
    const value = cells[i + 1];
    if (label && value !== undefined) labelToValue[label] = value;
  }

  const get = (... keys) => {
    for (const k of keys) {
      const v = labelToValue[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };

  out.complaint_id = get('Record ID', 'Incident Number') || null;
  out.category = get('Category') || null;
  out.issue_type = get('Item Name', 'Incident Title') || null;
  out.remarks = get('Remarks') || null;
  out.location = get('Location') || null;
  out.contact_number = get('Contact Numbers', 'Contact Number') || null;
  const submitDate = get('Submit Date');
  const submitTime = get('Submit Time');
  if (submitDate || submitTime) {
    out.reported_at = [submitDate, submitTime].filter(Boolean).join(' ').trim() || null;
  }

  if (out.remarks && !out.vehicle_number) {
    out.vehicle_number = extractVehicleFromText(out.remarks);
  }

  return out;
}

/**
 * Safe parser output when parsing fails.
 */
function safeParserOutput(parse_errors = ['parser_error']) {
  return {
    complaint_id: null,
    vehicle_number: null,
    category: null,
    issue_type: null,
    location: null,
    remarks: null,
    reported_at: null,
    contact_number: null,
    parse_errors: [...parse_errors],
    attachments: [],
  };
}

export function parseEmail(raw) {
  const parse_errors = [];

  try {
    let text = getEmailText(raw);
    if (!text) {
      parse_errors.push('Email body empty');
      return { ...safeParserOutput(parse_errors), parse_errors };
    }

    text = cleanEmailBody(text);
    if (!text) {
      parse_errors.push('Email body empty after cleaning');
      return { ...safeParserOutput(parse_errors), parse_errors };
    }

    text = text.replace(/\s+/g, ' ').trim();

    const result = {
      complaint_id: null,
      vehicle_number: null,
      issue_type: null,
      category: null,
      location: null,
      reported_at: null,
      remarks: null,
      contact_number: null,
      attachments: [],
      parse_errors,
    };

    result.complaint_id = extractComplaintId(text);
    if (!result.complaint_id) {
      result.complaint_id =
        extractField('Complaint ID', text) ||
        extractField('Record ID', text) ||
        extractField('Incident Number', text) ||
        null;
    }

    result.vehicle_number = extractVehicle(text) || extractField('Vehicle number', text);
    if (!result.vehicle_number) result.vehicle_number = extractVehicleFromText(text);

    result.category = extractField('Category', text);
    result.issue_type = extractField('Issue type', text) || extractField('Item Name', text);
    result.location = extractField('Location', text);

    const rawRemarks = extractField('Remarks', text) || extractField('Description', text);
    result.remarks = rawRemarks ? String(rawRemarks).trim() : null;
    result.reported_at = extractField('Reported At', text);
    result.contact_number = extractContactNumber(text);

    const htmlFields = extractStructuredHTMLFields(raw);
    if (htmlFields.complaint_id && !result.complaint_id) result.complaint_id = htmlFields.complaint_id;
    if (htmlFields.vehicle_number && !result.vehicle_number) result.vehicle_number = htmlFields.vehicle_number;
    if (htmlFields.category && !result.category) result.category = htmlFields.category;
    if (htmlFields.issue_type && !result.issue_type) result.issue_type = htmlFields.issue_type;
    if (htmlFields.location && !result.location) result.location = htmlFields.location;
    if (htmlFields.remarks && !result.remarks) result.remarks = htmlFields.remarks;
    if (htmlFields.reported_at && !result.reported_at) result.reported_at = htmlFields.reported_at;
    if (htmlFields.contact_number && !result.contact_number) result.contact_number = htmlFields.contact_number;

    if (!result.complaint_id) parse_errors.push('complaint_id missing');
    if (!result.vehicle_number) parse_errors.push('vehicle_number missing');
    if (!result.issue_type) parse_errors.push('issue_type missing');
    if (!result.category) parse_errors.push('category missing');
    if (!result.location) parse_errors.push('location missing');

    return result;
  } catch (err) {
    return safeParserOutput(['parser_error']);
  }
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
  /^\s*-{3,}\s*$/,  // ---- or ----------- etc.
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

/** Line starts with one of these labels → strip that line so we don't re-inject into remarks. */
const REMARKS_LABEL_LINE_STARTERS = /^(Complaint ID|Vehicle Number|Location|Category|Issue type|Item Name|Description|Remarks|Contact Number|Submitted By|Submit Date|Submit Time)\s*[:\-]?\s*/i;

/**
 * Remove lines that start with known structured labels (so we don't re-inject them into remarks).
 * @param {string} text
 * @returns {string}
 */
function stripLabelLinesFromRemainder(text) {
  if (!text || typeof text !== 'string') return '';
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    return !REMARKS_LABEL_LINE_STARTERS.test(t);
  });
  return kept.join(' ').replace(/\s+/g, ' ').trim();
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
    const normalizedFullText = fullText && typeof fullText === 'string' ? fullText.replace(/\s+/g, ' ').trim() : '';

    // 0) Complaint ID fallback: if parser did not set it (e.g. no CCM format), try label aliases
    if (!out.complaint_id || String(out.complaint_id).trim() === '') {
      const fromComplaintId = normalizedFullText ? extractField('Complaint ID', normalizedFullText) : null;
      const fromRecordId = normalizedFullText ? extractField('Record ID', normalizedFullText) : null;
      const fromIncidentNumber = normalizedFullText ? extractField('Incident Number', normalizedFullText) : null;
      const fallback = fromComplaintId || fromRecordId || fromIncidentNumber;
      if (fallback && String(fallback).trim()) out.complaint_id = String(fallback).trim();
    }

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

    // 2) Append remainder from cleaned body only when parsed.remarks was empty (parser did not find Remarks/Description)
    const hadRemarksFromParser = parsed.remarks != null && String(parsed.remarks).trim() !== '';
    if (cleanedBody && !hadRemarksFromParser) {
      let remainder = cleanedBody.replace(/\s+/g, ' ').trim();
      remainder = stripLabelLinesFromRemainder(remainder);
      remainder = removeValue(remainder, out.complaint_id);
      remainder = removeValue(remainder, parsed.vehicle_number);
      remainder = removeValue(remainder, out.vehicle_number);
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
    contact_number: null,
  };
  if (!text || typeof text !== 'string') return result;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return result;
  result.complaint_id = extractComplaintId(normalized);
  result.vehicle_number = extractVehicle(normalized) || extractField('Vehicle number', normalized);
  if (!result.vehicle_number) result.vehicle_number = extractVehicleFromText(normalized);
  result.category = extractField('Category', normalized);
  result.issue_type = extractField('Issue type', normalized) || extractField('Item Name', normalized);
  result.location = extractField('Location', normalized);
  result.remarks = extractField('Remarks', normalized) || extractField('Description', normalized);
  result.reported_at = extractField('Reported At', normalized);
  result.contact_number = extractContactNumber(normalized);
  return result;
}
