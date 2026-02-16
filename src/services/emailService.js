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
// src/services/emailService.js

import { supabase } from '../supabaseClient.js'

const POSTMARK_URL = 'https://api.postmarkapp.com/email'

function canSendEmail() {
  return (
    process.env.POSTMARK_SERVER_TOKEN &&
    process.env.FROM_EMAIL
  )
}

async function sendEmail(payload, tag) {
  if (!canSendEmail()) {
    console.warn(`[EMAIL SKIPPED] ${tag} — env not configured`)
    return
  }

  try {
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
      console.error(`[EMAIL FAILED] ${tag}`, text)
    }
  } catch (err) {
    console.error(`[EMAIL ERROR] ${tag}`, err.message)
  }
}

/* =====================================================
   1️⃣ TICKET CONFIRMATION EMAIL
===================================================== */
export async function sendTicketConfirmation({
  toEmail,
  ticketNumber,
}) {
  if (!toEmail) return

  await sendEmail(
    {
      From: process.env.FROM_EMAIL,
      To: toEmail,
      Subject: `Ticket Created — ${ticketNumber}`,
      TextBody: `
Your ticket ${ticketNumber} has been successfully created.

Our operations team will review it shortly.

Thank you,
Pariskq Operations Team
      `.trim(),
    },
    'TICKET_CONFIRMATION'
  )
}

/* =====================================================
   2️⃣ FE ACTION TOKEN EMAIL
===================================================== */
export async function sendFETokenEmail({
  feId,
  ticketNumber,
  token,
  type,
}) {
  try {
    const { data: fe, error } = await supabase
      .from('field_executives')
      .select('email, name')
      .eq('id', feId)
      .single()

    if (error || !fe?.email) {
      console.warn('[FE EMAIL SKIPPED] FE not found')
      return
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

    await sendEmail(
      {
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
      },
      'FE_TOKEN'
    )
  } catch (err) {
    console.error('[sendFETokenEmail ERROR]', err.message)
  }
}

/* =====================================================
   3️⃣ TICKET RESOLUTION EMAIL
===================================================== */
export async function sendResolutionEmail({
  toEmail,
  ticketNumber,
}) {
  if (!toEmail) return

  await sendEmail(
    {
      From: process.env.FROM_EMAIL,
      To: toEmail,
      Subject: `Ticket Resolved — ${ticketNumber}`,
      TextBody: `
Your ticket ${ticketNumber} has been resolved.

If you have any further issues, feel free to raise a new ticket.

Thank you,
Pariskq Operations Team
      `.trim(),
    },
    'TICKET_RESOLUTION'
  )
}
