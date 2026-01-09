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
    complaint_id: extract(/(CCM\w+)/i),
    vehicle_number: extract(/VEHICLE\s*([A-Z0-9]+)/i),
    category: extract(/Category\s*(.+)/i) || 'UNKNOWN',
    issue_type: extract(/Item Name\s*(.+)/i) || 'GENERAL',
    location: extract(/Location\s*(.+)/i),
    remarks: extract(/Remarks\s*(.+)/i),
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
    .or('processing_status.is.null,processing_status.eq.PENDING')
    .order('created_at', { ascending: true })
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
      remarks: parsed.remarks,
      confidence_score: confidence.score,
      needs_review: confidence.needs_review,
      normalized_subject: parsed.normalized_subject,
    });

    await supabase
      .from('raw_emails')
      .update({ processing_status: 'PARSED' })
      .eq('id', email.id);

    console.log(`✅ Parsed raw_email ${email.id}`);
  }
}

/* =====================================================
   PHASE 2 — PARSED → TICKET / COMMENT / DRAFT
===================================================== */

async function processParsedEmails() {
  const { data: parsedRows } = await supabase
    .from('parsed_emails')
    .select('*, raw_emails(*)')
    .is('ticket_created', null)
    .order('created_at', { ascending: true })
    .limit(10);

  if (!parsedRows?.length) return;

  for (const parsed of parsedRows) {
    /* LOW CONFIDENCE → DRAFT ONLY */
    if (parsed.confidence_score < 80) {
      await supabase
        .from('parsed_emails')
        .update({ processing_status: 'DRAFT' })
        .eq('id', parsed.id);

      await supabase
        .from('raw_emails')
        .update({ processing_status: 'DRAFT' })
        .eq('id', parsed.raw_email_id);

      console.log(`📝 Draft created for raw_email ${parsed.raw_email_id}`);
      continue;
    }

    /* CHECK EXISTING TICKET BY COMPLAINT */
    let existingTicket = null;

    if (parsed.complaint_id) {
      const { data } = await supabase
        .from('tickets')
        .select('id')
        .eq('complaint_id', parsed.complaint_id)
        .limit(1);

      existingTicket = data?.[0] || null;
    }

    /* DUPLICATE → COMMENT */
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

      console.log(`💬 Comment added to ticket ${existingTicket.id}`);
      continue;
    }

    /* CREATE NEW TICKET (DB-SAFE) */
    const ticketNumber = generateTicketNumber();
    const status = parsed.confidence_score >= 95 ? 'OPEN' : 'NEEDS_REVIEW';

    try {
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

      console.log(`🎫 Ticket ${ticketNumber} created`);
    } catch (err) {
      // UNIQUE constraint hit → convert to comment
      const { data } = await supabase
        .from('tickets')
        .select('id')
        .eq('complaint_id', parsed.complaint_id)
        .limit(1);

      if (data?.[0]) {
        await supabase.from('ticket_comments').insert({
          ticket_id: data[0].id,
          comment: parsed.remarks,
          source: 'EMAIL',
        });

        console.log(`⚠️ Duplicate caught → comment added`);
      }
    }

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
  }
}

/* =====================================================
   RUNNER
===================================================== */

export async function runAutoTicketProcessor() {
  console.log('🚀 Auto ticket processor running');
  await parseRawEmails();
  await processParsedEmails();
}
