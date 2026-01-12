/*import { fetchPendingRawEmails, updateRawEmailStatus } from '../repositories/rawEmailsRepo.js';
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

//old code 
import {
  fetchPendingRawEmails,
  updateRawEmailStatus,
} from '../repositories/rawEmailsRepo.js';

import {
  insertParsedEmail,
  markParsedAsTicketed,
} from '../repositories/parsedEmailsRepo.js';

import { findTicketByComplaintId } from '../repositories/ticketsRepo.js';
import { parseEmail } from '../services/parsingService.js';
import { calculateConfidence } from '../services/confidenceService.js';
import { addEmailComment } from '../services/commentService.js';
import { createTicket } from '../services/ticketService.js';

export async function runAutoTicketWorker() {
  const { data: rawEmails, error } = await fetchPendingRawEmails();

  if (error) {
    console.error('Failed to fetch pending raw emails:', error);
    return;
  }

  for (const raw of rawEmails || []) {
    try {
      console.log(`🔍 Processing raw_email ${raw.id}`);

       ===============================
         STEP 1 — PARSE EMAIL
      =============================== 
      const parsed = parseEmail(raw);

      if (!parsed) {
        await updateRawEmailStatus(raw.id, 'DRAFT', {
          processing_error: 'Parser returned null',
        });
        continue;
      }

       ===============================
         STEP 2 — CONFIDENCE SCORE
      =============================== 
      const confidence = calculateConfidence(parsed);

       ===============================
         STEP 3 — STORE PARSED EMAIL
      =============================== 
      const { data: parsedRow, error: parsedError } =
        await insertParsedEmail({
          raw_email_id: raw.id,
          ...parsed,
          confidence_score: confidence,
          needs_review: confidence < 95,
          ticket_created: false,
        });

      if (parsedError || !parsedRow) {
        await updateRawEmailStatus(raw.id, 'ERROR', {
          processing_error: 'Parsed email insert failed',
        });
        continue;
      }

      ===============================
         STEP 4 — LOW CONFIDENCE → DRAFT
      =============================== 
      if (confidence < 80) {
        await updateRawEmailStatus(raw.id, 'DRAFT');
        continue;
      }

       ===============================
         STEP 5 — DEDUPLICATION
      =============================== 
      if (parsed.complaint_id) {
        const duplicate = await findTicketByComplaintId(
          parsed.complaint_id
        );

        if (duplicate) {
          await addEmailComment(
            duplicate.id,
            parsed.remarks || raw.subject
          );

          await updateRawEmailStatus(raw.id, 'COMMENT_ADDED', {
            linked_ticket_id: duplicate.id,
          });

          await markParsedAsTicketed(parsedRow.id);
          continue;
        }
      }

       ===============================
         STEP 6 — CREATE TICKET
      =============================== 
      await createTicket(parsedRow, raw);

      await updateRawEmailStatus(raw.id, 'TICKET_CREATED');
      await markParsedAsTicketed(parsedRow.id);

      console.log(`🎫 Ticket created for raw_email ${raw.id}`);

    } catch (err) {
      console.error(`❌ Worker failed for raw_email ${raw.id}`, err);

      await updateRawEmailStatus(raw.id, 'ERROR', {
        processing_error: err.message,
      });
    }
  }
}
*/
import {
  fetchPendingRawEmails,
  updateRawEmailStatus,
} from '../repositories/rawEmailsRepo.js';

import {
  insertParsedEmail,
  markParsedAsTicketed,
} from '../repositories/parsedEmailsRepo.js';

import { findTicketByComplaintId } from '../repositories/ticketsRepo.js';

import { parseEmail } from '../services/parsingService.js';
import { calculateConfidence } from '../services/confidenceService.js';
import { addEmailComment } from '../services/commentService.js';
import { createTicket } from '../services/ticketService.js';
import { classifyEmail } from '../services/emailClassificationService.js';

export async function runAutoTicketWorker() {
  const { data: rawEmails, error } = await fetchPendingRawEmails();

  if (error) {
    console.error('❌ Failed to fetch pending raw emails:', error);
    return;
  }

  for (const raw of rawEmails || []) {
    try {
      console.log(`🔍 Processing raw_email ${raw.id}`);

      /* ===============================
         STEP 0 — CLASSIFY EMAIL
      =============================== */
      const classification = classifyEmail(raw);

      if (classification.type !== 'COMPLAINT') {
        const statusMap = {
          PROMOTIONAL: 'IGNORED_PROMOTIONAL',
          AUTO_REPLY: 'IGNORED_AUTO_REPLY',
          UNKNOWN: 'IGNORED_UNKNOWN',
        };

        const newStatus =
          statusMap[classification.type] || 'IGNORED_UNKNOWN';

        await updateRawEmailStatus(raw.id, newStatus, {
          classification_type: classification.type,
          classification_confidence: classification.confidence,
          classification_reasons: classification.reasons,
        });

        console.info(
          `🛑 raw_email ${raw.id} ignored (${classification.type})`,
          classification.reasons
        );

        continue; // 🚨 STOP PIPELINE HERE
      }

      /* ===============================
         STEP 1 — PARSE EMAIL
      =============================== */
      const parsed = parseEmail(raw);

      if (!parsed) {
        await updateRawEmailStatus(raw.id, 'DRAFT', {
          processing_error: 'Parser returned null',
        });
        continue;
      }

      /* ===============================
         STEP 2 — CONFIDENCE SCORE
      =============================== */
      const confidence = calculateConfidence(parsed);

      /* ===============================
         STEP 3 — STORE PARSED EMAIL
      =============================== */
      const { data: parsedRow, error: parsedError } =
        await insertParsedEmail({
          raw_email_id: raw.id,
          ...parsed,
          confidence_score: confidence,
          needs_review: confidence < 95,
          ticket_created: false,
        });

      if (parsedError || !parsedRow) {
        await updateRawEmailStatus(raw.id, 'ERROR', {
          processing_error: 'Parsed email insert failed',
        });
        continue;
      }

      /* ===============================
         STEP 4 — LOW CONFIDENCE → DRAFT
      =============================== */
      if (confidence < 80) {
        await updateRawEmailStatus(raw.id, 'DRAFT');
        continue;
      }

      /* ===============================
         STEP 5 — DEDUPLICATION
      =============================== */
      if (parsed.complaint_id) {
        const duplicate = await findTicketByComplaintId(
          parsed.complaint_id
        );

        if (duplicate) {
          await addEmailComment(
            duplicate.id,
            parsed.remarks || raw.subject
          );

          await updateRawEmailStatus(raw.id, 'COMMENT_ADDED', {
            linked_ticket_id: duplicate.id,
          });

          await markParsedAsTicketed(parsedRow.id);
          continue;
        }
      }

      /* ===============================
         STEP 6 — CREATE TICKET
      =============================== */
      await createTicket(parsedRow, raw);

      await updateRawEmailStatus(raw.id, 'TICKET_CREATED');
      await markParsedAsTicketed(parsedRow.id);

      console.log(`🎫 Ticket created for raw_email ${raw.id}`);
    } catch (err) {
      console.error(`❌ Worker failed for raw_email ${raw.id}`, err);

      await updateRawEmailStatus(raw.id, 'ERROR', {
        processing_error: err.message,
      });
    }
  }
}

