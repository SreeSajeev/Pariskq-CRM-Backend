/*

const POSTMARK_URL = 'https://api.postmarkapp.com/email';
import { supabase } from '../config/supabase.js';

export async function sendTicketConfirmation({
  to,
  ticketNumber
}) {
  const payload = {
    From: process.env.FROM_EMAIL,
    To: to,
    Subject: `Complaint Registered — Ticket ${ticketNumber}`,
    TextBody: `
Hello,

Your complaint has been successfully registered.

Ticket Number: ${ticketNumber}

Our team will review the issue and get back to you shortly with a resolution.

Thank you for reaching out.
Pariskq Support Team
    `.trim(),
  };

  const res = await fetch(POSTMARK_URL, {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Postmark send failed: ${text}`);
  }
}



export async function sendFETokenEmail({
  feId,
  ticketNumber,
  token,
  type
}) {
  // fetch FE email
  const { data: fe, error } = await supabase
    .from('field_executives')
    .select('email, name')
    .eq('id', feId)
    .single();

  if (error || !fe?.email) {
    throw new Error('Field Executive email not found');
  }

  const actionLabel =
    type === 'RESOLUTION'
      ? 'Resolution Action Required'
      : 'On-site Action Required';

  const actionText =
    type === 'RESOLUTION'
      ? 'upload the resolution proof'
      : 'upload the on-site proof';

  const actionLink = `${process.env.FIELD_OPS_URL}/fe/action/${token}`;

  const payload = {
    From: process.env.FROM_EMAIL,
    To: fe.email,
    Subject: `${actionLabel} — Ticket ${ticketNumber}`,
    TextBody: `
Hello ${fe.name || ''},

You have been assigned a task for Ticket ${ticketNumber}.

Please click the link below to ${actionText}:

${actionLink}

This link is time-sensitive.

Thank you,
Pariskq Operations Team
    `.trim(),
  };

  const res = await fetch(POSTMARK_URL, {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Postmark send failed: ${text}`);
  }
}



export async function sendResolutionEmail({
  to,
  ticketNumber
}) {
  const payload = {
    From: process.env.FROM_EMAIL,
    To: to,
    Subject: `Ticket Resolved — ${ticketNumber}`,
    TextBody: `
Hello,

Your ticket ${ticketNumber} has been successfully resolved.

If you have any further issues or questions, feel free to reply to this email.

Thank you for your patience.
Pariskq Support Team
    `.trim(),
  };

  const res = await fetch(POSTMARK_URL, {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Postmark send failed: ${text}`);
  }
}
*/
// src/services/emailService.js

const POSTMARK_URL = 'https://api.postmarkapp.com/email'
import { supabase } from '../supabaseClient.js'

function assertEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Missing env var: ${name}`)
  }
}

/* ===============================
   FE ACTION TOKEN EMAIL
================================ */
export async function sendFETokenEmail({
  feId,
  ticketNumber,
  token,
  type,
}) {
  try {
    assertEnv('POSTMARK_SERVER_TOKEN')
    assertEnv('FROM_EMAIL')
    assertEnv('FIELD_OPS_URL')

    const { data: fe, error } = await supabase
      .from('field_executives')
      .select('email, name')
      .eq('id', feId)
      .single()

    if (error || !fe?.email) {
      throw new Error('Field Executive email not found')
    }

    const actionLabel =
      type === 'RESOLUTION'
        ? 'Resolution Action Required'
        : 'On-site Action Required'

    const actionText =
      type === 'RESOLUTION'
        ? 'upload the resolution proof'
        : 'upload the on-site proof'

    const actionLink = `${process.env.FIELD_OPS_URL}/fe/action/${token}`

    const payload = {
      From: process.env.FROM_EMAIL,
      To: fe.email,
      Subject: `${actionLabel} — Ticket ${ticketNumber}`,
      TextBody: `
Hello ${fe.name || ''},

You have been assigned a task for Ticket ${ticketNumber}.

Please click the link below to ${actionText}:

${actionLink}

This link is time-sensitive.

Thank you,
Pariskq Operations Team
      `.trim(),
    }

    const res = await fetch(POSTMARK_URL, {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[EMAIL FAILED]', text)
    }
  } catch (err) {
    // 🔥 CRITICAL: DO NOT THROW
    console.error('[sendFETokenEmail ERROR]', err.message)
  }
}
