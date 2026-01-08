import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ------------------------
   TICKET NUMBER GENERATOR
------------------------- */
function generateTicketNumber() {
  const date = new Date();
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `PKQ-${ymd}-${random}`;
}

/* ------------------------
   SIMPLE RULE-BASED PARSER
------------------------- */
function parseEmail(rawEmail) {
  const text =
    `${rawEmail.subject || ''} ${rawEmail.payload?.TextBody || ''}`;

  const vehicleMatch =
    text.match(/[A-Z]{2}\s?\d{2}\s?[A-Z]{2}\s?\d{4}/);

  const complaintMatch =
    text.match(/CCM\d+|CMP-\d+/);

  return {
    vehicle_number: vehicleMatch?.[0] || null,
    complaint_id: complaintMatch?.[0] || null,
    category: text.toUpperCase().includes('MDVR') ? 'MDVR' : 'UNKNOWN',
    issue_type: text.toLowerCase().includes('offline')
      ? 'DEVICE_OFFLINE'
      : 'GENERAL',
    location: rawEmail.payload?.FromFull?.Name || null,
    opened_by_email: rawEmail.from_email || null,
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
    const ticketNumber = generateTicketNumber();

    const { error: ticketError } = await supabase
      .from('tickets')
      .insert({
        ticket_number: ticketNumber,          // REQUIRED
        status: 'OPEN',                       // REQUIRED
        complaint_id: parsed.complaint_id,
        vehicle_number: parsed.vehicle_number,
        category: parsed.category,
        issue_type: parsed.issue_type,
        location: parsed.location,
        opened_by_email: parsed.opened_by_email,
        opened_at: new Date().toISOString(),
        raw_email_id: email.id                // FK (you added this)
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
      .update({
        ticket_created: true,
        processing_status: 'TICKET_CREATED',
        processed_at: new Date().toISOString()
      })
      .eq('id', email.id);

    console.log(
      `Ticket ${ticketNumber} created for raw_email ${email.id}`
    );
  }
}
