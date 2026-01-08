import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ------------------------
   SIMPLE RULE-BASED PARSER
------------------------- */
function parseEmail(rawEmail) {
  const text =
    rawEmail.subject +
    ' ' +
    (rawEmail.payload?.TextBody || '');

  const vehicleMatch = text.match(/[A-Z]{2}\s?\d{2}\s?[A-Z]{2}\s?\d{4}/);
  const complaintMatch = text.match(/CMP-\d+/);

  return {
    vehicle_number: vehicleMatch?.[0] || null,
    complaint_id: complaintMatch?.[0] || null,
    category: text.includes('MDVR') ? 'MDVR' : 'UNKNOWN',
    issue_type: text.includes('offline') ? 'DEVICE_OFFLINE' : 'GENERAL',
    location: rawEmail.payload?.FromFull?.Name || null,
    remarks: rawEmail.payload?.TextBody || rawEmail.subject,
  };
}

/* ------------------------
   MAIN PROCESSOR
------------------------- */
export async function processRawEmails() {
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('*')
    .eq('ticket_created', false)
    .limit(10);

  if (error) {
    console.error('Fetch error:', error);
    return;
  }

  for (const email of emails) {
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
        status: 'OPEN',
      });

    if (!ticketError) {
      await supabase
        .from('raw_emails')
        .update({ ticket_created: true })
        .eq('id', email.id);
    }
  }
}
