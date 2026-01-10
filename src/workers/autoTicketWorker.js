import { fetchPendingRawEmails, updateRawEmailStatus } from '../repositories/rawEmailsRepo.js';
import { insertParsedEmail, markParsedAsTicketed } from '../repositories/parsedEmailsRepo.js';
import { findTicketByComplaintId } from '../repositories/ticketsRepo.js';
import { parseEmail } from '../services/parsingService.js';
import { calculateConfidence } from '../services/confidenceService.js';
import { addEmailComment } from '../services/commentService.js';
import { createTicket } from '../services/ticketService.js';

export async function runAutoTicketWorker() {
  const { data: rawEmails } = await fetchPendingRawEmails();

  for (const raw of rawEmails || []) {
    try {
      const parsed = parseEmail(raw);
      const confidence = calculateConfidence(parsed);

      const { data: parsedRow } = await insertParsedEmail({
        raw_email_id: raw.id,
        ...parsed,
        confidence_score: confidence,
        needs_review: confidence < 95,
        ticket_created: false,
      });

      if (confidence < 80) {
        await updateRawEmailStatus(raw.id, 'DRAFT');
        continue;
      }

      const duplicate = await findTicketByComplaintId(parsed.complaint_id);
      if (duplicate) {
        await addEmailComment(duplicate.id, parsed.remarks || raw.subject);
        await updateRawEmailStatus(raw.id, 'COMMENT_ADDED', {
          linked_ticket_id: duplicate.id,
        });
        await markParsedAsTicketed(parsedRow.id);
        continue;
      }

      await createTicket(parsedRow, raw);
      await updateRawEmailStatus(raw.id, 'TICKET_CREATED');
      await markParsedAsTicketed(parsedRow.id);

    } catch (err) {
      await updateRawEmailStatus(raw.id, 'ERROR', {
        processing_error: err.message,
      });
      console.error('AutoTicketWorker error:', err);
    }
  }
}
