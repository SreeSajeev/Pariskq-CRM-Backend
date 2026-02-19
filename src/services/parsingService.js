import { getEmailText } from '../utils/emailParser.js';

const LABELS = [
  'Category',
  'Item Name',
  'Incident Title',
  'Location',
  'Remarks',
  'Reported At'
];

function tokenize(text) {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
}

function extractByScanning(lines) {
  const result = {};
  let currentLabel = null;

  for (const line of lines) {
    const matchedLabel = LABELS.find(label =>
      new RegExp(`^${label}\\b`, 'i').test(line)
    );

    if (matchedLabel) {
      currentLabel = matchedLabel;
      const value = line.replace(new RegExp(`^${matchedLabel}\\s*[:\\-]?`, 'i'), '').trim();
      result[currentLabel] = value || '';
      continue;
    }

    if (currentLabel) {
      result[currentLabel] += ` ${line}`;
    }
  }

  return result;
}

function extractComplaintId(text) {
  const match = text.match(/\bCCM\d+\b/i);
  return match ? match[0] : null;
}

function extractVehicle(text) {
  const match = text.match(/\bVEHICLE\s+([A-Z0-9]+)\b/i);
  return match ? match[1] : null;
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
    parse_errors
  };

  let text = '';

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

  const lines = tokenize(text);
  const structured = extractByScanning(lines);

  result.complaint_id = extractComplaintId(text);
  result.vehicle_number = extractVehicle(text);

  result.category = structured['Category'] || null;
  result.issue_type = structured['Item Name'] || null;
  result.location = structured['Location'] || null;
  result.remarks = structured['Remarks'] || null;
  result.reported_at = structured['Reported At'] || null;

  if (!result.complaint_id) parse_errors.push('complaint_id missing');
  if (!result.vehicle_number) parse_errors.push('vehicle_number missing');
  if (!result.issue_type) parse_errors.push('issue_type missing');
  if (!result.category) parse_errors.push('category missing');
  if (!result.location) parse_errors.push('location missing');

  return result;
}
