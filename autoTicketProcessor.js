import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ------------------------
   SIMPLE RULE-BASED PARSER
------------------------- */
function parseEmail(rawEmail) {
  const bodyText =
    rawEmail.subject + ' ' + (rawEmail.payload?.TextBody || '');

  const vehicleMatch =
    bodyText.match(/[A-Z]{2}\s?\d{2}\s?[A-Z]{2}\s?\d{4}/);

  const complaintMatch =
    bodyText.match(/CMP-\d+/);

  return {
    vehicle_number: vehicleMatch?.[0] || null,
    complaint_id: complaintMatch?.[0] || null,
    category: bodyText.toUpperCase().includes('MDVR') ? 'MDVR' : 'UNKNOWN',
    issue_type: bodyText.toLowerCase().includes('offline')
      ? 'DEVICE_OFFLINE'
      : 'GENERAL',
    location: rawEmail.payload?.FromFull?.Name || null,
    remarks: rawEmail.payload?.TextBody || rawEmail.subject
  };
}

/* ------------------------
   MAIN PROCESSOR
------------------------- */
export async function processRawEmails() {
  console.log('Running auto ticket processor');

  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('*')
    .eq('ticket_created', false)
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) {
    console.error('Failed to fetch raw emails:', error);
    return;
  }

  if (!emails || emails.length === 0) {
    console.log('No raw emails to process');
    return;
  }

  for (const email of emails) {
    console.log(`Processing raw_email ${email.id}`);

    const parsed = parseEmail(email);

    const { error: ticketError } = await supabase
      .from('tickets')
      .insert({
        raw_email_id: email.id,
        vehicle_number: parsed.vehicle_number,
        category: parsed.category,
        issue_type: parsed.issue_type,
        location: parsed.location,
        remarks: parsed.remarks,
        status: 'OPEN'
      });

    if (ticketError) {
      console.error(
        `Ticket creation failed for raw_email ${email.id}:`,
        ticketError
      );
      continue;
    }

    await supabase
      .from('raw_emails')
      .update({ ticket_created: true })
      .eq('id', email.id);

    console.log(`Ticket created for raw_email ${email.id}`);
  }
}
