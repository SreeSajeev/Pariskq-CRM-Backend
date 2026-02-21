// src/services/ticketService.js

import { generateTicketNumber } from '../utils/ticketNumber.js'
import { insertTicket } from '../repositories/ticketsRepo.js'
import { sendTicketConfirmation, sendMissingDetailsEmail } from './emailService.js'
import { createSlaRow } from './slaService.js'

function deriveMissingDetails(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  const list = [];
  if (parsed.complaint_id == null || String(parsed.complaint_id).trim() === '') list.push('Complaint ID');
  if (parsed.vehicle_number == null || String(parsed.vehicle_number).trim() === '') list.push('Vehicle number');
  if (parsed.category == null || String(parsed.category).trim() === '') list.push('Category');
  if (parsed.issue_type == null || String(parsed.issue_type).trim() === '') list.push('Issue type');
  if (parsed.location == null || String(parsed.location).trim() === '') list.push('Location');
  return list;
}

function deriveReceivedDetails(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  const labels = [];
  if (safeHasValue(parsed.complaint_id)) labels.push('Complaint ID');
  if (safeHasValue(parsed.vehicle_number)) labels.push('Vehicle number');
  if (safeHasValue(parsed.category)) labels.push('Category');
  if (safeHasValue(parsed.issue_type)) labels.push('Issue type');
  if (safeHasValue(parsed.location)) labels.push('Location');
  return labels;
}

function safeHasValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
}

const STRUCTURED_FIELDS = ['complaint_id', 'vehicle_number', 'category', 'issue_type', 'location'];

export function countStructuredComplaintFields(parsed) {
  if (!parsed || typeof parsed !== 'object') return 0;
  return STRUCTURED_FIELDS.filter((key) => safeHasValue(parsed[key])).length;
}

export function hasRequiredFieldsForOpen(ticket) {
  if (!ticket || typeof ticket !== 'object') return false;
  return (
    safeHasValue(ticket.vehicle_number) &&
    safeHasValue(ticket.issue_type) &&
    safeHasValue(ticket.location)
  );
}

export function mergeParsedIntoTicket(ticketRow, parsedReply) {
  if (!ticketRow || !parsedReply || typeof ticketRow !== 'object' || typeof parsedReply !== 'object') return {};
  const out = {};
  for (const key of STRUCTURED_FIELDS) {
    if (!safeHasValue(ticketRow[key]) && safeHasValue(parsedReply[key])) {
      out[key] = parsedReply[key];
    }
  }
  return out;
}

function resolveClientSlug(email) {
  if (!email) return null;
  if (String(email).toLowerCase().includes('hitachi')) return 'hitachi';
  return null;
}

export async function createTicket(parsed, rawEmail, options = {}) {
  if (!parsed) {
    const err = new Error('Parsed email is null in createTicket')
    err.code = 'PARSED_EMAIL_NULL'
    throw err
  }

  if (!rawEmail || typeof rawEmail !== 'object') {
    const err = new Error('Missing or invalid raw email in createTicket')
    err.code = 'RAW_EMAIL_MISSING'
    throw err
  }

  const senderEmail =
    rawEmail?.from_email ||
    rawEmail?.payload?.FromFull?.Email ||
    rawEmail?.payload?.From ||
    null

  if (!senderEmail) {
    const err = new Error('Missing sender email in raw email')
    err.code = 'SENDER_EMAIL_MISSING'
    throw err
  }

  const requiredComplete = options.requiredComplete === true
  const ticketNumber = generateTicketNumber()
  const status = requiredComplete ? 'OPEN' : 'NEEDS_REVIEW'
  const clientSlug = resolveClientSlug(senderEmail)

  const inserted = await insertTicket({
    ticket_number: ticketNumber,
    status,
    complaint_id: parsed.complaint_id,
    vehicle_number: parsed.vehicle_number,
    category: parsed.category,
    issue_type: parsed.issue_type,
    location: parsed.location,
    opened_by_email: senderEmail,
    opened_at: new Date().toISOString(),
    confidence_score: parsed.confidence_score,
    needs_review: parsed.needs_review,
    source: 'EMAIL',
    client_slug: clientSlug,
  })

  createSlaRow(inserted.id).catch((err) =>
    console.error('[SLA] createSlaRow after createTicket', inserted.id, err.message)
  )

  if (status === 'NEEDS_REVIEW') {
    const missingDetails = deriveMissingDetails(parsed)
    const receivedDetails = deriveReceivedDetails(parsed)
    sendMissingDetailsEmail({
      toEmail: senderEmail,
      ticketNumber,
      missingDetails,
      receivedDetails,
      subject: rawEmail?.subject || null,
      complaintId: parsed.complaint_id,
      category: parsed.category,
      issueType: parsed.issue_type,
      location: parsed.location,
    }).catch(err => {
      console.error('[EMAIL:MISSING_DETAILS]', { ticketNumber, message: err.message })
    })
  } else {
    sendTicketConfirmation({
      toEmail: senderEmail,
      ticketNumber,
    }).catch(err => {
      console.error('[EMAIL:TICKET_CONFIRMATION]', { ticketNumber, message: err.message })
    })
  }

  return {
    ticketNumber,
    status,
  }
}
