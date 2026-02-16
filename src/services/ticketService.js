/*import { generateTicketNumber } from '../utils/ticketNumber.js';
import { insertTicket } from '../repositories/ticketsRepo.js';

export async function createTicket(parsed, rawEmail) {
  const ticketNumber = generateTicketNumber();
  const status = parsed.confidence_score >= 95 ? 'OPEN' : 'NEEDS_REVIEW';

  await insertTicket({
    ticket_number: ticketNumber,
    status,
    complaint_id: parsed.complaint_id,
    vehicle_number: parsed.vehicle_number,
    category: parsed.category,
    issue_type: parsed.issue_type,
    location: parsed.location,
    opened_by_email: rawEmail.from_email,
    opened_at: new Date().toISOString(),
    confidence_score: parsed.confidence_score,
    needs_review: parsed.needs_review,
    source: 'EMAIL',
  });

  return ticketNumber;
}
*/
// src/services/ticketService.js

import { generateTicketNumber } from '../utils/ticketNumber.js'
import { insertTicket } from '../repositories/ticketsRepo.js'
import { sendTicketConfirmation } from './emailService.js'

/* =====================================================
   CREATE TICKET — AUTHORITATIVE
===================================================== */
export async function createTicket(parsed, rawEmail) {
  /* ===============================
     VALIDATION (HARD FAILS)
  ================================ */

  if (!parsed) {
    const err = new Error('Parsed email is null in createTicket')
    err.code = 'PARSED_EMAIL_NULL'
    throw err
  }

  if (parsed.confidence_score == null) {
    const err = new Error('Parsed email missing confidence_score')
    err.code = 'CONFIDENCE_SCORE_MISSING'
    throw err
  }

  if (!rawEmail?.from_email) {
    const err = new Error('Missing sender email in raw email')
    err.code = 'SENDER_EMAIL_MISSING'
    throw err
  }

  /* ===============================
     BUSINESS RULES
  ================================ */

  const ticketNumber = generateTicketNumber()

  const status =
    parsed.confidence_score >= 95
      ? 'OPEN'
      : 'NEEDS_REVIEW'

  /* ===============================
     PERSISTENCE (SOURCE OF TRUTH)
  ================================ */

  await insertTicket({
    ticket_number: ticketNumber,
    status,
    complaint_id: parsed.complaint_id,
    vehicle_number: parsed.vehicle_number,
    category: parsed.category,
    issue_type: parsed.issue_type,
    location: parsed.location,
    opened_by_email: rawEmail.from_email,
    opened_at: new Date().toISOString(),
    confidence_score: parsed.confidence_score,
    needs_review: parsed.needs_review,
    source: 'EMAIL',
  })

  /* ===============================
     SIDE EFFECTS (NON-BLOCKING)
     🔥 EMAIL MUST NEVER BLOCK
  ================================ */

  // Fire-and-forget — demo safe
  sendTicketConfirmation({
    toEmail: rawEmail.from_email,
    ticketNumber,
  }).catch(err => {
    console.error('[EMAIL:TICKET_CONFIRMATION]', {
      ticketNumber,
      message: err.message,
    })
  })

  /* ===============================
     RESULT
  ================================ */

  return {
    ticketNumber,
    status,
  }
}
