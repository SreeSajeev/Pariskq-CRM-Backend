const POSTMARK_URL = 'https://api.postmarkapp.com/email';

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
