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

/* ---------- SAFE PAYLOAD PARSE ---------- */
function getEmailText(raw) {
  let payload = raw.payload;

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }

  return `
${raw.subject || ''}
${payload.TextBody || ''}
${payload.HtmlBody || ''}
`;
}

/* ---------- PARSER ---------- */
function parseEmail(raw) {
  const text = getEmailText(raw);
  const extract = (regex) => text.match(regex)?.[1]?.trim() || null;

  return {
    complaint_id: extract(/\b(CCM\w+)\b/i),
    vehicle_number: extract(/\bVEHICLE\s*([A-Z0-9]+)\b/i),
    category: extract(/Category\s*[:\-]?\s*(.+)/i) || 'UNKNOWN',
    issue_type: extract(/Item Name\s*[:\-]?\s*(.+)/i) || 'GENERAL',
    location: extract(/Location\s*[:\-]?\s*(.+)/i),
    remarks: extract(/Remarks\s*[:\-]?\s*(.+)/i),
    normalized_subject: normalizeSubject(raw.subject),
  };
}

function calculateConfidence(p) {
  let score = 0;
  if (p.complaint_id) score += 40;
  if (p.vehicle_number) score += 30;
  if (p.category !== 'UNKNOWN') score += 15;
  if (p.issue_type !== 'GENERAL') score += 15;

  return score;
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
    .order('created_at')
    .limit(10);

  for (const email of rawEmails || []) {
    const parsed = parseEmail(email);
    const score = calculateConfidence(parsed);

    await supabase.from('parsed_emails').insert({
      raw_email_id: email.id,
      complaint_id: parsed.complaint_id,
      vehicle_number: parsed.vehicle_number,
      category: parsed.category,
      issue_type: parsed.issue_type,
      location: parsed.location,
      remarks: parsed.remarks,
      confidence_score: score,
      needs_review: score < 95,
      normalized_subject: parsed.normalized_subject,
      ticket_created: false,
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
    .eq('ticket_created', false)
    .order('created_at')
    .limit(10);

  for (const parsed of parsedRows || []) {
    /* -------- LOW CONFIDENCE → DRAFT -------- */
    if (parsed.confidence_score < 80) {
      await supabase
        .from('raw_emails')
        .update({ processing_status: 'DRAFT' })
        .eq('id', parsed.raw_email_id);

      console.log(`📝 Draft queued for review (${parsed.raw_email_id})`);
      continue;
    }

    /* -------- ABSOLUTE DEDUP (complaint_id) -------- */
    if (parsed.complaint_id) {
      const { data } = await supabase
        .from('tickets')
        .select('id')
        .eq('complaint_id', parsed.complaint_id)
        .limit(1);

      if (data?.[0]) {
        await supabase.from('ticket_comments').insert({
          ticket_id: data[0].id,
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
            linked_ticket_id: data[0].id,
          })
          .eq('id', parsed.raw_email_id);

        console.log(`💬 Duplicate → comment added`);
        continue;
      }
    }

    /* -------- CREATE TICKET -------- */
    const ticketNumber = generateTicketNumber();
    const status = parsed.confidence_score >= 95 ? 'OPEN' : 'NEEDS_REVIEW';

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

    console.log(`🎫 Ticket ${ticketNumber} created`);
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
