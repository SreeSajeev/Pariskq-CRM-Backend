// src/services/ticketService.js

import { generateTicketNumber } from '../utils/ticketNumber.js'
import { insertTicket } from '../repositories/ticketsRepo.js'
import { sendTicketConfirmation, sendMissingDetailsEmail } from './emailService.js'

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

function safeHasValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
}

export function hasRequiredFieldsForOpen(ticket) {
  if (!ticket || typeof ticket !== 'object') return false;
  return (
    safeHasValue(ticket.vehicle_number) &&
    safeHasValue(ticket.issue_type) &&
    safeHasValue(ticket.location)
  );
}

export async function createTicket(parsed, rawEmail) {
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

  if (parsed.confidence_score == null) {
    const err = new Error('Parsed email missing confidence_score')
    err.code = 'CONFIDENCE_SCORE_MISSING'
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

  const ticketNumber = generateTicketNumber()

  const status =
    parsed.confidence_score >= 95
      ? 'OPEN'
      : 'NEEDS_REVIEW'

  await insertTicket({
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
  })

  sendTicketConfirmation({
    toEmail: senderEmail,
    ticketNumber,
  }).catch(err => {
    console.error('[EMAIL:TICKET_CONFIRMATION]', { ticketNumber, message: err.message })
  })

  if (status === 'NEEDS_REVIEW') {
    const missingDetails = deriveMissingDetails(parsed)
    sendMissingDetailsEmail({
      toEmail: senderEmail,
      ticketNumber,
      missingDetails,
    }).catch(err => {
      console.error('[EMAIL:MISSING_DETAILS]', { ticketNumber, message: err.message })
    })
  }

  return {
    ticketNumber,
    status,
  }
}
