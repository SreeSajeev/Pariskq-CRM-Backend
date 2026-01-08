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
    reported_at: extract(/Submit Date\s*(.+)/i)
  };
}

function calculateConfidence(parsed) {
  let score = 0;

  if (parsed.complaint_id) score += 30;
  if (parsed.vehicle_number) score += 30;
  if (parsed.category !== 'UNKNOWN') score += 20;
  if (parsed.issue_type !== 'GENERAL') score += 20;

  return {
    score,
    needs_review: score < 95
  };
}

async function findDuplicate(parsed) {
  if (!parsed.complaint_id || !parsed.vehicle_number) return null;

  const { data } = await supabase
    .from('tickets')
    .select('id')
    .eq('complaint_id', parsed.complaint_id)
    .eq('vehicle_number', parsed.vehicle_number)
    .eq('category', parsed.category)
    .eq('issue_type', parsed.issue_type)
    .in('status', ['OPEN', 'ASSIGNED', 'NEEDS_REVIEW'])
    .limit(1);

  return data?.[0] || null;
}

/* =====================================================
   PHASE 1 — RAW_EMAILS → PARSED_EMAILS
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
      ticket_created: false
    });

    await supabase
      .from('raw_emails')
      .update({ processing_status: 'PARSED' })
      .eq('id', email.id);

    console.log(`Parsed raw_email ${email.id}`);
  }
}

/* =====================================================
   PHASE 2 — PARSED_EMAILS → TICKETS
===================================================== */

async function createTicketsFromParsedEmails() {
  const { data: parsedRows } = await supabase
    .from('parsed_emails')
    .select('*, raw_emails(*)')
    .eq('ticket_created', false)
    .limit(10);

  if (!parsedRows?.length) return;

  for (const parsed of parsedRows) {
    const duplicate = await findDuplicate(parsed);

    if (duplicate) {
      await supabase
        .from('raw_emails')
        .update({
          ticket_created: true,
          processing_status: 'DUPLICATE',
          linked_ticket_id: duplicate.id
        })
        .eq('id', parsed.raw_email_id);

      await supabase
        .from('parsed_emails')
        .update({ ticket_created: true })
        .eq('id', parsed.id);

      console.log(`Duplicate detected for raw_email ${parsed.raw_email_id}`);
      continue;
    }

    const status =
      parsed.confidence_score >= 95
        ? 'OPEN'
        : parsed.confidence_score >= 80
        ? 'NEEDS_REVIEW'
        : 'DRAFT';

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
      source: 'EMAIL'
    });

    await supabase
      .from('parsed_emails')
      .update({ ticket_created: true })
      .eq('id', parsed.id);

    await supabase
      .from('raw_emails')
      .update({
        ticket_created: true,
        processing_status: status
      })
      .eq('id', parsed.raw_email_id);

    console.log(`Ticket ${ticketNumber} created`);
  }
}

/* =====================================================
   RUNNER
===================================================== */

export async function runAutoTicketProcessor() {
  console.log('🚀 Auto ticket processor running');
  await parseRawEmails();
  await createTicketsFromParsedEmails();
}
