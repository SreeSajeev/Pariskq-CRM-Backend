// /services/parsingService.js
import { getEmailText } from '../utils/emailParser.js';

const FIELD_LABELS = [
  'Category',
  'Item Name',
  'Location',
  'Remarks',
  'Reported At',
  'Incident Title'
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
  result.vehicle_number = extractVehicle(text);

  result.category = extractField('Category', text);
  result.issue_type = extractField('Item Name', text);
  result.location = extractField('Location', text);
  result.remarks = extractField('Remarks', text);
  result.reported_at = extractField('Reported At', text);

  if (!result.complaint_id) parse_errors.push('complaint_id missing');
  if (!result.vehicle_number) parse_errors.push('vehicle_number missing');
  if (!result.issue_type) parse_errors.push('issue_type missing');
  if (!result.category) parse_errors.push('category missing');
  if (!result.location) parse_errors.push('location missing');

  return result;
}
