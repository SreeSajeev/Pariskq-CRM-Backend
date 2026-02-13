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
const POSTMARK_URL = 'https://api.postmarkapp.com/email';
import { supabase } from '../supabaseClient.js';

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

/* ===============================
   FE ACTION TOKEN EMAIL
================================ */

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

/* ===============================
   RESOLUTION EMAIL (CLIENT)
================================ */

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

/* ===============================
   CLIENT CLOSURE EMAIL (SINGLE OR CONSOLIDATED)
================================ */

export async function sendClientClosureEmail({
  to,
  consolidated = false,
  ticket = null,
  tickets = [],
}) {
  if (!consolidated && !ticket) {
    throw new Error('Must provide ticket for non-consolidated email');
  }

  if (consolidated && tickets.length === 0) {
    throw new Error('Must provide tickets array for consolidated email');
  }

  let subject, textBody;

  if (consolidated) {
    // Consolidated email for 5+ tickets
    const ticketNumbers = tickets.map(t => t.ticket_number).join(', ');
    
    subject = `${tickets.length} Tickets Resolved`;
    textBody = `
Hello,

We're pleased to inform you that ${tickets.length} of your recent tickets have been resolved:

${tickets.map(t => `• ${t.ticket_number} - ${t.category || 'General'}`).join('\n')}

All issues have been addressed. If you have any further concerns, please don't hesitate to reach out.

Thank you for your patience.
Pariskq Support Team
    `.trim();
  } else {
    // Single ticket email
    subject = `Ticket Resolved — ${ticket.ticket_number}`;
    textBody = `
Hello,

Your ticket ${ticket.ticket_number} has been successfully resolved.

Category: ${ticket.category || 'General'}

If you have any further issues or questions, feel free to reply to this email.

Thank you for your patience.
Pariskq Support Team
    `.trim();
  }

  const payload = {
    From: process.env.FROM_EMAIL,
    To: to,
    Subject: subject,
    TextBody: textBody,
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