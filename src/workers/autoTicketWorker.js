import {
  fetchPendingRawEmails,
  updateRawEmailStatus,
} from '../repositories/rawEmailsRepo.js';
import {
  insertParsedEmail,
  markParsedAsTicketed,
} from '../repositories/parsedEmailsRepo.js';
import {
  findTicketByComplaintId,
  findTicketByTicketNumber,
  updateTicketStatus,
} from '../repositories/ticketsRepo.js';
import { parseEmail } from '../services/parsingService.js';
import { calculateConfidence } from '../services/confidenceService.js';
import { addEmailComment } from '../services/commentService.js';
import { createTicket, hasRequiredFieldsForOpen } from '../services/ticketService.js';
import { classifyEmail } from '../services/emailClassificationService.js';
import { validateRequiredFields } from '../services/requiredFieldValidator.js';
import { sendMissingInfoEmail } from '../services/customerClarificationService.js';
import { getEmailText } from '../utils/emailParser.js';
import { supabase } from '../supabaseClient.js';

const TICKET_ID_REGEX = /\[Ticket\s+ID:\s*([^\]]+)\]/i;

const QUOTE_STOP_PATTERNS = [/^\s*On\s+/i, /^\s*From:\s*/i, /^\s*Sent:\s*/i];

function lineStopsQuote(line) {
  return QUOTE_STOP_PATTERNS.some((p) => p.test(line));
}

function extractNewReplyContent(rawEmailPayload) {
  try {
    if (!rawEmailPayload || typeof rawEmailPayload !== 'object') return null;
    const text = getEmailText(rawEmailPayload);
    if (!text || typeof text !== 'string') return null;

    const lines = text.split(/\r?\n/);
    const collected = [];
    for (const line of lines) {
      if (lineStopsQuote(line)) break;
      if (/^\s*>/.test(line)) continue;
      collected.push(line);
    }
    const result = collected.join('\n').replace(/\n+/g, '\n').trim();
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

function extractTicketNumberFromSubject(subject) {
  if (subject == null || typeof subject !== 'string') return null;
  const match = subject.match(TICKET_ID_REGEX);
  return match ? match[1].trim() : null;
}

async function handleReplyFlow(raw, ticket) {
  const content = extractNewReplyContent(raw);
  if (content) {
    const { error: commentError } = await addEmailComment(ticket.id, content);
    if (commentError) {
      console.error(`[REPLY] addEmailComment failed ticket ${ticket.id}`, commentError.message);
    }
  }

  await supabase.from('audit_logs').insert({
    entity_type: 'ticket',
    entity_id: ticket.id,
    action: 'client_provided_additional_details',
    metadata: { raw_email_id: raw.id },
  });

  if (ticket.status === 'NEEDS_REVIEW' && hasRequiredFieldsForOpen(ticket)) {
    const { error: updateErr } = await updateTicketStatus(ticket.id, 'OPEN');
    if (updateErr) {
      console.error(`[REPLY] updateTicketStatus failed ticket ${ticket.id}`, updateErr.message);
    }
  }

  await updateRawEmailStatus(raw.id, 'PROCESSED_REPLY', {
    linked_ticket_id: ticket.id,
  });
}

export async function runAutoTicketWorker() {
  const { data: rawEmails, error } = await fetchPendingRawEmails();

  if (error) {
    console.error('Failed to fetch pending raw emails:', error.message);
    return;
  }

  for (const raw of rawEmails || []) {
    try {
      if (raw.processing_status === 'PROCESSED_REPLY') continue;

      const ticketNumber = extractTicketNumberFromSubject(raw.subject);
      if (ticketNumber) {
        const ticket = await findTicketByTicketNumber(ticketNumber);
        if (ticket) {
          await handleReplyFlow(raw, ticket);
          continue;
        }
      }

      const classification = classifyEmail(raw);

      if (classification.type !== 'COMPLAINT') {
        const statusMap = {
          PROMOTIONAL: 'IGNORED_PROMOTIONAL',
          AUTO_REPLY: 'IGNORED_AUTO_REPLY',
          UNKNOWN: 'IGNORED_UNKNOWN',
        };
        await updateRawEmailStatus(
          raw.id,
          statusMap[classification.type] || 'IGNORED_UNKNOWN'
        );
        continue;
      }

      const parsed = parseEmail(raw);

      const validation = validateRequiredFields(parsed);
      if (!validation.isComplete) {
        await updateRawEmailStatus(raw.id, 'AWAITING_CUSTOMER_INFO', {
          missing_fields: validation.missingFields,
        });
        await Promise.resolve(
          sendMissingInfoEmail({
            to: raw.from_email || null,
            originalSubject: raw.subject || '',
            missingFields: validation.missingFields,
          })
        );
        continue;
      }

      const confidence = calculateConfidence(parsed);

      const { data: parsedRow, error: parsedError } = await insertParsedEmail({
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

      if (confidence < 80) {
        await updateRawEmailStatus(raw.id, 'DRAFT');
        continue;
      }

      if (parsed.complaint_id) {
        const existing = await findTicketByComplaintId(parsed.complaint_id);
        if (existing) {
          const { error: commentError } = await addEmailComment(
            existing.id,
            parsed.remarks || raw.subject
          );
          if (commentError) {
            console.error(`addEmailComment failed ticket ${existing.id}`, commentError.message);
          }
          await updateRawEmailStatus(raw.id, 'COMMENT_ADDED', {
            linked_ticket_id: existing.id,
          });
          await markParsedAsTicketed(parsedRow.id);
          continue;
        }
      }

      await createTicket(
        {
          ...parsed,
          confidence_score: confidence,
          needs_review: confidence < 95,
        },
        raw
      );

      await updateRawEmailStatus(raw.id, 'TICKET_CREATED');
      await markParsedAsTicketed(parsedRow.id);
    } catch (err) {
      console.error(`Worker failed raw_email ${raw.id}`, err.message);
      await updateRawEmailStatus(raw.id, 'ERROR', {
        processing_error: err.message,
      });
    }
  }
}
