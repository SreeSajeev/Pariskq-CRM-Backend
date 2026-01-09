import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =====================================================
   HELPERS
===================================================== */

function generateTicketNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `PKQ-${date}-${rand}`;
}

function normalizeSubject(subject = '') {
  return subject
    .toLowerCase()
    .replace(/^(\s*(re|fwd|fw):\s*)+/gi, '')
    .trim();
}

function parseEmail(raw) {
  const text = `${raw.subject || ''}\n${raw.payload?.TextBody || ''}`;
  const extract = (regex) => text.match(regex)?.[1]?.trim() || null;

  return {
    complaint_id: extract(/Record ID\s*(\w+)/i),
    vehicle_number: extract(/VEHICLE\s*([A-Z0-9]+)/i),
    category: extract(/Category\s*(.+)/i) || 'UNKNOWN',
    issue_type: extract(/Item Name\s*(.+)/i) || 'GENERAL',
    location: extract(/Location\s*(.+)/i),
    remarks: extract(/Remarks\s*(.+)/i),
    reported_at: extract(/Submit Date\s*(.+)/i),
    normalized_subject: normalizeSubject(raw.subject),
  };
}

function calculateConfidence(parsed) {
  let score = 0;

  if (parsed.complaint_id) score += 40;
  if (parsed.vehicle_number) score += 30;
  if (parsed.category !== 'UNKNOWN') score += 15;
  if (parsed.issue_type !== 'GENERAL') score += 15;

  return {
    score,
    needs_review: score < 95,
  };
}

/* =====================================================
   PHASE 1 — RAW → PARSED (ALWAYS)
===================================================== */

async function parseRawEmails() {
  const { data: rawEmails } = await supabase
    .from('raw_emails')
    .select('*')
    .eq('ticket_created', false)
    .is('processing_status', null)
    .limit(10);

  if (!rawEmails?.length) return;

  for (const email of rawEmails) {
    const parsed = parseEmail(email);
    const confidence = calculateConfidence(parsed);

    await supabase.from('parsed_emails').insert({
      raw_email_id: email.id,
      complaint_id: parsed.complaint_id,
      vehicle_number: parsed.vehicle_number,
      category: parsed.category,
      issue_type: parsed.issue_type,
      location: parsed.location,
      reported_at: parsed.reported_at,
      remarks: parsed.remarks,
      confidence_score: confidence.score,
      needs_review: confidence.needs_review,
      normalized_subject: parsed.normalized_subject,
      ticket_created: false,
    });

    await supabase
      .from('raw_emails')
      .update({ processing_status: 'PARSED' })
      .eq('id', email.id);

    console.log(`Parsed raw_email ${email.id}`);
  }
}

/* =====================================================
   PHASE 2 — PARSED → TICKET OR COMMENT
===================================================== */

async function processParsedEmails() {
  const { data: parsedRows } = await supabase
    .from('parsed_emails')
    .select('*, raw_emails(*)')
    .eq('ticket_created', false)
    .limit(10);

  if (!parsedRows?.length) return;

  for (const parsed of parsedRows) {
    //  LOW CONFIDENCE → STOP
    if (parsed.confidence_score < 80) {
      await supabase
        .from('parsed_emails')
        .update({ ticket_created: true })
        .eq('id', parsed.id);

      await supabase
        .from('raw_emails')
        .update({ processing_status: 'DRAFT' })
        .eq('id', parsed.raw_email_id);

      console.log(`Draft created for raw_email ${parsed.raw_email_id}`);
      continue;
    }

    // CHECK EXISTING TICKET (complaint_id)
    let existingTicket = null;

    if (parsed.complaint_id) {
      const { data } = await supabase
        .from('tickets')
        .select('id')
        .eq('complaint_id', parsed.complaint_id)
        .limit(1);

      existingTicket = data?.[0] || null;
    }

    // DUPLICATE → COMMENT
    if (existingTicket) {
      await supabase.from('ticket_comments').insert({
        ticket_id: existingTicket.id,
        comment: parsed.remarks || parsed.raw_emails.subject,
        source: 'EMAIL',
      });

      await supabase
        .from('parsed_emails')
        .update({ ticket_created: true })
        .eq('id', parsed.id);

      await supabase
        .from('raw_emails')
        .update({
          ticket_created: true,
          processing_status: 'COMMENT_ADDED',
          linked_ticket_id: existingTicket.id,
        })
        .eq('id', parsed.raw_email_id);

      console.log(`💬 Comment added to existing ticket`);
      continue;
    }

    // CREATE NEW TICKET
    const status =
      parsed.confidence_score >= 95 ? 'OPEN' : 'NEEDS_REVIEW';

    const ticketNumber = generateTicketNumber();

    await supabase.from('tickets').insert({
      ticket_number: ticketNumber,
      status,
      complaint_id: parsed.complaint_id,
      vehicle_number: parsed.vehicle_number,
      category: parsed.category,
      issue_type: parsed.issue_type,
      location: parsed.location,
      opened_by_email: parsed.raw_emails.from_email,
      opened_at: new Date().toISOString(),
      raw_email_id: parsed.raw_email_id,
      confidence_score: parsed.confidence_score,
      needs_review: parsed.needs_review,
      source: 'EMAIL',
    });

    await supabase
      .from('parsed_emails')
      .update({ ticket_created: true })
      .eq('id', parsed.id);

    await supabase
      .from('raw_emails')
      .update({
        ticket_created: true,
        processing_status: status,
      })
      .eq('id', parsed.raw_email_id);

    console.log(` Ticket ${ticketNumber} created`);
  }
}

/* =====================================================
   RUNNER
===================================================== */

export async function runAutoTicketProcessor() {
  console.log(' Auto ticket processor running');
  await parseRawEmails();
  await processParsedEmails();
}
