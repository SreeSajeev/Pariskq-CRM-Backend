
//parsingService.js
import { getEmailText } from '../utils/emailParser.js';

/* ======================================================
   CONFIG
====================================================== */

const FIELD_LABELS = [
  'Category',
  'Item Name',
  'Location',
  'Remarks',
  'Reported At',
  'Incident Title'
];

/* ======================================================
   UTILITIES
====================================================== */

function safeString(value) {
  if (!value) return '';
  return String(value).trim();
}

function normalizeWhitespace(text) {
  return safeString(text)
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/* ======================================================
   TOKENIZATION ENGINE
   Works for:
   - single-line
   - shuffled labels
   - html converted text
====================================================== */

function extractFieldsFromText(text) {
  const result = {};
  const lowerText = text.toLowerCase();

  const labelPositions = [];

  for (const label of FIELD_LABELS) {
    const regex = new RegExp(`\\b${label}\\b`, 'i');
    const match = regex.exec(text);
    if (match) {
      labelPositions.push({
        label,
        index: match.index
      });
    }
  }

  // Sort by appearance order
  labelPositions.sort((a, b) => a.index - b.index);

  for (let i = 0; i < labelPositions.length; i++) {
    const current = labelPositions[i];
    const next = labelPositions[i + 1];

    const startIndex = current.index + current.label.length;
    const endIndex = next ? next.index : text.length;

    const rawValue = text.slice(startIndex, endIndex);

    const cleaned = rawValue
      .replace(/^[:\-\s]+/, '')
      .trim();

    result[current.label] = cleaned || null;
  }

  return result;
}

/* ======================================================
   STRUCTURED EXTRACTIONS
====================================================== */

function extractComplaintId(text) {
  const match = text.match(/\bCCM\d{4,15}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function extractVehicle(text) {
  const match = text.match(/\bVEHICLE\s+([A-Z0-9-]{4,20})\b/i);
  return match ? match[1].toUpperCase() : null;
}

/* ======================================================
   PUBLIC PARSER
====================================================== */

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
    parse_errors
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

  text = normalizeWhitespace(text);

  // Structured IDs first (independent of label order)
  result.complaint_id = extractComplaintId(text);
  result.vehicle_number = extractVehicle(text);

  const extractedFields = extractFieldsFromText(text);

  result.category = extractedFields['Category'] || null;
  result.issue_type = extractedFields['Item Name'] || null;
  result.location = extractedFields['Location'] || null;
  result.remarks = extractedFields['Remarks'] || null;
  result.reported_at = extractedFields['Reported At'] || null;

  /* ======================================================
     VALIDATION
  ====================================================== */

  if (!result.complaint_id)
    parse_errors.push('complaint_id missing');

  if (!result.vehicle_number)
    parse_errors.push('vehicle_number missing');

  if (!result.issue_type)
    parse_errors.push('issue_type missing');

  if (!result.category)
    parse_errors.push('category missing');

  if (!result.location)
    parse_errors.push('location missing');

  return result;
}
