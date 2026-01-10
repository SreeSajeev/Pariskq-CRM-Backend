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
import { generateTicketNumber } from '../utils/ticketNumber.js';
import { insertTicket } from '../repositories/ticketsRepo.js';

export async function createTicket(parsed, rawEmail) {
  if (!parsed) {
    throw new Error('createTicket called with null parsed email');
  }

  if (parsed.confidence_score == null) {
    throw new Error('Parsed email missing confidence_score');
  }

  const ticketNumber = generateTicketNumber();

  const status =
    parsed.confidence_score >= 95 ? 'OPEN' : 'NEEDS_REVIEW';

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
